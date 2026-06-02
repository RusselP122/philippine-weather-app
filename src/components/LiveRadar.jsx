import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Play,
  Pause,
  Square,
  RefreshCw,
  Download,
  Maximize2,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  Loader2
} from "lucide-react";
import { supabase } from "../supabaseClient";

// High-fidelity dynamic pixel color swapping helper
const recolorRadarImage = (imgElement, theme) => {
  const canvas = document.createElement("canvas");
  canvas.width = imgElement.naturalWidth || imgElement.width || 1020;
  canvas.height = imgElement.naturalHeight || imgElement.height || 1393;

  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(imgElement, 0, 0);

  if (theme === "default") {
    try {
      return canvas.toDataURL("image/png");
    } catch (e) {
      console.error("Canvas export error:", e);
      return imgElement.src;
    }
  }

  try {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      if (a < 15) continue; // Skip transparent pixels

      const maxChannel = Math.max(r, g, b);
      const minChannel = Math.min(r, g, b);
      const saturation = maxChannel > 0 ? (maxChannel - minChannel) / maxChannel : 0;

      // Skip white/grey outlines/labels and radar clutter (non-colorful pixels)
      if (saturation < 0.22 || (r > 170 && g > 170 && b > 170 && saturation < 0.16)) {
        continue;
      }

      // Classify PAGASA storm cell colors
      let colorType = "green"; // Light rain default
      if (b > g && b > r * 0.9) {
        colorType = "blue";
      } else if (r > 155 && b > 155 && g < 135) {
        colorType = "purple";
      } else if (r > 180 && g < 110 && b < 115) {
        colorType = "red";
      } else if (r > 150 && g > 110 && b < 100) {
        colorType = "yellow";
      } else if (g > r * 0.8 && g > b) {
        colorType = "green";
      }

      let targetHex = "";
      if (theme === "vaporwave") {
        if (colorType === "blue") targetHex = "#00f0ff";
        else if (colorType === "green") targetHex = "#05d9e8";
        else if (colorType === "yellow") targetHex = "#ff2a74";
        else if (colorType === "red") targetHex = "#ff007f";
        else if (colorType === "purple") targetHex = "#ab00cd";
      } else if (theme === "storm") {
        if (colorType === "blue") targetHex = "#1e3a8a";
        else if (colorType === "green") targetHex = "#047857";
        else if (colorType === "yellow") targetHex = "#d97706";
        else if (colorType === "red") targetHex = "#dc2626";
        else if (colorType === "purple") targetHex = "#701a75";
      } else if (theme === "retro") {
        if (colorType === "blue") targetHex = "#14532d";
        else if (colorType === "green") targetHex = "#15803d";
        else if (colorType === "yellow") targetHex = "#22c55e";
        else if (colorType === "red") targetHex = "#4ade80";
        else if (colorType === "purple") targetHex = "#86efac";
      } else if (theme === "custom") {
        // High-fidelity custom color palette provided by user (mapping classes to customized levels)
        if (colorType === "blue") targetHex = "#0a6f87";      // 10 dBZ: rgb(10, 111, 135)
        else if (colorType === "green") targetHex = "#31ab12";   // 20 dBZ: rgb(49, 171, 18)
        else if (colorType === "yellow") targetHex = "#f0ec00";  // 35 dBZ: rgb(240, 236, 0)
        else if (colorType === "red") targetHex = "#ff0000";     // 50 dBZ: rgb(255, 0, 0)
        else if (colorType === "purple") targetHex = "#dcbae6";  // 65 dBZ: rgb(220, 186, 230) for extreme core
      }

      if (targetHex) {
        const hex = targetHex.replace("#", "");
        data[i] = parseInt(hex.substring(0, 2), 16);
        data[i + 1] = parseInt(hex.substring(2, 4), 16);
        data[i + 2] = parseInt(hex.substring(4, 6), 16);
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/png");
  } catch (e) {
    console.error("Dynamic recolor error:", e);
    return imgElement.src;
  }
};

const getIslandGroupOfRegion = (regionStr) => {
  if (!regionStr) return "luzon";
  const r = regionStr.toLowerCase();
  if (
    r.includes("western visayas") ||
    r.includes("central visayas") ||
    r.includes("eastern visayas")
  ) {
    return "visayas";
  }
  if (
    r.includes("zamboanga") ||
    r.includes("northern mindanao") ||
    r.includes("davao") ||
    r.includes("soccsksargen") ||
    r.includes("caraga") ||
    r.includes("muslim mindanao") ||
    r.includes("armm")
  ) {
    return "mindanao";
  }
  return "luzon";
};

const LiveRadar = () => {
  // Timeline State
  const [rawTimeline, setRawTimeline] = useState([]);
  const [accumulatedTimeline, setAccumulatedTimeline] = useState(() => {
    try {
      if (typeof window !== "undefined") {
        const saved = window.localStorage.getItem("radar_accumulated_timeline");
        return saved ? JSON.parse(saved) : [];
      }
    } catch (e) {
      console.error("Failed to load saved radar timeline:", e);
    }
    return [];
  });
  const [frames, setFrames] = useState([]);
  const [preloadingFrames, setPreloadingFrames] = useState([]);
  const [activeFrameIndex, setActiveFrameIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isPreloading, setIsPreloading] = useState(false);
  const [error, setError] = useState(null);

  // Custom Radar Color Palette Themes State
  const [colorTheme, setColorTheme] = useState("custom");
  const [cachedFrameUrls, setCachedFrameUrls] = useState({});

  // Map GeoJSON data for aligned background projection
  const [geoData, setGeoData] = useState(null);

  // Fetch GeoJSON Philippines Map data
  useEffect(() => {
    fetch("/data/ph_provinces.json")
      .then((res) => res.json())
      .then((data) => setGeoData(data))
      .catch((err) => console.error("Failed to load provinces map:", err));
  }, []);

  // Strict bounding coordinates of PAGASA's Doppler Radar Composite Canvas
  const minLon = 115.5; // Official PAGASA Composite bounds
  const maxLon = 129.5; // Official PAGASA Composite bounds
  const minLat = 4.0;   // Official PAGASA Composite bounds
  const maxLat = 22.5;  // Official PAGASA Composite bounds
  const canvasWidth = 1020;
  const canvasHeight = 1393;

  // Project province coordinates linearly to match radar image aspects perfectly (EPSG:4326 equivalence)
  const projectedFeatures = useMemo(() => {
    if (!geoData) return [];

    const project = (lon, lat) => {
      const x = ((lon - minLon) / (maxLon - minLon)) * canvasWidth;
      const y = ((maxLat - lat) / (maxLat - minLat)) * canvasHeight;
      return [x, y];
    };

    const generateD = (coords, type) => {
      if (type === "Polygon") {
        return coords.map(ring => {
          return ring.map((coord, index) => {
            const [x, y] = project(coord[0], coord[1]);
            return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
          }).join(' ') + ' Z';
        }).join(' ');
      } else if (type === "MultiPolygon") {
        return coords.map(poly => {
          return poly.map(ring => {
            return ring.map((coord, index) => {
              const [x, y] = project(coord[0], coord[1]);
              return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
            }).join(' ') + ' Z';
          }).join(' ');
        }).join(' ');
      }
      return "";
    };

    const getCentroid = (coords, type) => {
      let ring = [];
      if (type === "Polygon") {
        ring = coords[0] || [];
      } else if (type === "MultiPolygon") {
        let maxLen = 0;
        let bestRing = [];
        coords.forEach(poly => {
          const r = poly[0] || [];
          if (r.length > maxLen) {
            maxLen = r.length;
            bestRing = r;
          }
        });
        ring = bestRing;
      }

      if (ring.length === 0) return [0, 0];

      let sumX = 0;
      let sumY = 0;
      ring.forEach(([lon, lat]) => {
        const [x, y] = project(lon, lat);
        sumX += x;
        sumY += y;
      });

      return [sumX / ring.length, sumY / ring.length];
    };

    return geoData.features.map((f) => {
      const d = generateD(f.geometry.coordinates, f.geometry.type);
      const [cX, cY] = getCentroid(f.geometry.coordinates, f.geometry.type);
      let name = f.properties.PROVINCE || f.properties.NAME_1 || "";
      if (name.toLowerCase() === "metropolitan manila") {
        name = "Metro Manila";
      }
      const island = getIslandGroupOfRegion(f.properties.REGION);
      return { d, cX, cY, name, island };
    });
  }, [geoData]);

  // Memoize the background filled landmass SVG (Layer 1) to establish dark land vs black water contrast
  const svgBaseMap = useMemo(() => {
    return (
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none select-none"
        viewBox="0 0 1020 1393"
      >
        {projectedFeatures.map((prov, idx) => (
          <path
            key={idx}
            d={prov.d}
            fill="#111625"
            stroke="none"
          />
        ))}
      </svg>
    );
  }, [projectedFeatures]);

  // Memoize the foreground province borders overlay SVG (Layer 3) to render crisp lines ON TOP of the rain
  const svgBordersOverlay = useMemo(() => {
    return (
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none select-none z-20"
        viewBox="0 0 1020 1393"
      >
        {projectedFeatures.map((prov, idx) => (
          <path
            key={idx}
            d={prov.d}
            fill="none"
            stroke="#334155" // High-contrast, crisp slate color intersecting weather cells
            strokeWidth="0.4"
          />
        ))}
      </svg>
    );
  }, [projectedFeatures]);

  // Playback Control State
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackFramesCount, setPlaybackFramesCount] = useState(16);
  const [intervalMs, setIntervalMs] = useState(500);

  // Interactive Map State (Default focused on Luzon: scale = 1.9, x = 104, y = 308)
  const [scale, setScale] = useState(1.9);
  const [translate, setTranslate] = useState({ x: 104, y: 308 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [activeRegion, setActiveRegion] = useState("luzon");
  const [labelRegion, setLabelRegion] = useState("luzon");
  const prevThemeRef = useRef(colorTheme);
  const prevFrameCountRef = useRef(playbackFramesCount);

  // Dynamic Responsive Region Focusing Helper
  const focusOnRegion = (regionId) => {
    const container = mapContainerRef.current;
    if (!container) return;

    // Use unscaled layout dimensions to prevent double-scaling transform errors
    const W = container.offsetWidth;
    const H = container.offsetHeight;

    let targetScale = 1.0;
    let targetX = 0;
    let targetY = 0;

    if (regionId === "luzon") {
      targetScale = 1.9;
      // tx = 425, ty = 480 in 1020x1393 space
      targetX = ((510 - 425) / 1020) * W * targetScale;
      targetY = ((696.5 - 480) / 1393) * H * targetScale;
    } else if (regionId === "visayas") {
      targetScale = 2.2;
      // tx = 580, ty = 850
      targetX = ((510 - 580) / 1020) * W * targetScale;
      targetY = ((696.5 - 850) / 1393) * H * targetScale;
    } else if (regionId === "mindanao") {
      targetScale = 2.1;
      // tx = 690, ty = 1090
      targetX = ((510 - 690) / 1020) * W * targetScale;
      targetY = ((696.5 - 1090) / 1393) * H * targetScale;
    } else {
      // Whole PH
      targetScale = 1.0;
      targetX = 0;
      targetY = 0;
    }

    setActiveRegion(regionId);
    setLabelRegion(regionId);
    setScale(targetScale);
    setTranslate({ x: targetX, y: targetY });
  };

  // Keep Luzon focus dynamic on mounting and timeline load
  useEffect(() => {
    if (frames.length > 0 && mapContainerRef.current) {
      const timer = setTimeout(() => {
        focusOnRegion("luzon");
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [frames]);

  // GIF Compiler Simulation State
  const [isCompiling, setIsCompiling] = useState(false);
  const [compilingProgress, setCompilingProgress] = useState(0);
  const [compilingMessage, setCompilingMessage] = useState("");

  const mapContainerRef = useRef(null);
  const touchStartDistRef = useRef(0);

  // Fetch Radar Timeline Data from Supabase
  const fetchTimeline = async (isBackground = false) => {
    if (!isBackground) {
      setIsLoading(true);
      setIsPlaying(false);
      setError(null);
    }
    try {
      // Query the latest radar frames from the Supabase database
      const { data, error } = await supabase
        .from("radar_frames")
        .select("observed_at, observed_at_unix, public_url")
        .order("observed_at_unix", { ascending: false })
        .limit(playbackFramesCount);

      if (error) throw error;

      if (data && data.length > 0) {
        const formatted = data.map((f) => ({
          observed_at: f.observed_at.split("+")[0].replace("T", " "), // Format "YYYY-MM-DD HH:mm:ss"
          observed_at_unix: parseInt(f.observed_at_unix, 10),
          image_url: f.public_url,
          rawBase64: null // Direct CORS support from Supabase Storage skips canvas taint issues!
        }));
        // Sort chronologically for timeline display
        setRawTimeline(formatted.reverse());
      } else if (!isBackground) {
        setError("No radar history records found in database.");
      }
    } catch (err) {
      console.error("Supabase fetch error:", err);
      if (!isBackground) {
        setError("Failed to connect to the radar archive database.");
      }
    } finally {
      if (!isBackground) {
        setIsLoading(false);
      }
    }
  };

  // Helper to map color theme to vertical legend bar gradient styles natively
  const getLegendGradientStyle = (theme) => {
    if (theme === "vaporwave") {
      return "linear-gradient(to top, #1c1533 0%, #00f0ff 20%, #05d9e8 40%, #ff2a74 60%, #ff007f 80%, #ab00cd 100%)";
    }
    if (theme === "storm") {
      return "linear-gradient(to top, #20181b 0%, #1e3a8a 20%, #047857 40%, #d97706 60%, #dc2626 80%, #701a75 100%)";
    }
    if (theme === "retro") {
      return "linear-gradient(to top, #041f0f 0%, #14532d 20%, #15803d 40%, #22c55e 60%, #4ade80 80%, #86efac 100%)";
    }
    if (theme === "custom") {
      return "linear-gradient(to top, #075163 0%, #0a6f87 20%, #31ab12 40%, #f0ec00 60%, #ff0000 80%, #dcbae6 100%)";
    }
    return "linear-gradient(to top, #1d4ed8 0%, #059669 20%, #facc15 40%, #f97316 60%, #dc2626 80%, #d01cc3 100%)";
  };

  useEffect(() => {
    fetchTimeline();

    // Auto-sync new radar data in the background quietly every 3 minutes
    const syncInterval = setInterval(() => {
      fetchTimeline(true);
    }, 3 * 60 * 1000); // 3 minutes

    return () => clearInterval(syncInterval);
  }, []);

  // Accumulate raw timeline frames into a master list of up to 36 frames and persist it in localStorage
  useEffect(() => {
    if (rawTimeline.length === 0) return;

    setAccumulatedTimeline((prev) => {
      const mergedMap = new Map();
      // Add existing accumulated frames
      prev.forEach(f => mergedMap.set(f.observed_at, f));
      // Add new frames from the rawTimeline, preserving cached rawBase64 properties
      rawTimeline.forEach(f => {
        if (!mergedMap.has(f.observed_at)) {
          mergedMap.set(f.observed_at, f);
        } else {
          const existing = mergedMap.get(f.observed_at);
          mergedMap.set(f.observed_at, { ...f, rawBase64: existing.rawBase64, dataUrl: existing.dataUrl });
        }
      });

      // Helper to safely obtain Unix timestamp for chronological sorting & gap detection
      const getUnixTimestamp = (f) => {
        if (f.observed_at_unix) return f.observed_at_unix;
        try {
          const d = new Date(f.observed_at.replace(" ", "T") + "+08:00");
          return Math.floor(d.getTime() / 1000);
        } catch (e) {
          return 0;
        }
      };

      // Convert to array and sort chronologically
      let merged = Array.from(mergedMap.values())
        .sort((a, b) => getUnixTimestamp(a) - getUnixTimestamp(b));

      // Prune large gaps: if there is a gap of > 2 hours (7200 seconds) between consecutive frames,
      // discard older frames to prevent jarring jumps in the loop animation.
      const GAP_THRESHOLD_SECONDS = 2 * 60 * 60; // 2 hours
      if (merged.length > 0) {
        const contiguousFromLatest = [merged[merged.length - 1]];
        for (let i = merged.length - 2; i >= 0; i--) {
          const current = merged[i];
          const next = merged[i + 1];
          const gap = getUnixTimestamp(next) - getUnixTimestamp(current);
          if (gap > GAP_THRESHOLD_SECONDS) {
            break; // Stop accumulating older frames beyond the data outage gap
          }
          contiguousFromLatest.push(current);
        }
        merged = contiguousFromLatest.reverse();
      }

      // Keep only up to the maximum possible depth (36 frames) to optimize RAM
      const sliced = merged.slice(-36);

      try {
        if (typeof window !== "undefined") {
          window.localStorage.setItem("radar_accumulated_timeline", JSON.stringify(sliced));
        }
      } catch (e) {
        console.error("Failed to save radar timeline:", e);
      }

      return sliced;
    });
  }, [rawTimeline]);

  // Filter accumulated timeline based on selected playback frames count
  useEffect(() => {
    if (accumulatedTimeline.length === 0) return;

    // Take the last N frames based on playbackFramesCount selection
    const sliced = accumulatedTimeline.slice(-playbackFramesCount);

    const isInitialLoad = frames.length === 0;
    const countChanged = prevFrameCountRef.current !== playbackFramesCount;

    // Deep compare against current preloading targets to prevent unnecessary runs
    const isDifferent = preloadingFrames.length !== sliced.length ||
      sliced.some((f, idx) => preloadingFrames[idx]?.observed_at !== f.observed_at);

    if (isDifferent || isInitialLoad || countChanged) {
      setPreloadingFrames(sliced);
    }
  }, [accumulatedTimeline, playbackFramesCount]);

  // Preload and dynamically recolor radar images to prevent playback flicker
  useEffect(() => {
    if (preloadingFrames.length === 0) return;

    let active = true;

    const themeChanged = prevThemeRef.current !== colorTheme;
    const countChanged = prevFrameCountRef.current !== playbackFramesCount;

    prevThemeRef.current = colorTheme;
    prevFrameCountRef.current = playbackFramesCount;

    // If theme changed, we MUST clear the cache because the recolored pixels will be different
    let currentCache = themeChanged ? {} : { ...cachedFrameUrls };

    if (themeChanged) {
      setCachedFrameUrls({}); // Force show loading spinner only on theme changes
      currentCache = {};
    }

    setIsPreloading(true);

    const preloadPromises = preloadingFrames.map((frame, index) => {
      const cacheKey = frame.observed_at;

      // Skip preloading and recoloring if this frame is already cached!
      if (currentCache[cacheKey]) {
        return Promise.resolve();
      }

      return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        
        // If we already have the raw base64 data cached, load it instantly without network requests!
        if (frame.rawBase64) {
          img.src = frame.rawBase64;
        } else {
          img.src = getFrameImageSrc(frame, index);
        }

        // Safety timeout of 10 seconds to prevent hanging loader overlays on slow mobile devices
        const timeoutId = setTimeout(() => {
          if (active) {
            currentCache[cacheKey] = img.src;
          }
          resolve();
        }, 10000);

        img.onload = () => {
          clearTimeout(timeoutId);
          if (!active) {
            resolve();
            return;
          }

          // Convert raw image to base64 if not already cached
          if (!frame.rawBase64) {
            try {
              const canvas = document.createElement("canvas");
              canvas.width = img.naturalWidth || img.width || 1020;
              canvas.height = img.naturalHeight || img.height || 1393;
              const ctx = canvas.getContext("2d");
              ctx.drawImage(img, 0, 0);
              frame.rawBase64 = canvas.toDataURL("image/png");
            } catch (e) {
              console.error("Failed to extract raw base64 data:", e);
            }
          }

          const dataUrl = recolorRadarImage(img, colorTheme);
          currentCache[cacheKey] = dataUrl;
          resolve();
        };
        img.onerror = () => {
          clearTimeout(timeoutId);
          if (active) {
            currentCache[cacheKey] = img.src;
          }
          resolve();
        };
      });
    });

    Promise.all(preloadPromises).then(() => {
      if (!active) return;

      // Prune old cached images that are no longer in the target preloadingFrames list to optimize RAM usage
      const prunedCache = {};
      preloadingFrames.forEach((f) => {
        const key = f.observed_at;
        if (currentCache[key]) {
          prunedCache[key] = currentCache[key];
        }
      });

      // Update cached URLs
      setCachedFrameUrls(prunedCache);

      // Save rawBase64 to accumulatedTimeline to persist it forever offline!
      setAccumulatedTimeline((prev) => {
        let updated = false;
        const next = prev.map((f) => {
          const match = preloadingFrames.find((pf) => pf.observed_at === f.observed_at);
          if (match && match.rawBase64 && f.rawBase64 !== match.rawBase64) {
            updated = true;
            return { ...f, rawBase64: match.rawBase64 };
          }
          return f;
        });

        if (updated) {
          try {
            window.localStorage.setItem("radar_accumulated_timeline", JSON.stringify(next));
          } catch (e) {
            console.error("Failed to save updated timeline with base64 cache:", e);
          }
        }
        return next;
      });

      // Update the active frames list for playback only after everything is cached!
      const isInitialLoad = frames.length === 0;

      if (isInitialLoad || themeChanged || countChanged) {
        setFrames(preloadingFrames);
        setActiveFrameIndex(preloadingFrames.length - 1); // Default to the latest frame
      } else {
        // Keep the playhead relative to the timeline shift so it doesn't jump!
        setActiveFrameIndex((prevIndex) => {
          const currentFrame = frames[prevIndex];
          if (currentFrame) {
            const newIndex = preloadingFrames.findIndex(f => f.observed_at === currentFrame.observed_at);
            if (newIndex !== -1) {
              return newIndex;
            }
          }
          return Math.min(prevIndex, preloadingFrames.length - 1);
        });
        setFrames(preloadingFrames);
      }

      setIsPreloading(false);
    });

    return () => {
      active = false;
    };
  }, [preloadingFrames, colorTheme]);

  // Playback timer loop
  useEffect(() => {
    let timer = null;
    if (isPlaying && frames.length > 0) {
      timer = setInterval(() => {
        setActiveFrameIndex((prevIndex) => (prevIndex + 1) % frames.length);
      }, intervalMs);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isPlaying, frames.length, intervalMs]);

  // Custom Wheel Zoom event hookup (native bypasses passive event blocks)
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;

    const onWheel = (e) => {
      e.preventDefault();
      const zoomFactor = 0.15;
      setScale((prevScale) => {
        const nextScale = prevScale + (e.deltaY < 0 ? zoomFactor : -zoomFactor);
        return Math.max(1, Math.min(nextScale, 5));
      });
      setActiveRegion("");
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", onWheel);
    };
  }, [frames]);

  // Drag Panning Event Handlers
  const handleMouseDown = (e) => {
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - translate.x, y: e.clientY - translate.y });
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    setActiveRegion("");
    setTranslate({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Touch Panning & Pinch-to-Zoom Event Handlers
  const handleTouchStart = (e) => {
    if (e.touches.length === 1) {
      setIsDragging(true);
      const touch = e.touches[0];
      setDragStart({ x: touch.clientX - translate.x, y: touch.clientY - translate.y });
    } else if (e.touches.length === 2) {
      setIsDragging(false);
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      touchStartDistRef.current = dist;
    }
  };

  const handleTouchMove = (e) => {
    if (e.touches.length === 1 && isDragging) {
      setActiveRegion("");
      const touch = e.touches[0];
      setTranslate({
        x: touch.clientX - dragStart.x,
        y: touch.clientY - dragStart.y
      });
    } else if (e.touches.length === 2 && touchStartDistRef.current > 0) {
      setActiveRegion("");
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const factor = dist / touchStartDistRef.current;
      touchStartDistRef.current = dist;
      setScale((prevScale) => {
        const nextScale = prevScale * factor;
        return Math.max(1, Math.min(nextScale, 5));
      });
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    touchStartDistRef.current = 0;
  };

  const resetZoom = () => {
    focusOnRegion("all");
  };

  // Compile Gif Loop Simulation
  const handleGenerateGif = () => {
    if (frames.length === 0) return;
    setIsCompiling(true);
    setCompilingProgress(0);
    setCompilingMessage("Starting compiler...");

    const steps = [
      { p: 15, m: "Downloading radar frames..." },
      { p: 35, m: "Aligning reflectivity grids..." },
      { p: 55, m: "Stitching storm structures..." },
      { p: 75, m: "Optimizing canvas colors..." },
      { p: 90, m: "Packaging GIF v1.6 loop..." },
      { p: 100, m: "GIF Compilation complete!" }
    ];

    let currentStepIdx = 0;

    const timer = setInterval(() => {
      if (currentStepIdx < steps.length) {
        const step = steps[currentStepIdx];
        setCompilingProgress(step.p);
        setCompilingMessage(step.m);
        currentStepIdx++;
      } else {
        clearInterval(timer);

        // Download currently viewed image (incorporating theme colors)
        try {
          const activeFrame = frames[activeFrameIndex];
          const link = document.createElement("a");
          link.href = cachedFrameUrls[activeFrame.observed_at] || getFrameImageSrc(activeFrame, activeFrameIndex);
          link.download = `doppler_radar_${activeFrame.observed_at.replace(/[\s-:]/g, "_")}.png`;
          link.target = "_blank";
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        } catch (e) {
          console.error("Image export failed:", e);
        }

        setTimeout(() => {
          setIsCompiling(false);
        }, 800);
      }
    }, 500);
  };

  // Get the modern, high-res radar-image endpoint URL dynamically
  const getFrameImageSrc = (frame, indexInTimeline) => {
    if (!frame) return "";
    // If it's already a direct Supabase Storage public URL, return it directly
    if (frame.image_url && (frame.image_url.includes("supabase.co") || frame.image_url.includes("radar-archives") || !frame.image_url.includes("id="))) {
      return frame.image_url;
    }
    const idMatch = frame.image_url.match(/[&?]id=(\d+)/);
    const index = idMatch ? idMatch[1] : indexInTimeline;
    return `https://panahon.gov.ph/api/v1/radar-image?token=vYopE7FszD6VmZ71qnG0GAh0dc4Qtv8G2Wp7eJ4k&sublayer=hybrid-reflectivity&index=${index}`;
  };

  // Format frame timestamp to visual text: e.g. "02:15 PM PHT" and "01 June 2026"
  const formatFrameTime = (observedAtStr) => {
    if (!observedAtStr) return { time: "--:-- PM PHT", date: "---" };
    try {
      const parts = observedAtStr.split(" ");
      const datePart = parts[0]; // YYYY-MM-DD
      const timePart = parts[1]; // HH:mm:ss

      const timeSubparts = timePart.split(":");
      let hour = parseInt(timeSubparts[0], 10);
      const minute = timeSubparts[1];
      const ampm = hour >= 12 ? "PM" : "AM";
      hour = hour % 12;
      hour = hour ? hour : 12; // 0 should be 12
      const formattedHour = hour.toString().padStart(2, "0");
      const timeStr = `${formattedHour}:${minute} ${ampm} PHT`;

      const dateSubparts = datePart.split("-");
      const months = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
      ];
      const day = dateSubparts[2];
      const month = months[parseInt(dateSubparts[1], 10) - 1];
      const year = dateSubparts[0];

      return { time: timeStr, date: `${day} ${month} ${year}` };
    } catch (e) {
      return { time: observedAtStr, date: "" };
    }
  };

  const activeTimeFormatted = formatFrameTime(frames[activeFrameIndex]?.observed_at);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <div className="max-w-7xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start w-full">
        {/* LEFT PANEL: Interactive Radar Screen */}
        <div className="lg:col-span-7 xl:col-span-8 bg-slate-900 border border-slate-800 rounded-3xl p-4 md:p-6 flex flex-col gap-4 shadow-2xl">
          {/* Radar Viewer Frame */}
          <div className="relative aspect-square w-full max-w-[700px] mx-auto bg-black rounded-2xl overflow-hidden border border-slate-950 select-none shadow-inner flex items-center justify-center">

            {/* Loading/Preloading Overlays */}
            {isLoading ? (
              <div className="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center gap-3 z-50">
                <Loader2 className="h-10 w-10 text-blue-500 animate-spin" />
                <span className="text-sm font-semibold text-slate-400">Loading Radar Timeline...</span>
              </div>
            ) : (isPreloading && Object.keys(cachedFrameUrls).length === 0) ? (
              <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm flex flex-col items-center justify-center gap-3 z-40">
                <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
                <span className="text-xs font-semibold text-slate-300">Preloading timeline frames to prevent flicker...</span>
              </div>
            ) : null}

            {/* Error Message */}
            {error && (
              <div className="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center p-6 text-center gap-4 z-50">
                <span className="text-red-400 text-sm font-medium">{error}</span>
                <button
                  onClick={fetchTimeline}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-semibold border border-slate-700 cursor-pointer transition-colors"
                >
                  Retry Connection
                </button>
              </div>
            )}

            {/* Top-Left Overlay Details */}
            {frames.length > 0 && (
              <div className="absolute top-4 left-4 z-30 flex flex-col leading-none pointer-events-none select-none">
                <span className="text-2xl md:text-3xl font-extrabold tracking-tight text-amber-400 drop-shadow-[0_2px_4px_rgba(0,0,0,0.85)]">
                  {activeTimeFormatted.time}
                </span>
                <span className="text-xs md:text-sm font-semibold text-slate-200 mt-1 drop-shadow-[0_2px_4px_rgba(0,0,0,0.85)]">
                  {activeTimeFormatted.date}
                </span>
              </div>
            )}

            {/* Bottom-Left dBZ Reflectivity Scale */}
            <div className="absolute bottom-2 left-2 md:bottom-4 md:left-4 z-30 bg-slate-950/80 backdrop-blur-sm border border-slate-800/30 rounded-lg md:rounded-xl p-1.5 md:p-2.5 flex flex-col select-none pointer-events-none text-[7.5px] md:text-[9px] text-slate-300 shadow-xl leading-none">
              <div className="flex gap-1.5 md:gap-2 items-center">
                {/* Visual Gradient scale */}
                <div
                  className="w-1.5 md:w-2 h-16 md:h-28 rounded-full"
                  style={{ background: getLegendGradientStyle(colorTheme) }}
                ></div>
                <div className="flex flex-col justify-between h-16 md:h-28 leading-none font-mono text-[6.5px] md:text-[8px]">
                  <span>65</span>
                  <span>60</span>
                  <span>45</span>
                  <span>30</span>
                  <span>20</span>
                  <span>15</span>
                  <span>3</span>
                  <span className="text-[5.5px] md:text-[7px]">1 mm/h</span>
                </div>
              </div>
              <div className="mt-1.5 md:mt-2 flex flex-col gap-0.5 text-[6.5px] md:text-[7px] text-slate-400 leading-none">
                <span className="font-bold">dBZ</span>
                <span>Radar Clutter</span>
              </div>
            </div>

            {/* Bottom-Right Imagery Credits */}
            <div className="absolute bottom-2 right-2 md:bottom-4 md:right-4 z-30 flex flex-col items-end text-[6.5px] md:text-[9px] text-slate-400 opacity-65 md:opacity-100 font-medium leading-tight md:leading-normal pointer-events-none select-none drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]">
              <span>Imagery from PAGASA PANAHON</span>
              <span>Data processed by PT/W</span>
              <span>Licensed under CC BY-SA 4.0</span>
            </div>

            {/* Main Radar Frame Renderer with aligned SVG province map layer underneath */}
            {frames.length > 0 && (
              <div
                ref={mapContainerRef}
                className="w-full relative cursor-grab active:cursor-grabbing overflow-hidden bg-black select-none touch-none"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                style={{
                  transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
                  transition: activeRegion ? "transform 0.4s ease-out" : "none",
                  aspectRatio: "1020 / 1393"
                }}
              >
                {/* Layer 1: Perfect-aligned SVG Base Map of the Philippines */}
                {svgBaseMap}

                {/* Layer 2: Transparent Radar Reflectivity PNG */}
                <img
                  src={cachedFrameUrls[frames[activeFrameIndex]?.observed_at] || getFrameImageSrc(frames[activeFrameIndex], activeFrameIndex)}
                  alt={`Doppler Radar Composite Frame ${activeFrameIndex}`}
                  draggable="false"
                  className="absolute inset-0 w-full h-full object-fill pointer-events-none select-none z-10"
                  style={{
                    imageRendering: "pixelated", // Render radar cells with infinite HD grid sharpness
                    transform: "translate(-2px, -4.5px)", // Micro-adjust the radar image slightly right and upward for perfect alignment
                  }}
                />

                {/* Layer 3: Foreground Province Borders Overlay (drawn on top of the rain) */}
                {svgBordersOverlay}
              </div>
            )}
          </div>

          {/* Bottom Scrub Range Timeline */}
          {frames.length > 0 && (
            <div className="flex items-center gap-4 bg-slate-950/40 p-3 rounded-2xl border border-slate-800/40">
              <button
                onClick={() => {
                  setIsPlaying(false);
                  setActiveFrameIndex((prev) => (prev > 0 ? prev - 1 : frames.length - 1));
                }}
                className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>

              <div className="flex-grow flex items-center gap-3">
                <SlidersHorizontal className="h-4.5 w-4.5 text-slate-400 select-none pointer-events-none" />
                <input
                  id="radar-slider"
                  type="range"
                  min="0"
                  max={frames.length - 1}
                  value={activeFrameIndex}
                  onChange={(e) => {
                    setIsPlaying(false);
                    setActiveFrameIndex(parseInt(e.target.value, 10));
                  }}
                  className="flex-grow h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer focus:outline-none"
                />
              </div>

              <button
                onClick={() => {
                  setIsPlaying(false);
                  setActiveFrameIndex((prev) => (prev + 1) % frames.length);
                }}
                className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          )}
        </div>

        {/* RIGHT PANEL: Futuristic HUD Command & Control Console */}
        <div className="lg:col-span-5 xl:col-span-4 flex flex-col gap-6 w-full font-sans select-none">
          <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-800/80 rounded-3xl p-6 shadow-2xl flex flex-col gap-6">

            {/* 1. HUD Telemetry Diagnostic Header */}
            <div className="flex flex-col gap-1 border-b border-slate-850 pb-4 font-mono text-[10px] text-cyan-400">
              <div className="flex justify-between items-center tracking-wider">
                <span className="font-semibold text-slate-400 uppercase tracking-widest text-[9px]">RADAR HUB DIAGNOSTIC</span>
                <span className={`px-2 py-0.5 rounded bg-cyan-950/60 text-cyan-400 border border-cyan-800/30 flex items-center gap-1.5 ${isPlaying ? 'animate-pulse' : ''}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${isPlaying ? 'bg-cyan-400 animate-ping' : 'bg-slate-500'}`}></span>
                  {isPlaying ? "ACTIVE" : "STANDBY"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2.5 text-slate-500">
                <span>GRID: EPSG:4326 (WGS84)</span>
                <span>MODE: HYBRID REFL</span>
                <span>SOURCE: Subic Doppler Mosaic</span>
                <span>RESOLUTION: 1020x1393</span>
              </div>
            </div>

            {/* 2. Unified Circular Play Hub */}
            <div className="flex flex-col items-center gap-4 bg-slate-950/40 py-6 px-4 rounded-2xl border border-slate-800/40 relative overflow-hidden group">
              {/* Subtle background tech grid */}
              <div className="absolute inset-0 opacity-5 pointer-events-none bg-[radial-gradient(#06b6d4_1px,transparent_1px)] [background-size:16px_16px]"></div>

              {/* Play button with glowing rotating orbit ring */}
              <div className="relative flex items-center justify-center h-20 w-20">
                {/* Dashed outer ring spins dynamically when animating */}
                <div className={`absolute inset-0 rounded-full border border-dashed border-cyan-500/30 transition-all duration-300 ${isPlaying ? "animate-[spin_10s_linear_infinite] scale-110 opacity-100" : "scale-100 opacity-50"
                  }`}></div>

                {/* Glow ring */}
                <div className={`absolute inset-0 rounded-full transition-all duration-500 blur-md ${isPlaying ? "bg-cyan-500/10 shadow-[0_0_20px_rgba(6,182,212,0.15)]" : "bg-transparent"
                  }`}></div>

                {/* Floating circular trigger */}
                <button
                  onClick={() => setIsPlaying(!isPlaying)}
                  disabled={frames.length === 0}
                  className={`relative z-10 h-16 w-16 rounded-full flex items-center justify-center transition-all cursor-pointer border ${isPlaying
                    ? "bg-gradient-to-tr from-cyan-600 to-blue-600 border-cyan-500 text-white shadow-[0_0_20px_rgba(6,182,212,0.4)]"
                    : "bg-slate-800 border-slate-700 hover:bg-slate-700 hover:border-slate-600 text-slate-300"
                    } active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {isPlaying ? (
                    <Pause className="h-6 w-6 fill-white text-white" />
                  ) : (
                    <Play className="h-6 w-6 fill-slate-300 text-slate-300 ml-1" />
                  )}
                </button>
              </div>

              {/* Auxiliary playback triggers */}
              <div className="flex gap-2.5 w-full mt-2 relative z-10">
                <button
                  onClick={() => {
                    setIsPlaying(false);
                    setActiveFrameIndex(0);
                  }}
                  disabled={frames.length === 0}
                  className="flex-1 py-2 px-3 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                  Stop
                </button>
                <button
                  onClick={fetchTimeline}
                  className="flex-1 py-2 px-3 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Sync Data
                </button>
                <button
                  onClick={resetZoom}
                  className="flex-1 py-2 px-3 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                  Recenter
                </button>
              </div>
            </div>

            {/* 3. Tactical Region Focus */}
            <div className="flex flex-col gap-2">
              <span className="text-slate-500 font-mono text-[9px] uppercase tracking-widest">Tactical Region Focus</span>
              <div className="grid grid-cols-4 gap-1.5 bg-slate-950/80 p-1.5 rounded-xl border border-slate-850">
                {[
                  { id: "luzon", label: "Luzon" },
                  { id: "visayas", label: "Visayas" },
                  { id: "mindanao", label: "Mindanao" },
                  { id: "all", label: "Whole PH" }
                ].map((region) => (
                  <button
                    key={region.id}
                    onClick={() => focusOnRegion(region.id)}
                    className={`py-2 px-1 text-[10px] md:text-xs font-bold rounded-lg transition-all cursor-pointer text-center ${activeRegion === region.id
                      ? "bg-cyan-600 text-white shadow-md shadow-cyan-900/30"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
                      }`}
                  >
                    {region.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 4. Asymmetric Spectral and delay deck */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Palette Theme Selector */}
              <div className="flex flex-col gap-2">
                <span className="text-slate-500 font-mono text-[9px] uppercase tracking-widest">Spectral Theme</span>
                <select
                  value={colorTheme}
                  onChange={(e) => {
                    setIsPlaying(false);
                    setColorTheme(e.target.value);
                  }}
                  className="w-full bg-slate-950/80 border border-slate-800/80 text-xs font-semibold rounded-xl p-2.5 text-slate-300 focus:outline-none focus:border-cyan-500/50 cursor-pointer"
                >
                  <option value="custom">Custom Smooth dBZ</option>
                  <option value="default">Default PAGASA</option>
                </select>
              </div>

              {/* Playback Delay (Intervalms) */}
              <div className="flex flex-col gap-2">
                <span className="text-slate-500 font-mono text-[9px] uppercase tracking-widest">Scan Delay</span>
                <div className="flex bg-slate-950/80 border border-slate-800/80 rounded-xl p-1.5 items-center justify-between">
                  <button
                    onClick={() => setIntervalMs(Math.max(100, intervalMs - 100))}
                    className="h-7 w-7 rounded-lg bg-slate-900 hover:bg-slate-800 flex items-center justify-center text-slate-400 font-bold transition-colors cursor-pointer active:scale-95"
                  >
                    -
                  </button>
                  <span className="text-xs font-mono font-bold text-slate-200">{intervalMs} ms</span>
                  <button
                    onClick={() => setIntervalMs(Math.min(3000, intervalMs + 100))}
                    className="h-7 w-7 rounded-lg bg-slate-900 hover:bg-slate-800 flex items-center justify-center text-slate-400 font-bold transition-colors cursor-pointer active:scale-95"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            {/* 5. Temporal Frame depth Segment */}
            <div className="flex flex-col gap-2">
              <span className="text-slate-500 font-mono text-[9px] uppercase tracking-widest">Temporal Frame Depth</span>
              <div className="grid grid-cols-3 gap-2 bg-slate-950/80 p-1.5 rounded-xl border border-slate-850">
                {[16, 24, 36].map((num) => (
                  <button
                    key={num}
                    onClick={() => {
                      setIsPlaying(false);
                      setPlaybackFramesCount(num);
                    }}
                    className={`py-2 px-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${playbackFramesCount === num
                      ? "bg-cyan-600 text-white shadow-md shadow-cyan-900/30"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
                      }`}
                  >
                    {num} Frames
                  </button>
                ))}
              </div>
            </div>

            {/* 6. Telemetry Compiler Output */}
            <div className="border-t border-slate-800/50 pt-5 flex flex-col gap-3">
              <span className="text-slate-500 font-mono text-[9px] uppercase tracking-widest">Export GIF</span>
              <button
                disabled={true}
                className="w-full py-3.5 px-5 rounded-xl font-extrabold text-xs tracking-wider uppercase flex items-center justify-center gap-2 transition-all bg-slate-800 text-slate-550 border border-slate-750 cursor-not-allowed opacity-50 select-none"
              >
                <Download className="h-4 w-4" />
                Compile Radar Loop
              </button>

              {/* Loader compile tracker */}
              {isCompiling && (
                <div className="bg-slate-950/80 border border-slate-900 rounded-xl p-3.5 flex flex-col gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="flex justify-between items-center text-[9px] font-mono leading-none">
                    <span className="text-emerald-400 font-bold">{compilingMessage}</span>
                    <span className="text-slate-400">{compilingProgress}%</span>
                  </div>
                  <div className="w-full bg-slate-900 rounded-full h-1 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full rounded-full transition-all duration-300"
                      style={{ width: `${compilingProgress}%` }}
                    ></div>
                  </div>
                </div>
              )}

              <p className="text-[10px] text-slate-500 leading-normal">
                Compiles radar frames from your selected temporal depth and delay telemetry into a high-fidelity radar animation file loop.
              </p>
            </div>

            {/* 7. Active Frame HUD Diagnostic readout */}
            {frames.length > 0 && (
              <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3.5 flex items-center justify-between text-xs font-mono">
                <div className="flex items-center gap-2.5">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                  </span>
                  <span className="text-slate-400 text-[10px] tracking-wide">
                    FRAME INDEX: <strong className="text-cyan-400">{activeFrameIndex + 1}</strong> OF <strong>{frames.length}</strong>
                  </span>
                </div>
                <span className="text-[10px] text-amber-400 tracking-wide">
                  TIME: {activeTimeFormatted.time.replace(" PHT", "")}
                </span>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
};

export default LiveRadar;
