import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Radio,
  Settings,
  HelpCircle,
  Clock,
  Sparkles,
  Layers,
  ArrowRight,
  RefreshCw,
  Sliders,
  ChevronDown,
  ExternalLink,
  Laptop,
  BookOpen
} from "lucide-react";
import { TrackMetadata, StreamPreset, PlayerState } from "./types";
import AudioVisualizer from "./components/AudioVisualizer";
import DeploymentPanel from "./components/DeploymentPanel";
import MarqueeText from "./components/MarqueeText";

// Import our custom generated premium logo asset (Mixer FM)
import defaultLogo from "./assets/images/og.jpg";

export const MAIN_STREAM_URL = "https://icecast.mixerfm.com:9118/mixerfm";

export default function App() {
  // Main Player State
  const [player, setPlayer] = useState<PlayerState>({
    isPlaying: false,
    isMuted: false,
    volume: 0.8,
    bufferStatus: "idle",
    streamUrl: MAIN_STREAM_URL
  });

  const [currentTrack, setCurrentTrack] = useState<TrackMetadata>({
    artist: "Awaiting Live Stream",
    title: "Mixer FM Broadcast",
    raw: "Awaiting Live Stream",
    artworkUrl: defaultLogo,
    timestamp: new Date().toLocaleTimeString()
  });

  const [history, setHistory] = useState<TrackMetadata[]>([]);
  const [showDeployment, setShowDeployment] = useState(false);
  const [showHotkeysHelp, setShowHotkeysHelp] = useState(true);
  const [metaLoading, setMetaLoading] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInIframe, setIsInIframe] = useState(false);
  const [dismissedIframeHint, setDismissedIframeHint] = useState(false);

  interface WikipediaInfo {
    title: string;
    extract: string;
    url: string;
    thumbnailUrl?: string;
    description?: string;
  }

  const [wikipediaInfo, setWikipediaInfo] = useState<WikipediaInfo | null>(null);
  const [wikiLoading, setWikiLoading] = useState(false);

  // Lyrics states
  const [lyrics, setLyrics] = useState<string | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [showLyricsModal, setShowLyricsModal] = useState(false);

  useEffect(() => {
    setIsInIframe(window.self !== window.top);
  }, []);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Synchronous player Autoplay on page mount
  useEffect(() => {
    const startAudioAutoPlay = setTimeout(() => {
      const audio = audioRef.current;
      if (!audio) return;

      setPlayer((prev) => ({ ...prev, bufferStatus: "connecting" }));
      const audioCacheBuster = `${MAIN_STREAM_URL}${MAIN_STREAM_URL.includes("?") ? "&" : "?"}cb=${Date.now()}`;
      audio.src = audioCacheBuster;
      audio.load();

      audio.play()
        .then(() => {
          setPlayer((prev) => ({ ...prev, isPlaying: true, bufferStatus: "playing" }));
        })
        .catch((err) => {
          console.warn("Autoplay blocked or required user interactive gesture:", err);
          setPlayer((prev) => ({ ...prev, isPlaying: false, bufferStatus: "idle" }));
        });
    }, 800);

    return () => clearTimeout(startAudioAutoPlay);
  }, []);

  // Monitor PWA installation prompt triggers across Chrome/Edge desktop environments
  useEffect(() => {
    // Dynamically register the production Service Worker on loading or immediately if already loaded
    if ("serviceWorker" in navigator) {
      const registerSW = () => {
        navigator.serviceWorker.register("/sw.js")
          .then((reg) => console.log("Mixer FM SPA Service Worker registered successfully:", reg.scope))
          .catch((err) => console.error("SPA Service Worker registration failed:", err));
      };

      if (document.readyState === "complete" || document.readyState === "interactive") {
        registerSW();
      } else {
        window.addEventListener("load", registerSW);
      }
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const triggerPwaInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`PWA install promotion user choice target outcome: ${outcome}`);
    setDeferredPrompt(null);
  };

  // Initialize and load persistent play history from LocalStorage
  useEffect(() => {
    const saved = localStorage.getItem("ice_track_history");
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (e) {
        console.error("Could not parse saved history:", e);
      }
    }
  }, []);

  // Sync historical tracks with LocalStorage
  const saveToHistory = (newTrack: TrackMetadata) => {
    setHistory((prev) => {
      // Avoid duplicate consecutive tracks
      if (prev.length > 0 && prev[0].title === newTrack.title && prev[0].artist === newTrack.artist) {
        return prev;
      }
      const updated = [newTrack, ...prev].slice(0, 5); // caps history list length at 5
      localStorage.setItem("ice_track_history", JSON.stringify(updated));
      return updated;
    });
  };

  // Main HTTP direct polling routine mapping back to Node.js proxy route
  const fetchActiveMetadata = async (targetUrl: string) => {
    if (!targetUrl) return;
    setMetaLoading(true);

    try {
      const response = await fetch(`/api/metadata?url=${encodeURIComponent(targetUrl)}`);
      const payload = await response.json();

      if (payload.success && payload.data && payload.data.raw) {
        const { artist, title, raw } = payload.data;
        
        // Skip updating if music signature has not changed
        if (raw !== currentTrack.raw) {
          const newMeta: TrackMetadata = {
            artist: artist || "Live Stream Node",
            title: title || "Broadcast Room Audio",
            raw: raw,
            artworkUrl: defaultLogo, // default until iTunes check finishes
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          };

          // Trigger remote lookup toward secure client-side iTunes Search API
          await fetchiTunesArtwork(artist, title, newMeta);
        }
      } else if (payload.fallback) {
        // Fallback structures when metadata headers are blank
        const fallback = payload.fallback;
        if (fallback.raw !== currentTrack.raw) {
          const fallbackMeta: TrackMetadata = {
            artist: fallback.artist,
            title: fallback.title,
            raw: fallback.raw,
            artworkUrl: defaultLogo,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          };
          setCurrentTrack(fallbackMeta);
          saveToHistory(fallbackMeta);
        }
      }
    } catch (err) {
      console.error("[Metadata Fetch Fail]", err);
    } finally {
      setMetaLoading(false);
    }
  };

  // Direct integration representing iTunes search API returning clear 600x600 size covers
  const fetchiTunesArtwork = async (artist: string, title: string, track: TrackMetadata) => {
    const rawSearchQuery = artist ? `${artist} ${title}` : title;
    
    // Quick sanitizing of track metadata tags to filter radio promos
    const cleanSearchQuery = rawSearchQuery
      .replace(/\s*[\(\[].*?[\)\]]/g, "") // remove parenthetical remarks
      .replace(/\s*-\s*Radio\s*Edit/gi, "")
      .replace(/\s*Live\s*at.*?/gi, "");

    try {
      const itunesQueryUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(cleanSearchQuery)}&limit=1&media=music`;
      const res = await fetch(itunesQueryUrl);
      const data = await res.json();

      if (data.results && data.results.length > 0) {
        const result = data.results[0];
        let originalArtworkUrl = result.artworkUrl100 || "";
        
        // Transform standard low-res artwork URL (100x100) into extreme ultra-fidelity 600x600 layout
        if (originalArtworkUrl) {
          const highResArtworkUrl = originalArtworkUrl.replace("/100x100bb.", "/600x600bb.");
          
          // Image preload in browser cache to make transitions buttery smooth
          const imgLoader = new Image();
          imgLoader.crossOrigin = "anonymous";
          imgLoader.onload = () => {
            const completedTrack = { ...track, artworkUrl: highResArtworkUrl };
            setCurrentTrack(completedTrack);
            saveToHistory(completedTrack);
          };
          imgLoader.onerror = () => {
            const fallbackCompleted = { ...track, artworkUrl: defaultLogo };
            setCurrentTrack(fallbackCompleted);
            saveToHistory(fallbackCompleted);
          };
          imgLoader.src = highResArtworkUrl;
          return;
        }
      }
    } catch (e) {
      console.error("[iTunes API Failed] Artwork seek failure, displaying default cover logo", e);
    }

    // Default Fallback
    const fallbackTrack = { ...track, artworkUrl: defaultLogo };
    setCurrentTrack(fallbackTrack);
    saveToHistory(fallbackTrack);
  };

  // Handle active music polling hooks
  useEffect(() => {
    fetchActiveMetadata(player.streamUrl);

    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
    }

    // Continuous polling of track metadata to keep display highly accurate
    pollTimerRef.current = setInterval(() => {
      fetchActiveMetadata(player.streamUrl);
    }, 12000);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, [player.streamUrl]);

  // Handle Wikipedia lookup whenever the current track changes
  useEffect(() => {
    let active = true;
    const artist = currentTrack.artist;
    const title = currentTrack.title;

    // Check if the current info is standard standby messaging
    const isStandbyArtist = !artist || /awaiting|mixer\s*fm|live\s*stream|broadcast/gi.test(artist);
    const isStandbyTitle = !title || /awaiting|mixer\s*fm|live\s*stream|broadcast/gi.test(title);

    if (isStandbyArtist && isStandbyTitle) {
      setWikipediaInfo(null);
      return;
    }

    const fetchWiki = async () => {
      setWikiLoading(true);
      setWikipediaInfo(null);

      try {
        const searchQuery = artist && title ? `${artist} ${title}` : (artist || title);
        const cleanQuery = searchQuery
          .replace(/\s*[\(\[].*?[\)\]]/g, "")
          .replace(/\s*-\s*Radio\s*Edit/gi, "")
          .replace(/\s*Live\s*at.*?/gi, "")
          .trim();

        const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanQuery)}&format=json&origin=*`;
        const res = await fetch(searchUrl);
        const searchData = await res.json();

        if (!active) return;

        let wikiTitle = "";
        if (searchData.query?.search?.length > 0) {
          wikiTitle = searchData.query.search[0].title;
        } else if (artist) {
          // Try fetching just the artist as fallback
          const artistQuery = artist
            .replace(/\s*[\(\[].*?[\)\]]/g, "")
            .trim();
          const artistUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(artistQuery)}&format=json&origin=*`;
          const artistRes = await fetch(artistUrl);
          const artistData = await artistRes.json();
          if (!active) return;
          if (artistData.query?.search?.length > 0) {
            wikiTitle = artistData.query.search[0].title;
          }
        }

        if (wikiTitle) {
          const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle)}`;
          const summaryRes = await fetch(summaryUrl);
          if (!active) return;

          if (summaryRes.ok) {
            const summaryData = await summaryRes.json();
            // Strictly require an informative extract to show the Wikipedia insights card
            if (summaryData.extract && summaryData.extract.trim() !== "" && summaryData.type !== "no-title") {
              setWikipediaInfo({
                title: summaryData.title || wikiTitle,
                extract: summaryData.extract,
                url: summaryData.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(wikiTitle)}`,
                thumbnailUrl: summaryData.thumbnail?.source,
                description: summaryData.description
              });
            } else {
              setWikipediaInfo(null);
            }
          } else {
            setWikipediaInfo(null);
          }
        } else {
          setWikipediaInfo(null);
        }
      } catch (e) {
        console.error("[Wikipedia API error]", e);
        if (active) setWikipediaInfo(null);
      } finally {
        if (active) setWikiLoading(false);
      }
    };

    fetchWiki();

    return () => {
      active = false;
    };
  }, [currentTrack.artist, currentTrack.title]);

  // Handle free Lyric fetching from api.lyrics.ovh
  useEffect(() => {
    let active = true;
    const artist = currentTrack.artist;
    const title = currentTrack.title;

    const isStandbyArtist = !artist || /awaiting|mixer\s*fm|live\s*stream|broadcast/gi.test(artist);
    const isStandbyTitle = !title || /awaiting|mixer\s*fm|live\s*stream|broadcast/gi.test(title);

    if (isStandbyArtist && isStandbyTitle) {
      setLyrics(null);
      return;
    }

    const fetchSongLyrics = async () => {
      setLyricsLoading(true);
      setLyrics(null);

      try {
        const cleanArtist = artist
          .replace(/\s*[\(\[].*?[\)\]]/g, "")
          .trim();
        const cleanTitle = title
          .replace(/\s*[\(\[].*?[\)\]]/g, "")
          .replace(/\s*-\s*Radio\s*Edit/gi, "")
          .replace(/\s*Live\s*at.*?/gi, "")
          .trim();

        const res = await fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(cleanArtist)}/${encodeURIComponent(cleanTitle)}`);
        if (!active) return;

        if (res.ok) {
          const data = await res.json();
          if (data.lyrics && data.lyrics.trim() !== "") {
            setLyrics(data.lyrics);
          } else {
            setLyrics(null);
          }
        } else {
          setLyrics(null);
        }
      } catch (e) {
        console.error("[Lyrics API error]", e);
        if (active) setLyrics(null);
      } finally {
        if (active) setLyricsLoading(false);
      }
    };

    fetchSongLyrics();

    return () => {
      active = false;
    };
  }, [currentTrack.artist, currentTrack.title]);

  // Audio stream handling effects
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.volume = player.isMuted ? 0 : player.volume;
    audio.muted = player.isMuted;
  }, [player.volume, player.isMuted]);

  // Handle Play/Stop command sequence
  const startStreamPlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (player.isPlaying) {
      audio.pause();
      audio.src = ""; // Force disconnect remote stream on pause to prevent continuous silent bandwidth consumption
      setPlayer((prev) => ({ ...prev, isPlaying: false, bufferStatus: "idle" }));
    } else {
      setPlayer((prev) => ({ ...prev, bufferStatus: "connecting" }));
      // Anti-cache caching buster addition to avoid frozen browser chunks
      const audioCacheBuster = `${player.streamUrl}${player.streamUrl.includes("?") ? "&" : "?"}cb=${Date.now()}`;
      audio.src = audioCacheBuster;
      audio.load();
      
      audio.play()
        .then(() => {
          setPlayer((prev) => ({ ...prev, isPlaying: true, bufferStatus: "playing" }));
        })
        .catch((err) => {
          console.error("Playback interrupted:", err);
          setPlayer((prev) => ({ ...prev, isPlaying: false, bufferStatus: "error" }));
        });
    }
  };

  const handleMuteToggle = () => {
    setPlayer((prev) => ({ ...prev, isMuted: !prev.isMuted }));
  };

  const handleVolumeChange = (newVal: number) => {
    setPlayer((prev) => ({ ...prev, volume: newVal, isMuted: newVal === 0 }));
  };

  // A ref to keep track of startStreamPlayback function for window/mediaSession handlers
  const startStreamPlaybackRef = useRef<() => void>(() => {});
  useEffect(() => {
    startStreamPlaybackRef.current = startStreamPlayback;
  }, [player.isPlaying, player.streamUrl, startStreamPlayback]);

  // Media session controls for bluetooth devices / lockscreen integration
  useEffect(() => {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title || "Mixer FM Broadcast",
        artist: currentTrack.artist || "Mixer FM",
        album: "Mixer FM Radio Stream",
        artwork: [
          { src: currentTrack.artworkUrl || defaultLogo, sizes: "600x600", type: "image/jpeg" }
        ]
      });
      navigator.mediaSession.playbackState = player.isPlaying ? "playing" : "paused";
    }
  }, [currentTrack, player.isPlaying]);

  useEffect(() => {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.setActionHandler("play", () => {
        startStreamPlaybackRef.current();
      });
      navigator.mediaSession.setActionHandler("pause", () => {
        startStreamPlaybackRef.current();
      });
      navigator.mediaSession.setActionHandler("stop", () => {
        startStreamPlaybackRef.current();
      });
    }
  }, []);

  // Synchronously update page title dynamically matching active stream state
  useEffect(() => {
    if (player.isPlaying) {
      document.title = `▶ ${currentTrack.title} - ${currentTrack.artist} | Mixer FM`;
    } else {
      document.title = `Mixer FM - Standby`;
    }
  }, [currentTrack.title, currentTrack.artist, player.isPlaying]);

  // Keyboard navigation listeners honoring strict WCAG compliance
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Disregard keyboard hotkeys when focus sits inside interactive input boxes
      if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") {
        return;
      }

      switch (e.code) {
        case "Space":
          e.preventDefault();
          startStreamPlayback();
          break;
        case "KeyM":
          e.preventDefault();
          handleMuteToggle();
          break;
        case "ArrowUp":
          e.preventDefault();
          handleVolumeChange(Math.min(1, player.volume + 0.05));
          break;
        case "ArrowDown":
          e.preventDefault();
          handleVolumeChange(Math.max(0, player.volume - 0.05));
          break;
        case "KeyH":
          e.preventDefault();
          setShowHotkeysHelp((prev) => !prev);
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [player]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#f0f0f0] flex flex-col relative overflow-x-hidden font-sans selection:bg-[#00F0FF] selection:text-slate-950">
      
      {/* Absolute Ambient Background matching the cover art glow dynamically */}
      <div 
        className="absolute inset-0 pointer-events-none transition-all duration-1000 ease-out z-0"
        style={{
          background: `radial-gradient(circle at 50% 25%, ${
            player.isPlaying ? "rgba(0, 240, 255, 0.15)" : "rgba(0, 240, 255, 0.05)"
          } 0%, rgba(10, 10, 10, 0) 70%)`
        }}
        aria-hidden="true"
      />

      {/* Programmatic HTML5 Audio node */}
      <audio 
        ref={audioRef} 
        crossOrigin="anonymous"
        onPlay={() => setPlayer(prev => ({ ...prev, isPlaying: true, bufferStatus: "playing" }))}
        onPause={() => setPlayer(prev => ({ ...prev, isPlaying: false, bufferStatus: "idle" }))}
        onWaiting={() => setPlayer(prev => ({ ...prev, bufferStatus: "connecting" }))}
        onPlaying={() => setPlayer(prev => ({ ...prev, bufferStatus: "playing" }))}
        onError={() => setPlayer(prev => ({ ...prev, isPlaying: false, bufferStatus: "error" }))}
      />

      {/* Main Structural Container */}
      <div className="max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-20 flex-grow flex flex-col justify-between z-10 relative">
        
        {/* Navigation Core Branding (Centered/Right-aligned header with logo-text removed, keeping play blueprint & state control) */}
        <header className="flex items-center justify-end gap-4 pb-6 border-b border-white/10 mb-8 mt-4">
          <div className="flex items-center gap-3">
            <button
              id="apache-deployment-toggle-btn"
              onClick={() => setShowDeployment(!showDeployment)}
              className="flex items-center gap-2 py-2 px-4 rounded-xl text-xs font-mono font-bold tracking-wider uppercase border border-white/10 hover:border-white/20 bg-white/5 hover:bg-white/10 text-white/90 hover:text-white transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F0FF]"
              aria-expanded={showDeployment}
              aria-controls="deployment-panel"
            >
              <Laptop className="w-3.5 h-3.5 text-[#00F0FF]" />
              {showDeployment ? "Hide Server Blueprint" : "APACHE SERVER BluePrint"}
            </button>
            
            <div className="flex items-center gap-2 px-3.5 py-1.5 bg-[#00F0FF]/10 border border-[#00F0FF]/30 rounded-full">
              <div className={`w-2 h-2 bg-[#00F0FF] rounded-full ${player.isPlaying ? "animate-pulse" : "opacity-60"}`}></div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#00F0FF]">
                {player.isPlaying ? "LIVE STREAM" : "STREAM STANDBY"}
              </span>
            </div>
          </div>
        </header>        {/* Dynamic PWA Installation Promotion Alert Banner */}
        <AnimatePresence>
          {deferredPrompt ? (
            <motion.div
              initial={{ opacity: 0, height: 0, margin: 0 }}
              animate={{ opacity: 1, height: "auto", marginBottom: "1.5rem" }}
              exit={{ opacity: 0, height: 0, margin: 0 }}
              transition={{ duration: 0.3 }}
              className="bg-gradient-to-r from-[#00F0FF]/15 to-transparent border border-[#00F0FF]/30 rounded-2xl relative overflow-hidden shadow-xl z-20"
            >
              <div className="absolute inset-0 bg-[#00F0FF]/5 hover:bg-[#00F0FF]/10 transition-colors pointer-events-none" />
              <div className="p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-4 w-full">
                <div className="flex items-center gap-3.5 z-10 text-left w-full sm:w-auto">
                  <div className="bg-[#00F0FF]/25 border border-[#00F0FF]/40 rounded-xl p-2.5 shrink-0 flex items-center justify-center animate-pulse">
                    <Sparkles className="w-5 h-5 text-[#00F0FF]" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-100 uppercase tracking-wide">
                      Mixer FM Desktop Web App
                    </h4>
                    <p className="text-[11px] text-white/60 font-sans mt-0.5">
                      Install on your device home screen for standalone player controls, full offline start speed, and media keys.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0 z-10 w-full sm:w-auto">
                  <button
                    onClick={() => setDeferredPrompt(null)}
                    className="w-1/2 sm:w-auto text-xs font-mono text-white/50 hover:text-white py-2 px-3.5 rounded-xl border border-white/5 bg-white/5 active:scale-95 transition-all text-center cursor-pointer"
                  >
                    LATER
                  </button>
                  <button
                    onClick={triggerPwaInstall}
                    className="w-1/2 sm:w-auto text-xs font-mono text-slate-950 bg-[#00F0FF] hover:bg-[#00F0FF]/80 font-extrabold uppercase py-2 px-4 shadow-md shadow-[#00F0FF]/20 rounded-xl flex items-center justify-center gap-1.5 hover:scale-[1.02] active:scale-95 transition-all text-center cursor-pointer"
                  >
                    INSTALL NOW <ArrowRight className="w-3.5 h-3.5 text-slate-950" />
                  </button>
                </div>
              </div>
            </motion.div>
          ) : (isInIframe && !dismissedIframeHint) ? (
            <motion.div
              initial={{ opacity: 0, height: 0, margin: 0 }}
              animate={{ opacity: 1, height: "auto", marginBottom: "1.5rem" }}
              exit={{ opacity: 0, height: 0, margin: 0 }}
              transition={{ duration: 0.3 }}
              className="bg-gradient-to-r from-[#00F0FF]/15 to-transparent border border-[#00F0FF]/30 rounded-2xl relative overflow-hidden shadow-xl z-20"
            >
              <div className="absolute inset-0 bg-[#00F0FF]/5 hover:bg-[#00F0FF]/10 transition-colors pointer-events-none" />
              <div className="p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-4 w-full">
                <div className="flex items-center gap-3.5 z-10 text-left w-full sm:w-auto">
                  <div className="bg-[#00F0FF]/25 border border-[#00F0FF]/40 rounded-xl p-2.5 shrink-0 flex items-center justify-center animate-pulse">
                    <Sparkles className="w-5 h-5 text-[#00F0FF]" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-100 uppercase tracking-wide">
                      💡 PWA Installation Sandbox Guideline
                    </h4>
                    <p className="text-[11px] text-white/60 font-sans mt-0.5 leading-relaxed">
                      Browsers disable PWA installation from inside sandboxed iframes. To install <strong>Mixer FM</strong> as a desktop app, click <strong>"Open in new tab"</strong> at the top-right of the screen, and click <strong>"INSTALL NOW"</strong> or click the Install icon in the browser address bar!
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0 z-10 w-full sm:w-auto">
                  <button
                    onClick={() => setDismissedIframeHint(true)}
                    className="w-full sm:w-auto text-xs font-mono text-white/50 hover:text-white py-2 px-4 rounded-xl border border-white/5 bg-white/5 active:scale-95 transition-all text-center cursor-pointer"
                  >
                    DISMISS GUIDE
                  </button>
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* Dynamic Deployment Segment */}
        <AnimatePresence>
          {showDeployment && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
              className="mb-8 z-20"
            >
              <DeploymentPanel />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Core Layout Interface Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start flex-grow mb-8">
          
          {/* LEFT: Main Player Showcase Module */}
          <section className="lg:col-span-7 flex flex-col items-center w-full gap-6">
            
            <div className="w-full bg-white/[0.03] backdrop-blur-xl border border-white/10 rounded-[2.5rem] p-6 sm:p-8 shadow-2xl relative overflow-hidden transition-all duration-300">
              <div className="absolute inset-0 bg-gradient-to-b from-[#00F0FF]/[0.02] to-transparent pointer-events-none" />
              
              {/* Dynamic Cover Artwork Display (Clickable stream controller) */}
              <div 
                id="interactive-album-artwork"
                onClick={startStreamPlayback}
                className="relative w-full max-w-sm sm:max-w-md mx-auto aspect-square mb-8 group shadow-2xl mt-4 cursor-pointer overflow-hidden rounded-2xl border border-white/15 hover:border-[#00F0FF]/40 hover:scale-[1.01] active:scale-[0.99] transition-all duration-300"
                title="Click Artwork to Play/Pause Live Radio"
              >
                {/* Accent glow elements from the Design HTML */}
                <div className="absolute inset-0 bg-gradient-to-tr from-[#00F0FF]/10 to-transparent rounded-2xl z-0 pointer-events-none" />
                <div className="absolute -inset-4 bg-white/5 blur-3xl opacity-20 rounded-full z-[-1] pointer-events-none" />
                
                <div className="w-full h-full bg-white/5 rounded-2xl overflow-hidden flex items-center justify-center relative z-10 shadow-inner">
                  <AnimatePresence mode="wait">
                    <motion.img
                      key={currentTrack.artworkUrl}
                      src={currentTrack.artworkUrl}
                      alt={`${currentTrack.title} artwork album cover`}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.5 }}
                      className="w-full h-full object-cover select-none"
                      referrerPolicy="no-referrer"
                    />
                  </AnimatePresence>

                  {/* Transparent Watermark on Top Right of Album Cover */}
                  <img 
                    src="/wm.png" 
                    alt="Watermark Logo" 
                    className="absolute top-4 right-4 w-12 h-10 object-contain z-10 pointer-events-none opacity-85 select-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]" 
                    referrerPolicy="no-referrer"
                  />

                  {/* Elegant micro hover overlay indicating action status (no circle in middle) */}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col items-center justify-center gap-2.5 z-20">
                    {player.isPlaying ? (
                      <>
                        <Pause className="w-12 h-12 text-[#00F0FF] animate-pulse" />
                        <span className="text-xs font-mono font-bold tracking-widest text-[#00F0FF] uppercase">CLICK TO PAUSE</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-12 h-12 text-[#00F0FF]" />
                        <span className="text-xs font-mono font-bold tracking-widest text-[#00F0FF] uppercase">CLICK TO PLAY</span>
                      </>
                    )}
                  </div>

                  {/* Cover decorative corner badges */}
                  <div className="absolute top-4 left-4 z-20 flex gap-2">
                    <span className="bg-black/95 backdrop-blur-md border border-white/10 text-[#00F0FF] font-mono text-[10px] font-bold tracking-widest px-3 py-1.5 rounded-full uppercase shadow-lg">
                      {player.bufferStatus === "connecting" ? "BUFFERING..." : player.bufferStatus === "error" ? "CONNECT ERROR" : "ICY HIGH-FI"}
                    </span>
                  </div>
                  
                  {/* Active Stream Info banner overlay */}
                  <div className="absolute bottom-4 inset-x-4 bg-black/80 backdrop-blur-md border border-white/10 p-3 rounded-2xl flex items-center justify-between z-20">
                    <span className="text-[10px] font-mono text-white/60 tracking-wider flex items-center gap-1.5 uppercase font-medium">
                      <Clock className="w-3.5 h-3.5 text-[#00F0FF] animate-pulse" /> Live Poll: {currentTrack.timestamp}
                    </span>
                    {metaLoading && (
                      <RefreshCw className="w-3.5 h-3.5 text-[#00F0FF] animate-spin" />
                    )}
                  </div>
                </div>
              </div>

              {/* Artist and Track Titles styled beautifully matching the high-impact design */}
              <div className="text-center mb-6 w-full max-w-full overflow-hidden">
                <div className="text-[#00F0FF] text-xs font-bold uppercase tracking-[0.4em] mb-2 font-mono">
                  {player.isPlaying ? "Currently Airing" : "Stream Standby"}
                </div>
                <div className="mb-3 max-w-xl mx-auto w-full">
                  <MarqueeText
                    text={currentTrack.title}
                    className="font-display text-3xl sm:text-4xl text-white tracking-tight uppercase leading-none"
                    speed={16}
                  />
                </div>
                <div className="text-xl font-light tracking-tight text-white/75 italic flex items-center justify-center gap-2 max-w-md mx-auto font-sans w-full overflow-hidden">
                  <Radio className="w-4 h-4 text-[#00F0FF] animate-pulse shrink-0 self-center" />
                  <div className="flex-1 min-w-0">
                    <MarqueeText
                      text={currentTrack.artist}
                      className="italic font-sans text-white/75"
                      speed={12}
                    />
                  </div>
                </div>
                {/* Right-aligned Sandbox Lyrics button directly under the artist name segment */}
                {lyrics && (
                  <div className="flex justify-end max-w-md mx-auto mt-2.5">
                    <button
                      onClick={() => setShowLyricsModal(true)}
                      className="px-3.5 py-1.5 bg-white/5 hover:bg-[#00F0FF]/15 text-[#00F0FF] border border-[#00F0FF]/30 hover:border-[#00F0FF]/60 text-xs font-mono font-bold tracking-wider rounded-xl uppercase transition-all duration-200 flex items-center gap-1.5 shadow-md active:scale-95 cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-[#00F0FF] animate-pulse" />
                      <span>Sandbox</span>
                    </button>
                  </div>
                )}
                <div className="h-1 w-24 bg-[#00F0FF] mx-auto mt-6"></div>
              </div>

              {/* High Performance Graphic Sound Virtualizer Element */}
              <div className="h-12 w-full mb-2 relative overflow-hidden rounded-2xl bg-black/50 border border-white/10">
                <AudioVisualizer isPlaying={player.isPlaying} analyser={null} themeColor="rgb(0, 240, 255)" />
              </div>

            </div>

            {/* Wikipedia Insights Block */}
            <AnimatePresence mode="wait">
              {wikiLoading ? (
                <motion.div
                  key="loading-wiki"
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                  transition={{ duration: 0.3 }}
                  className="w-full bg-white/[0.03] backdrop-blur-xl border border-white/10 rounded-[2.5rem] p-6 sm:p-8 flex flex-col gap-4 animate-pulse"
                >
                  <div className="flex items-center gap-3">
                    <div className="bg-white/5 w-10 h-10 rounded-xl" />
                    <div className="space-y-1.5 flex-1">
                      <div className="bg-white/10 h-4 w-32 rounded" />
                      <div className="bg-white/5 h-3 w-48 rounded" />
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-5 items-start mt-2">
                    <div className="bg-white/5 w-24 h-24 rounded-2xl flex-shrink-0" />
                    <div className="flex-grow space-y-2.5 w-full">
                      <div className="bg-white/10 h-5 w-1/2 rounded" />
                      <div className="bg-white/5 h-3 w-full rounded" />
                      <div className="bg-white/5 h-3 w-5/6 rounded" />
                      <div className="bg-white/5 h-3 w-2/3 rounded" />
                    </div>
                  </div>
                </motion.div>
              ) : wikipediaInfo ? (
                <motion.div
                  key={wikipediaInfo.url}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                  transition={{ duration: 0.4 }}
                  className="w-full bg-white/[0.03] backdrop-blur-xl border border-white/10 rounded-[2.5rem] p-6 sm:p-8 shadow-2xl relative overflow-hidden text-left"
                >
                  <div className="absolute inset-0 bg-gradient-to-b from-white/[0.01] to-transparent pointer-events-none" />
                  
                  <div className="flex items-center gap-3 mb-4">
                    <div className="bg-[#00F0FF]/15 border border-[#00F0FF]/30 rounded-xl p-2.5 flex items-center justify-center">
                      <BookOpen className="w-5 h-5 text-[#00F0FF]" />
                    </div>
                    <div>
                      <h3 className="font-display text-lg tracking-wide uppercase text-slate-100 font-bold leading-none">
                        WIKIPEDIA INSIGHTS
                      </h3>
                      <p className="text-[10px] font-mono text-white/50 uppercase tracking-widest mt-1">
                        Dynamic Track Encyclopedia
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-5 items-start">
                    {wikipediaInfo.thumbnailUrl && (
                      <img 
                        src={wikipediaInfo.thumbnailUrl} 
                        alt={wikipediaInfo.title}
                        className="w-24 h-24 sm:w-28 sm:h-28 object-cover rounded-2xl border border-white/10 flex-shrink-0 shadow-lg bg-white/5"
                        referrerPolicy="no-referrer"
                      />
                    )}
                    <div className="flex-grow text-left space-y-2">
                      <h4 className="font-sans text-base font-bold text-white leading-snug flex items-center gap-2 flex-wrap">
                        {wikipediaInfo.title}
                        {wikipediaInfo.description && (
                          <span className="text-[10px] font-mono py-0.5 px-2 bg-white/5 text-white/70 border border-white/10 rounded-full font-normal">
                            {wikipediaInfo.description}
                          </span>
                        )}
                      </h4>
                      <p className="text-xs text-white/70 leading-relaxed font-sans line-clamp-4 sm:line-clamp-none">
                        {wikipediaInfo.extract}
                      </p>
                      <div className="pt-2 flex">
                        <a 
                          href={wikipediaInfo.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs font-mono font-bold text-[#00F0FF] hover:text-[#00F0FF]/80 tracking-wider uppercase group cursor-pointer"
                        >
                          Read full article 
                          <ExternalLink className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                        </a>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>

          </section>

          {/* RIGHT: Bento Column with Settings, Presets, and Historical entries */}
          <section className="lg:col-span-5 space-y-6 sm:space-y-8 w-full">

            {/* Song History Section (Last 5 songs with step-down timeline opacity from the Design HTML) */}
            <div className="bg-white/[0.03] backdrop-blur-xl border border-white/10 rounded-[2rem] p-5 sm:p-6 shadow-xl">
              <h3 className="font-display text-xl tracking-wide uppercase text-white mb-4 flex items-center gap-2">
                <Clock className="w-5 h-5 text-[#00F0FF]" />
                PLAYBACK HISTORIC LOGS
              </h3>

              <div className="space-y-4">
                <AnimatePresence initial={false}>
                  {history.length === 0 ? (
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-xs font-mono text-white/30 italic text-center py-6 block"
                    >
                      No historical track list in current session.
                    </motion.p>
                  ) : (
                    history.map((track, i) => {
                      // Apply Step-down opacity representing age of songs just like Recently Played sidebar in design HTML
                      const opacities = ["opacity-100", "opacity-80", "opacity-60", "opacity-40", "opacity-20"];
                      const opacityClass = opacities[i] || "opacity-20";

                      return (
                        <motion.div
                          key={`${track.title}-${track.timestamp}-${i}`}
                          initial={{ opacity: 0, x: 20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -20 }}
                          transition={{ duration: 0.3, delay: i * 0.05 }}
                          className={`flex items-center gap-3.5 bg-black/40 p-2.5 rounded-2xl border border-white/5 hover:border-white/10 transition-colors duration-150 group ${opacityClass}`}
                        >
                          <img
                            src={track.artworkUrl || defaultLogo}
                            alt="Cover thumbnail"
                            className="w-12 h-12 rounded-lg object-cover bg-neutral-900 border border-white/10 shrink-0"
                            referrerPolicy="no-referrer"
                          />
                          <div className="flex-grow min-w-0">
                            <h4 className="text-sm font-bold text-white truncate group-hover:text-[#00F0FF] transition-colors duration-100">
                              {track.title}
                            </h4>
                            <p className="text-[11px] text-white/50 truncate mt-0.5 font-sans">
                              {track.artist}
                            </p>
                          </div>
                          <span className="text-[10px] font-mono text-white/40 whitespace-nowrap bg-white/5 px-2 py-1 rounded-md border border-white/5">
                            {track.timestamp}
                          </span>
                        </motion.div>
                      );
                    })
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Keyboard Hotkey Guidance Screen Badge */}
            <AnimatePresence>
              {showHotkeysHelp && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="bg-black border border-white/10 rounded-2xl p-4 shadow-lg"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <HelpCircle className="w-4 h-4 text-[#00F0FF] animate-pulse" />
                      <span className="text-[10px] font-mono tracking-widest font-bold uppercase text-white/80">
                        KEYBOARD CO-PILOT ASSISTANT
                      </span>
                    </div>
                    <button
                      id="close-hotkeys-btn"
                      onClick={() => setShowHotkeysHelp(false)}
                      className="text-[11px] font-mono text-white/40 hover:text-white/80 focus-visible:outline-none cursor-pointer"
                      title="Hide Key Guide"
                    >
                      [Dismiss]
                    </button>
                  </div>
                  <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] font-mono text-white/60 leading-snug">
                    <li>
                      <kbd className="px-1.5 py-0.5 bg-white/5 border border-white/10 rounded text-[#00F0FF] shadow-sm mr-1.5 font-bold font-mono">
                        Space
                      </kbd>{" "}
                      Play/Pause
                    </li>
                    <li>
                      <kbd className="px-1.5 py-0.5 bg-white/5 border border-white/10 rounded text-[#00F0FF] shadow-sm mr-1.5 font-bold font-mono">
                        M
                      </kbd>{" "}
                      Toggle Mute
                    </li>
                    <li>
                      <kbd className="px-1.5 py-0.5 bg-white/5 border border-white/10 rounded text-[#00F0FF] shadow-sm mr-1.5 font-bold font-mono">
                        ▲ Arrow
                      </kbd>{" "}
                      Volume +5%
                    </li>
                    <li>
                      <kbd className="px-1.5 py-0.5 bg-white/5 border border-white/10 rounded text-[#00F0FF] shadow-sm mr-1.5 font-bold font-mono">
                        ▼ Arrow
                      </kbd>{" "}
                      Volume -5%
                    </li>
                  </ul>
                </motion.div>
              )}
            </AnimatePresence>

          </section>

        </div>

        {/* Footer Area */}
        <footer className="w-full text-center py-6 border-t border-white/10 mt-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-mono text-white/40">
          <p>© 2026 Mixer FM Player. Designed under supreme precision.</p>
          <div className="flex gap-4">
            <span className="hover:text-[#00F0FF] transition-colors cursor-pointer">Anton & Inter Web fonts</span>
            <span>•</span>
            <span className="hover:text-[#00F0FF] transition-colors cursor-pointer">iTunes Metadata Engine</span>
          </div>
        </footer>

      </div>

      {/* Immersive Lyrics Sandbox Modal */}
      <AnimatePresence>
        {showLyricsModal && lyrics && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop blur overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowLyricsModal(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            
            {/* Modal Box */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 180 }}
              className="bg-[#0f141c]/95 border border-white/10 rounded-[2.5rem] w-full max-w-lg overflow-hidden shadow-2xl relative z-10 flex flex-col max-h-[80vh]"
            >
              <div className="absolute inset-0 bg-gradient-to-b from-[#00F0FF]/5 to-transparent pointer-events-none" />
              
              {/* Modal Header */}
              <div className="p-6 sm:p-8 border-b border-white/5 flex items-start justify-between gap-4">
                <div>
                  <span className="text-[10px] font-mono tracking-widest text-[#00F0FF] bg-[#00F0FF]/10 border border-[#00F0FF]/30 px-2.5 py-1 rounded-full uppercase font-bold">
                    LYRICS SANDBOX
                  </span>
                  <h3 className="font-display text-xl text-white uppercase tracking-wider mt-3 leading-tight">
                    {currentTrack.title}
                  </h3>
                  <p className="text-xs text-white/50 font-sans mt-1">
                    {currentTrack.artist}
                  </p>
                </div>
                <button
                  onClick={() => setShowLyricsModal(false)}
                  className="p-2 text-white/40 hover:text-white bg-white/5 hover:bg-white/10 rounded-full transition-colors cursor-pointer focus:outline-none"
                  title="Close Modal"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              {/* Modal Content - Scrollable Lyrics */}
              <div className="flex-grow p-6 sm:p-8 overflow-y-auto text-left custom-scrollbar">
                <p className="text-sm text-slate-200 leading-relaxed font-sans whitespace-pre-line text-center italic tracking-wide">
                  {lyrics}
                </p>
              </div>

              {/* Modal Footer */}
              <div className="p-4 border-t border-white/5 bg-black/40 text-center">
                <p className="text-[9px] font-mono text-white/30 uppercase tracking-widest">
                  Live synchronized lyric sandbox data pipeline
                </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
