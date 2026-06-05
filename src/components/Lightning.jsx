import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Zap,
  RefreshCw,
  Info,
  MapPin,
  Maximize2,
  ShieldAlert,
  Sliders,
  Radio,
  Timer,
  Globe,
  Layers,
  Sparkles,
  ChevronRight,
  ChevronUp,
  ChevronDown
} from "lucide-react";

const LIGHTNING_URL = "/api/lightning?token=uvNBtXqdMnd3T80OTGjmEY9c3UEjAlOCajt2AoEu&parameter=ten_minute_frequency";

// Robust Philippine Standard Time (UTC+8) manual parser to guarantee accurate browser-independent absolute relative age calculations
const parsePHDateToMs = (dateStr) => {
  if (!dateStr) return 0;
  try {
    const parts = dateStr.trim().split(" ");
    if (parts.length !== 2) return 0;
    const dateParts = parts[0].split("-");
    const timeParts = parts[1].split(":");
    if (dateParts.length !== 3 || timeParts.length !== 3) return 0;

    const year = parseInt(dateParts[0], 10);
    const month = parseInt(dateParts[1], 10) - 1;
    const day = parseInt(dateParts[2], 10);
    const hour = parseInt(timeParts[0], 10);
    const minute = parseInt(timeParts[1], 10);
    const second = parseInt(timeParts[2], 10);

    // PH time is UTC+8, so subtract 8 hours to get UTC representation
    return Date.UTC(year, month, day, hour - 8, minute, second);
  } catch (e) {
    return 0;
  }
};

const Lightning = () => {
  const [geoData, setGeoData] = useState(null);
  const [lightningData, setLightningData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [activeRegion, setActiveRegion] = useState("All");
  const [selectedType, setSelectedType] = useState("All");
  const [timeFilter, setTimeFilter] = useState("All");
  const [hoveredStrike, setHoveredStrike] = useState(null);
  const [hoveredBadgeStrikeId, setHoveredBadgeStrikeId] = useState(null);
  const [showLabels, setShowLabels] = useState(false);
  const [countdown, setCountdown] = useState(30);
  const [feedLatency, setFeedLatency] = useState(0);
  const [isMobileCollapsed, setIsMobileCollapsed] = useState(true);

  // Zoom and Pan States
  const [zoomScale, setZoomScale] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const mapContainerRef = useRef(null);

  const handleWheel = (e) => {
    e.preventDefault();
    const scaleFactor = 0.15;
    const nextScale = e.deltaY < 0 ? zoomScale + scaleFactor : zoomScale - scaleFactor;
    setZoomScale(Math.min(6, Math.max(1, nextScale)));
  };

  const handleMouseDown = (e) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    setPanOffset({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleTouchStart = (e) => {
    if (e.touches.length < 1) return;
    setIsDragging(true);
    setDragStart({ x: e.touches[0].clientX - panOffset.x, y: e.touches[0].clientY - panOffset.y });
  };

  const handleTouchMove = (e) => {
    if (!isDragging || e.touches.length < 1) return;
    setPanOffset({
      x: e.touches[0].clientX - dragStart.x,
      y: e.touches[0].clientY - dragStart.y
    });
  };

  // Reset manual zoom/pan when activeRegion is changed
  useEffect(() => {
    setZoomScale(1);
    setPanOffset({ x: 0, y: 0 });
  }, [activeRegion]);

  // ── CORE SVG PROJECTION & BOUNDS MAPPING ──
  const minLon = 114.0;
  const maxLon = 128.0;
  const minLat = 4.0;
  const maxLat = 22.0;
  const canvasWidth = 1000;
  const canvasHeight = 1400;

  const project = (lon, lat) => {
    const x = ((lon - minLon) / (maxLon - minLon)) * canvasWidth;
    const y = ((maxLat - lat) / (maxLat - minLat)) * canvasHeight;
    return [x, y];
  };

  const getIslandGroup = (region) => {
    if (!region) return "Luzon";
    const r = region.toLowerCase();
    if (r.includes("visayas")) return "Visayas";
    if (
      r.includes("zamboanga") ||
      r.includes("mindanao") ||
      r.includes("davao") ||
      r.includes("soccsksargen") ||
      r.includes("caraga") ||
      r.includes("bangsamoro") ||
      r.includes("muslim")
    ) {
      return "Mindanao";
    }
    return "Luzon";
  };

  // Base map structures
  const mapData = useMemo(() => {
    if (!geoData) return null;

    const bounds = {
      All: { minX: 0, maxX: 1000, minY: 0, maxY: canvasHeight },
      Luzon: { minX: canvasWidth, maxX: 0, minY: canvasHeight, maxY: 0 },
      Visayas: { minX: canvasWidth, maxX: 0, minY: canvasHeight, maxY: 0 },
      Mindanao: { minX: canvasWidth, maxX: 0, minY: canvasHeight, maxY: 0 }
    };

    const projectedFeatures = geoData.features.map((f) => {
      const provName = f.properties.PROV_NAME || f.properties.PROVINCE || f.properties.NAME_1 || f.properties.name || "Unknown";
      const region = f.properties.REGION || "";
      const group = getIslandGroup(region);

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

      const d = generateD(f.geometry.coordinates, f.geometry.type);

      let sumX = 0, sumY = 0, count = 0;
      const getCentroid = (c) => {
        if (typeof c[0] === 'number') {
          const [lon, lat] = c;
          const [x, y] = project(lon, lat);
          sumX += x;
          sumY += y;
          count++;

          // Track regional bounding boxes for zoom focuses
          if (group !== "Luzon" || provName !== "Palawan") {
            if (x < bounds[group].minX) bounds[group].minX = x;
            if (x > bounds[group].maxX) bounds[group].maxX = x;
            if (y < bounds[group].minY) bounds[group].minY = y;
            if (y > bounds[group].maxY) bounds[group].maxY = y;
          }
        } else {
          c.forEach(getCentroid);
        }
      };
      getCentroid(f.geometry.coordinates);

      return {
        id: f.properties.ID_1 || provName,
        name: provName,
        region,
        group,
        d,
        centroid: count > 0 ? [sumX / count, sumY / count] : [canvasWidth / 2, canvasHeight / 2]
      };
    });

    Object.keys(bounds).forEach((key) => {
      if (key === "All") return;
      const b = bounds[key];
      const w = b.maxX - b.minX;
      const h = b.maxY - b.minY;
      const padX = w * 0.08;
      const padY = h * 0.08;

      bounds[key] = {
        minX: Math.max(0, b.minX - padX),
        maxX: Math.min(canvasWidth, b.maxX + padX),
        minY: Math.max(0, b.minY - padY),
        maxY: Math.min(canvasHeight, b.maxY + padY)
      };
    });

    return {
      features: projectedFeatures,
      bounds,
      canvasWidth,
      canvasHeight
    };
  }, [geoData]);

  // Active regional viewBox selection
  const activeViewBox = useMemo(() => {
    if (!mapData) return "0 0 1000 1400";
    const b = mapData.bounds[activeRegion];
    if (!b) return "0 0 1000 1400";
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    return `${b.minX.toFixed(1)} ${b.minY.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`;
  }, [mapData, activeRegion]);

  // Load geo map
  useEffect(() => {
    fetch("/data/ph_provinces.json")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load maps");
        return res.json();
      })
      .then((data) => setGeoData(data))
      .catch((err) => console.error("Error loading boundaries:", err));
  }, []);

  // Fetch PAGASA Lightning strikes
  const fetchLightning = async () => {
    try {
      setLoading(true);
      setError(null);
      // Fetch with cache busting and explicit Cache-Control headers to ensure browser never caches the feed
      const res = await fetch(`${LIGHTNING_URL}&cachebust=${Date.now()}`, {
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
          "Expires": "0"
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      
      const rawList = json && json.data ? json.data : [];
      
      // Parse coordinates as numbers safely
      const parsed = rawList.map((item, idx) => {
        const lat = parseFloat(item.lat);
        const lon = parseFloat(item.lon);
        const val = parseFloat(item.value || 1);
        const amp = parseFloat(item.amplitude || 0);
        const h = parseFloat(item.height || 0);
        
        // Project coordinates into standard map SVG grid
        const [x, y] = project(lon, lat);
        const observedAtMs = parsePHDateToMs(item.observed_at);

        return {
          id: `strike-${idx}-${item.observed_at}`,
          lat,
          lon,
          x,
          y,
          value: val,
          amplitude: amp,
          height: h,
          observedAt: item.observed_at,
          observedAtMs,
          type: item.readable_parameter || "Cloud to Cloud"
        };
      });

      // Find the absolute latest timestamp in the dataset to define relative edge time
      let maxTimeMs = 0;
      parsed.forEach(s => {
        if (s.observedAtMs > maxTimeMs) {
          maxTimeMs = s.observedAtMs;
        }
      });

      const latestTimeMs = maxTimeMs > 0 ? maxTimeMs : Date.now();

      // Compute actual absolute latency relative to the user's real browser time
      if (maxTimeMs > 0) {
        const latencyMs = Date.now() - maxTimeMs;
        const latencyMin = Math.max(0, Math.floor(latencyMs / 60000));
        setFeedLatency(latencyMin);
      } else {
        setFeedLatency(0);
      }

      // Compute relative ages and classification, then sort newest first compared to browser real-time clock
      const processed = parsed.map(s => {
        const relativeAgeSec = maxTimeMs > 0 ? Math.max(0, (latestTimeMs - s.observedAtMs) / 1000) : 120;
        const actualAgeSec = Math.max(0, (Date.now() - s.observedAtMs) / 1000);
        return {
          ...s,
          ageSeconds: relativeAgeSec,
          actualAgeSeconds: actualAgeSec,
          isRealTime: relativeAgeSec <= 60
        };
      }).sort((a, b) => a.actualAgeSeconds - b.actualAgeSeconds);

      setLightningData(processed);
      setLastUpdated(new Date());
      setCountdown(30);
    } catch (err) {
      console.error("Failed to load lightning strikes:", err);
      setError("Unable to load latest lightning strikes.");
    } finally {
      setLoading(false);
    }
  };

  // Run on mount
  useEffect(() => {
    fetchLightning();
  }, []);

  // Timer loop for automatic countdown & refreshes
  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          fetchLightning();
          return 30;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Filtering lightning data
  const filteredStrikes = useMemo(() => {
    return lightningData.filter((s) => {
      // Type filter
      if (selectedType !== "All" && s.type !== selectedType) return false;
      
      // Time stream filter
      if (timeFilter === "Real-Time" && !s.isRealTime) return false;
      if (timeFilter === "10-Min" && s.isRealTime) return false;
      
      // Region bounding box filter
      if (activeRegion !== "All" && mapData) {
        const b = mapData.bounds[activeRegion];
        if (s.x < b.minX || s.x > b.maxX || s.y < b.minY || s.y > b.maxY) {
          return false;
        }
      }
      return true;
    });
  }, [lightningData, activeRegion, selectedType, timeFilter, mapData]);

  // Breakdown statistics
  const stats = useMemo(() => {
    let cloudToCloud = 0;
    let cloudToGround = 0;
    let realTimeTotal = 0;
    let tenMinTotal = 0;
    
    lightningData.forEach((s) => {
      if (s.type === "Cloud to Cloud") cloudToCloud++;
      else cloudToGround++;

      if (s.isRealTime) realTimeTotal++;
      else tenMinTotal++;
    });

    return {
      total: lightningData.length,
      cloudToCloud,
      cloudToGround,
      realTimeTotal,
      tenMinTotal
    };
  }, [lightningData]);

  // Active Thunderstorm Alert Zones by calculating density within 60km of province centroids
  const activeWarningZones = useMemo(() => {
    if (!mapData || lightningData.length === 0) return [];
    
    const provHits = {};
    mapData.features.forEach((feature) => {
      provHits[feature.name] = {
        name: feature.name,
        group: feature.group,
        region: feature.region,
        count: 0,
        centroid: feature.centroid
      };
    });

    lightningData.forEach((s) => {
      mapData.features.forEach((feat) => {
        if (!feat.centroid) return;
        const dx = s.x - feat.centroid[0];
        const dy = s.y - feat.centroid[1];
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        // Within ~50px SVG space coordinates (approx. 50-60km radius)
        if (dist <= 48) {
          provHits[feat.name].count++;
        }
      });
    });

    return Object.values(provHits)
      .filter(p => p.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5); // top 5 active storm zones
  }, [mapData, lightningData]);

  return (
    <div className="relative h-[calc(100vh-64px)] w-full bg-slate-950 font-sans overflow-hidden flex flex-col md:flex-row">
      <style>{`
        .glowing-glow {
            filter: drop-shadow(0 0 8px rgba(250, 204, 21, 0.65));
        }
        .glowing-glow-violet {
            filter: drop-shadow(0 0 8px rgba(167, 139, 250, 0.65));
        }
        .bg-grid {
            background-image: linear-gradient(to right, rgba(51, 65, 85, 0.15) 1px, transparent 1px),
                              linear-gradient(to bottom, rgba(51, 65, 85, 0.15) 1px, transparent 1px);
            background-size: 80px 80px;
        }
        @keyframes real-time-glow {
          0%, 100% { filter: drop-shadow(0 0 4px #ff2a85) drop-shadow(0 0 12px #ff2a85); opacity: 0.85; }
          50% { filter: drop-shadow(0 0 10px #ffffff) drop-shadow(0 0 25px #ff2a85); opacity: 1; fill: #ffffff; }
        }
        .real-time-glow-cc {
          animation: real-time-glow 1s infinite ease-in-out;
        }
        @keyframes real-time-glow-cg {
          0%, 100% { filter: drop-shadow(0 0 4px #00f0ff) drop-shadow(0 0 12px #00f0ff); opacity: 0.85; }
          50% { filter: drop-shadow(0 0 10px #ffffff) drop-shadow(0 0 25px #00f0ff); opacity: 1; fill: #ffffff; }
        }
        .real-time-glow-cg {
          animation: real-time-glow-cg 1s infinite ease-in-out;
        }
      `}</style>

      {/* ── MAP CONTAINER ── */}
      <div
        className={`relative w-full transition-all duration-500 ease-in-out bg-black overflow-hidden flex items-center justify-center border-b md:border-b-0 border-slate-900 ${
          isMobileCollapsed ? "h-[calc(100vh-124px)]" : "h-[40vh]"
        } md:h-full md:flex-1`}
      >
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_center,rgba(15,23,42,0.3)_0%,rgba(0,0,0,1)_95%)] bg-grid" />

        {/* Dynamic Zooming Map */}
        {mapData ? (
          <svg
            className={`w-auto h-full max-h-full max-w-full aspect-[1000/1400] relative z-10 select-none transition-all ${
              isDragging ? "cursor-grabbing" : "cursor-grab"
            }`}
            viewBox={activeViewBox}
            style={{
              filter: "drop-shadow(0 25px 50px rgba(0, 0, 0, 0.75))",
            }}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleMouseUp}
          >
            <g
              style={{
                transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomScale})`,
                transformOrigin: "50% 50%",
                transition: isDragging ? "none" : "transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)"
              }}
            >
              {/* Base provinces */}
              <g opacity="0.9">
                {mapData.features.map((feature) => {
                  return (
                    <path
                      key={feature.id}
                      d={feature.d}
                      fill="#1e293b"
                      stroke="#334155"
                      strokeWidth="0.85"
                      strokeLinejoin="round"
                      className="transition-all duration-300 hover:fill-[#334155]/60"
                    />
                  );
                })}
              </g>

              {/* Lightning Strikes overlays */}
              <g opacity="0.95">
                {filteredStrikes.map((s) => {
                  const isCc = s.type === "Cloud to Cloud";
                  const isRealTime = s.isRealTime;
                  
                  // Color configuration
                  let color;
                  let glowClass;
                  
                  if (isRealTime) {
                    // Real-Time (<1 min): ultra vibrant pink / neon cyan
                    color = isCc ? "#ff2a85" : "#00f0ff";
                    glowClass = isCc ? "real-time-glow-cc" : "real-time-glow-cg";
                  } else {
                    // 10-Min Active (1-10 min): softer violet / amber
                    color = isCc ? "#a78bfa" : "#facc15";
                    glowClass = isCc ? "glowing-glow-violet" : "glowing-glow";
                  }

                  const isSelected = hoveredBadgeStrikeId === s.id;
                  const isHovered = hoveredStrike && hoveredStrike.id === s.id;
                  const isActive = isSelected || isHovered;

                  // Compute dynamic scale factor for the lightning bolt (thunder symbol)
                  let scaleFactor = isRealTime ? 1.4 : 1.05;
                  if (isActive) {
                    scaleFactor = isRealTime ? 2.1 : 1.7;
                  }

                  return (
                    <g key={s.id}>
                      {/* Interaction point (Lightning bolt / Thunder symbol path) */}
                      <path
                        d="M 1.5 -7 L -3.5 0.5 L 0 0.5 L -2 7.5 L 3.5 0 L 0 0 Z"
                        fill={color}
                        className={`cursor-pointer ${glowClass}`}
                        style={{
                          transform: `translate(${s.x}px, ${s.y}px) scale(${scaleFactor})`,
                          transformOrigin: "0 0",
                          transition: "transform 0.18s cubic-bezier(0.16, 1, 0.3, 1)"
                        }}
                        onMouseEnter={() => setHoveredStrike(s)}
                        onMouseLeave={() => setHoveredStrike(null)}
                      />
                    </g>
                  );
                })}
              </g>

              {/* Centroid indicators if labels toggled */}
              {showLabels && (
                <g className="pointer-events-none select-none font-mono">
                  {mapData.features.map((feat) => (
                    <g key={`lbl-${feat.id}`} transform={`translate(${feat.centroid[0]}, ${feat.centroid[1]})`}>
                      <text
                        y="3"
                        textAnchor="middle"
                        fill="rgba(100, 116, 139, 0.45)"
                        fontSize="6.5"
                        fontWeight="bold"
                      >
                        {feat.name}
                      </text>
                    </g>
                  ))}
                </g>
              )}
            </g>
          </svg>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3">
            <Radio className="w-10 h-10 text-sky-400 animate-pulse" />
            <span className="text-slate-500 font-mono text-xs">Generating coordinate projection matrices...</span>
          </div>
        )}

        {/* Controllers */}
        <div className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between gap-3 pointer-events-none flex-wrap">
          <div className="flex gap-2 pointer-events-auto">
            {/* Island selection */}
            <div className="bg-slate-950/80 backdrop-blur-md p-1 rounded-xl border border-slate-800/80 shadow-2xl flex gap-1">
              {["All", "Luzon", "Visayas", "Mindanao"].map((region) => (
                <button
                  key={region}
                  onClick={() => setActiveRegion(region)}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-bold tracking-wide uppercase transition-all duration-300 cursor-pointer ${
                    activeRegion === region
                      ? "bg-amber-500 text-slate-950 font-black shadow-md shadow-amber-500/20"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/50"
                  }`}
                >
                  {region}
                </button>
              ))}
            </div>

            {/* Manual Zoom Controls */}
            <div className="bg-slate-950/80 backdrop-blur-md p-1 rounded-xl border border-slate-800/80 shadow-2xl flex gap-1">
              <button
                onClick={() => setZoomScale(Math.min(6, zoomScale + 0.5))}
                className="px-2 py-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 transition-all font-black text-xs cursor-pointer"
                title="Zoom In"
              >
                ＋
              </button>
              <button
                onClick={() => setZoomScale(Math.max(1, zoomScale - 0.5))}
                className="px-2 py-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 transition-all font-black text-xs cursor-pointer"
                title="Zoom Out"
              >
                －
              </button>
              <button
                onClick={() => { setZoomScale(1); setPanOffset({ x: 0, y: 0 }); }}
                className="px-2 py-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 transition-all font-black text-[10px] cursor-pointer"
                title="Reset Map Zoom"
              >
                ⟲
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 pointer-events-auto">
            {/* Show labels */}
            <button
              onClick={() => setShowLabels(!showLabels)}
              className={`p-2 rounded-xl text-xs font-semibold backdrop-blur-md border shadow-lg flex items-center justify-center gap-1.5 transition-all duration-300 cursor-pointer ${
                showLabels
                  ? "bg-indigo-600/80 text-white border-indigo-500"
                  : "bg-slate-950/80 text-slate-400 border-slate-800 hover:bg-slate-900/80"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{showLabels ? "Hide Map Labels" : "Show Map Labels"}</span>
            </button>

            {/* Refresh countdown indicator */}
            <button
              onClick={fetchLightning}
              disabled={loading}
              className="px-3 py-2 rounded-xl bg-slate-950/80 hover:bg-slate-900 border border-slate-800 text-slate-300 hover:text-white flex items-center gap-2 text-xs font-semibold shadow-xl transition-all disabled:opacity-50 cursor-pointer"
            >
              <Timer className="w-3.5 h-3.5 text-amber-400" />
              <span>{countdown}s</span>
              <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* Floating Map Legend */}
        <div className="absolute bottom-4 left-4 z-20 bg-slate-950/85 backdrop-blur-md p-3 rounded-xl border border-slate-800/80 shadow-2xl flex flex-col gap-2 pointer-events-auto max-w-[240px]">
          <div className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest flex items-center gap-1.5 border-b border-slate-800/60 pb-1">
            <Globe className="w-3 h-3 text-sky-400" />
            <span>Map Legend</span>
          </div>
          
          <div className="space-y-2.5 text-[9.5px] font-bold text-slate-300">
            {/* Real-time category */}
            <div className="flex flex-col gap-1.5">
              <div className="text-slate-500 uppercase tracking-wider text-[8px] font-mono font-bold">Real-Time (&lt;1 min)</div>
              <div className="flex items-center gap-2.5 pl-1 text-pink-400">
                <div className="relative flex items-center justify-center w-3 h-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-400 opacity-75"></span>
                  <svg className="relative w-3.5 h-3.5 shrink-0 text-pink-500" viewBox="-5 -8 10 16" fill="currentColor">
                    <path d="M 1.5 -7 L -3.5 0.5 L 0 0.5 L -2 7.5 L 3.5 0 L 0 0 Z" />
                  </svg>
                </div>
                <span>IC (In-Cloud) Strike</span>
              </div>
              <div className="flex items-center gap-2.5 pl-1 text-cyan-400">
                <div className="relative flex items-center justify-center w-3 h-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                  <svg className="relative w-3.5 h-3.5 shrink-0 text-cyan-500" viewBox="-5 -8 10 16" fill="currentColor">
                    <path d="M 1.5 -7 L -3.5 0.5 L 0 0.5 L -2 7.5 L 3.5 0 L 0 0 Z" />
                  </svg>
                </div>
                <span>CG (Cloud-to-Ground)</span>
              </div>
            </div>
            
            <div className="h-px bg-slate-800/50 my-1" />

            {/* Active category */}
            <div className="flex flex-col gap-1.5">
              <div className="text-slate-500 uppercase tracking-wider text-[8px] font-mono font-bold">10-Min Archive (1-10 min)</div>
              <div className="flex items-center gap-2.5 pl-1 text-violet-300">
                <svg className="w-3.5 h-3.5 shrink-0 text-violet-400 filter drop-shadow-[0_0_4px_#a78bfa]" viewBox="-5 -8 10 16" fill="currentColor">
                  <path d="M 1.5 -7 L -3.5 0.5 L 0 0.5 L -2 7.5 L 3.5 0 L 0 0 Z" />
                </svg>
                <span>IC (In-Cloud) Strike</span>
              </div>
              <div className="flex items-center gap-2.5 pl-1 text-amber-300">
                <svg className="w-3.5 h-3.5 shrink-0 text-amber-400 filter drop-shadow-[0_0_4px_#facc15]" viewBox="-5 -8 10 16" fill="currentColor">
                  <path d="M 1.5 -7 L -3.5 0.5 L 0 0.5 L -2 7.5 L 3.5 0 L 0 0 Z" />
                </svg>
                <span>CG (Cloud-to-Ground)</span>
              </div>
            </div>
          </div>
        </div>

      {/* ── TOOLTIP (DESKTOP) ── */}
      {hoveredStrike && (
        <div
          className="hidden md:flex absolute z-50 pointer-events-none w-64 rounded-xl border border-slate-700 bg-slate-950/95 p-3.5 text-slate-200 shadow-2xl backdrop-blur-lg flex flex-col gap-2.5 transition-opacity"
          style={{
            left: hoveredStrike.x > 700 ? hoveredStrike.x - 280 : hoveredStrike.x + 20,
            top: hoveredStrike.y > 1100 ? hoveredStrike.y - 140 : hoveredStrike.y + 20,
          }}
        >
          <div className="flex justify-between items-start border-b border-slate-800 pb-2">
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="font-extrabold text-slate-100 text-xs tracking-wide uppercase">
                  {hoveredStrike.type === "Cloud to Cloud" ? "In-Cloud" : "Cloud-to-Ground"}
                </h3>
                {hoveredStrike.isRealTime && (
                  <span className="px-1 py-0.5 rounded text-[8px] font-black uppercase bg-rose-500/20 text-rose-400 border border-rose-500/30 animate-pulse">
                    LIVE
                  </span>
                )}
              </div>
              <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                Age: {hoveredStrike.actualAgeSeconds < 60 ? `Live ${Math.round(hoveredStrike.actualAgeSeconds)}s ago` : `${Math.floor(hoveredStrike.actualAgeSeconds / 60)}m ago`} ({hoveredStrike.observedAt.split(" ")[1]})
              </p>
            </div>
            <Zap className={`w-4 h-4 ${hoveredStrike.isRealTime ? (hoveredStrike.type === "Cloud to Cloud" ? "text-pink-400" : "text-cyan-400") : (hoveredStrike.type === "Cloud to Cloud" ? "text-violet-400" : "text-amber-400")}`} />
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px] font-mono leading-relaxed">
              <div className="bg-slate-900/50 p-1.5 rounded border border-slate-800/80">
                <span className="text-slate-500 block">Amplitude:</span>
                <span className="text-white font-bold">{hoveredStrike.amplitude} A</span>
              </div>
              <div className="bg-slate-900/50 p-1.5 rounded border border-slate-800/80">
                <span className="text-slate-500 block">Altitude:</span>
                <span className="text-white font-bold">{(hoveredStrike.height / 1000).toFixed(1)} km</span>
              </div>
              <div className="bg-slate-900/50 p-1.5 rounded border border-slate-800/80">
                <span className="text-slate-500 block">Latitude:</span>
                <span className="text-white font-bold">{hoveredStrike.lat.toFixed(4)}°N</span>
              </div>
              <div className="bg-slate-900/50 p-1.5 rounded border border-slate-800/80">
                <span className="text-slate-500 block">Longitude:</span>
                <span className="text-white font-bold">{hoveredStrike.lon.toFixed(4)}°E</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── SIDEBAR PANEL (TECHNICAL LIGHTNING DESK STYLE) ── */}
      <div
        className={`w-full md:w-80 lg:w-96 transition-all duration-500 ease-in-out bg-[#090d16]/95 md:bg-[#050811]/90 backdrop-blur-xl border-t md:border-t-0 md:border-l border-slate-800/80 flex flex-col z-20 overflow-hidden shadow-[-15px_0_35px_rgba(0,0,0,0.6)] ${
          isMobileCollapsed ? "h-[60px] flex-none" : "h-[calc(60vh-64px)] flex-1"
        } md:h-full md:flex-none`}
      >
        
        {/* Header Block */}
        <div
          onClick={() => {
            if (window.innerWidth < 768) {
              setIsMobileCollapsed(!isMobileCollapsed);
            }
          }}
          className={`bg-gradient-to-r from-slate-950/80 to-slate-900/80 px-5 border-b border-slate-800 text-center relative overflow-hidden flex-shrink-0 cursor-pointer md:cursor-default transition-all duration-300 ${
            isMobileCollapsed ? "py-4" : "py-5"
          }`}
        >
          <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 blur-xl rounded-full pointer-events-none" />
          <h1 className="text-sm sm:text-base md:text-lg font-black tracking-widest text-white uppercase flex items-center justify-center gap-2 relative">
            <Radio className="w-4 h-4 text-rose-500 animate-pulse" />
            <span>Lightning Detection</span>
            <span className="absolute right-0 top-1/2 -translate-y-1/2 md:hidden">
              {isMobileCollapsed ? (
                <ChevronUp className="w-5 h-5 text-sky-400 animate-bounce" />
              ) : (
                <ChevronDown className="w-5 h-5 text-slate-400" />
              )}
            </span>
          </h1>
          <p className={`text-[10px] font-bold text-amber-400 uppercase tracking-widest mt-1 transition-all duration-300 ${
            isMobileCollapsed ? "hidden md:block" : "block"
          }`}>
            Forming Thunderstorm Monitor
          </p>
          
          <div className={`mt-3 flex justify-center gap-2 flex-wrap transition-all duration-300 ${
            isMobileCollapsed ? "hidden md:flex" : "flex"
          }`}>
            <span className="text-[9px] font-mono bg-slate-950/90 text-slate-400 py-1 px-2.5 rounded border border-slate-800/60">
              10-Minute Refresh Loop
            </span>
            {feedLatency > 3 ? (
              <span className="text-[9px] font-mono bg-amber-950/40 text-amber-400 py-1 px-2.5 rounded border border-amber-500/20 animate-pulse font-bold">
                ⚠️ Feed Delay: {feedLatency}m
              </span>
            ) : (
              <span className="text-[9px] font-mono bg-emerald-950/40 text-emerald-400 py-1 px-2.5 rounded border border-emerald-500/20 font-bold">
                ✓ Live Stream
              </span>
            )}
          </div>
        </div>

        {/* Total Statistics Cards - 2x2 Grid */}
        <div className="p-4 grid grid-cols-2 gap-2.5 bg-slate-950/40 border-b border-slate-900/80 flex-shrink-0">
          <div className="bg-slate-900/30 border border-slate-850 hover:border-slate-850 rounded-xl p-2 text-center flex flex-col justify-center relative overflow-hidden transition-all duration-300">
            {stats.realTimeTotal > 0 && (
              <div className="absolute top-1.5 right-1.5 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
              </div>
            )}
            <span className="text-[9px] text-rose-400/80 uppercase tracking-wider font-bold">Real-Time (Live)</span>
            <span className="text-xl font-black text-rose-500 mt-0.5">{stats.realTimeTotal}</span>
          </div>
          <div className="bg-slate-900/30 border border-slate-850 hover:border-slate-850 rounded-xl p-2 text-center flex flex-col justify-center">
            <span className="text-[9px] text-sky-400/80 uppercase tracking-wider font-bold">10-Min Archive</span>
            <span className="text-xl font-black text-sky-400 mt-0.5">{stats.tenMinTotal}</span>
          </div>
          <div className="bg-slate-900/30 border border-slate-850 hover:border-slate-850 rounded-xl p-2 text-center flex flex-col justify-center">
            <span className="text-[9px] text-violet-400/80 uppercase tracking-wider font-bold">In-Cloud (IC)</span>
            <span className="text-xl font-black text-violet-300 mt-0.5">{stats.cloudToCloud}</span>
          </div>
          <div className="bg-slate-900/30 border border-slate-850 hover:border-slate-850 rounded-xl p-2 text-center flex flex-col justify-center">
            <span className="text-[9px] text-amber-400/80 uppercase tracking-wider font-bold">Cloud-to-Ground (CG)</span>
            <span className="text-xl font-black text-amber-300 mt-0.5">{stats.cloudToGround}</span>
          </div>
        </div>

        {/* Filter Panel */}
        <div className="p-4 border-b border-slate-900/60 flex-shrink-0 space-y-3 bg-slate-950/20">
          {/* Time Stream Filter */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[9px] text-slate-400 font-bold uppercase tracking-wider">
              <Timer className="w-3.5 h-3.5 text-rose-500" />
              <span>Time Stream:</span>
            </div>
            <div className="flex gap-1">
              {[
                { label: "All", value: "All" },
                { label: "Live (<1m)", value: "Real-Time" },
                { label: "10-Min Archive", value: "10-Min" }
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setTimeFilter(opt.value)}
                  className={`px-2 py-1 rounded text-[9px] font-extrabold uppercase border transition-all cursor-pointer ${
                    timeFilter === opt.value
                      ? "bg-rose-500/15 text-rose-400 border-rose-500/40 shadow-sm"
                      : "bg-slate-900/40 border-slate-800 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Discharge Type Filter */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[9px] text-slate-400 font-bold uppercase tracking-wider">
              <Sliders className="w-3.5 h-3.5 text-amber-400" />
              <span>Discharge Type:</span>
            </div>
            <div className="flex gap-1">
              {[
                { label: "All Types", value: "All" },
                { label: "In-Cloud (IC)", value: "Cloud to Cloud" },
                { label: "Cloud-to-Ground (CG)", value: "Cloud to Ground" }
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setSelectedType(opt.value)}
                  className={`px-2 py-1 rounded text-[9px] font-extrabold uppercase border transition-all cursor-pointer ${
                    selectedType === opt.value
                      ? "bg-amber-500/15 text-amber-400 border-amber-500/40 shadow-sm"
                      : "bg-slate-900/40 border-slate-800 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Dynamic Lists Viewport */}
        <div className="p-4 flex-1 overflow-y-auto space-y-4">
          
          {/* Active warning zones */}
          <div>
            <h2 className="text-slate-400 font-bold uppercase tracking-wider text-[10px] flex items-center gap-1.5 border-b border-slate-900 pb-1.5 mb-3">
              <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />
              <span>Severe Lightning Densities</span>
            </h2>
            
            {activeWarningZones.length > 0 ? (
              <div className="space-y-2">
                {activeWarningZones.map((feat) => (
                  <div
                    key={feat.name}
                    className="p-2.5 rounded-xl border bg-slate-950/40 border-slate-900 flex justify-between items-center transition-all hover:bg-slate-900/20"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.7)]" />
                      <div>
                        <span className="text-xs font-black text-white">{feat.name}</span>
                        <span className="text-[9px] text-slate-500 block uppercase tracking-wider font-mono">
                          {feat.group} • {feat.region.split("(")[0].trim()}
                        </span>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-[10px] font-black text-amber-400">
                      {feat.count} Hits
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center p-4 border border-dashed border-slate-900 rounded-xl">
                <span className="text-[10px] text-slate-500">No active severe storm centers detected.</span>
              </div>
            )}
          </div>

          {/* Real-time log */}
          <div>
            <h2 className="text-slate-400 font-bold uppercase tracking-wider text-[10px] flex items-center gap-1.5 border-b border-slate-900 pb-1.5 mb-3">
              <Radio className="w-3.5 h-3.5 text-rose-500 animate-pulse" />
              <span>Real-time Stroke Stream</span>
            </h2>

            {filteredStrikes.length > 0 ? (
              <div className="space-y-1.5 font-mono text-[9.5px]">
                {filteredStrikes.slice(0, 15).map((s) => {
                  const isSelected = hoveredBadgeStrikeId === s.id;
                  const isRealTime = s.isRealTime;
                  const isCc = s.type === "Cloud to Cloud";
                  
                  // Color configuration based on real-time vs archive
                  let badgeBorderColor = isRealTime 
                    ? (isCc ? "border-pink-500/30 bg-pink-950/10 text-pink-300" : "border-cyan-500/30 bg-cyan-950/10 text-cyan-300")
                    : "border-slate-900 bg-slate-950/30 text-slate-400";

                  let hoverClass = isSelected
                    ? (isRealTime 
                       ? (isCc ? "bg-pink-950/20 border-pink-500 text-white" : "bg-cyan-950/20 border-cyan-500 text-white")
                       : "bg-slate-900 border-slate-700 text-white")
                    : badgeBorderColor;

                  return (
                    <div
                      key={s.id}
                      className={`p-2 rounded-lg border transition-all cursor-pointer flex justify-between items-center ${hoverClass}`}
                      onMouseEnter={() => setHoveredBadgeStrikeId(s.id)}
                      onMouseLeave={() => setHoveredBadgeStrikeId(null)}
                    >
                      <div className="flex items-center gap-1.5">
                        {isRealTime ? (
                          <span className="relative flex h-3 w-3 shrink-0 items-center justify-center">
                            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isCc ? "bg-pink-400" : "bg-cyan-400"}`}></span>
                            <svg className={`relative w-3.5 h-3.5 shrink-0 ${isCc ? "text-pink-500" : "text-cyan-500"}`} viewBox="-5 -8 10 16" fill="currentColor">
                              <path d="M 1.5 -7 L -3.5 0.5 L 0 0.5 L -2 7.5 L 3.5 0 L 0 0 Z" />
                            </svg>
                          </span>
                        ) : (
                          <svg className={`w-3.5 h-3.5 shrink-0 ${isCc ? "text-violet-400/80" : "text-amber-400/80"}`} viewBox="-5 -8 10 16" fill="currentColor">
                            <path d="M 1.5 -7 L -3.5 0.5 L 0 0.5 L -2 7.5 L 3.5 0 L 0 0 Z" />
                          </svg>
                        )}
                        <span className="font-extrabold uppercase">
                          {isCc ? "IC" : "CG"}
                        </span>
                        <span className="text-[9px] opacity-80">
                          ({s.lat.toFixed(3)}, {s.lon.toFixed(3)})
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-1.5 font-bold">
                        {s.actualAgeSeconds < 60 ? (
                          <span className={`text-[8.5px] px-1 py-0.5 rounded font-black border uppercase tracking-wider ${
                            isCc ? "bg-pink-950/30 text-pink-400 border-pink-500/35" : "bg-cyan-950/30 text-cyan-400 border-cyan-500/35"
                          }`}>
                            Live {Math.round(s.actualAgeSeconds)}s
                          </span>
                        ) : (
                          <span className="opacity-60 text-[8.5px]">
                            {Math.floor(s.actualAgeSeconds / 60)}m ago
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center p-4 border border-dashed border-slate-900 rounded-xl">
                <span className="text-[10px] text-slate-500">No stroke stream matches.</span>
              </div>
            )}
          </div>

        </div>

        {/* Footer */}
        <div className="bg-slate-950 p-4 border-t border-slate-900 flex flex-col gap-2 relative flex-shrink-0">
          <div className="text-emerald-400 font-bold text-xs text-center tracking-wide uppercase flex items-center justify-center gap-1">
            <Radio className="w-3.5 h-3.5 animate-pulse text-emerald-400" />
            <span>PAGASA WSR-88D REALTIME LIGHTNING</span>
          </div>
          <div className="text-[9px] text-slate-500 text-center font-mono leading-tight">
            DOST-PAGASA Weather radar & lightning networks
          </div>
        </div>

      </div>

    </div>
  );
};

export default Lightning;
