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
  Loader2,
  Radio,
  Eye,
  EyeOff,
  Activity,
  Palette,
  Info,
  X,
  Layers,
  Settings,
  Plus,
  Minus
} from "lucide-react";
import { supabase } from "../supabaseClient";
import html2canvas from "html2canvas";
import GIF from "gif.js";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, ImageOverlay, Circle, CircleMarker, GeoJSON, Tooltip, useMap } from "react-leaflet";
import RadarControls from "./Radar/RadarControls";
import StationInspector from "./Radar/StationInspector";
import RadarWorker from "../workers/radarWorker?worker";
import { 
  minLon, maxLon, minLat, maxLat, 
  canvasWidth, canvasHeight, RADAR_STATIONS,
  HEX_COLORS_DBZ
} from "../data/radarConfig";

const RADAR_BOUNDS = [
  [minLat, minLon],
  [maxLat, maxLon]
];

const MAP_STYLES = {
  broadcast: {
    id: "broadcast",
    name: "AI TV Broadcast",
    desc: "Navy ocean & slate-olive land (ai_precip_outlook)",
    oceanBg: "#162533",
    landFill: "#25342a",
    borderColor: "#475569",
    borderWeight: 0.8
  },
  satellite: {
    id: "satellite",
    name: "ESRI Satellite Imagery",
    desc: "High-resolution orbital satellite photography",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri"
  },
  dark: {
    id: "dark",
    name: "CartoDB Dark Matter",
    desc: "Midnight dark cartography with road networks",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>'
  }
};

const MapBridge = ({ setMapInstance, setMapZoom }) => {
  const map = useMap();
  useEffect(() => {
    setMapInstance(map);
    setMapZoom(map.getZoom());
    const onZoom = () => setMapZoom(map.getZoom());
    map.on("zoomend", onZoom);
    return () => map.off("zoomend", onZoom);
  }, [map, setMapInstance, setMapZoom]);
  return null;
};

// High-fidelity dynamic pixel color swapping helper via Web Worker
const recolorRadarImageAsync = (imgElement, theme = "default") => {
  return new Promise((resolve) => {
    // If theme is "default", preserve the native authentic GarbinWx composite directly
    if (theme === "default") {
      resolve(imgElement.src);
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = imgElement.naturalWidth || imgElement.width || canvasWidth;
    canvas.height = imgElement.naturalHeight || imgElement.height || canvasHeight;

    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(imgElement, 0, 0);

    try {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const worker = new RadarWorker();

      worker.onmessage = (e) => {
        const processedData = new Uint8ClampedArray(e.data.buffer);
        const newImageData = new ImageData(processedData, e.data.width, e.data.height);
        ctx.putImageData(newImageData, 0, 0);
        resolve(canvas.toDataURL("image/png"));
        worker.terminate();
      };

      worker.onerror = (e) => {
        console.error("Worker error:", e);
        resolve(imgElement.src);
        worker.terminate();
      };

      worker.postMessage(
        { buffer: imageData.data.buffer, width: canvas.width, height: canvas.height, theme },
        [imageData.data.buffer]
      );
    } catch (e) {
      console.error("Dynamic recolor error:", e);
      resolve(imgElement.src);
    }
  });
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
  const [isInteractiveLoading, setIsInteractiveLoading] = useState(false);
  const [error, setError] = useState(null);

  // Custom Radar Color Palette Themes State
  const [colorTheme, setColorTheme] = useState("default");
  const [cachedFrameUrls, setCachedFrameUrls] = useState({});

  // Base Map Layer & Leaflet Map Instance State
  const [mapStyle, setMapStyle] = useState("broadcast");
  const [mapInstance, setMapInstance] = useState(null);
  const [mapZoom, setMapZoom] = useState(6);

  // Radar Interactive Station States
  const [hoveredStationId, setHoveredStationId] = useState(null);
  const [selectedStationId, setSelectedStationId] = useState(null);
  const [showLeftPanel, setShowLeftPanel] = useState(true);
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [showStations, setShowStations] = useState(true);
  const [showRangeCircles, setShowRangeCircles] = useState(true);

  // Mobile legend collapsed/expanded state
  const [showMobileLegend, setShowMobileLegend] = useState(false);

  // GIF compilation states
  const [gifProgress, setGifProgress] = useState(0);
  const [isCreatingGif, setIsCreatingGif] = useState(false);
  const [gifMessage, setGifMessage] = useState("");

  // Handle responsive design for sidebars on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const handleResize = () => {
        const isLarge = window.innerWidth >= 1024;
        setShowLeftPanel(isLarge);
        setShowRightPanel(isLarge);
      };
      handleResize();
      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }
  }, []);

  const saveTimelineToLocalStorage = (timelineArray) => {
    try {
      if (typeof window !== "undefined") {
        // Strip out large rawBase64 data URLs to prevent QuotaExceededError
        const pruned = timelineArray.map(({ observed_at, observed_at_unix, image_url }) => ({
          observed_at,
          observed_at_unix,
          image_url
        }));
        window.localStorage.setItem("radar_accumulated_timeline", JSON.stringify(pruned));
      }
    } catch (e) {
      console.error("Failed to save radar timeline:", e);
    }
  };

  // Map GeoJSON data for aligned background projection
  const [geoData, setGeoData] = useState(null);

  // Fetch GeoJSON Philippines Map data
  useEffect(() => {
    fetch("/data/ph_provinces.json")
      .then((res) => res.json())
      .then((data) => setGeoData(data))
      .catch((err) => console.error("Failed to load provinces map:", err));
  }, []);

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

  // Project radar stations onto the map canvas coordinate space
  const projectedStations = useMemo(() => {
    const project = (lon, lat) => {
      const x = ((lon - minLon) / (maxLon - minLon)) * canvasWidth;
      const y = ((maxLat - lat) / (maxLat - minLat)) * canvasHeight;
      return [x, y];
    };
    return RADAR_STATIONS.map(station => {
      const [x, y] = project(station.lon, station.lat);
      return {
        ...station,
        x,
        y
      };
    });
  }, []);

  const [stations, setStations] = useState(projectedStations);

  useEffect(() => {
    setStations(projectedStations);
  }, [projectedStations]);

  // Dynamically analyze the current radar image frame to determine online/offline status of each station
  useEffect(() => {
    if (!frames.length || activeFrameIndex >= frames.length) return;
    
    const activeFrame = frames[activeFrameIndex];
    if (!activeFrame || !activeFrame.image_url) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        
        ctx.drawImage(img, 0, 0, canvasWidth, canvasHeight);
        
        const updatedStations = stations.map((station) => {
          // Project station lat/lon to canvas coordinates
          const x = Math.round(station.x);
          const y = Math.round(station.y);
          
          // Sample a few pixels around the station center to detect presence of sweep data or range rings
          // We check 8 cardinal directions at radius of 45 pixels (about 50km range)
          const radius = 45;
          const angles = [0, 45, 90, 135, 180, 225, 270, 315];
          let hasData = false;
          
          for (let angle of angles) {
            const rad = (angle * Math.PI) / 180;
            const px = Math.round(x + radius * Math.cos(rad));
            const py = Math.round(y + radius * Math.sin(rad));
            
            if (px >= 0 && px < canvasWidth && py >= 0 && py < canvasHeight) {
              const pixel = ctx.getImageData(px, py, 1, 1).data;
              const alpha = pixel[3];
              
              // If there's any visible pixel data (alpha > 5), it means the station sweep exists
              if (alpha > 5) {
                hasData = true;
                break;
              }
            }
          }
          
          let currentStatus = hasData ? "online" : "offline";
          
          // Preserved overrides for specific manual modes
          if (station.id === "guiuan") {
            currentStatus = "maintenance"; // Guiuan is under rebuilding/maintenance
          } else if (station.id === "virac" && !hasData) {
            currentStatus = "standby"; // Virac is often standby facing Pacific
          }
          
          return {
            ...station,
            status: currentStatus
          };
        });
        
        // Prevent infinite state loops: check if status actually changed before updating state
        const changed = updatedStations.some((us, idx) => us.status !== stations[idx]?.status);
        if (changed) {
          setStations(updatedStations);
        }
      } catch (e) {
        // Fallback silently if canvas read is blocked (CORS safety)
        console.warn("Dynamic station status check bypassed (CORS / browser restriction):", e);
      }
    };
    img.src = activeFrame.image_url;
  }, [activeFrameIndex, frames, projectedStations]);

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
  const initialFocusDone = useRef(false);

  // Dynamic Responsive Region Focusing Helper via Leaflet
  const focusOnRegion = (regionId) => {
    setActiveRegion(regionId);
    setLabelRegion(regionId);
    if (!mapInstance) return;
    const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

    if (regionId === "luzon") {
      mapInstance.flyTo([16.4, 121.2], isMobile ? 6.2 : 7.2, { duration: 0.8 });
      setScale(1.9);
    } else if (regionId === "visayas") {
      mapInstance.flyTo([10.8, 123.5], isMobile ? 6.7 : 7.6, { duration: 0.8 });
      setScale(2.2);
    } else if (regionId === "mindanao") {
      mapInstance.flyTo([7.8, 124.8], isMobile ? 6.7 : 7.6, { duration: 0.8 });
      setScale(2.1);
    } else {
      mapInstance.flyToBounds(RADAR_BOUNDS, { padding: isMobile ? [10, 10] : [25, 25], duration: 0.8 });
      setScale(1.0);
    }
  };

  const resetZoom = () => {
    focusOnRegion("all");
  };

  const handleZoomIn = () => {
    if (mapInstance) {
      mapInstance.zoomIn();
    }
  };

  const handleZoomOut = () => {
    if (mapInstance) {
      mapInstance.zoomOut();
    }
  };

  // Keep region focus dynamic on mounting and timeline load (full archipelago on mobile, Luzon on desktop)
  useEffect(() => {
    if (frames.length > 0 && mapInstance && !initialFocusDone.current) {
      initialFocusDone.current = true;
      const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
      focusOnRegion(isMobile ? "all" : "luzon");
    }
  }, [frames, mapInstance]);

  // GIF Compiler Simulation State
  const [isCompiling, setIsCompiling] = useState(false);
  const [compilingProgress, setCompilingProgress] = useState(0);
  const [compilingMessage, setCompilingMessage] = useState("");

  const mapContainerRef = useRef(null);
  const touchStartDistRef = useRef(0);

  // Fetch Radar Timeline Data from Supabase
  const fetchTimeline = async (isBackground = false, targetCount = playbackFramesCount) => {
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
        .limit(targetCount);

      if (error) throw error;

      if (data && data.length > 0) {
        // Helper to convert DB ISO timestamp (stored as UTC) to standard PHT (UTC+8) format
        const formatToPHT = (isoStr) => {
          try {
            const d = new Date(isoStr);
            const phtOffsetMs = 8 * 60 * 60 * 1000; // +8 hours
            const phtDate = new Date(d.getTime() + phtOffsetMs);
            const year = phtDate.getUTCFullYear();
            const month = String(phtDate.getUTCMonth() + 1).padStart(2, "0");
            const day = String(phtDate.getUTCDate()).padStart(2, "0");
            const hours = String(phtDate.getUTCHours()).padStart(2, "0");
            const minutes = String(phtDate.getUTCMinutes()).padStart(2, "0");
            const seconds = String(phtDate.getUTCSeconds()).padStart(2, "0");
            return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
          } catch (e) {
            return isoStr.split("+")[0].replace("T", " ");
          }
        };

        const formatted = data.map((f) => ({
          observed_at: formatToPHT(f.observed_at), // Convert database timestamp to PHT (UTC+8)
          observed_at_unix: parseInt(f.observed_at_unix, 10),
          image_url: f.public_url,
          rawBase64: null // Direct CORS support from Supabase Storage skips canvas taint issues!
        }));
        // Sort chronologically for timeline display
        setRawTimeline(formatted.reverse());
      } else {
        if (!isBackground) {
          setError("No radar history records found in database.");
        }
        setIsInteractiveLoading(false);
      }
    } catch (err) {
      console.error("Supabase fetch error:", err);
      if (!isBackground) {
        setError("Failed to connect to the radar archive database.");
      }
      setIsInteractiveLoading(false);
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
    if (theme === "clean") {
      return "linear-gradient(to top, transparent 0%, transparent 18.75%, #00ff00 20%, #cdeb00 37.5%, #ffff00 38.75%, #ff8700 50%, #ff0000 57.5%, #a00000 68.75%, #eb00cd 75%, #aa00ff 81.25%, #9600ff 100%)";
    }
    // Official GarbinWx DBZ Scale (1 to 66+ dBZ)
    return "linear-gradient(to top, #535353 0%, #cecece 18.75%, #00ff00 20%, #cdeb00 37.5%, #ffff00 38.75%, #ff8700 50%, #ff0000 57.5%, #a00000 68.75%, #eb00cd 75%, #aa00ff 81.25%, #9600ff 100%)";
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

      saveTimelineToLocalStorage(sliced);

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
            setCachedFrameUrls((prev) => ({
              ...prev,
              [cacheKey]: img.src
            }));
          }
          resolve();
        }, 10000);

        img.onload = async () => {
          clearTimeout(timeoutId);
          if (!active) {
            resolve();
            return;
          }

          // Convert raw image to base64 if not already cached
          if (!frame.rawBase64) {
            try {
              const canvas = document.createElement("canvas");
              canvas.width = img.naturalWidth || img.width || canvasWidth;
              canvas.height = img.naturalHeight || img.height || canvasHeight;
              const ctx = canvas.getContext("2d");
              ctx.drawImage(img, 0, 0);
              frame.rawBase64 = canvas.toDataURL("image/png");
            } catch (e) {
              console.error("Failed to extract raw base64 data:", e);
            }
          }

          const dataUrl = await recolorRadarImageAsync(img, colorTheme);
          if (active) {
            currentCache[cacheKey] = dataUrl;
            setCachedFrameUrls((prev) => ({
              ...prev,
              [cacheKey]: dataUrl
            }));
          }
          resolve();
        };
        img.onerror = () => {
          clearTimeout(timeoutId);
          if (active) {
            currentCache[cacheKey] = img.src;
            setCachedFrameUrls((prev) => ({
              ...prev,
              [cacheKey]: img.src
            }));
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
          saveTimelineToLocalStorage(next);
        }
        return next;
      });

      // Update the active frames list for playback only after everything is cached!
      const isInitialLoad = frames.length === 0;
      const isNewImageAdded = !isInitialLoad && frames.length > 0 && preloadingFrames.length > 0 && 
                              preloadingFrames[preloadingFrames.length - 1].observed_at !== frames[frames.length - 1].observed_at;

      if (isInitialLoad || themeChanged || countChanged || isNewImageAdded) {
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
      setIsInteractiveLoading(false);
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
  }, [frames, isLoading]);

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

  const drawDbgColorLegend = (ctx, x, y, width, height, theme, scale) => {
    // 1. Draw rounded container card
    ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
    ctx.shadowBlur = 8 * scale;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 4 * scale;

    ctx.fillStyle = "rgba(15, 23, 42, 0.85)"; // slate-900 with opacity
    ctx.strokeStyle = "rgba(51, 65, 85, 0.8)"; // slate-800
    ctx.lineWidth = 1.5 * scale;
    
    // Draw rounded rect path
    const radius = 12 * scale;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.fill();
    ctx.stroke();

    // Reset shadow
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // 2. Draw Title Text
    ctx.fillStyle = "#94a3b8"; // slate-400
    ctx.font = `bold ${8 * scale}px monospace`;
    ctx.textAlign = "left";
    ctx.fillText("dBZ Intensity", x + 12 * scale, y + 18 * scale);

    // Title divider line
    ctx.strokeStyle = "rgba(51, 65, 85, 0.4)";
    ctx.lineWidth = 1 * scale;
    ctx.beginPath();
    ctx.moveTo(x + 12 * scale, y + 24 * scale);
    ctx.lineTo(x + width - 12 * scale, y + 24 * scale);
    ctx.stroke();

    // 3. Define color stops based on theme
    let colors = ["#595959", "#43e843", "#00c900", "#eff000", "#ff6a00", "#f50500", "#e600cc", "#9e07fb"]; // default & custom
    if (theme === "custom" || theme === "default") {
      colors = ["#595959", "#43e843", "#00c900", "#eff000", "#ff6a00", "#f50500", "#e600cc", "#9e07fb"];
    } else if (theme === "vaporwave") {
      colors = ["#1c1533", "#00f0ff", "#05d9e8", "#ff2a74", "#ff007f", "#ab00cd"];
    } else if (theme === "storm") {
      colors = ["#20181b", "#1e3a8a", "#047857", "#d97706", "#dc2626", "#701a75"];
    } else if (theme === "retro") {
      colors = ["#041f0f", "#14532d", "#15803d", "#22c55e", "#4ade80", "#86efac"];
    }

    // 4. Draw vertical gradient color bar
    const barX = x + 12 * scale;
    const barY = y + 32 * scale;
    const barW = 8 * scale;
    const barH = height - 44 * scale;

    const legendColors = colors.slice(1); // Omit clutter background color

    const grad = ctx.createLinearGradient(barX, barY + barH, barX, barY);
    legendColors.forEach((c, idx) => {
      grad.addColorStop(idx / (legendColors.length - 1), c);
    });

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW, barH, 4 * scale);
    ctx.fill();

    // Draw thin dark outline around color bar
    ctx.strokeStyle = "rgba(2, 6, 17, 0.6)";
    ctx.lineWidth = 1 * scale;
    ctx.stroke();

    // 5. Draw Labels & color indicators
    const labels = [
      { text: "65 dBZ (65+)", color: "#9e07fb" },
      { text: "60 dBZ (45)", color: "#e600cc" },
      { text: "45 dBZ (30)", color: "#f50500" },
      { text: "30 dBZ (15)", color: "#eff000" },
      { text: "20 dBZ (7)", color: "#00c900" },
      { text: "15 dBZ (1-3)", color: "#43e843" },
      { text: "0 dBZ (Clutter)", color: "#595959" }
    ];

    ctx.textAlign = "left";
    ctx.font = `bold ${8 * scale}px sans-serif`;
    ctx.textBaseline = "middle";

    labels.forEach((lbl, idx) => {
      const itemY = barY + (idx / (labels.length - 1)) * barH;
      
      // Draw small circular color indicator dot
      const dotX = x + 28 * scale;
      ctx.fillStyle = lbl.color;
      ctx.beginPath();
      ctx.arc(dotX, itemY, 2.5 * scale, 0, Math.PI * 2);
      ctx.fill();

      // Draw label text
      ctx.fillStyle = "#cbd5e1"; // slate-300
      ctx.fillText(lbl.text, dotX + 6.5 * scale, itemY);
    });

    // Reset baseline setting
    ctx.textBaseline = "alphabetic";
  };

  const drawRoundRect = (ctx, x, y, w, h, radius) => {
    if (ctx.roundRect) {
      ctx.roundRect(x, y, w, h, radius);
    } else {
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + w - radius, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
      ctx.lineTo(x + w, y + h - radius);
      ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
      ctx.lineTo(x + radius, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
    }
  };

  const renderFrameToCanvas = async (frame, exportScale = 4, selectedStation = null, cachedLayers = null) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1020 * exportScale;
    canvas.height = 1393 * exportScale;
    const ctx = canvas.getContext("2d");

    // Render ocean background based on mapStyle (Default: AI TV Broadcast Deep Navy)
    let oceanBg = "#162533";
    if (mapStyle === "dark") oceanBg = "#020617";
    else if (mapStyle === "satellite") oceanBg = "#08141e";

    ctx.fillStyle = oceanBg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // SVG loaders helpers
    const loadImage = (src) => {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = (e) => reject(e);
        img.src = src;
      });
    };

    const loadSvgAsImage = (svgString) => {
      return new Promise((resolve, reject) => {
        const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          resolve(img);
        };
        img.onerror = (e) => {
          URL.revokeObjectURL(url);
          reject(e);
        };
        img.src = url;
      });
    };

    // 1. Draw Base Map (fill landmass and coastlines based on mapStyle)
    const baseMapKey = `baseMap_${mapStyle}_${exportScale}`;
    if (cachedLayers && cachedLayers[baseMapKey]) {
      ctx.drawImage(cachedLayers[baseMapKey], 0, 0);
    } else {
      let landFill = "#25342a"; // Dark Slate-Olive from ai_precip_outlook
      let coastStroke = "#0f172a"; // TV Coastline
      let coastWidth = "1.2";
      if (mapStyle === "dark") {
        landFill = "#0f172a";
        coastStroke = "#1e293b";
        coastWidth = "0.8";
      } else if (mapStyle === "satellite") {
        landFill = "#182823";
        coastStroke = "#233d34";
        coastWidth = "1.0";
      }
      const baseMapSvgString = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1020 1393" width="${1020 * exportScale}" height="${1393 * exportScale}">${projectedFeatures.map(prov => `<path d="${prov.d}" fill="${landFill}" stroke="${coastStroke}" stroke-width="${coastWidth}" />`).join('')}</svg>`;
      const baseMapImg = await loadSvgAsImage(baseMapSvgString);
      if (cachedLayers) cachedLayers[baseMapKey] = baseMapImg;
      ctx.drawImage(baseMapImg, 0, 0);
    }

    // 2. Draw Radar image (with custom theme colors)
    const frameIndex = frames.findIndex(f => f.observed_at === frame.observed_at);
    const radarSrc = cachedFrameUrls[frame.observed_at] || getFrameImageSrc(frame, frameIndex !== -1 ? frameIndex : 0);
    const radarImg = await loadImage(radarSrc);

    // Dynamically analyze this frame's image to calculate correct online/offline statuses for this frame
    let analyzedStations = stations;
    try {
      const canvasForAnalysis = document.createElement("canvas");
      canvasForAnalysis.width = 1020;
      canvasForAnalysis.height = 1393;
      const ctxForAnalysis = canvasForAnalysis.getContext("2d");
      if (ctxForAnalysis) {
        ctxForAnalysis.drawImage(radarImg, 0, 0, 1020, 1393);
        analyzedStations = stations.map((station) => {
          const x = Math.round(station.x);
          const y = Math.round(station.y);
          
          const radius = 45;
          const angles = [0, 45, 90, 135, 180, 225, 270, 315];
          let hasData = false;
          
          for (let angle of angles) {
            const rad = (angle * Math.PI) / 180;
            const px = Math.round(x + radius * Math.cos(rad));
            const py = Math.round(y + radius * Math.sin(rad));
            
            if (px >= 0 && px < 1020 && py >= 0 && py < 1393) {
              const pixel = ctxForAnalysis.getImageData(px, py, 1, 1).data;
              const alpha = pixel[3];
              if (alpha > 5) {
                hasData = true;
                break;
              }
            }
          }
          
          let currentStatus = hasData ? "online" : "offline";
          if (station.id === "guiuan") {
            currentStatus = "maintenance";
          } else if (station.id === "virac" && !hasData) {
            currentStatus = "standby";
          }
          
          return {
            ...station,
            status: currentStatus
          };
        });
      }
    } catch (e) {
      console.warn("Exporter dynamic station status check bypassed:", e);
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(radarImg, 0, 0, 1020 * exportScale, 1393 * exportScale);
    ctx.imageSmoothingEnabled = true;

    // 3. Draw Province Borders Overlay (crisp on top of weather cells)
    const bordersKey = `borders_${mapStyle}_${exportScale}`;
    if (cachedLayers && cachedLayers[bordersKey]) {
      ctx.drawImage(cachedLayers[bordersKey], 0, 0);
    } else {
      let borderColor = "#475569"; // Slate borders from ai_precip_outlook
      let borderWidth = "0.8";
      if (mapStyle === "dark") {
        borderColor = "#334155";
        borderWidth = "0.4";
      }
      const bordersSvgString = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1020 1393" width="${1020 * exportScale}" height="${1393 * exportScale}">${projectedFeatures.map(prov => `<path d="${prov.d}" fill="none" stroke="${borderColor}" stroke-width="${borderWidth}" opacity="0.85" />`).join('')}</svg>`;
      const bordersImg = await loadSvgAsImage(bordersSvgString);
      if (cachedLayers) cachedLayers[bordersKey] = bordersImg;
      ctx.drawImage(bordersImg, 0, 0);
    }

    // Draw active station range ring on canvas so they are captured
    if (showRangeCircles) {
      analyzedStations.forEach((station) => {
        const isHovered = hoveredStationId === station.id;
        const isSelected = selectedStationId === station.id;
        const isActive = isHovered || isSelected;
        if (!isActive || station.status === "maintenance") return;

        // Draw scan coverage dashed circle
        ctx.beginPath();
        ctx.arc(station.x * exportScale, station.y * exportScale, 160 * exportScale, 0, Math.PI * 2);
        ctx.strokeStyle = station.status === "online" ? "rgba(56, 189, 248, 0.7)" : "rgba(234, 179, 8, 0.7)";
        ctx.lineWidth = 1.5 * exportScale;
        ctx.setLineDash([4 * exportScale, 4 * exportScale]);
        ctx.stroke();
        ctx.setLineDash([]); // Reset dash
      });
    }

    // 4. Draw Stations Points (Sky blue marker with white border like ai_precip_outlook)
    if (showStations) {
      const stationsSvgString = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1020 1393" width="${1020 * exportScale}" height="${1393 * exportScale}">${analyzedStations.map(station => {
        let markerColor = "#38bdf8";
        if (station.status === "online") markerColor = "#38bdf8";
        else if (station.status === "maintenance") markerColor = "#ef4444";
        else if (station.status === "standby") markerColor = "#eab308";
        return `<circle cx="${station.x}" cy="${station.y}" r="4.2" fill="${markerColor}" stroke="#ffffff" stroke-width="1.2" />`;
      }).join('')}</svg>`;
      const stationsImg = await loadSvgAsImage(stationsSvgString);
      ctx.drawImage(stationsImg, 0, 0);
    }

    // Output processing (crop if a station is selected)
    if (selectedStation) {
      const cropCanvas = document.createElement("canvas");
      cropCanvas.width = 440 * exportScale;
      cropCanvas.height = 440 * exportScale;
      const cropCtx = cropCanvas.getContext("2d");

      // Draw solid broadcast dark background outside circle
      cropCtx.fillStyle = "#0b131a";
      cropCtx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);

      // Save context state for circular scope clipping
      cropCtx.save();

      // Circular clipping path centered at (220, 200) with radius 160
      cropCtx.beginPath();
      cropCtx.arc(220 * exportScale, 200 * exportScale, 160 * exportScale, 0, Math.PI * 2);
      cropCtx.clip();

      // Draw ocean interior background for scope
      cropCtx.fillStyle = oceanBg;
      cropCtx.fillRect(60 * exportScale, 40 * exportScale, 320 * exportScale, 320 * exportScale);

      // Blit region from full national canvas
      cropCtx.drawImage(
        canvas,
        (selectedStation.x - 160) * exportScale, // sx
        (selectedStation.y - 160) * exportScale, // sy
        320 * exportScale, // sw
        320 * exportScale, // sh
        60 * exportScale, // dx
        40 * exportScale, // dy
        320 * exportScale, // dw
        320 * exportScale  // dh
      );

      // Restore context state to remove circular clipping
      cropCtx.restore();

      // Draw high-contrast double borders around the circular radar scope
      cropCtx.strokeStyle = "#1e293b";
      cropCtx.lineWidth = 3.5 * exportScale;
      cropCtx.beginPath();
      cropCtx.arc(220 * exportScale, 200 * exportScale, 161 * exportScale, 0, Math.PI * 2);
      cropCtx.stroke();

      cropCtx.strokeStyle = "#38bdf8"; // broadcast cyan ring
      cropCtx.lineWidth = 1.5 * exportScale;
      cropCtx.beginPath();
      cropCtx.arc(220 * exportScale, 200 * exportScale, 160 * exportScale, 0, Math.PI * 2);
      cropCtx.stroke();

      const activeTime = formatFrameTime(frame?.observed_at);

      // 1. Draw Watermark: Philippine Typhoon/Weather (Top-Left)
      cropCtx.fillStyle = "#38bdf8";
      cropCtx.font = `900 ${7.5 * exportScale}px sans-serif`;
      cropCtx.textAlign = "left";
      cropCtx.fillText("PHILIPPINE TYPHOON/WEATHER", 24 * exportScale, 20 * exportScale);

      cropCtx.fillStyle = "#94a3b8";
      cropCtx.font = `bold ${4.5 * exportScale}px monospace`;
      cropCtx.fillText("DOPPLER RADAR NETWORK", 24 * exportScale, 28 * exportScale);

      // 2. Draw Station Telemetry Banner Pill (Top-Center)
      cropCtx.fillStyle = "#1e293b";
      cropCtx.strokeStyle = "#38bdf8";
      cropCtx.lineWidth = 1 * exportScale;
      cropCtx.beginPath();
      drawRoundRect(cropCtx, 140 * exportScale, 11 * exportScale, 160 * exportScale, 20 * exportScale, 5 * exportScale);
      cropCtx.fill();
      cropCtx.stroke();

      cropCtx.fillStyle = "#ffffff";
      cropCtx.font = `900 ${7.5 * exportScale}px sans-serif`;
      cropCtx.textAlign = "center";
      cropCtx.fillText(selectedStation.name.toUpperCase(), 220 * exportScale, 22 * exportScale);

      cropCtx.fillStyle = "#38bdf8";
      cropCtx.font = `bold ${4 * exportScale}px monospace`;
      cropCtx.fillText("240 KM RADIAL COVERAGE", 220 * exportScale, 28 * exportScale);

      // 3. Draw Timestamp & Date (Top-Right)
      cropCtx.fillStyle = "#fbbf24";
      cropCtx.font = `900 ${7.5 * exportScale}px sans-serif`;
      cropCtx.textAlign = "right";
      cropCtx.fillText(activeTime.time, 416 * exportScale, 20 * exportScale);

      cropCtx.fillStyle = "#94a3b8";
      cropCtx.font = `bold ${5 * exportScale}px sans-serif`;
      cropCtx.fillText(activeTime.date, 416 * exportScale, 28 * exportScale);

      // 4. Draw dBZ intensity legend on crop canvas (Bottom-Left)
      drawDbgColorLegend(
        cropCtx,
        24 * exportScale,
        372 * exportScale,
        64 * exportScale,
        56 * exportScale,
        colorTheme,
        exportScale * 0.42
      );

      // 5. Draw Station Status Diagnostics (Bottom-Right)
      cropCtx.fillStyle = "#1e293b";
      cropCtx.strokeStyle = "rgba(56, 189, 248, 0.3)";
      cropCtx.lineWidth = 1 * exportScale;
      cropCtx.beginPath();
      drawRoundRect(cropCtx, 100 * exportScale, 372 * exportScale, 316 * exportScale, 56 * exportScale, 8 * exportScale);
      cropCtx.fill();
      cropCtx.stroke();

      // Diagnostic telemetry inside bottom card
      cropCtx.fillStyle = "#94a3b8";
      cropCtx.font = `bold ${4.5 * exportScale}px monospace`;
      cropCtx.textAlign = "left";
      cropCtx.fillText("DIAGNOSTIC TELEMETRY:", 112 * exportScale, 388 * exportScale);

      const currentStationDetails = analyzedStations.find(s => s.id === selectedStation.id) || selectedStation;
      const statusUpper = String(currentStationDetails.status || "online").toUpperCase();
      
      let statusColor = "#10b981";
      let statusText = "SYS ACTIVE";
      if (statusUpper === "OFFLINE") {
        statusColor = "#ef4444";
        statusText = "SYS OFFLINE";
      } else if (statusUpper === "MAINTENANCE") {
        statusColor = "#ef4444";
        statusText = "MAINTENANCE";
      } else if (statusUpper === "STANDBY") {
        statusColor = "#eab308";
        statusText = "STANDBY MODE";
      }

      cropCtx.fillStyle = "#38bdf8";
      cropCtx.font = `bold ${4.5 * exportScale}px monospace`;
      cropCtx.fillText(`COORDS: ${selectedStation.lat.toFixed(2)}°N, ${selectedStation.lon.toFixed(2)}°E`, 112 * exportScale, 400 * exportScale);
      cropCtx.fillText(`SYSTEM STATUS: ${statusUpper}`, 112 * exportScale, 412 * exportScale);

      cropCtx.fillStyle = statusColor;
      cropCtx.beginPath();
      cropCtx.arc(398 * exportScale, 400 * exportScale, 3 * exportScale, 0, Math.PI * 2);
      cropCtx.fill();

      cropCtx.fillStyle = statusColor;
      cropCtx.font = `900 ${4.5 * exportScale}px monospace`;
      cropCtx.textAlign = "right";
      cropCtx.fillText(statusText, 390 * exportScale, 403 * exportScale);

      return cropCanvas;
    } else {
      const activeTime = formatFrameTime(frame?.observed_at);

      // ── Top Broadcast Header Banner ──────────────────────────────────────────
      ctx.fillStyle = "rgba(11, 19, 26, 0.96)";
      ctx.fillRect(0, 0, canvas.width, 108 * exportScale);

      ctx.fillStyle = "#1e293b";
      ctx.fillRect(0, 106.5 * exportScale, canvas.width, 1.5 * exportScale);

      // Left: Brand Logo / Title
      ctx.textAlign = "left";
      ctx.fillStyle = "#38bdf8";
      ctx.font = `900 ${16 * exportScale}px sans-serif`;
      ctx.fillText("PHILIPPINE TYPHOON/WEATHER", 36 * exportScale, 46 * exportScale);

      ctx.fillStyle = "#94a3b8";
      ctx.font = `bold ${9 * exportScale}px monospace`;
      ctx.fillText("NATIONAL DOPPLER RADAR NETWORK", 36 * exportScale, 68 * exportScale);

      ctx.fillStyle = "#64748b";
      ctx.font = `bold ${7.5 * exportScale}px monospace`;
      ctx.fillText("HIGH-RESOLUTION 240KM COMPOSITE", 36 * exportScale, 88 * exportScale);

      // Center: Title Pill + Subtitle Pill
      const pillW = 340 * exportScale;
      const pillH = 42 * exportScale;
      const pillX = (canvas.width - pillW) / 2;
      const pillY = 16 * exportScale;

      ctx.fillStyle = "#1e293b";
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 1.5 * exportScale;
      ctx.beginPath();
      drawRoundRect(ctx, pillX, pillY, pillW, pillH, 12 * exportScale);
      ctx.fill();
      ctx.stroke();

      ctx.textAlign = "center";
      ctx.fillStyle = "#f8fafc";
      ctx.font = `900 ${17 * exportScale}px sans-serif`;
      ctx.fillText("DOPPLER RADAR COMPOSITE", canvas.width / 2, pillY + 27 * exportScale);

      // Subtitle Blue Bar Pill
      const subW = 310 * exportScale;
      const subH = 26 * exportScale;
      const subX = (canvas.width - subW) / 2;
      const subY = 66 * exportScale;

      ctx.fillStyle = "#0369a1";
      ctx.beginPath();
      drawRoundRect(ctx, subX, subY, subW, subH, 8 * exportScale);
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${10.5 * exportScale}px sans-serif`;
      ctx.fillText(`LIVE OBSERVED · ${activeTime.time.replace(" PHT", "")} PHT (${activeTime.date})`, canvas.width / 2, subY + 17.5 * exportScale);

      // Right: Telemetry / Status Box
      ctx.textAlign = "right";
      ctx.fillStyle = "#38bdf8";
      ctx.font = `900 ${12 * exportScale}px monospace`;
      ctx.fillText("SYSTEM OPERATIONAL", canvas.width - 36 * exportScale, 46 * exportScale);

      ctx.fillStyle = "#94a3b8";
      ctx.font = `bold ${8.5 * exportScale}px monospace`;
      ctx.fillText("COMPOSITE ARCHIVE: 16 STATIONS", canvas.width - 36 * exportScale, 68 * exportScale);

      ctx.fillStyle = "#64748b";
      ctx.font = `bold ${7.5 * exportScale}px monospace`;
      ctx.fillText("PAGASA / GARBINWX COMPOSITE", canvas.width - 36 * exportScale, 88 * exportScale);

      // ── Bottom Broadcast Footer Bar ──────────────────────────────────────────
      const footH = 44 * exportScale;
      const footY = canvas.height - footH;
      ctx.fillStyle = "rgba(11, 19, 26, 0.94)";
      ctx.fillRect(0, footY, canvas.width, footH);

      ctx.fillStyle = "#1e293b";
      ctx.fillRect(0, footY, canvas.width, 1.2 * exportScale);

      // Bottom Left Telemetry
      ctx.textAlign = "left";
      ctx.fillStyle = "#38bdf8";
      ctx.font = `900 ${8.5 * exportScale}px sans-serif`;
      ctx.fillText("DOPPLER RADAR COMPOSITE MONITORING", 36 * exportScale, footY + 19 * exportScale);

      ctx.fillStyle = "#64748b";
      ctx.font = `bold ${7 * exportScale}px sans-serif`;
      ctx.fillText(`Cartography: ${MAP_STYLES[mapStyle]?.name || mapStyle} · Calibration: WGS84 / EPSG:4326`, 36 * exportScale, footY + 33 * exportScale);

      // Bottom Right Notice
      ctx.textAlign = "right";
      ctx.fillStyle = "#94a3b8";
      ctx.font = `bold ${7.5 * exportScale}px monospace`;
      ctx.fillText(`COLOR THEME: ${colorTheme.toUpperCase()} · RANGE: 1 TO 66+ dBZ`, canvas.width - 36 * exportScale, footY + 19 * exportScale);

      ctx.fillStyle = "#64748b";
      ctx.font = `bold ${7 * exportScale}px sans-serif`;
      ctx.fillText("Official Doppler composite archives. Reflectivity values subject to terrain calibration.", canvas.width - 36 * exportScale, footY + 33 * exportScale);

      // ── Draw dBZ Intensity Legend Card ────────────────────────────────────────
      drawDbgColorLegend(
        ctx,
        36 * exportScale,
        canvas.height - 238 * exportScale,
        110 * exportScale,
        180 * exportScale,
        colorTheme,
        exportScale * 0.8
      );

      return canvas;
    }
  };

  // Compile Gif Loop Simulation
  // Compile Gif Loop Simulation
  const handleGenerateGif = async () => {
    if (frames.length === 0) return;
    setIsCompiling(true);
    setCompilingProgress(0);
    setCompilingMessage("Initializing capture...");

    const activeFrame = frames[activeFrameIndex];
    const selectedStation = selectedStationId
      ? stations.find(s => s.id === selectedStationId)
      : null;

    const steps = [
      { p: 25, m: "Stitching canvas layers..." },
      { p: 60, m: "Rendering telemetry text..." },
      { p: 100, m: "Export complete!" }
    ];

    let currentStepIdx = 0;

    const timer = setInterval(async () => {
      if (currentStepIdx < steps.length) {
        const step = steps[currentStepIdx];
        setCompilingProgress(step.p);
        setCompilingMessage(step.m);
        currentStepIdx++;
      } else {
        clearInterval(timer);

        try {
          const exportCanvas = await renderFrameToCanvas(activeFrame, 4, selectedStation);
          
          let downloadFileName = `doppler_radar_${activeFrame.observed_at.replace(/[\s-:]/g, "_")}.png`;
          if (selectedStation) {
            downloadFileName = `doppler_radar_${selectedStation.id}_scope_${activeFrame.observed_at.replace(/[\s-:]/g, "_")}.png`;
          }

          exportCanvas.toBlob((blob) => {
            const dataUrl = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = dataUrl;
            link.download = downloadFileName;
            link.target = "_blank";
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(dataUrl);
          }, "image/png");

        } catch (e) {
          console.error("Canvas export composition failed, falling back:", e);
          fallbackExport();
        }

        setTimeout(() => {
          setIsCompiling(false);
        }, 800);
      }
    }, 200);

    const fallbackExport = () => {
      try {
        const link = document.createElement("a");
        link.href = cachedFrameUrls[activeFrame.observed_at] || getFrameImageSrc(activeFrame, activeFrameIndex);
        link.download = `doppler_radar_${activeFrame.observed_at.replace(/[\s-:]/g, "_")}.png`;
        link.target = "_blank";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (e) {
        console.error("Fallback image export failed:", e);
      }
    };
  };

  // Compile full temporal GIF loop animation
  const handleCompileGif = async () => {
    if (frames.length === 0) return;
    setIsCreatingGif(true);
    setGifProgress(0);
    setGifMessage("Loading compiler worker...");

    try {
      // Fetch gif.worker.js from a CDN and create a Blob URL to avoid origin blocks
      const workerResponse = await fetch("https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js");
      if (!workerResponse.ok) throw new Error("Failed to fetch GIF worker from CDN");
      const workerBlob = await workerResponse.blob();
      const workerUrl = URL.createObjectURL(workerBlob);

      const gif = new GIF({
        workers: 2,
        quality: 10,
        workerScript: workerUrl
      });

      const selectedStation = selectedStationId
        ? stations.find(s => s.id === selectedStationId)
        : null;

      // Select moderate resolution constraints (2x scale: full-map 2040x2786, crop-scope 640x640)
      const gifScale = selectedStation ? 2 : 1.5;

      setGifMessage(`Stitching ${frames.length} frames...`);

      const cachedLayers = {};

      for (let i = 0; i < frames.length; i++) {
        setGifProgress(Math.floor((i / frames.length) * 60));
        setGifMessage(`Rasterizing frame ${i + 1} of ${frames.length}...`);
        
        const frameCanvas = await renderFrameToCanvas(frames[i], gifScale, selectedStation, cachedLayers);
        gif.addFrame(frameCanvas, { delay: intervalMs });
      }

      gif.on("progress", (p) => {
        setGifProgress(60 + Math.floor(p * 40));
        setGifMessage(`Encoding GIF: ${Math.floor(p * 100)}%...`);
      });

      gif.on("finished", (blob) => {
        setGifProgress(100);
        setGifMessage("Compilation complete!");

        const downloadFileName = selectedStation
          ? `doppler_radar_${selectedStation.id}_scope_loop.gif`
          : `doppler_radar_composite_loop.gif`;

        const dataUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = dataUrl;
        link.download = downloadFileName;
        link.target = "_blank";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        URL.revokeObjectURL(workerUrl);
        URL.revokeObjectURL(dataUrl);
        
        setTimeout(() => {
          setIsCreatingGif(false);
        }, 1000);
      });

      setGifMessage("Packaging GIF animation loop...");
      gif.render();

    } catch (e) {
      console.error("GIF creation failed:", e);
      alert("Failed to build GIF. Please check your internet connection for dependency loading.");
      setIsCreatingGif(false);
    }
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

  const loadedFramesProgress = useMemo(() => {
    if (playbackFramesCount === 0) return { loaded: 0, total: 0 };
    const targetFrames = preloadingFrames.length > 0 ? preloadingFrames : accumulatedTimeline.slice(-playbackFramesCount);
    const loaded = targetFrames.filter(f => cachedFrameUrls[f.observed_at]).length;
    return { loaded, total: playbackFramesCount };
  }, [preloadingFrames, accumulatedTimeline, playbackFramesCount, cachedFrameUrls]);

  const activeTimeFormatted = formatFrameTime(frames[activeFrameIndex]?.observed_at);

  if (isLoading) {
    return (
      <div className="w-full min-h-[calc(100vh-60px)] bg-slate-950 text-slate-100 flex flex-col items-center justify-center gap-3 font-sans relative overflow-hidden select-none">
        <Loader2 className="h-10 w-10 text-cyan-400 animate-spin" />
        <span className="text-sm font-semibold text-slate-400 tracking-wider font-mono uppercase">INITIALIZING RADAR SYSTEM...</span>
      </div>
    );
  }

  return (
    <div className="w-full min-h-[calc(100vh-60px)] bg-slate-950 text-slate-100 flex flex-col font-sans relative overflow-hidden select-none">
      
      {/* 1. Underlying full-bleed Map Layer */}
      <div className="absolute inset-0 w-full h-full z-0 flex items-center justify-center bg-black">
        {/* Loading/Preloading Overlays */}
        {(isInteractiveLoading || (isPreloading && Object.keys(cachedFrameUrls).length === 0)) ? (
          <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm flex flex-col items-center justify-center gap-3 z-40">
            <Loader2 className="h-8 w-8 text-cyan-400 animate-spin" />
            <span className="text-xs font-semibold text-slate-350 tracking-wider font-mono">
              BUFFERING RADAR DATA... ({loadedFramesProgress.loaded}/{loadedFramesProgress.total})
            </span>
          </div>
        ) : null}

        {/* Error Message */}
        {error && (
          <div className="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center p-6 text-center gap-4 z-50">
            <span className="text-red-400 text-sm font-mono tracking-wider">{error}</span>
            <button
              onClick={fetchTimeline}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 rounded-xl text-xs font-semibold border border-slate-800 hover:border-cyan-500/50 cursor-pointer transition-all"
            >
              Retry Connection
            </button>
          </div>
        )}

        {/* Map Frame Renderer */}
        {/* Leaflet Map Renderer */}
        {frames.length > 0 && (
          <MapContainer
            center={[12.8797, 121.7740]}
            zoom={typeof window !== "undefined" && window.innerWidth < 768 ? 5.5 : 6}
            minZoom={4}
            maxZoom={12}
            zoomControl={false}
            attributionControl={false}
            className="w-full h-full z-0 select-none"
            style={{
              background: mapStyle === "broadcast" ? "#162533" : "#020617",
              width: "100%",
              height: "100%"
            }}
          >
            <MapBridge setMapInstance={setMapInstance} setMapZoom={setMapZoom} />

            {/* Layer 1: Base Map - AI TV Broadcast (ai_precip_outlook land) or TileLayer (Satellite / Dark Matter) */}
            {mapStyle === "broadcast" ? (
              geoData && (
                <GeoJSON
                  key="broadcast-land"
                  data={geoData}
                  pane="tilePane"
                  style={() => ({
                    fillColor: "#25342a",
                    fillOpacity: 1,
                    color: "#0f172a",
                    weight: 1.2,
                    opacity: 0.95
                  })}
                  interactive={false}
                />
              )
            ) : (
              MAP_STYLES[mapStyle]?.url && (
                <TileLayer
                  key={mapStyle}
                  url={MAP_STYLES[mapStyle].url}
                  attribution={MAP_STYLES[mapStyle].attribution}
                  maxZoom={18}
                />
              )
            )}

            {/* Layer 2: Transparent Doppler Radar Reflectivity ImageOverlay */}
            <ImageOverlay
              key={`radar-${activeFrameIndex}-${colorTheme}`}
              url={cachedFrameUrls[frames[activeFrameIndex]?.observed_at] || getFrameImageSrc(frames[activeFrameIndex], activeFrameIndex)}
              bounds={RADAR_BOUNDS}
              opacity={0.88}
              pane="overlayPane"
              zIndex={300}
            />

            {/* Layer 3: TV Broadcast Province Borders on top of weather cells (Crisp overlay) */}
            {mapStyle === "broadcast" && geoData && (
              <GeoJSON
                key="broadcast-borders"
                data={geoData}
                pane="shadowPane"
                style={() => ({
                  fill: false,
                  fillOpacity: 0,
                  color: "#475569",
                  weight: 0.8,
                  opacity: 0.85
                })}
                interactive={false}
              />
            )}

            {/* Layer 4: Interactive Doppler Radar Stations & 240km Ranges */}
            {showStations && stations.map((station) => {
              const isHovered = hoveredStationId === station.id;
              const isSelected = selectedStationId === station.id;
              const isHighlight = isHovered || isSelected;

              let markerColor = "#38bdf8";
              if (station.status === "online") markerColor = "#38bdf8";
              else if (station.status === "maintenance") markerColor = "#ef4444";
              else if (station.status === "standby") markerColor = "#eab308";

              return (
                <React.Fragment key={`stn-${station.id}`}>
                  {/* 240km Range Circle (strictly non-interactive so it NEVER blocks clicks/hovers to other stations or the map) */}
                  {showRangeCircles && isHighlight && station.status !== "maintenance" && (
                    <Circle
                      key={`range-${station.id}`}
                      center={[station.lat, station.lon]}
                      radius={240000}
                      pane="overlayPane"
                      interactive={false}
                      pathOptions={{
                        interactive: false,
                        color: station.status === "online" ? "#38bdf8" : "#eab308",
                        fillColor: station.status === "online" ? "#38bdf8" : "#eab308",
                        fillOpacity: 0.05,
                        weight: 1.5,
                        dashArray: "5 5",
                        className: "pointer-events-none"
                      }}
                    />
                  )}

                  {/* Station Marker: Placed in markerPane (z-index 600) so it is ALWAYS on top of borders and rain */}
                  <CircleMarker
                    key={`marker-${station.id}`}
                    center={[station.lat, station.lon]}
                    radius={isHighlight ? 8 : 5.5}
                    pane="markerPane"
                    pathOptions={{
                      color: "#ffffff",
                      fillColor: markerColor,
                      fillOpacity: 1,
                      weight: isHighlight ? 2.5 : 1.5,
                      className: "cursor-pointer"
                    }}
                    eventHandlers={{
                      mouseover: () => setHoveredStationId(station.id),
                      mouseout: () => setHoveredStationId(null),
                      click: (e) => {
                        L.DomEvent.stopPropagation(e);
                        const nextId = selectedStationId === station.id ? null : station.id;
                        setSelectedStationId(nextId);
                        if (nextId) setShowRightPanel(true);
                      }
                    }}
                  >
                    <Tooltip direction="top" offset={[0, -10]} opacity={1} className="radar-tooltip">
                      <div className="bg-slate-900/95 backdrop-blur-md border border-slate-700/80 px-2.5 py-1.5 rounded-xl shadow-2xl font-mono min-w-[150px] pointer-events-none">
                        <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-1 mb-1">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="h-2 w-2 rounded-full animate-pulse"
                              style={{ backgroundColor: markerColor }}
                            />
                            <span className="font-bold text-white text-[11px] uppercase tracking-wide">
                              {station.name}
                            </span>
                          </div>
                          <span
                            className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase"
                            style={{
                              backgroundColor:
                                markerColor === "#38bdf8"
                                  ? "rgba(56, 189, 248, 0.15)"
                                  : markerColor === "#ef4444"
                                  ? "rgba(239, 68, 68, 0.15)"
                                  : "rgba(234, 179, 8, 0.15)",
                              color: markerColor
                            }}
                          >
                            {station.status}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[9px] text-slate-400">
                          <span>240 KM RADIAL</span>
                          <span className="text-slate-300 font-bold">{station.lat.toFixed(2)}°N, {station.lon.toFixed(2)}°E</span>
                        </div>
                        <div className="text-[8px] text-cyan-400/80 mt-1 font-sans text-center">
                          {selectedStationId === station.id ? "Selected · Click to deselect" : "Click to inspect station"}
                        </div>
                      </div>
                    </Tooltip>
                  </CircleMarker>
                </React.Fragment>
              );
            })}
          </MapContainer>
        )}
      </div>

      {/* 2. Glassmorphic Control Overlay Panels */}

      {/* Floating Top Header bar */}
      <div className="absolute top-3 left-3 right-3 md:top-4 md:left-4 md:right-4 z-50 flex items-center justify-between pointer-events-none">
        <div className="flex gap-2 pointer-events-auto">
          {/* Collapse Left Sidebar button */}
          <button
            onClick={() => {
              const next = !showLeftPanel;
              setShowLeftPanel(next);
              if (next && typeof window !== "undefined" && window.innerWidth < 1024) {
                setShowRightPanel(false);
              }
            }}
            className={`p-2.5 md:p-3 rounded-xl md:rounded-2xl border transition-all duration-300 shadow-xl flex items-center justify-center cursor-pointer ${showLeftPanel
              ? "bg-cyan-500/10 border-cyan-500/40 text-cyan-400"
              : "bg-slate-900/80 backdrop-blur-md border-slate-800 text-slate-400 hover:text-white hover:border-slate-700"
            }`}
            title="Toggle Left Control Deck"
          >
            <SlidersHorizontal className="h-4.5 w-4.5 md:h-5 md:w-5" />
          </button>
        </div>

        {/* Dynamic Date-Time Indicator (Inline on both mobile & desktop) */}
        {frames.length > 0 && (
          <div className={`bg-slate-900/85 backdrop-blur-xl border border-slate-800/80 rounded-xl md:rounded-2xl px-2.5 sm:px-3.5 md:px-5 py-1 md:py-2.5 gap-2 sm:gap-2.5 md:gap-4 shadow-2xl pointer-events-auto transition-all duration-300 ${showLeftPanel || showRightPanel ? "hidden md:flex" : "flex items-center"}`}>
            <div className="flex flex-col items-center">
              <span className="text-sm sm:text-base md:text-2xl font-black tracking-tight text-cyan-400 font-mono leading-none">
                {activeTimeFormatted.time.replace(" PHT", "")}
              </span>
              <span className="text-[7px] sm:text-[8px] md:text-[10px] font-bold text-slate-400 tracking-wider font-mono mt-0.5">PHT (UTC+8)</span>
            </div>
            <div className="h-5 sm:h-6 md:h-8 w-[1px] bg-slate-800"></div>
            <div className="flex flex-col">
              <span className="text-[9px] sm:text-[10px] md:text-sm font-black text-slate-100 leading-tight whitespace-nowrap">
                {activeTimeFormatted.date}
              </span>
              <span className="text-[7px] sm:text-[8px] md:text-[9px] font-semibold text-cyan-400/80 md:text-slate-400 leading-none">DOPPLER COMPOSITE</span>
            </div>
          </div>
        )}

        <div className="flex gap-1.5 sm:gap-2 pointer-events-auto">
          {/* Quick Base Map Style Switcher (Broadcast -> Satellite -> Dark) */}
          <button
            onClick={() => {
              const styles = ["broadcast", "satellite", "dark"];
              const nextIdx = (styles.indexOf(mapStyle) + 1) % styles.length;
              setMapStyle(styles[nextIdx]);
            }}
            className={`p-2.5 md:p-3 rounded-xl md:rounded-2xl border transition-all duration-300 shadow-xl flex items-center justify-center cursor-pointer ${
              mapStyle === "broadcast"
                ? "bg-cyan-500/15 border-cyan-500/40 text-cyan-400"
                : mapStyle === "satellite"
                ? "bg-amber-500/15 border-amber-500/40 text-amber-400"
                : "bg-slate-900/80 backdrop-blur-md border-slate-800 text-slate-400 hover:text-white hover:border-slate-700"
            }`}
            title={`Base Map: ${MAP_STYLES[mapStyle]?.name || mapStyle} (Tap to cycle)`}
          >
            <Layers className="h-4.5 w-4.5 md:h-5 md:w-5" />
          </button>

          {/* Toggle Stations on Map */}
          <button
            onClick={() => setShowStations(!showStations)}
            className={`p-2.5 md:p-3 rounded-xl md:rounded-2xl border transition-all duration-300 shadow-xl flex items-center justify-center cursor-pointer ${showStations
              ? "bg-cyan-500/10 border-cyan-500/40 text-cyan-400"
              : "bg-slate-900/80 backdrop-blur-md border-slate-800 text-slate-400 hover:text-white hover:border-slate-700"
            }`}
            title="Toggle Station Markers"
          >
            {showStations ? <Eye className="h-4.5 w-4.5 md:h-5 md:w-5" /> : <EyeOff className="h-4.5 w-4.5 md:h-5 md:w-5" />}
          </button>

          {/* Collapse Right Sidebar button */}
          <button
            onClick={() => {
              const next = !showRightPanel;
              setShowRightPanel(next);
              if (next && typeof window !== "undefined" && window.innerWidth < 1024) {
                setShowLeftPanel(false);
              }
            }}
            className={`p-2.5 md:p-3 rounded-xl md:rounded-2xl border transition-all duration-300 shadow-xl flex items-center justify-center cursor-pointer ${showRightPanel
              ? "bg-cyan-500/10 border-cyan-500/40 text-cyan-400"
              : "bg-slate-900/80 backdrop-blur-md border-slate-800 text-slate-400 hover:text-white hover:border-slate-700"
            }`}
            title="Toggle Right Status Deck"
          >
            <Activity className="h-4.5 w-4.5 md:h-5 md:w-5" />
          </button>
        </div>
      </div>

      {/* Floating Left Control Panel */}
      <RadarControls
        showLeftPanel={showLeftPanel}
        setShowLeftPanel={setShowLeftPanel}
        scale={scale}
        mapStyle={mapStyle}
        setMapStyle={setMapStyle}
        frames={frames}
        activeRegion={activeRegion}
        focusOnRegion={focusOnRegion}
        playbackFramesCount={playbackFramesCount}
        setPlaybackFramesCount={setPlaybackFramesCount}
        setIsPlaying={setIsPlaying}
        setIsInteractiveLoading={setIsInteractiveLoading}
        fetchTimeline={fetchTimeline}
        intervalMs={intervalMs}
        setIntervalMs={setIntervalMs}
        handleGenerateGif={handleGenerateGif}
        isCompiling={isCompiling}
        compilingMessage={compilingMessage}
        compilingProgress={compilingProgress}
        handleCompileGif={handleCompileGif}
        isCreatingGif={isCreatingGif}
        gifMessage={gifMessage}
        gifProgress={gifProgress}
      />

      {/* Floating Right Status/Preset Panel */}
      <StationInspector
        showRightPanel={showRightPanel}
        setShowRightPanel={setShowRightPanel}
        stations={stations}
        hoveredStationId={hoveredStationId}
        selectedStationId={selectedStationId}
        setHoveredStationId={setHoveredStationId}
        setSelectedStationId={setSelectedStationId}
        colorTheme={colorTheme}
        setColorTheme={setColorTheme}
        setIsPlaying={setIsPlaying}
        scale={scale}
      />

      {/* Mobile Floating dBZ Legend Toggle Pill */}
      {!(showLeftPanel || showRightPanel) && !showMobileLegend && (
        <button
          onClick={() => setShowMobileLegend(true)}
          className="md:hidden absolute bottom-[92px] left-2.5 z-35 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-900/90 backdrop-blur-xl border border-slate-800 text-slate-300 hover:text-white shadow-xl text-[10px] font-mono font-bold active:scale-95 pointer-events-auto cursor-pointer"
          title="Open dBZ Intensity Legend"
        >
          <div className="flex h-3 w-3 rounded-full overflow-hidden border border-slate-700">
            <div className="w-full h-full" style={{ background: getLegendGradientStyle(colorTheme) }}></div>
          </div>
          <span>dBZ Scale</span>
          <ChevronRight className="h-3 w-3 text-cyan-400 rotate-[-90deg]" />
        </button>
      )}

      {/* Mobile Floating Zoom Controls */}
      {!(showLeftPanel || showRightPanel) && (
        <div className="md:hidden absolute bottom-[92px] right-2.5 z-35 flex flex-col gap-1.5 pointer-events-auto">
          <button
            onClick={handleZoomIn}
            className="h-8 w-8 rounded-xl bg-slate-900/90 backdrop-blur-xl border border-slate-800 text-slate-300 hover:text-white flex items-center justify-center shadow-xl active:scale-95 transition-all cursor-pointer"
            title="Zoom In"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            onClick={handleZoomOut}
            className="h-8 w-8 rounded-xl bg-slate-900/90 backdrop-blur-xl border border-slate-800 text-slate-300 hover:text-white flex items-center justify-center shadow-xl active:scale-95 transition-all cursor-pointer"
            title="Zoom Out"
          >
            <Minus className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Floating Legend Panel */}
      <div className={`absolute bottom-[92px] md:bottom-28 z-35 bg-slate-900/95 md:bg-slate-900/90 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-3 flex-col select-none pointer-events-auto shadow-2xl min-w-[160px] max-w-[180px] transition-all duration-300 ${
        showLeftPanel || showRightPanel
          ? "hidden md:flex"
          : showMobileLegend ? "flex" : "hidden md:flex"
      } ${showLeftPanel ? "left-2.5 md:left-[352px]" : "left-2.5 md:left-4"}`}>
        <div className="flex justify-between items-center border-b border-slate-800/70 pb-1.5 mb-2 px-0.5">
          <div className="flex gap-1.5 items-center">
            <span className="font-bold tracking-wider font-mono text-[9px] text-slate-300 uppercase">dBZ</span>
            <span className="font-bold tracking-wider font-mono text-[9px] text-slate-400 uppercase">Intensity</span>
          </div>
          <button
            onClick={() => setShowMobileLegend(false)}
            className="md:hidden p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            title="Close Legend"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex gap-2.5 items-center justify-between px-0.5">
          {/* Left dBZ values */}
          <div className="flex flex-col justify-between h-40 font-mono text-[8.5px] font-bold text-slate-300 text-right w-6 leading-none">
            <span className="text-[#9600ff]">66+</span>
            <span className="text-[#eb00cd]">60</span>
            <span className="text-[#dc0000]">50</span>
            <span className="text-[#ff8700]">40</span>
            <span className="text-[#cdeb00]">30</span>
            <span className="text-[#00dc00]">20</span>
            <span className="text-[#00ff00]">16</span>
            <span className="text-[#8a8a8a]">1</span>
          </div>

          {/* Color gradient bar */}
          <div
            className="w-3 h-40 rounded-full border border-slate-950/80 flex-shrink-0 shadow-inner"
            style={{ background: getLegendGradientStyle(colorTheme) }}
          ></div>

          {/* Right Intensity & Clutter labels */}
          <div className="flex flex-col justify-between h-40 font-mono text-[8px] text-left leading-none">
            <span className="font-bold text-[#b400ff] whitespace-nowrap">Hail / Extreme</span>
            <span className="text-[#ff00ff] whitespace-nowrap">Violent</span>
            <span className="text-[#ff3200] whitespace-nowrap">Torrential</span>
            <span className="text-[#ff9600] whitespace-nowrap">Heavy Rain</span>
            <span className="text-[#ffff00] whitespace-nowrap">Moderate</span>
            <span className="text-[#00e600] whitespace-nowrap">Light Rain</span>
            <span className="text-[#00ff00] whitespace-nowrap">Very Light</span>
            <span className="text-slate-400 whitespace-nowrap text-[7.5px]">Clutter (1-15)</span>
          </div>
        </div>
      </div>

      {/* Bottom Floating Control Scrubber Deck */}
      <div className={`absolute bottom-2.5 sm:bottom-3 md:bottom-4 left-0 right-0 z-40 px-2.5 sm:px-3 md:px-0 justify-center pointer-events-none transition-all duration-300 ${showLeftPanel || showRightPanel ? "hidden md:flex" : "flex"}`}>
        <div className="w-full max-w-3xl bg-slate-900/85 backdrop-blur-xl border border-slate-800/85 rounded-2xl md:rounded-3xl p-2.5 sm:p-3 md:p-4 shadow-2xl flex flex-col gap-2 md:gap-3 pointer-events-auto">
          
          <div className="flex items-center gap-1.5 sm:gap-2.5 md:gap-4 w-full">
            
            {/* Playback Controls */}
            <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                disabled={frames.length === 0}
                className={`h-8.5 w-8.5 sm:h-10 sm:w-10 md:h-11 md:w-11 rounded-xl md:rounded-2xl flex items-center justify-center transition-all cursor-pointer border active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${isPlaying
                  ? "bg-cyan-500/10 border-cyan-500/40 text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.15)]"
                  : "bg-slate-950/80 border-slate-800 hover:bg-slate-900 hover:border-slate-700 text-slate-350"
                }`}
                title={isPlaying ? "Pause Timeline Loop" : "Play Timeline Loop"}
              >
                {isPlaying ? <Pause className="h-3.5 w-3.5 sm:h-4 sm:w-4 md:h-5 md:w-5 fill-current" /> : <Play className="h-3.5 w-3.5 sm:h-4 sm:w-4 md:h-5 md:w-5 fill-current ml-0.5" />}
              </button>

              <button
                onClick={() => {
                  setIsPlaying(false);
                  setActiveFrameIndex(frames.length - 1);
                }}
                disabled={frames.length === 0}
                className="h-8.5 w-8.5 sm:h-10 sm:w-10 md:h-11 md:w-11 rounded-xl md:rounded-2xl bg-slate-950/80 border border-slate-800 hover:bg-slate-900 hover:border-slate-700 text-slate-400 hover:text-white transition-all flex items-center justify-center cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Stop / Jump to Latest Frame"
              >
                <Square className="h-3 w-3 sm:h-4 sm:w-4 md:h-4.5 md:w-4.5 fill-current" />
              </button>
            </div>

            {/* Scrubber timeline bar */}
            <div className="flex-grow flex items-center gap-1 sm:gap-2 md:gap-3 min-w-0">
              <button
                onClick={() => {
                  setIsPlaying(false);
                  setActiveFrameIndex((prev) => (prev > 0 ? prev - 1 : frames.length - 1));
                }}
                disabled={frames.length === 0}
                className="h-7 w-7 sm:h-8 sm:w-8 rounded-lg bg-slate-950/40 border border-slate-850 hover:bg-slate-950 hover:border-slate-800 hover:text-white flex items-center justify-center text-slate-400 transition-colors cursor-pointer flex-shrink-0"
                title="Previous Frame"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>

              {/* Advanced timeline slider with load dot diagnostics */}
              <div className="flex-grow flex flex-col gap-0.5 sm:gap-1 relative py-1 justify-center min-w-0">
                <input
                  id="radar-slider"
                  type="range"
                  min="0"
                  max={frames.length > 0 ? frames.length - 1 : 0}
                  value={activeFrameIndex}
                  onChange={(e) => {
                    setIsPlaying(false);
                    setActiveFrameIndex(parseInt(e.target.value, 10));
                  }}
                  className="w-full h-1.5 bg-slate-950 rounded-lg appearance-none cursor-pointer focus:outline-none accent-cyan-400"
                />
                
                {/* Visual load indicators showing cached states underneath the slider */}
                {frames.length > 0 && (
                  <div className="w-full flex justify-between px-0.5 pointer-events-none mt-0.5 sm:mt-1">
                    {frames.map((frame, index) => {
                      const isCached = !!cachedFrameUrls[frame.observed_at];
                      const isActive = index === activeFrameIndex;
                      
                      let dotColorClass = "bg-slate-850";
                      if (isActive) dotColorClass = "bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.6)] scale-125";
                      else if (isCached) dotColorClass = "bg-cyan-800";
                      
                      return (
                        <span
                          key={index}
                          className={`h-0.5 w-0.5 rounded-full transition-all duration-150 ${dotColorClass}`}
                          style={{
                            width: "2.5px",
                            height: "2.5px"
                          }}
                        ></span>
                      );
                    })}
                  </div>
                )}
              </div>

              <button
                onClick={() => {
                  setIsPlaying(false);
                  setActiveFrameIndex((prev) => (prev + 1) % frames.length);
                }}
                disabled={frames.length === 0}
                className="h-7 w-7 sm:h-8 sm:w-8 rounded-lg bg-slate-950/40 border border-slate-850 hover:bg-slate-950 hover:border-slate-800 hover:text-white flex items-center justify-center text-slate-400 transition-colors cursor-pointer flex-shrink-0"
                title="Next Frame"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            {/* Recenter & Refresh actions row */}
            <div className="flex gap-1 sm:gap-2 justify-end flex-shrink-0">
              <button
                onClick={resetZoom}
                className="h-8.5 sm:h-10 md:h-11 px-2 sm:px-3 md:px-4 rounded-xl md:rounded-2xl bg-slate-950/80 border border-slate-800 hover:bg-slate-900 hover:border-slate-700 text-slate-400 hover:text-white transition-all flex items-center justify-center gap-1.5 cursor-pointer text-[10px] md:text-xs font-semibold active:scale-95"
                title="Recenter Map View"
              >
                <Maximize2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Recenter</span>
              </button>

              <button
                onClick={fetchTimeline}
                className="h-8.5 w-8.5 sm:h-10 sm:w-10 md:h-11 md:w-11 rounded-xl md:rounded-2xl bg-slate-950/80 border border-slate-800 hover:bg-slate-900 hover:border-slate-700 text-slate-400 hover:text-white transition-all flex items-center justify-center cursor-pointer active:scale-95 flex-shrink-0"
                title="Refresh Radar Feed"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>

          </div>

          {/* Timeline diagnostics readout */}
          {frames.length > 0 && (
            <div className="flex items-center justify-between text-[7.5px] sm:text-[8.5px] md:text-[9px] font-mono text-slate-400 px-1 pt-1 border-t border-slate-800/40">
              <div className="flex items-center gap-1.5">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-cyan-500"></span>
                </span>
                <span>
                  <span className="hidden sm:inline">PLAYHEAD: </span>
                  <strong className="text-cyan-400">FRAME {activeFrameIndex + 1}</strong>/{frames.length}
                </span>
              </div>
              <div className="flex items-center gap-2 sm:gap-4">
                <span className="hidden xs:inline">BUFFER: <strong>{loadedFramesProgress.loaded}/{loadedFramesProgress.total}</strong></span>
                <span>OBS: <strong className="text-amber-400">{frames[activeFrameIndex]?.observed_at}</strong></span>
              </div>
            </div>
          )}

        </div>
      </div>

    </div>
  );
};

export default LiveRadar;
