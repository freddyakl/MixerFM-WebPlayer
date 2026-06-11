import { useState } from "react";
import { Check, Copy, Download, Server, Terminal, Radio, HelpCircle } from "lucide-react";

export default function DeploymentPanel() {
  const [copied, setCopied] = useState(false);

  // Standalone, self-contained, robust index.php script source code containing server-side metadata bypass + complete client logic
  const phpCode = `<?php
/**
 * Mixer FM - Standalone Apache Deployment Script
 * Single-file PHP/HTML/JS solution incorporating a PHP server-side CORS-bypass metadata parser
 * optimized immediately for Ubuntu + Apache + PHP7.4+ setups.
 */

// Robust helper to read precise number of bytes from live stream socket, bypassing network packet fragmentation limits
if (!function_exists('robust_fread')) {
    function robust_fread($stream, $length) {
        $buffer = '';
        $timeout = 3.0;
        $start = microtime(true);
        while (strlen($buffer) < $length && (microtime(true) - $start) < $timeout) {
            $chunk = @fread($stream, $length - strlen($buffer));
            if ($chunk === false || strlen($chunk) === 0) {
                usleep(1500); // 1.5ms micro sleep to await more streaming frames
                continue;
            }
            $buffer .= $chunk;
        }
        return $buffer;
    }
}

// Durable fetch function supporting curl fallback when allow_url_fopen is disabled in php.ini config
if (!function_exists('php_get_url_contents')) {
    function php_get_url_contents($url) {
        if (ini_get('allow_url_fopen')) {
            $context = stream_context_create([
                'http' => [
                    'timeout' => 3.0,
                    'follow_location' => 1,
                    'max_redirects' => 5
                ],
                'ssl' => [
                    'verify_peer' => false,
                    'verify_peer_name' => false,
                    'allow_self_signed' => true
                ]
            ]);
            return @file_get_contents($url, false, $context);
        } elseif (function_exists('curl_init')) {
            $ch = curl_init();
            curl_setopt($ch, CURLOPT_URL, $url);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_TIMEOUT, 3);
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
            curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);
            curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
            $result = curl_exec($ch);
            curl_close($ch);
            return $result;
        }
        return false;
    }
}

// -------------------------------------------------------------
// PHP PWA Endpoints: Output Web Manifest dynamically
// -------------------------------------------------------------
if (isset($_GET['action']) && $_GET['action'] === 'manifest') {
    header('Content-Type: application/json');
    header('Access-Control-Allow-Origin: *');
    echo json_encode([
        'name' => 'Mixer FM',
        'short_name' => 'Mixer FM',
        'description' => 'Mixer FM - High definition live audio stream player',
        'start_url' => 'index.php',
        'display' => 'standalone',
        'orientation' => 'any',
        'background_color' => '#0a0a0a',
        'theme_color' => '#00F0FF',
        'icons' => [
            [
                'src' => 'https://itunes.apple.com/favicon.ico',
                'sizes' => '32x32',
                'type' => 'image/x-icon'
            ],
            [
                'src' => 'og.jpg',
                'sizes' => '512x512',
                'type' => 'image/jpeg',
                'purpose' => 'any'
            ],
            [
                'src' => 'og.jpg',
                'sizes' => '512x512',
                'type' => 'image/jpeg',
                'purpose' => 'maskable'
            ]
        ]
    ]);
    exit;
}

// -------------------------------------------------------------
// PHP PWA Endpoints: Output Service Worker JS dynamically
// -------------------------------------------------------------
if (isset($_GET['action']) && $_GET['action'] === 'sw') {
    header('Content-Type: application/javascript');
    header('Access-Control-Allow-Origin: *');
    echo "const CACHE_NAME = 'mixerfm-pwa-cache-v1';
const PRE_CACHE_ASSETS = [
    'index.php',
    'og.jpg'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(PRE_CACHE_ASSETS).catch((err) => {
                console.warn('Pre-cache warning or offline asset mismatch:', err);
            });
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    
    const url = new URL(event.request.url);
    if (url.search.includes('action=metadata') || url.protocol === 'chrome-extension:') {
        return;
    }
    
    if (url.port === '9118' || url.hostname.includes('itunes.apple.com')) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }
            return fetch(event.request).then((networkResponse) => {
                if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
                    return networkResponse;
                }
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseToCache);
                });
                return networkResponse;
            }).catch(() => {
                if (event.request.mode === 'navigate') {
                    return caches.match('index.php');
                }
            });
        })
    );
});";
    exit;
}

// -------------------------------------------------------------
// PHP Backend API Endpoint: Intercept AJAX metadata requests
// -------------------------------------------------------------
if (isset($_GET['action']) && $_GET['action'] === 'metadata') {
    header('Content-Type: application/json');
    header('Access-Control-Allow-Origin: *');
    
    $streamUrl = isset($_GET['url']) ? filter_var($_GET['url'], FILTER_VALIDATE_URL) : '';
    
    if (!$streamUrl) {
        echo json_encode([
            'success' => false,
            'error' => 'Invalid or empty Stream URL provided.'
        ]);
        exit;
    }

    try {
        // Run native Icecast ICY metadata reader within PHP with full redirects tracing & disabled TLS peer check
        $context = stream_context_create([
            'http' => [
                'method' => 'GET',
                'header' => "Icy-MetaData: 1\\r\\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) IcecastMetadataReader/1.0\\r\\n",
                'timeout' => 4.0,
                'follow_location' => 1,
                'max_redirects' => 5
            ],
            'ssl' => [
                'verify_peer' => false,
                'verify_peer_name' => false,
                'allow_self_signed' => true
            ]
        ]);

        $stream = @fopen($streamUrl, 'r', false, $context);
        
        if (!$stream) {
            throw new Exception("Could not open stream connection directly to $streamUrl");
        }

        // Parse meta wrappers and search sequential $http_response_header array natively
        $wrapperHeaders = [];
        if (isset($http_response_header)) {
            $wrapperHeaders = $http_response_header;
        } else {
            $metadataHeaders = stream_get_meta_data($stream);
            $wrapperHeaders = isset($metadataHeaders['wrapper_data']) ? $metadataHeaders['wrapper_data'] : [];
        }
        
        $metaint = 0;
        foreach ($wrapperHeaders as $header) {
            if (stripos($header, 'icy-metaint:') === 0) {
                list(, $metaVal) = explode(':', $header, 2);
                $metaint = (int)trim($metaVal);
                break;
            }
        }

        if ($metaint <= 0) {
            fclose($stream);
            
            // Backup connection attempt: Parse title from structure-json on custom Icecast mounts
            $parsedUrl = parse_url($streamUrl);
            $port = isset($parsedUrl['port']) ? ':' . $parsedUrl['port'] : '';
            $statusUrl = $parsedUrl['scheme'] . '://' . $parsedUrl['host'] . $port . '/status-json.xsl';
            
            $jsonStats = php_get_url_contents($statusUrl);
            
            if ($jsonStats) {
                $statusData = json_decode($jsonStats, true);
                if (isset($statusData['icestats']['source'])) {
                    $sources = $statusData['icestats']['source'];
                    $curSource = null;
                    
                    if (isset($sources[0])) {
                        // Scan mount listings for precise path matching
                        $path = isset($parsedUrl['path']) ? $parsedUrl['path'] : '';
                        foreach ($sources as $src) {
                            $mount = isset($src['mount']) ? $src['mount'] : '';
                            if ($mount && ($path === $mount || strpos($path, $mount) !== false || strpos($mount, $path) !== false)) {
                                $curSource = $src;
                                break;
                            }
                        }
                        if (!$curSource) {
                            $curSource = $sources[0];
                        }
                    } else {
                        $curSource = $sources;
                    }
                    
                    if ($curSource && isset($curSource['title'])) {
                        $fullTitle = trim($curSource['title']);
                        $parts = explode(' - ', $fullTitle, 2);
                        echo json_encode([
                            'success' => true,
                            'method' => 'status-json',
                            'data' => [
                                'artist' => count($parts) > 1 ? trim($parts[0]) : '',
                                'title' => count($parts) > 1 ? trim($parts[1]) : $fullTitle,
                                'raw' => $fullTitle
                            ]
                        ]);
                        exit;
                    }
                }
            }
            throw new Exception("ICY stream does not support inline metadata and status-json.xsl was not found.");
        }

        // We have metaint! Read and discard the precise audio payload interval
        robust_fread($stream, $metaint);
        
        // Read 1-byte metadata length flag block (1 byte maps to length of raw metadata string * 16)
        $lenByteChar = robust_fread($stream, 1);
        if (strlen($lenByteChar) === 0) {
            throw new Exception("Unexpected stream endpoint while reading metadata size.");
        }
        
        $metadataLength = ord($lenByteChar) * 16;
        
        if ($metadataLength > 0) {
            $rawMetaBlock = robust_fread($stream, $metadataLength);
            fclose($stream);

            $rawMetaBlock = rtrim($rawMetaBlock, "\\0");
            if (preg_match('/StreamTitle=\\\'(.*?)\\\'(?=;|StreamUrl=|$)/s', $rawMetaBlock, $matches)) {
                $fullTitle = trim($matches[1]);
                $parts = explode(' - ', $fullTitle, 2);
                echo json_encode([
                    'success' => true,
                    'method' => 'icy-stream-headers',
                    'data' => [
                        'artist' => count($parts) > 1 ? trim($parts[0]) : 'Live Host',
                        'title' => count($parts) > 1 ? trim($parts[1]) : $fullTitle,
                        'raw' => $fullTitle
                    ]
                ]);
                exit;
            }
        }
        
        fclose($stream);
        echo json_encode([
            'success' => true,
            'method' => 'icy-stream-headers-empty',
            'data' => [
                'artist' => 'Live Stream',
                'title' => 'Streaming Live Audio',
                'raw' => 'Live Stream - Streaming Live Audio'
            ]
        ]);
    } catch (Exception $e) {
        echo json_encode([
            'success' => false,
            'error' => $e->getMessage(),
            'fallback' => [
                'artist' => 'Audio Broadcast',
                'title' => 'Live Broadcast',
                'raw' => 'Audio Broadcast - Live Broadcast'
            ]
        ]);
    }
    exit;
}
?>
<!DOCTYPE html>
<html lang="en" class="min-h-full bg-slate-950 text-slate-100">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mixer FM</title>
    <link rel="manifest" href="index.php?action=manifest">
    <meta name="theme-color" content="#00F0FF">
    <!-- iOS support -->
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="Mixer FM">
    <link rel="apple-touch-icon" href="og.jpg">
    <!-- Fonts -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
    <!-- Tailwind CSS CDN -->
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            theme: {
                extend: {
                    fontFamily: {
                        sans: ['Inter', 'sans-serif'],
                        display: ['Anton', 'sans-serif'],
                        mono: ['JetBrains Mono', 'monospace'],
                    },
                    colors: {
                        primary: '#00F0FF'
                    }
                }
            }
        }
    </script>
    <style>
        html, body {
            min-height: 100% !important;
            height: auto !important;
            overflow-y: auto !important;
            overflow-x: hidden !important;
            scroll-behavior: smooth;
        }
        .custom-focus:focus-visible {
            outline: 2px solid #00F0FF;
            outline-offset: 2px;
        }
        /* Soft pulsing ambient glowing background shadows matching cyan */
        .ambient-radial {
            background: radial-gradient(circle at center, rgba(0, 240, 255, 0.15) 0%, rgba(15, 23, 42, 0) 70%);
        }
        /* Smooth scrolling marquee animations */
        @keyframes marquee {
            0% { transform: translate3d(0, 0, 0); }
            100% { transform: translate3d(-50%, 0, 0); }
        }
        .marquee-wrapper {
            width: 100%;
            overflow: hidden;
            position: relative;
            white-space: nowrap;
            mask-image: linear-gradient(to right, transparent, white 8%, white 92%, transparent);
            -webkit-mask-image: linear-gradient(to right, transparent, white 8%, white 92%, transparent);
        }
        .marquee-content {
            display: inline-flex;
            white-space: nowrap;
            animation: marquee 16s linear infinite;
        }
        .marquee-content:hover {
            animation-play-state: paused;
        }
    </style>
</head>
<body class="min-h-full flex flex-col font-sans selection:bg-primary selection:text-slate-950" onload="initPlayer()">

    <!-- App Root Grid Outer Layout -->
    <div class="min-h-screen flex flex-col relative overflow-x-hidden bg-slate-950 p-4 sm:p-6 md:p-8 pb-24">
        
        <!-- Glowing ambient background synced dynamically with client script -->
        <div id="ambientBackdrop" class="absolute inset-0 pointer-events-none transition-all duration-1000 ease-out ambient-radial z-0"></div>

        <!-- Header Bar -->
        <header class="w-full max-w-5xl mx-auto flex items-center justify-end z-10 pb-6 border-b border-slate-800/60 mb-6">
            <div class="flex items-center gap-3">
                <span class="px-2.5 py-1 text-[10px] font-mono tracking-widest bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full flex items-center gap-1.5 shadow-sm shadow-emerald-500/5">
                    <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    APACHE RUNNING
                </span>
            </div>
        </header>

        <!-- Dynamic PWA Installation Promotion Alert Banner -->
        <div id="pwaInstallBanner" style="display: none;" class="w-full max-w-5xl mx-auto bg-gradient-to-r from-primary/15 to-transparent border border-primary/30 p-4 rounded-2xl mb-6 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl relative overflow-hidden transition-all z-20">
            <div class="absolute inset-0 bg-primary/5 hover:bg-primary/10 transition-colors pointer-events-none"></div>
            <div class="flex items-center gap-3.5 z-10 text-left">
                <div class="bg-primary/25 border border-primary/40 rounded-xl p-2.5 shrink-0 flex items-center justify-center animate-pulse">
                    <svg class="w-5 h-5 text-primary fill-none stroke-current" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 21l8.905-12.232H13l1-5L5 16H9.813z" />
                    </svg>
                </div>
                <div>
                    <h4 class="text-sm font-bold text-slate-100 uppercase tracking-wide">
                        Mixer FM Desktop Web App
                    </h4>
                    <p class="text-[11px] text-slate-300 font-sans mt-0.5">
                        Install on your computer or phone home screen for standalone player windows, multimedia keys, and offline speed.
                    </p>
                </div>
            </div>
            <div class="flex items-center gap-3 shrink-0 z-10 w-full sm:w-auto">
                <button onclick="dismissPwaPromo()" class="w-1/2 sm:w-auto text-xs font-mono text-slate-400 hover:text-slate-100 py-2 px-3.5 rounded-xl border border-slate-800 bg-slate-900/60 active:scale-95 transition-all text-center cursor-pointer">
                    LATER
                </button>
                <button onclick="triggerPwaInstall()" class="w-1/2 sm:w-auto text-xs font-mono text-slate-950 bg-primary hover:bg-primary/80 font-extrabold uppercase py-2 px-4 shadow-md shadow-primary/20 rounded-xl flex items-center justify-center gap-1.5 hover:scale-[1.02] active:scale-95 transition-all text-center cursor-pointer">
                    INSTALL NOW →
                </button>
            </div>
        </div>

        <!-- Main Workspace Grid -->
        <main class="w-full max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8 items-start z-10 flex-grow">
            
            <!-- Left Side Column: Core Showcase -->
            <section class="lg:col-span-7 flex flex-col items-center gap-6 w-full">
                
                <!-- Main Player Card Frame -->
                <div class="w-full bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 shadow-2xl relative overflow-hidden transition-all duration-300">
                    
                    <!-- Cover image holder and overlay interactive states (Click to toggle playback) -->
                    <div onclick="triggerPlayback()" class="aspect-square w-full max-w-md mx-auto relative rounded-2xl overflow-hidden group shadow-2xl border border-slate-850 mb-6 bg-slate-950 cursor-pointer hover:border-primary/45 hover:scale-[1.01] active:scale-[0.99] transition-all duration-300">
                        <!-- Custom logo image staying as the fallback logo og.jpg -->
                        <img id="mainAlbumArt" 
                             src="og.jpg"
                             alt="Current Track Artwork fallback" 
                             class="w-full h-full object-cover transition-transform duration-500 ease-out select-none"
                             referrerpolicy="no-referrer"
                             onerror="this.onerror=null; this.src='og.jpg';">
                        
                        <!-- Transparent Watermark on Top Right of Album Cover -->
                        <img src="/wm.png" 
                             alt="Watermark Logo" 
                             class="absolute top-4 right-4 w-12 h-10 object-contain z-10 pointer-events-none opacity-85 select-none filter drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]"
                             referrerpolicy="no-referrer">

                        <!-- Elegant hover overlay (No central circle elements) -->
                        <div id="albumSpinOverlay" class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col items-center justify-center gap-2.5 z-20">
                            <svg id="hoverIconSVG" class="w-12 h-12 text-primary fill-current" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z"></path>
                            </svg>
                            <span id="hoverStatusText" class="text-xs font-mono font-bold tracking-widest text-primary uppercase">CLICK TO PLAY</span>
                        </div>
                    </div>

                    <!-- Audio Metadata panel -->
                    <div class="text-center space-y-2 mb-6 w-full max-w-full overflow-hidden">
                        <div class="flex items-center justify-center gap-2">
                            <span id="playerStatusBadge" class="bg-black/70 backdrop-blur-md border border-slate-800/80 text-primary font-mono text-[9px] font-bold tracking-widest px-2.5 py-1 rounded-full uppercase shadow-xl">
                                STANDBY
                            </span>
                        </div>
                        <div id="titleContainer" class="max-w-md mx-auto w-full flex justify-center py-1">
                            <h2 id="currentTrackTitle" class="font-display text-2xl sm:text-3xl text-slate-100 uppercase tracking-wide leading-tight py-0.5 break-words text-center w-full block">
                                Mixer FM Broadcast
                            </h2>
                        </div>
                        <div id="artistContainer" class="max-w-md mx-auto w-full flex justify-center py-1">
                            <p id="currentArtist" class="text-primary font-mono text-xs sm:text-sm tracking-wider uppercase font-semibold break-words text-center w-full block">
                                Awaiting Live Stream
                            </p>
                        </div>
                        <!-- Sandbox Lyrics Button on the Right -->
                        <div id="sandboxBtnContainer" class="justify-end max-w-md mx-auto mt-2" style="display: none; padding-right: 0.5rem;">
                            <button onclick="toggleLyricsModal()" class="px-3.5 py-1.5 bg-white/5 hover:bg-primary/10 text-primary border border-primary/30 hover:border-primary/60 text-xs font-mono font-bold tracking-wider rounded-xl uppercase transition-all duration-200 flex items-center gap-1.5 shadow-sm active:scale-95 cursor-pointer">
                                <svg class="w-3.5 h-3.5 text-primary" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-11.314l.707.707m11.314 11.314l.707.707M12 8a4 4 0 100 8 4 4 0 000-8z"></path>
                                </svg>
                                <span>Sandbox</span>
                            </button>
                        </div>
                    </div>

                    <!-- Hidden Audio Element -->
                    <audio id="audioInstance" crossorigin="anonymous" style="display:none;"></audio>

                    <!-- Elegant Equalizer bars representing live playback state -->
                    <div id="simulatedWave" class="flex items-center justify-center gap-1.5 h-10 px-2 opacity-30 select-none transition-opacity duration-300">
                        <div class="w-1.5 bg-primary rounded-full transition-all duration-150 h-5"></div>
                        <div class="w-1.5 bg-primary rounded-full transition-all duration-150 h-3"></div>
                        <div class="w-1.5 bg-primary rounded-full transition-all duration-150 h-8"></div>
                        <div class="w-1.5 bg-primary rounded-full transition-all duration-150 h-4"></div>
                        <div class="w-1.5 bg-primary rounded-full transition-all duration-150 h-6"></div>
                        <div class="w-1.5 bg-primary rounded-full transition-all duration-150 h-2"></div>
                        <div class="w-1.5 bg-primary rounded-full transition-all duration-150 h-7"></div>
                        <div class="w-1.5 bg-primary rounded-full transition-all duration-150 h-4"></div>
                        <div class="w-1.5 bg-primary rounded-full transition-all duration-150 h-9"></div>
                        <div class="w-1.5 bg-primary rounded-full transition-all duration-150 h-3"></div>
                        <div class="w-1.5 bg-primary rounded-full transition-all duration-150 h-6"></div>
                        <div class="w-1.5 bg-primary rounded-full transition-all duration-150 h-2"></div>
                    </div>

                </div>

                <!-- Wikipedia Insights Card -->
                <div id="wikipediaCard" style="display: none;" class="w-full bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 shadow-2xl relative overflow-hidden text-left transition-all duration-300">
                    <div class="absolute inset-0 bg-gradient-to-b from-white/[0.01] to-transparent pointer-events-none"></div>
                    
                    <div class="flex items-center gap-3 mb-4 relative z-10">
                        <div class="bg-primary/10 border border-primary/30 rounded-xl p-2.5 flex items-center justify-center">
                            <svg class="w-5 h-5 text-primary" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path>
                            </svg>
                        </div>
                        <div>
                            <h3 class="font-display text-lg tracking-wide uppercase text-slate-100 font-bold leading-none">
                                WIKIPEDIA INSIGHTS
                            </h3>
                            <p class="text-[10px] font-mono text-slate-400 uppercase tracking-widest mt-1">
                                Dynamic Track Encyclopedia
                            </p>
                        </div>
                    </div>

                    <div class="flex flex-col sm:flex-row gap-5 items-start relative z-10">
                        <img id="wikiThumbnail" src="" alt="Wiki image" class="w-24 h-24 sm:w-28 sm:h-28 object-cover rounded-2xl border border-slate-800 flex-shrink-0 shadow-lg bg-slate-950 hidden" referrerpolicy="no-referrer">
                        <div class="flex-grow text-left space-y-2">
                            <h4 class="font-sans text-base font-bold text-slate-100 leading-snug flex items-center gap-2 flex-wrap">
                                <span id="wikiTitle">Loading...</span>
                                <span id="wikiDescription" class="text-[10px] font-mono py-0.5 px-2 bg-slate-950 text-slate-400 border border-slate-800 rounded-full font-normal hidden">Artist Description</span>
                            </h4>
                            <p id="wikiExtract" class="text-xs text-slate-350 leading-relaxed font-sans">
                                Loading Wikipedia page...
                            </p>
                            <div class="pt-2 flex">
                                <a id="wikiLink" href="" target="_blank" rel="noreferrer" class="inline-flex items-center gap-1.5 text-xs font-mono font-bold text-primary hover:text-primary/80 tracking-wider uppercase group cursor-pointer">
                                    Read full article 
                                    <svg class="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>
                                    </svg>
                                </a>
                            </div>
                        </div>
                    </div>
                </div>

            </section>

            <!-- Right Side Column: Dynamic Track History -->
            <section class="lg:col-span-5 space-y-6 sm:space-y-8">

                <!-- Playback History Panel -->
                <div class="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-3xl p-5 shadow-xl">
                    <h3 class="font-display text-lg tracking-wide uppercase text-slate-100 mb-3 flex items-center gap-2">
                        <svg class="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                        </svg>
                        PLAYBACK SONG HISTORY
                    </h3>
                    
                    <!-- Dynamic History List -->
                    <div id="historyList" class="space-y-2.5 max-h-64 overflow-y-auto pr-1">
                        <!-- History elements injected by JS dynamically -->
                        <p class="text-xs font-mono text-slate-500 italic text-center py-4">No tracks played in this session yet.</p>
                    </div>
                </div>

                <!-- Accessibility Help Guide -->
                <div class="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4">
                    <div class="flex items-center gap-2.5 mb-2">
                        <div class="bg-primary/10 p-1.5 rounded-lg border border-primary/20">
                            <svg class="h-4 w-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"></path>
                            </svg>
                        </div>
                        <h4 class="text-xs font-mono tracking-widest uppercase font-bold text-slate-200">ACCESSIBILITY KEYBOARD HOTKEYS</h4>
                    </div>
                    <ul class="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] font-mono text-slate-400">
                        <li><kbd class="px-1.5 py-0.5 bg-slate-950 border border-slate-800 rounded shadow-xs text-[10px] text-primary mr-1.5 font-mono">Space</kbd> Play / Pause</li>
                        <li><kbd class="px-1.5 py-0.5 bg-slate-950 border border-slate-800 rounded shadow-xs text-[10px] text-primary mr-1.5 font-mono">M</kbd> Toggle Mute</li>
                        <li><kbd class="px-1.5 py-0.5 bg-slate-950 border border-slate-800 rounded shadow-xs text-[10px] text-primary mr-1.5 font-mono">▲ Arrow</kbd> Volume Level Up</li>
                        <li><kbd class="px-1.5 py-0.5 bg-slate-950 border border-slate-800 rounded shadow-xs text-[10px] text-primary mr-1.5 font-mono">▼ Arrow</kbd> Volume Level Down</li>
                    </ul>
                </div>

            </section>
        </main>

        <!-- Footer -->
        <footer class="w-full max-w-5xl mx-auto pt-8 border-t border-slate-800/60 mt-10 text-center z-10">
            <p class="text-xs font-mono text-slate-500">
                Powered by HTML5 Audio, PHP, and iTunes Search engine. Compatible with Ubuntu Apache deployments.
            </p>
        </footer>
    </div>

    <!-- Beautiful Lyrics Sandbox Modal (Vanilla HTML) -->
    <div id="lyricsSandboxModal" style="display: none;" class="fixed inset-0 z-50 items-center justify-center p-4">
        <!-- Backdrop blur overlay -->
        <div onclick="toggleLyricsModal()" class="absolute inset-0 bg-black/85 backdrop-blur-md"></div>
        
        <!-- Modal Box -->
        <div class="bg-slate-900 border border-slate-800 rounded-[2.5rem] w-full max-w-lg overflow-hidden shadow-2xl relative z-10 flex flex-col max-h-[80vh] transition-all duration-300 transform scale-95 opacity-0" id="lyricsContentBox">
            <div class="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none"></div>
            
            <!-- Modal Header -->
            <div class="p-6 sm:p-8 border-b border-slate-800/60 flex items-start justify-between gap-4">
                <div>
                  <span class="text-[9px] font-mono tracking-widest text-primary bg-primary/10 border border-primary/30 px-2.5 py-1 rounded-full uppercase font-bold">
                    LYRICS SANDBOX
                  </span>
                  <h3 id="lyricsModalTitle" class="font-display text-xl text-slate-100 uppercase tracking-wider mt-3 leading-tight">
                    Mixer FM Broadcast
                  </h3>
                  <p id="lyricsModalArtist" class="text-xs text-slate-400 font-sans mt-0.5 animate-pulse">
                    Awaiting Live Stream
                  </p>
                </div>
                <button onclick="toggleLyricsModal()" class="p-2 text-slate-500 hover:text-slate-200 bg-slate-800/40 hover:bg-slate-800 rounded-full transition-colors cursor-pointer focus:outline-none">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
            </div>
            
            <!-- Scrollable Lyrics -->
            <div class="flex-grow p-6 sm:p-8 overflow-y-auto text-left custom-scrollbar">
                <p id="lyricsText" class="text-sm text-slate-200 leading-relaxed font-sans whitespace-pre-line text-center italic tracking-wide">
                    Loading lyrics...
                </p>
            </div>

            <!-- Modal Footer -->
            <div class="p-4 border-t border-slate-800/60 bg-slate-950 text-center">
                <p class="text-[9px] font-mono text-slate-500 uppercase tracking-widest">
                  Live synchronized lyric sandbox data pipeline
                </p>
            </div>
        </div>
    </div>

    <!-- -------------------------------------------------------------
         Client-Side JavaScript Application Controller
         ------------------------------------------------------------- -->
    <script>
        const fallbackArtwork = "og.jpg";
        
        let audioEl;
        let isPlaying = false;
        let isMuted = false;
        let savedVolume = 0.8;
        let streamUrl = "";
        let metaTimer = null;
        let queryInFlight = false;
        let songHistory = [];
        try {
            const savedHistory = localStorage.getItem('ice_track_history');
            if (savedHistory) {
                songHistory = JSON.parse(savedHistory);
            }
        } catch (e) {
            console.error("Could not parse saved history:", e);
        }
        let curTrackRaw = "";
        let currentTrackMeta = { artist: "Awaiting Live Stream", title: "Mixer FM Broadcast" };
        let pwaDeferredPrompt = null;

        // Custom PWA installation prompt listeners for desktop and mobile browsers
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            pwaDeferredPrompt = e;
            const banner = document.getElementById('pwaInstallBanner');
            if (banner) {
                banner.style.display = 'flex';
            }
        });

        window.addEventListener('appinstalled', () => {
            dismissPwaPromo();
        });

        function dismissPwaPromo() {
            pwaDeferredPrompt = null;
            const banner = document.getElementById('pwaInstallBanner');
            if (banner) {
                banner.style.display = 'none';
            }
        }

        async function triggerPwaInstall() {
            if (!pwaDeferredPrompt) return;
            pwaDeferredPrompt.prompt();
            const { outcome } = await pwaDeferredPrompt.userChoice;
            console.log('PWA installation prompt user choice target outcome:', outcome);
            dismissPwaPromo();
        }
        
        function initPlayer() {
            // Register Offline Service Worker for Progressive Web App (PWA) support
            if ('serviceWorker' in navigator) {
                const registerSW = () => {
                    navigator.serviceWorker.register('index.php?action=sw')
                        .then(reg => console.log('Mixer FM PWA Service Worker Registered Successfully', reg.scope))
                        .catch(err => console.error('PWA Service Worker Registration Failed:', err));
                };
                if (document.readyState === 'complete' || document.readyState === 'interactive') {
                    registerSW();
                } else {
                    window.addEventListener('load', registerSW);
                }
            }

            audioEl = document.getElementById('audioInstance');
            streamUrl = "https://icecast.mixerfm.com:9118/mixerfm";
            
            // Render initial history immediately on startup
            renderHistory();
            
            // Apply volume setting
            audioEl.volume = savedVolume;

            // Autoplay when page is loaded
            setTimeout(() => {
                triggerPlayback();
            }, 800);

            // Audio element events
            audioEl.addEventListener('playing', () => {
                setStatus('PLAYING');
                updatePlayButtonVisual(true);
                document.getElementById('simulatedWave').style.opacity = "1";
            });
            audioEl.addEventListener('waiting', () => {
                setStatus('BUFFERING...');
                document.getElementById('simulatedWave').style.opacity = "0.4";
            });
            audioEl.addEventListener('pause', () => {
                setStatus('PAUSED');
                updatePlayButtonVisual(false);
                document.getElementById('simulatedWave').style.opacity = "0.3";
            });
            audioEl.addEventListener('error', (e) => {
                setStatus('CONNECTION ERROR');
                updatePlayButtonVisual(false);
                document.getElementById('simulatedWave').style.opacity = "0.3";
                console.error("Audio Playback Error:", e);
            });

            // Set up metadata updates
            fetchMetadata();
            metaTimer = setInterval(fetchMetadata, 10000); // Poll server-side proxy every 10 seconds

            // Keyboard navigation listener
            window.addEventListener('keydown', handleKeyNavigation);

            // Modulate equalizer look procedural logic
            setInterval(modulateWave, 100);
        }

        function setStatus(text) {
            document.getElementById('playerStatusBadge').innerText = text;
        }

        function updatePlayButtonVisual(playing) {
            isPlaying = playing;
            const hoverIcon = document.getElementById('hoverIconSVG');
            const hoverText = document.getElementById('hoverStatusText');
            if (playing) {
                // Pause Icon SVG
                hoverIcon.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"></path>';
                hoverText.innerText = "CLICK TO PAUSE";
            } else {
                // Play Icon SVG
                hoverIcon.innerHTML = '<path d="M8 5v14l11-7z"></path>';
                hoverText.innerText = "CLICK TO PLAY";
            }

            if ("mediaSession" in navigator) {
                navigator.mediaSession.playbackState = playing ? "playing" : "paused";
            }

            updatePageTitle();
        }

        function triggerPlayback() {
            if (isPlaying) {
                audioEl.pause();
                audioEl.src = ""; // Clear source to stop buffer network activity
            } else {
                setStatus('CONNECTING...');
                // Append cachebuster to make sure browser requests fresh streaming bytes
                audioEl.src = streamUrl + (streamUrl.includes('?') ? '&' : '?') + 'cb=' + Date.now();
                audioEl.load();
                audioEl.play().catch(err => {
                    setStatus('ERROR STARTED');
                    console.error("Playback failed:", err);
                });
            }
        }

        function toggleMute() {
            isMuted = !isMuted;
            audioEl.muted = isMuted;
        }

        function adjustVolume(percent) {
            savedVolume = parseFloat(percent) / 100;
            if (audioEl) {
                audioEl.volume = savedVolume;
                audioEl.muted = false;
                isMuted = false;
            }
        }

        function updatePageTitle() {
            if (isPlaying) {
                document.title = "▶ " + currentTrackMeta.title + " - " + currentTrackMeta.artist + " | Mixer FM";
            } else {
                document.title = "Mixer FM - Standby";
            }
        }

        function handleKeyNavigation(e) {
            // Bypass during active inputs
            if (document.activeElement.tagName === 'INPUT') return;

            if (e.code === 'Space') {
                e.preventDefault();
                triggerPlayback();
            } else if (e.code === 'KeyM') {
                e.preventDefault();
                toggleMute();
            } else if (e.code === 'ArrowUp') {
                e.preventDefault();
                let val = Math.min(100, (audioEl ? audioEl.volume * 100 : 80) + 5);
                adjustVolume(val);
            } else if (e.code === 'ArrowDown') {
                e.preventDefault();
                let val = Math.max(0, (audioEl ? audioEl.volume * 100 : 80) - 5);
                adjustVolume(val);
            }
        }

        // Update display text as wrapping elements rather than marquee animations
        function setDynamicMarquee(containerId, childId, text, isArtist) {
            const container = document.getElementById(containerId);
            if (!container) return;
            
            container.className = "max-w-md mx-auto w-full flex justify-center py-1";
            
            let html = '';
            if (isArtist) {
                html = '<span id="' + childId + '" class="text-primary font-mono text-xs sm:text-sm tracking-wider uppercase font-semibold text-center break-words w-full block">' + text + '</span>';
            } else {
                html = '<span id="' + childId + '" class="font-display text-2xl sm:text-3xl text-slate-100 uppercase tracking-wide leading-tight py-0.5 text-center break-words w-full block">' + text + '</span>';
            }
            container.innerHTML = html;
        }

        // Fetch Metadata using PHP direct helper as proxy
        async function fetchMetadata() {
            if (queryInFlight || !streamUrl) return;
            queryInFlight = true;

            try {
                const response = await fetch('index.php?action=metadata&url=' + encodeURIComponent(streamUrl));
                const resData = await response.json();
                
                if (resData.success && resData.data && resData.data.raw) {
                    const track = resData.data;
                    if (track.raw !== curTrackRaw) {
                        curTrackRaw = track.raw;
                        
                        currentTrackMeta.title = track.title || "LIVE BROADCAST";
                        currentTrackMeta.artist = track.artist || "LIVE AUDIO SOURCE";

                        // Set dynamic marquee fields
                        setDynamicMarquee('titleContainer', 'currentTrackTitle', currentTrackMeta.title, false);
                        setDynamicMarquee('artistContainer', 'currentArtist', currentTrackMeta.artist, true);
                        
                        // Async fetch high-res iTunes artwork directly
                        updateArtwork(track.artist, track.title);
                        updatePageTitle();
                        // Async fetch Wikipedia information and lyrics
                        updateWikipediaInfo(track.artist, track.title);
                        updateLyricsInfo(track.artist, track.title);
                    }
                } else if (resData.fallback) {
                    const fallback = resData.fallback;
                    currentTrackMeta.title = fallback.title;
                    currentTrackMeta.artist = fallback.artist;
                    
                    setDynamicMarquee('titleContainer', 'currentTrackTitle', fallback.title, false);
                    setDynamicMarquee('artistContainer', 'currentArtist', fallback.artist, true);
                    updatePageTitle();
                    // Async fetch Wikipedia information and lyrics
                    updateWikipediaInfo(fallback.artist, fallback.title);
                    updateLyricsInfo(fallback.artist, fallback.title);
                }
            } catch (err) {
                console.error("Metadata fetch error:", err);
            } finally {
                queryInFlight = false;
            }
        }

        // Direct fetch Wikipedia API for matching article summary
        async function updateWikipediaInfo(artist, title) {
            const card = document.getElementById('wikipediaCard');
            const wikiTitleEl = document.getElementById('wikiTitle');
            const wikiDescEl = document.getElementById('wikiDescription');
            const wikiExtractEl = document.getElementById('wikiExtract');
            const wikiImgEl = document.getElementById('wikiThumbnail');
            const wikiLinkEl = document.getElementById('wikiLink');

            if (!card) return;

            // Stop update requests if metadata resolves to default standby formats
            const isStandbyArtist = !artist || /awaiting|mixer\s*fm|live\s*stream|broadcast/gi.test(artist);
            const isStandbyTitle = !title || /awaiting|mixer\s*fm|live\s*stream|broadcast/gi.test(title);

            if (isStandbyArtist && isStandbyTitle) {
                card.style.display = 'none';
                return;
            }

            // Bring block template to active layout state using inline displays
            card.style.display = 'block';
            wikiTitleEl.innerText = "Searching Wikipedia...";
            wikiDescEl.style.display = 'none';
            wikiExtractEl.innerText = "Querying live Wikipedia database for track context and insights...";
            wikiImgEl.style.display = 'none';
            wikiImgEl.src = '';

            try {
                const searchQuery = artist && title ? artist + " " + title : (artist || title);
                const cleanQuery = searchQuery
                    .replace(/\s*[\(\[].*?[\)\]]/g, "")
                    .replace(/\s*-\s*Radio\s*Edit/gi, "")
                    .replace(/\s*Live\s*at.*?/gi, "")
                    .trim();

                const searchUrl = 'https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + encodeURIComponent(cleanQuery) + '&format=json&origin=*';
                const searchRes = await fetch(searchUrl);
                const searchData = await searchRes.json();

                let wikiTitle = "";
                if (searchData.query && searchData.query.search && searchData.query.search.length > 0) {
                    wikiTitle = searchData.query.search[0].title;
                } else if (artist) {
                    // Try artist fallback query
                    const artistQuery = artist.replace(/\s*[\(\[].*?[\)\]]/g, "").trim();
                    const artistUrl = 'https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + encodeURIComponent(artistQuery) + '&format=json&origin=*';
                    const artistRes = await fetch(artistUrl);
                    const artistData = await artistRes.json();
                    if (artistData.query && artistData.query.search && artistData.query.search.length > 0) {
                        wikiTitle = artistData.query.search[0].title;
                    }
                }

                if (wikiTitle) {
                    const summaryUrl = 'https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(wikiTitle);
                    const summaryRes = await fetch(summaryUrl);
                    
                    if (summaryRes.ok) {
                        const summaryData = await summaryRes.json();
                        // Strictly require an informative extract to show the Wikipedia insights card
                        if (summaryData.extract && summaryData.extract.trim() !== "" && summaryData.type !== "no-title") {
                            wikiTitleEl.innerText = summaryData.title || wikiTitle;
                            wikiExtractEl.innerText = summaryData.extract;
                            wikiLinkEl.href = summaryData.content_urls?.desktop?.page || ('https://en.wikipedia.org/wiki/' + encodeURIComponent(wikiTitle));
                            
                            if (summaryData.description) {
                                wikiDescEl.innerText = summaryData.description;
                                wikiDescEl.style.display = 'inline-block';
                            } else {
                                wikiDescEl.style.display = 'none';
                            }

                            if (summaryData.thumbnail && summaryData.thumbnail.source) {
                                wikiImgEl.src = summaryData.thumbnail.source;
                                wikiImgEl.style.display = 'block';
                            } else {
                                wikiImgEl.style.display = 'none';
                            }
                        } else {
                            card.style.display = 'none';
                        }
                    } else {
                        card.style.display = 'none';
                    }
                } else {
                    card.style.display = 'none';
                }
            } catch (e) {
                console.error("Wikipedia search failed:", e);
                card.style.display = 'none';
            }
        }

        // Handle Lyrics lookup and active state
        let activeLyrics = "";

        async function updateLyricsInfo(artist, title) {
            const btnContainer = document.getElementById('sandboxBtnContainer');
            if (!btnContainer) return;

            const isStandbyArtist = !artist || /awaiting|mixer\s*fm|live\s*stream|broadcast/gi.test(artist);
            const isStandbyTitle = !title || /awaiting|mixer\s*fm|live\s*stream|broadcast/gi.test(title);

            if (isStandbyArtist && isStandbyTitle) {
                btnContainer.style.display = 'none';
                activeLyrics = "";
                return;
            }

            try {
                const cleanArtist = artist.replace(/\s*[\(\[].*?[\)\]]/g, "").trim();
                const cleanTitle = title.replace(/\s*[\(\[].*?[\)\]]/g, "").replace(/\s*-\s*Radio\s*Edit/gi, "").trim();

                const response = await fetch('https://api.lyrics.ovh/v1/' + encodeURIComponent(cleanArtist) + '/' + encodeURIComponent(cleanTitle));
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.lyrics && data.lyrics.trim() !== "") {
                        activeLyrics = data.lyrics;
                        btnContainer.style.display = 'flex';
                        return;
                    }
                }
            } catch (err) {
                console.error("Lyrics fetch failed:", err);
            }

            btnContainer.style.display = 'none';
            activeLyrics = "";
        }

        function toggleLyricsModal() {
            const modal = document.getElementById('lyricsSandboxModal');
            const box = document.getElementById('lyricsContentBox');
            if (!modal) return;

            if (modal.style.display === 'none') {
                document.getElementById('lyricsModalTitle').innerText = currentTrackMeta.title;
                document.getElementById('lyricsModalArtist').innerText = currentTrackMeta.artist;
                document.getElementById('lyricsText').innerText = activeLyrics;

                modal.style.display = 'flex';
                setTimeout(() => {
                    box.classList.remove('scale-95', 'opacity-0');
                    box.classList.add('scale-100', 'opacity-100');
                }, 50);
            } else {
                box.classList.add('scale-95', 'opacity-0');
                box.classList.remove('scale-100', 'opacity-100');
                setTimeout(() => {
                    modal.style.display = 'none';
                }, 250);
            }
        }
        window.toggleLyricsModal = toggleLyricsModal;

        // Direct fetch iTunes API for reliable 600x600 size artwork
        async function updateArtwork(artist, title) {
            const fallbackPic = fallbackArtwork;
            const query = (artist ? artist + " " : "") + title;
            const mainImg = document.getElementById('mainAlbumArt');

            try {
                const itunesResponse = await fetch('https://itunes.apple.com/search?term=' + encodeURIComponent(query) + '&limit=1&media=music');
                const iTunesData = await itunesResponse.json();
                
                if (iTunesData.results && iTunesData.results.length > 0) {
                    const match = iTunesData.results[0];
                    let artUrl = match.artworkUrl100 || "";
                    
                    // Replace dimensions from 100x100 to target 600x600 size for extreme clarity
                    if (artUrl) {
                        artUrl = artUrl.replace('/100x100bb.', '/600x600bb.');
                        
                        // Preload image
                        const tempImg = new Image();
                        tempImg.crossOrigin = "anonymous";
                        tempImg.onload = () => {
                            mainImg.src = artUrl;
                            addHistoryRecord(artist, title, artUrl);
                            updateAmbientColor(artUrl);
                            updateBluetoothMetadata(artist, title, artUrl);
                        };
                        tempImg.onerror = () => {
                            mainImg.src = fallbackPic;
                            addHistoryRecord(artist, title, fallbackPic);
                            updateBluetoothMetadata(artist, title, fallbackPic);
                        };
                        tempImg.src = artUrl;
                        return;
                    }
                }
            } catch (e) {
                console.error("iTunes Artwork Retrieval failed:", e);
            }

            mainImg.src = fallbackPic;
            addHistoryRecord(artist, title, fallbackPic);
            resetAmbientColor();
            updateBluetoothMetadata(artist, title, fallbackPic);
        }

        // Media session updates to connected bluetooth gear
        function updateBluetoothMetadata(artist, title, artworkUrl) {
            if ("mediaSession" in navigator) {
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: title || "Mixer FM Broadcast",
                    artist: artist || "Mixer FM",
                    album: "Mixer FM Radio Stream",
                    artwork: [
                        { src: artworkUrl, sizes: "600x600", type: "image/jpeg" }
                    ]
                });
            }
        }

        // Dynamic History state manager
        function addHistoryRecord(artist, title, artUrl) {
            // Check duplicates
            if (songHistory.length > 0 && songHistory[0].title === title && songHistory[0].artist === artist) {
                return;
            }

            songHistory.unshift({
                artist: artist || "Live Stream",
                title: title || "Broadcast Audio",
                artUrl: artUrl,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });

            // Limit to last 5 songs
            if (songHistory.length > 5) {
                songHistory.pop();
            }

            try {
                localStorage.setItem('ice_track_history', JSON.stringify(songHistory));
            } catch (e) {
                console.error("Could not save history to localStorage:", e);
            }

            renderHistory();
        }

        function renderHistory() {
            const list = document.getElementById('historyList');
            if (songHistory.length === 0) {
                list.innerHTML = '<p class="text-xs font-mono text-slate-500 italic text-center py-4">No tracks played in this session yet.</p>';
                return;
            }

            list.innerHTML = songHistory.map(item => [
                '<div class="flex items-center gap-3 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/40 hover:border-slate-800 transition-all duration-150 group">',
                    '<img src="', item.artUrl, '" alt="Song cover art" class="w-10 h-10 rounded-lg object-cover bg-slate-900 border border-slate-800" referrerpolicy="no-referrer">',
                    '<div class="flex-grow min-w-0">',
                        '<h4 class="text-xs font-semibold text-slate-200 truncate group-hover:text-primary transition-colors">', item.title, '</h4>',
                        '<p class="text-[10px] font-mono text-slate-400 truncate">', item.artist, '</p>',
                    '</div>',
                    '<span class="text-[9px] font-mono text-slate-500">', item.time, '</span>',
                '</div>'
            ].join('')).join('');
        }

        // Beautiful dynamic backdrops modulating subtle cyan color glow reflecting active track
        function updateAmbientColor(artUrl) {
            const backdrop = document.getElementById('ambientBackdrop');
            backdrop.style.background = 'radial-gradient(circle at center, rgba(0, 240, 255, 0.22) 0%, rgba(15, 23, 42, 0) 75%)';
        }

        function resetAmbientColor() {
            const backdrop = document.getElementById('ambientBackdrop');
            backdrop.style.background = 'radial-gradient(circle at center, rgba(0, 240, 255, 0.12) 0%, rgba(15, 23, 42, 0) 70%)';
        }

        // Procedural visualizer animation
        function modulateWave() {
            if (!isPlaying) return;
            const bars = document.getElementById('simulatedWave').children;
            for (let bar of bars) {
                const randomHeight = Math.floor(Math.random() * 32) + 6;
                bar.style.height = randomHeight + 'px';
            }
        }
    </script>
</body>
</html>
`;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(phpCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadFile = () => {
    const element = document.createElement("a");
    const file = new Blob([phpCode], { type: "text/plain" });
    element.href = URL.createObjectURL(file);
    element.download = "index.php";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <div id="deployment-panel" className="bg-white/[0.03] backdrop-blur-xl border border-white/10 rounded-[2rem] p-6 sm:p-8 shadow-2xl relative overflow-hidden">
      {/* Background Graphic elements */}
      <div className="absolute -top-12 -right-12 w-48 h-48 bg-[#00F0FF]/5 rounded-full blur-3xl pointer-events-none"></div>
      
      {/* Drawer Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/10 mb-6">
        <div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold uppercase tracking-widest bg-[#00F0FF]/10 text-[#00F0FF] border border-[#00F0FF]/25 mb-2">
            <Server className="w-3.5 h-3.5 animate-pulse" /> Standalone Apache Server Ready
          </span>
          <h2 className="font-display text-2xl sm:text-3xl text-slate-100 tracking-wide uppercase">
            UBUNTU DEPLOYMENT CENTER
          </h2>
          <p className="text-sm text-slate-400 mt-1 max-w-xl">
            This deployment engine packages all metadata bypass server proxy, iTunes search, and visual templates 
            into a single-file production-ready <code className="bg-black/40 px-1.5 py-0.5 rounded text-[#00F0FF] font-mono text-xs font-bold font-mono">index.php</code> script.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            id="copy-php-btn"
            onClick={copyToClipboard}
            className="flex items-center gap-2 py-2.5 px-4 bg-white/5 hover:bg-white/10 active:scale-95 text-slate-100 text-xs font-mono font-bold uppercase tracking-widest rounded-xl transition-all border border-white/10 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F0FF]"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-emerald-400" /> COPIED!
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" /> COPY CODE
              </>
            )}
          </button>
          <button
            id="download-php-btn"
            onClick={downloadFile}
            className="flex items-center gap-2 py-2.5 px-4 bg-[#00F0FF] hover:bg-[#00d0dd] active:scale-95 text-slate-950 text-xs font-mono font-bold uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-[#00F0FF]/10 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F0FF]"
          >
            <Download className="w-4 h-4 text-slate-950" /> DOWNLOAD .PHP
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        {/* Step-by-Step Setup Guide */}
        <div className="flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            <h3 className="font-mono text-xs tracking-widest uppercase text-[#00F0FF] font-bold flex items-center gap-2">
              <Terminal className="w-4 h-4" /> Ubuntu Server Setup Directives
            </h3>

            <div className="space-y-4 relative pl-3 before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[1.5px] before:bg-white/10">
              <div className="relative">
                <span className="absolute -left-6 top-0 w-5 h-5 rounded-full bg-black border border-white/10 text-[10px] font-mono text-[#00F0FF] flex items-center justify-center font-bold">1</span>
                <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wide">Install Apache & PHP Stack</h4>
                <p className="text-xs text-slate-400 mt-1 mb-2">Connect to your Ubuntu Server node and install prerequisite packages using apt-get:</p>
                <pre className="bg-black/50 text-white p-2.5 rounded-xl text-[11px] font-mono border border-white/10 overflow-x-auto select-all">
                  sudo apt-get update && \<br />
                  sudo apt-get install apache2 php libapache2-mod-php php-curl -y
                </pre>
              </div>

              <div className="relative pt-2">
                <span className="absolute -left-6 top-2 w-5 h-5 rounded-full bg-black border border-white/10 text-[10px] font-mono text-[#00F0FF] flex items-center justify-center font-bold">2</span>
                <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wide">Upload script and set permissions</h4>
                <p className="text-xs text-slate-400 mt-1 mb-2">Place downloaded <code className="font-mono text-[#00F0FF]">index.php</code> into Apache default document folder & clean existing assets:</p>
                <pre className="bg-black/50 text-white p-2.5 rounded-xl text-[11px] font-mono border border-white/10 overflow-x-auto select-all">
                  sudo rm -f /var/www/html/index.html<br />
                  # Save your copied code to /var/www/html/index.php<br />
                  sudo chown -R www-data:www-data /var/www/html/
                </pre>
              </div>

              <div className="relative pt-2">
                <span className="absolute -left-6 top-2 w-5 h-5 rounded-full bg-black border border-white/10 text-[10px] font-mono text-[#00F0FF] flex items-center justify-center font-bold">3</span>
                <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wide">Enable services</h4>
                <p className="text-xs text-slate-400 mt-1 mb-2">Restart the daemon to ensure PHP hooks are mapped correctly to incoming traffic:</p>
                <pre className="bg-black/50 text-white p-2.5 rounded-xl text-[11px] font-mono border border-white/10 overflow-x-auto select-all">
                  sudo systemctl restart apache2
                </pre>
              </div>
            </div>
          </div>

          <div className="bg-black/25 p-4 rounded-2xl border border-white/10 text-xs text-slate-300">
            <h4 className="font-semibold text-slate-200 mb-1 flex items-center gap-1.5 uppercase text-[10px] font-mono tracking-wider font-mono">
              <HelpCircle className="w-3.5 h-3.5 text-[#00F0FF]" /> Stream Metadata Bypass Note
            </h4>
            <p className="text-slate-400 leading-relaxed text-[11px]">
              Icecast servers stream audio chunks live. Standard browsers block direct headers extraction via CORS security restrictions. 
              The server-side proxy routine in our PHP blueprint connects directly, scrapes headers background-ports, and supplies correct 
              metadata feeds back on tap instantly.
            </p>
          </div>
        </div>

        {/* Code Previewer Frame */}
        <div className="flex flex-col bg-black border border-white/10 rounded-2xl overflow-hidden min-h-[300px]">
          <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-white/5">
            <span className="text-[10px] font-mono tracking-widest text-slate-400 uppercase">index.php - SOURCE CODE BLUEPRINT</span>
            <span className="px-2 py-0.5 rounded bg-black border border-white/10 text-[9px] font-mono text-[#00F0FF] uppercase">PHP + JS + CSS</span>
          </div>
          <div className="flex-grow p-4 overflow-y-auto text-[#00F0FF] font-mono text-[10px] leading-relaxed max-h-[340px] select-all scrollbar-thin">
            <pre className="text-slate-300 select-all whitespace-pre">{phpCode}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}
