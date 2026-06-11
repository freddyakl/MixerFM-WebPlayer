import express from "express";
import path from "path";
import fs from "fs";
import http from "http";
import https from "https";
import { URL } from "url";
import { createServer as createViteServer } from "vite";

// Helper to perform HTTP GET requests that support redirect tracing and simple buffer controls
function performRequest(targetUrl: string, headers: Record<string, string> = {}, timeoutMs = 4000): Promise<{ headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(targetUrl);
      const isHttps = parsedUrl.protocol === "https:";
      const requester = isHttps ? https : http;

      const req = requester.get(
        targetUrl,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) IcecastMetadataReader/1.0",
            ...headers,
          },
          timeout: timeoutMs,
        },
        (res) => {
          // Handle HTTP Redirection
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            let nextUrl = res.headers.location;
            if (!nextUrl.startsWith("http")) {
              nextUrl = new URL(nextUrl, targetUrl).toString();
            }
            resolve(performRequest(nextUrl, headers, timeoutMs));
            return;
          }

          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });
          res.on("end", () => {
            resolve({
              headers: res.headers,
              body: Buffer.concat(chunks),
            });
          });
        }
      );

      req.on("error", (err) => reject(err));
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Request timed out"));
      });
    } catch (e) {
      reject(e);
    }
  });
}

// Extract ICY Metadata inline from an audio stream
function extractIcyMetadata(streamUrl: string, responseTimeout = 4000): Promise<{ title: string; artist: string; raw: string }> {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(streamUrl);
      const isHttps = parsedUrl.protocol === "https:";
      const requester = isHttps ? https : http;

      const req = requester.get(
        streamUrl,
        {
          headers: {
            "Icy-MetaData": "1",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) IcecastPlayerAgent/1.0",
          },
          timeout: responseTimeout,
        },
        (res) => {
          // Handle redirects
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            let nextUrl = res.headers.location;
            if (!nextUrl.startsWith("http")) {
              nextUrl = new URL(nextUrl, streamUrl).toString();
            }
            req.destroy();
            resolve(extractIcyMetadata(nextUrl, responseTimeout));
            return;
          }

          const metaintStr = res.headers["icy-metaint"];
          if (!metaintStr) {
            req.destroy();
            reject(new Error("No icy-metaint header found, stream may not support metadata streaming."));
            return;
          }

          const metaint = parseInt(Array.isArray(metaintStr) ? metaintStr[0] : metaintStr, 10);
          if (isNaN(metaint) || metaint <= 0) {
            req.destroy();
            reject(new Error("Invalid icy-metaint value received: " + metaintStr));
            return;
          }

          let byteCounter = 0;
          let inMetadata = false;
          let metadataLength = 0;
          let metadataBuffer = Buffer.alloc(0);

          res.on("data", (chunk: Buffer) => {
            let offset = 0;

            while (offset < chunk.length) {
              if (!inMetadata) {
                // Determine how many bytes we need until the next metadata block
                const remainingToMeta = metaint - byteCounter;
                const bytesAvailable = chunk.length - offset;

                if (bytesAvailable < remainingToMeta) {
                  byteCounter += bytesAvailable;
                  break; // consumed entire chunk
                } else {
                  // We hit the metaint barrier!
                  offset += remainingToMeta;
                  byteCounter = 0;
                  inMetadata = true;
                  
                  // Read the metadata length byte
                  if (offset < chunk.length) {
                    const lengthByte = chunk[offset];
                    metadataLength = lengthByte * 16;
                    offset++;

                    if (metadataLength === 0) {
                      // Empty metadata block, skip and go back to streaming
                      inMetadata = false;
                    } else {
                      metadataBuffer = Buffer.alloc(0);
                    }
                  } else {
                    // Length byte is in the next chunk, handle gracefully
                    metadataLength = -1; // Flag to indicate we need the length byte first next chunk
                  }
                }
              } else {
                // If we need the length byte from the previous transition
                if (metadataLength === -1) {
                  const lengthByte = chunk[offset];
                  metadataLength = lengthByte * 16;
                  offset++;
                  if (metadataLength === 0) {
                    inMetadata = false;
                    continue;
                  }
                  metadataBuffer = Buffer.alloc(0);
                }

                // We are reading metadata content
                const neededMetadataBytes = metadataLength - metadataBuffer.length;
                const chunkBytesRemaining = chunk.length - offset;
                const bytesToRead = Math.min(neededMetadataBytes, chunkBytesRemaining);

                metadataBuffer = Buffer.concat([
                  metadataBuffer,
                  chunk.subarray(offset, offset + bytesToRead),
                ]);
                offset += bytesToRead;

                if (metadataBuffer.length === metadataLength) {
                  // Successfully read full metadata block!
                  req.destroy(); // Shut down stream stream immediately to conserve bandwidth
                  
                  const metadataStr = metadataBuffer.toString("utf-8");
                  resolve(parseIcyString(metadataStr));
                  return;
                }
              }
            }
          });

          res.on("end", () => {
            reject(new Error("Stream ended before metadata could be collected"));
          });

          res.on("error", (err) => {
            reject(err);
          });
        }
      );

      req.on("error", (err) => reject(err));
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Connection timeout reading stream metadata"));
      });
    } catch (e) {
      reject(e);
    }
  });
}

// Convert Icy stream string such as StreamTitle='SomaFM - Groove Salad';StreamUrl=''; into parsed parts
function parseIcyString(icyStr: string): { title: string; artist: string; raw: string } {
  // Strip trailing null bytes
  const trimmed = icyStr.replace(/\0+$/, "").trim();
  const match = trimmed.match(/StreamTitle='(.*?)'(?=;|StreamUrl=|$)/s);
  if (match && match[1]) {
    const fullTitle = match[1];
    // Split into artist & title
    const parts = fullTitle.split(" - ");
    if (parts.length >= 2) {
      return {
        artist: parts[0].trim(),
        title: parts.slice(1).join(" - ").trim(),
        raw: fullTitle,
      };
    }
    return {
      artist: "",
      title: fullTitle.trim(),
      raw: fullTitle,
    };
  }
  return { artist: "", title: "", raw: trimmed };
}

// Alternative: fetch status-json.xsl if server allows it
async function getJsonMetadata(streamUrl: string): Promise<{ title: string; artist: string; raw: string }> {
  try {
    const parsed = new URL(streamUrl);
    // Standard icecast servers mount stats at status-json.xsl or /stats
    // Let's form status-json.xsl url from the host + port
    const portSection = parsed.port ? `:${parsed.port}` : "";
    const statusUrl = `${parsed.protocol}//${parsed.hostname}${portSection}/status-json.xsl`;
    
    const response = await performRequest(statusUrl, {}, 2500);
    const json = JSON.parse(response.body.toString("utf-8"));
    
    let mountPath = parsed.pathname;
    if (!mountPath || mountPath === "/") {
      mountPath = "";
    }

    if (json && json.icestats) {
      const sources = json.icestats.source;
      let matchedSource: any = null;

      if (Array.isArray(sources)) {
        // Find matching mount
        matchedSource = sources.find((src: any) => {
          const mount = src.mount || "";
          return mountPath.includes(mount) || mount.includes(mountPath);
        }) || sources[0];
      } else if (sources) {
        matchedSource = sources;
      }

      if (matchedSource && (matchedSource.title || matchedSource.yp_currently_playing)) {
        const fullTitle = (matchedSource.title || matchedSource.yp_currently_playing || "").trim();
        const artist = (matchedSource.artist || "").trim();
        
        if (artist && fullTitle && !fullTitle.includes(artist)) {
          return {
            artist,
            title: fullTitle,
            raw: `${artist} - ${fullTitle}`,
          };
        }

        const parts = fullTitle.split(" - ");
        if (parts.length >= 2) {
          return {
            artist: parts[0].trim(),
            title: parts.slice(1).join(" - ").trim(),
            raw: fullTitle,
          };
        }
        return {
          artist: artist || "Unknown Host",
          title: fullTitle,
          raw: fullTitle,
        };
      }
    }
    throw new Error("No source matching path or no title in status-json.xsl");
  } catch (err: any) {
    throw new Error(`JSON status failed: ${err.message}`);
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Synergize and ensure PWA standard icon of og.jpg sits inside public/og.jpg for Chromium client downloads
  try {
    const srcPath = path.join(process.cwd(), "src/assets/images/og.jpg");
    const destPath = path.join(process.cwd(), "public/og.jpg");
    if (fs.existsSync(srcPath)) {
      if (!fs.existsSync(path.dirname(destPath))) {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
      }
      fs.copyFileSync(srcPath, destPath);
      console.log(`[PWA Asset sync] Synced artwork ${srcPath} successfully to ${destPath}`);
    } else {
      console.warn(`[PWA Asset sync] Source artwork from ${srcPath} was missing`);
    }
  } catch (e: any) {
    console.error("[PWA Asset sync] Failure copying icon artwork to public folder:", e);
  }

  app.use(express.json());

  // API Route to fetch metadata
  app.get("/api/metadata", async (req, res) => {
    const streamUrl = req.query.url as string;

    if (!streamUrl) {
      res.status(400).json({ error: "No stream URL provided" });
      return;
    }

    try {
      // Attempt 1: Fetch via native ICY Metadata extraction directly from stream bytes
      // This is the cleanest and most robust method since it queries the live audio source
      try {
        const meta = await extractIcyMetadata(streamUrl);
        if (meta.title || meta.artist) {
          res.json({ success: true, method: "icy-metadata-stream", data: meta });
          return;
        }
      } catch (streamError: any) {
        // Fallback to Attempt 2: status-json.xsl stats check
        try {
          const meta = await getJsonMetadata(streamUrl);
          if (meta.title || meta.artist) {
            res.json({ success: true, method: "status-json-stats", data: meta });
            return;
          }
        } catch (jsonError: any) {
          // If both fail, let's look for known SomaFM or radio APIs if the URL matches known servers,
          // or return simple placeholder metadata from the stream metadata tags if we can scrap them.
          throw new Error(`Direct ICY failed (${streamError.message}) & JSON stats failed (${jsonError.message})`);
        }
      }

      res.status(404).json({ error: "Could not extract metadata from stream" });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to fetch stream metadata",
        fallback: {
          artist: "Live Stream",
          title: "Audio Broadcast",
          raw: "Live Stream - Audio Broadcast"
        }
      });
    }
  });

  // Client request to download the generated standalone index.php
  app.get("/api/download-php-code", (req, res) => {
    res.setHeader("Content-Disposition", "attachment; filename=index.php");
    res.setHeader("Content-Type", "text/plain");
    // This endpoint can serve the compiled PHP template source if requested
    res.send("PHP source code download requested");
  });

  // Serve PWA manifest, service worker, and app icon safely across development and production
  app.get("/manifest.json", (req, res) => {
    res.setHeader("Content-Type", "application/manifest+json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    const prodPath = path.join(process.cwd(), "dist/manifest.json");
    const devPath = path.join(process.cwd(), "public/manifest.json");
    if (fs.existsSync(prodPath)) {
      res.sendFile(prodPath);
    } else {
      res.sendFile(devPath);
    }
  });

  app.get("/sw.js", (req, res) => {
    res.setHeader("Content-Type", "application/javascript");
    res.setHeader("Access-Control-Allow-Origin", "*");
    const prodPath = path.join(process.cwd(), "dist/sw.js");
    const devPath = path.join(process.cwd(), "public/sw.js");
    if (fs.existsSync(prodPath)) {
      res.sendFile(prodPath);
    } else {
      res.sendFile(devPath);
    }
  });

  app.get("/og.jpg", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    const prodPath = path.join(process.cwd(), "dist/og.jpg");
    const devPath = path.join(process.cwd(), "public/og.jpg");
    const assetPath = path.join(process.cwd(), "src/assets/images/og.jpg");
    if (fs.existsSync(prodPath)) {
      res.sendFile(prodPath);
    } else if (fs.existsSync(devPath)) {
      res.sendFile(devPath);
    } else {
      res.sendFile(assetPath);
    }
  });

  // Vite integration as dev middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production static files servicing
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Icecast Stream Backend] Server is active at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Backend Server failed to boot:", err);
});
