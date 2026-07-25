// src/components/TCPositions.jsx
import React, { useEffect, useState, useMemo } from "react";
import {
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  X,
  Activity,
  Calendar,
  Compass,
  Info,
  Map,
  Wind,
  Layers,
  ChevronRight,
  Download,
  AlertTriangle
} from "lucide-react";

// Helper to resolve asset URLs relative to the base path
const getAssetUrl = (path) => {
  const base = import.meta.env.BASE_URL || "/";
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  return `${base}${cleanPath}`;
};

// Helper to parse movement speed for displays
const formatKnots = (kt) => {
  if (!kt) return "N/A";
  return `${kt} kt (${round(kt * 1.852)} km/h)`;
};

const round = (val) => Math.round(val);

const TCPositions = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedHistoryIndex, setSelectedHistoryIndex] = useState(null);

  // Zoom & Pan states
  const [zoomScale, setZoomScale] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [enlargedImage, setEnlargedImage] = useState(null);

  // Storm indexing & tracking states
  const [stormsList, setStormsList] = useState([]);
  const [selectedTrackId, setSelectedTrackId] = useState(null);

  const loadLatestStorm = () => {
    fetch(getAssetUrl("/data/tc_positions_latest.json"))
      .then((res) => {
        if (!res.ok) {
          throw new Error("Failed to load initialization cycle data.");
        }
        return res.json();
      })
      .then((json) => {
        setData(json);
        setLoading(false);
        if (json.active) {
          setSelectedTrackId(json.track_id);
          setStormsList([{
            track_id: json.track_id,
            storm_name: json.storm_name,
            active: true
          }]);
        }
        if (json.history && json.history.length > 0) {
          setSelectedHistoryIndex(json.history.length - 1);
        }
      })
      .catch((err) => {
        console.error(err);
        setError(err.message);
        setLoading(false);
      });
  };

  // Load storms list index first
  useEffect(() => {
    fetch(getAssetUrl("/data/tc_storms_index.json"))
      .then((res) => {
        if (!res.ok) {
          throw new Error("No index available, loading latest storm.");
        }
        return res.json();
      })
      .then((index) => {
        setStormsList(index);
        if (index && index.length > 0) {
          // Select first active storm, or fallback to the most recent storm
          const activeStorm = index.find((s) => s.active) || index[0];
          setSelectedTrackId(activeStorm.track_id);
        } else {
          loadLatestStorm();
        }
      })
      .catch((err) => {
        console.warn(err.message);
        loadLatestStorm();
      });
  }, []);

  // Load storm details when selectedTrackId changes
  useEffect(() => {
    if (!selectedTrackId) return;
    
    setLoading(true);
    const numMatch = selectedTrackId.match(/\d+/)?.[0];
    const shortId = numMatch ? `${parseInt(numMatch, 10)}W` : selectedTrackId;

    const fetchTrack = async () => {
      const endpoints = [
        `/data/tc_positions_${selectedTrackId}.json`,
        `/data/tc_positions_${shortId}.json`,
        `/data/tc_positions_latest.json`
      ];
      for (const ep of endpoints) {
        try {
          const res = await fetch(getAssetUrl(ep));
          if (res.ok) {
            const json = await res.json();
            if (json && (json.history || json.latest)) return json;
          }
        } catch (e) {}
      }
      throw new Error(`Failed to load data for storm ${selectedTrackId}`);
    };

    fetchTrack()
      .then((json) => {
        setData(json);
        setLoading(false);
        if (json.history && json.history.length > 0) {
          setSelectedHistoryIndex(json.history.length - 1);
        }
      })
      .catch((err) => {
        console.error(err);
        setError(err.message);
        setLoading(false);
      });
  }, [selectedTrackId]);

  const currentSelectedPoint = useMemo(() => {
    if (!data || !data.history || selectedHistoryIndex === null) return null;
    return data.history[selectedHistoryIndex];
  }, [data, selectedHistoryIndex]);

  // Zoom controls
  const handleZoomIn = () => setZoomScale((prev) => Math.min(prev + 0.25, 4));
  const handleZoomOut = () => setZoomScale((prev) => Math.max(prev - 0.25, 1));
  const handleZoomReset = () => {
    setZoomScale(1);
    setPanOffset({ x: 0, y: 0 });
  };

  // Dragging map behavior
  const handleMouseDown = (e) => {
    if (zoomScale <= 1) return;
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

  const handleWheel = (e) => {
    e.preventDefault();
    const scaleFactor = 0.15;
    const nextScale = e.deltaY < 0 ? zoomScale + scaleFactor : zoomScale - scaleFactor;
    setZoomScale(Math.min(4, Math.max(1, nextScale)));
  };

  // Category color badge
  const getCategoryColorClass = (category) => {
    if (!category) return "bg-slate-800 text-slate-400 border border-slate-500/20";
    const cat = category.toLowerCase();
    if (cat.includes("super typhoon")) return "bg-rose-500/20 text-rose-400 border border-rose-500/30";
    if (cat.includes("severe tropical storm")) return "bg-orange-500/20 text-orange-400 border border-orange-500/30";
    if (cat.includes("tropical storm")) return "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30";
    if (cat.includes("tropical depression")) return "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30";
    if (cat.includes("typhoon")) return "bg-red-500/20 text-red-400 border border-red-500/30";
    return "bg-blue-500/20 text-blue-400 border border-blue-500/30"; // Low Pressure Area
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-400 gap-3">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-cyan-400"></div>
        <span className="text-sm font-bold tracking-wider">Loading TC initialization cycles...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-[70vh] bg-slate-950 flex flex-col items-center justify-center p-8 text-center gap-4">
        <AlertTriangle className="w-16 h-16 text-rose-500 animate-pulse" />
        <h2 className="text-xl font-black text-white">Initialization Cycle Tracking Unavailable</h2>
        <p className="text-sm text-slate-500 max-w-md leading-relaxed">
          The forecast initialization cycle datasets could not be loaded or processed at this time. Please check back later.
        </p>
      </div>
    );
  }

  return (
    <section className="bg-slate-950 py-8 md:py-12 relative overflow-hidden selection:bg-cyan-500 selection:text-white">
      <style>{`
        .bg-grid-pattern {
            background-image: linear-gradient(to right, rgba(255,255,255,0.015) 1px, transparent 1px),
                               linear-gradient(to bottom, rgba(255,255,255,0.015) 1px, transparent 1px);
            background-size: 32px 32px;
        }
        .custom-glass {
            background: rgba(15, 23, 42, 0.6);
            backdrop-filter: blur(16px);
            border: 1px solid rgba(255, 255, 255, 0.06);
        }
        .custom-scroll::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .custom-scroll::-webkit-scrollbar-track {
          background: rgba(255,255,255,0.02);
          border-radius: 8px;
        }
        .custom-scroll::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.1);
          border-radius: 8px;
        }
      `}</style>

      {/* Grid overlay */}
      <div className="absolute inset-0 bg-grid-pattern pointer-events-none z-0"></div>

      <div className="max-w-6xl mx-auto px-4 relative z-10 flex flex-col gap-6 md:gap-8">
        
        {/* Header Block */}
        <header className="custom-glass rounded-3xl p-5 md:p-7 shadow-2xl flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6 border border-white/5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-80 h-80 bg-gradient-to-br from-cyan-500/10 to-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_rgba(34,211,238,0.7)]"></span>
              <span className="text-xs font-black uppercase tracking-widest text-slate-400">Analysis Trend</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent">
              TC Positions
            </h1>
            <p className="text-xs md:text-sm text-slate-400 max-w-xl mt-1 leading-relaxed">
              Tropical cyclone Center Positions by Forecast Initialization Cycle. Watch the storm's starting coordinates evolve over successive model runs.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {stormsList.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-black uppercase tracking-wider text-slate-400">Select Storm:</span>
                <select
                  value={selectedTrackId || ""}
                  onChange={(e) => setSelectedTrackId(e.target.value)}
                  className="px-3 py-2 bg-slate-900 border border-white/10 hover:border-slate-500 rounded-xl text-xs font-black tracking-wide text-slate-300 focus:outline-none focus:ring-1 focus:ring-cyan-500 cursor-pointer"
                >
                  {stormsList.map((storm) => (
                    <option key={storm.track_id} value={storm.track_id} className="bg-slate-950 text-slate-300">
                      {storm.storm_name} {storm.active ? "● Active" : "○ Past"}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {data.active && (
              <a
                href={getAssetUrl(`/assets/tc_positions_${selectedTrackId || 'latest'}.png`)}
                download={`tc_positions_${selectedTrackId || 'latest'}.png`}
                className="px-4 py-2 bg-slate-900 border border-white/5 hover:border-slate-500 rounded-xl text-xs font-black tracking-wide text-slate-400 hover:text-white transition-all shadow-lg flex items-center gap-2 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>DOWNLOAD MAP</span>
              </a>
            )}
          </div>
        </header>

        {!data.active ? (
          /* Empty Calm State */
          <div className="custom-glass rounded-3xl p-8 md:p-12 text-center flex flex-col items-center justify-center gap-5 border border-white/5 shadow-2xl relative">
            <div className="w-20 h-20 bg-slate-900 border border-white/5 rounded-full flex items-center justify-center shadow-lg relative">
              <Activity className="w-10 h-10 text-cyan-500/60" />
              <div className="absolute inset-0 border border-cyan-400/20 rounded-full animate-ping"></div>
            </div>
            <div>
              <h2 className="text-xl font-bold text-white mb-2">No Active Tropical Cyclones</h2>
              <p className="text-sm text-slate-400 max-w-md mx-auto leading-relaxed">
                There are currently no active tropical cyclones in the Western North Pacific being analyzed across successive model runs. The region remains quiet.
              </p>
            </div>
          </div>
        ) : (
          /* Active Cyclone Tracking Dashboard */
          <div className="grid grid-cols-1 lg:grid-cols-[2fr,1.2fr] gap-6 md:gap-8 items-start">
            
            {/* Left Column: Interactive Map View */}
            <div className="custom-glass rounded-3xl p-3 shadow-2xl border border-white/5 flex flex-col relative group">
              <div className="border-b border-white/5 px-4.5 py-3 flex items-center justify-between text-xs text-slate-400">
                <span className="font-bold flex items-center gap-1.5">
                  <Map className="w-4 h-4 text-cyan-400" />
                  <span>Cycle Analysis Map ({data.storm_name})</span>
                </span>
                <span className="font-mono text-[10px] text-slate-500 font-bold bg-slate-950 px-2.5 py-1 rounded-lg border border-white/5">
                  Latest: {data.latest.init_time} UTC
                </span>
              </div>

              {/* Map Viewport */}
              <div className="h-80 md:h-[30rem] w-full bg-slate-950 border border-white/5 rounded-2xl overflow-hidden relative mt-2 shadow-inner flex items-center justify-center">
                <img
                  src={getAssetUrl(`/assets/tc_positions_${selectedTrackId || 'latest'}.png`)}
                  alt="Tropical cyclone initialization cycle track map"
                  className="h-full w-full object-contain cursor-pointer transition-opacity hover:opacity-90"
                  onClick={() => setEnlargedImage(getAssetUrl(`/assets/tc_positions_${selectedTrackId || 'latest'}.png`))}
                />
                <button
                  onClick={() => setEnlargedImage(getAssetUrl(`/assets/tc_positions_${selectedTrackId || 'latest'}.png`))}
                  className="absolute bottom-4 right-4 p-3 bg-slate-900/95 hover:bg-slate-800 border border-white/10 hover:border-slate-500 rounded-2xl text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shadow-2xl flex items-center gap-1.5 text-xs font-bold"
                >
                  <Maximize2 className="w-4 h-4" />
                  <span>Maximize Image</span>
                </button>
              </div>
            </div>

            {/* Right Column: Storm Details & History Timeline */}
            <div className="flex flex-col gap-6 md:gap-8">
              
              {/* Storm Parameters Card */}
              <aside className="custom-glass rounded-3xl p-5 md:p-6 shadow-2xl border border-white/5 space-y-4 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-cyan-500/5 blur-2xl rounded-full"></div>

                <h2 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-cyan-400" />
                  <span>Storm Details</span>
                </h2>

                <div className="flex items-center justify-between border-b border-white/5 pb-3">
                  <div>
                    <h3 className="text-lg font-black text-white tracking-tight">{data.storm_name}</h3>
                    <span className="text-[10px] font-mono text-slate-500 font-bold uppercase">ATCF: {data.track_id}</span>
                  </div>
                  <span className={`text-[10px] uppercase font-black px-2.5 py-1 rounded-lg ${getCategoryColorClass(data.latest.category)}`}>
                    {data.latest.category}
                  </span>
                </div>

                <dl className="grid grid-cols-2 gap-4 text-xs md:text-sm">
                  <div className="flex flex-col gap-1 border-r border-white/5 pr-2">
                    <dt className="text-slate-500 font-bold flex items-center gap-1">
                      <Compass className="w-3.5 h-3.5 text-slate-400" />
                      <span>Coordinates</span>
                    </dt>
                    <dd className="font-bold text-slate-200">
                      {data.latest.lat.toFixed(1)}° N, {data.latest.lon.toFixed(1)}° E
                    </dd>
                  </div>

                  <div className="flex flex-col gap-1 pl-2">
                    <dt className="text-slate-500 font-bold flex items-center gap-1">
                      <Wind className="w-3.5 h-3.5 text-slate-400" />
                      <span>Max Winds</span>
                    </dt>
                    <dd className="font-bold text-slate-200">
                      {formatKnots(data.latest.wind_kt)}
                    </dd>
                  </div>

                  <div className="flex flex-col gap-1 border-r border-white/5 pr-2 border-t border-white/5 pt-2.5">
                    <dt className="text-slate-500 font-bold">Central Pressure</dt>
                    <dd className="font-bold text-slate-200">
                      {data.latest.pressure_hpa} hPa
                    </dd>
                  </div>

                  <div className="flex flex-col gap-1 pl-2 border-t border-white/5 pt-2.5">
                    <dt className="text-slate-500 font-bold">Movement</dt>
                    <dd className="font-bold text-slate-200 leading-tight">
                      {data.latest.movement}
                    </dd>
                  </div>
                </dl>

                <div className="text-[10px] text-slate-500 leading-relaxed border-t border-white/5 pt-3 mt-1 bg-slate-950/20 p-2.5 rounded-xl border border-white/5 flex items-start gap-2">
                  <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                  <span>
                    Movement speed and direction are computed dynamically based on the shift in storm centers between the latest initialization runs.
                  </span>
                </div>
              </aside>

              {/* History Initialization Cycle Timeline */}
              <aside className="custom-glass rounded-3xl p-5 md:p-6 shadow-2xl border border-white/5 flex flex-col">
                <h2 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-cyan-400" />
                  <span>Initialization History</span>
                </h2>

                <div className="relative pl-6 space-y-5 border-l border-white/10 py-1">
                  {data.history.map((pt, index) => {
                    const isLatest = index === data.history.length - 1;
                    const isSelected = index === selectedHistoryIndex;

                    return (
                      <div
                        key={index}
                        onClick={() => setSelectedHistoryIndex(index)}
                        className={`relative cursor-pointer transition-all duration-300 p-2.5 rounded-2xl border text-xs ${
                          isSelected
                            ? "bg-slate-900 border-cyan-400/40 shadow-lg text-white"
                            : "bg-transparent border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-950/20"
                        }`}
                      >
                        {/* Timeline Node Ring */}
                        <div
                          className={`absolute -left-[30px] top-[14px] w-4 h-4 rounded-full border-2 transition-all duration-300 flex items-center justify-center ${
                            isLatest
                              ? "bg-red-500 border-red-400 shadow-[0_0_8px_rgba(239,68,68,0.6)]"
                              : "bg-slate-900 border-white/20"
                          } ${isSelected ? "ring-4 ring-cyan-500/20 scale-110" : ""}`}
                        >
                          {isSelected && <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full"></div>}
                        </div>

                        <div className="flex justify-between items-start mb-1.5">
                          <span className="font-black text-slate-300 flex items-center gap-1">
                            {pt.cycle} UTC
                            {isLatest && (
                              <span className="text-[9px] uppercase bg-red-500/10 text-red-400 border border-red-500/20 px-1.5 py-0.2 rounded-full font-bold ml-1">
                                LATEST
                              </span>
                            )}
                          </span>
                          <span className="text-[10px] font-mono opacity-70">
                            {pt.lat.toFixed(1)}°N, {pt.lon.toFixed(1)}°E
                          </span>
                        </div>

                        {/* Expandable item details */}
                        <div className="flex gap-4 text-[10px] text-slate-500 font-bold font-mono">
                          <span className="flex items-center gap-1">
                            <Layers className="w-3.5 h-3.5 text-slate-600" />
                            <span>{pt.pressure_hpa} hPa</span>
                          </span>
                          <span className="flex items-center gap-1">
                            <Wind className="w-3.5 h-3.5 text-slate-600" />
                            <span>{pt.wind_kt} kt ({pt.wind_kmh} km/h)</span>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </aside>
            </div>
          </div>
        )}
      </div>

      {/* Fullscreen Map Overlay Lightbox */}
      {/* Full Screen Interactive Image Modal (Pinch/Scroll Zoomable Lightbox) */}
      {enlargedImage && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/95 p-4 backdrop-blur-md overflow-hidden"
          onClick={() => { setEnlargedImage(null); handleZoomReset(); }}
        >
          {/* Lightbox Controls Header */}
          <div className="absolute top-4 left-4 right-4 z-50 flex items-center justify-between pointer-events-none">
            <div className="bg-slate-900/90 border border-white/10 px-4 py-2 rounded-2xl flex items-center gap-2 pointer-events-auto">
              <Maximize2 className="w-4 h-4 text-cyan-400" />
              <span className="text-xs font-black text-white uppercase tracking-wider">Zoom Mode: {zoomScale.toFixed(1)}x</span>
            </div>

            <div className="flex items-center gap-2 pointer-events-auto">
              <button
                onClick={(e) => { e.stopPropagation(); setZoomScale(Math.min(4, zoomScale + 0.5)); }}
                className="p-2.5 rounded-xl bg-slate-900 border border-white/10 hover:border-slate-500 text-white cursor-pointer transition-all hover:scale-105 active:scale-95"
                title="Zoom In"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setZoomScale(Math.max(1, zoomScale - 0.5)); }}
                className="p-2.5 rounded-xl bg-slate-900 border border-white/10 hover:border-slate-500 text-white cursor-pointer transition-all hover:scale-105 active:scale-95"
                title="Zoom Out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleZoomReset(); }}
                className="p-2.5 rounded-xl bg-slate-900 border border-white/10 hover:border-slate-500 text-white cursor-pointer transition-all hover:scale-105 active:scale-95"
                title="Reset Zoom"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                onClick={() => { setEnlargedImage(null); handleZoomReset(); }}
                className="p-2.5 rounded-xl bg-slate-900 border border-white/10 hover:border-slate-500 text-white cursor-pointer transition-all hover:scale-105 active:scale-95"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div
            className="w-full h-full flex items-center justify-center"
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            // Touch gestures support
            onTouchStart={(e) => {
              if (zoomScale <= 1 || e.touches.length < 1) return;
              setIsDragging(true);
              setDragStart({ x: e.touches[0].clientX - panOffset.x, y: e.touches[0].clientY - panOffset.y });
            }}
            onTouchMove={(e) => {
              if (!isDragging || e.touches.length < 1) return;
              setPanOffset({
                x: e.touches[0].clientX - dragStart.x,
                y: e.touches[0].clientY - dragStart.y
              });
            }}
            onTouchEnd={handleMouseUp}
          >
            <img
              src={enlargedImage}
              alt="Enlarged forecast map visualizer"
              style={{
                transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomScale})`,
                cursor: zoomScale > 1 ? (isDragging ? "grabbing" : "grab") : "default",
                transition: isDragging ? "none" : "transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)"
              }}
              className="max-w-full max-h-[85vh] object-contain rounded-2xl shadow-2xl select-none"
              onClick={(e) => e.stopPropagation()}
              onDragStart={(e) => e.preventDefault()}
            />
          </div>
        </div>
      )}
    </section>
  );
};

export default TCPositions;
