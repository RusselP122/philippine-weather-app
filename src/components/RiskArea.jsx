import React, { useState } from "react";
import {
  Layers,
  Activity,
  Info,
  Database,
  ShieldAlert,
  HelpCircle,
  Download,
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCcw,
  X
} from "lucide-react";

// Helper to resolve asset URLs relative to the base path
const getAssetUrl = (path) => {
  const base = import.meta.env.BASE_URL || "/";
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  return `${base}${cleanPath}`;
};

const VARIABLE_INFO = {
  track_probability: {
    name: "Track Probability",
    desc: "Probability of a tropical cyclone center passing within 65 nautical miles (120 km) of any location over the 15-day period.",
    color: "from-blue-500 to-indigo-600"
  },
  "34_knot_strike_probability": {
    name: "34-knot (TS) Strike Prob",
    desc: "Probability of experiencing sustained wind speeds of 34 knots (63 km/h, Tropical Storm strength) or higher over the 15-day period.",
    color: "from-sky-400 to-blue-500"
  },
  "50_knot_strike_probability": {
    name: "50-knot (STS) Strike Prob",
    desc: "Probability of experiencing sustained wind speeds of 50 knots (93 km/h, Severe Tropical Storm strength) or higher over the 15-day period.",
    color: "from-emerald-400 to-teal-500"
  },
  "64_knot_strike_probability": {
    name: "64-knot (TY) Strike Prob",
    desc: "Probability of experiencing sustained wind speeds of 64 knots (118 km/h, Typhoon strength) or higher over the 15-day period.",
    color: "from-orange-500 to-red-600"
  }
};

const LEGEND_ITEMS = [
  { val: "5% – 10%", color: "#1d4ed8" },
  { val: "10% – 20%", color: "#38bdf8" },
  { val: "20% – 30%", color: "#34d399" },
  { val: "30% – 50%", color: "#facc15" },
  { val: "50% – 70%", color: "#f97316" },
  { val: "≥ 70%", color: "#dc2626" }
];

const RiskArea = () => {
  const [selectedVariable, setSelectedVariable] = useState("track_probability");
  const [imageError, setImageError] = useState(false);

  const [enlargedImage, setEnlargedImage] = useState(null);
  const [zoomScale, setZoomScale] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const imageSrc = getAssetUrl(`/assets/risk_maps/risk_map_${selectedVariable}.png`);

  const handleVariableChange = (varKey) => {
    setSelectedVariable(varKey);
    setImageError(false);
    setEnlargedImage(null);
    resetZoom();
  };

  // Handle zooming & panning interactive lightbox
  const handleWheel = (e) => {
    e.preventDefault();
    const scaleFactor = 0.15;
    const nextScale = e.deltaY < 0 ? zoomScale + scaleFactor : zoomScale - scaleFactor;
    setZoomScale(Math.min(4, Math.max(1, nextScale)));
  };

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

  const resetZoom = () => {
    setZoomScale(1);
    setPanOffset({ x: 0, y: 0 });
  };

  return (
    <section className="bg-slate-950 py-8 md:py-12 relative overflow-x-hidden selection:bg-cyan-500 selection:text-white min-h-screen">
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
      `}</style>

      {/* Grid texture overlay */}
      <div className="absolute inset-0 bg-grid-pattern pointer-events-none z-0"></div>

      <div className="max-w-6xl mx-auto px-4 relative z-10 flex flex-col gap-6 md:gap-8">
        
        {/* Header Block */}
        <header className="custom-glass rounded-3xl p-5 md:p-7 shadow-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-6 border-b border-white/5 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-80 h-80 bg-gradient-to-br from-cyan-500/10 to-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.7)]"></span>
              <span className="text-xs font-black uppercase tracking-widest text-slate-400">Risk Assessment Map</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent">
              Tropical Cyclone Risk Area
            </h1>
            <p className="text-xs md:text-sm text-slate-400 max-w-xl mt-1 leading-relaxed">
              Analyze the 15-day cumulative strike and track probabilities. This map shows the maximum risk for each province in the Philippines, overlaid with the forecast track.
            </p>
          </div>
        </header>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-[2fr,1fr] gap-6 md:gap-8 items-start">
          
          {/* Left Column - Map Card */}
          <div className="custom-glass rounded-3xl p-4 shadow-2xl relative group flex flex-col">
            <div className="border-b border-white/5 px-2 pb-3.5 mb-3.5 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-400">
              <span className="font-bold flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-red-500 animate-pulse" />
                <span>15-Day Cumulative Risk Map</span>
              </span>
              <span className="font-mono text-[10px] text-slate-400 font-bold bg-slate-900 px-3 py-1 rounded-xl border border-white/5">
                MODEL: GDM-FNV3 LARGE (1000 MEMBERS)
              </span>
            </div>

            {/* Variable Selection Tabs & Download Button */}
            <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between mb-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 flex-grow">
                {Object.keys(VARIABLE_INFO).map((varKey) => (
                  <button
                    key={varKey}
                    onClick={() => handleVariableChange(varKey)}
                    className={`px-3 py-2.5 rounded-xl text-[11px] font-black tracking-wider transition-all duration-300 border cursor-pointer whitespace-normal text-center leading-tight ${
                      selectedVariable === varKey
                        ? "bg-slate-800 text-cyan-400 border-white/10 shadow-lg shadow-black/40"
                        : "bg-slate-950/60 border-white/5 text-slate-500 hover:text-slate-200"
                    }`}
                  >
                    {VARIABLE_INFO[varKey].name}
                  </button>
                ))}
              </div>

              {imageError ? (
                <button
                  disabled
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 border border-white/5 text-slate-600 font-black text-xs tracking-wider rounded-xl cursor-not-allowed shrink-0"
                >
                  <Download className="w-4 h-4" />
                  <span>DOWNLOAD PNG</span>
                </button>
              ) : (
                <a
                  href={imageSrc}
                  download={`philippines_risk_map_${selectedVariable}.png`}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 active:scale-95 text-slate-950 font-black text-xs tracking-wider rounded-xl transition-all duration-300 border border-cyan-400/20 shadow-lg shadow-cyan-500/10 shrink-0 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>DOWNLOAD PNG</span>
                </a>
              )}
            </div>

            {/* Map Image Viewer */}
            <div className="w-full bg-slate-950 border border-white/5 rounded-2xl overflow-hidden relative shadow-inner flex items-center justify-center min-h-[35rem] group">
              {!imageError && (
                <>
                  <img
                    src={imageSrc}
                    alt={`${VARIABLE_INFO[selectedVariable].name} Map`}
                    className="max-h-[45rem] w-full object-contain cursor-pointer transition-opacity hover:opacity-90"
                    onClick={() => setEnlargedImage(imageSrc)}
                    onError={(e) => {
                      setImageError(true);
                      e.target.onerror = null;
                      e.target.src = ""; // Clear source
                      e.target.style.display = 'none';
                      // Show fallback
                      const parent = e.target.parentNode;
                      const fallback = parent.querySelector('.fallback-container');
                      if (fallback) fallback.style.display = 'flex';
                    }}
                    onLoad={(e) => {
                      setImageError(false);
                      e.target.style.display = 'block';
                      const parent = e.target.parentNode;
                      const fallback = parent.querySelector('.fallback-container');
                      if (fallback) fallback.style.display = 'none';
                    }}
                  />
                  <button
                    onClick={() => setEnlargedImage(imageSrc)}
                    className="absolute bottom-4 right-4 p-3 bg-slate-900/95 hover:bg-slate-800 border border-white/10 hover:border-slate-500 rounded-2xl text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shadow-2xl flex items-center gap-1.5 text-xs font-bold z-20"
                  >
                    <Maximize2 className="w-4 h-4" />
                    <span>Maximize Image</span>
                  </button>
                </>
              )}
              <div className="fallback-container absolute inset-0 hidden flex-col items-center justify-center p-8 text-center gap-3">
                <Database className="w-10 h-10 text-slate-700 animate-pulse" />
                <span className="text-sm text-slate-500 font-bold">
                  No risk map image has been generated yet for this variable.
                </span>
                <span className="text-xs text-slate-600 max-w-sm">
                  The maps will be automatically generated and uploaded during the next scheduled GitHub workflow run.
                </span>
              </div>
            </div>
          </div>

          {/* Right Column - Sidebar */}
          <div className="flex flex-col gap-6">
            
            {/* Legend Card */}
            <div className="custom-glass rounded-3xl p-5 md:p-6 shadow-2xl space-y-4">
              <h2 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5 border-b border-white/5 pb-2.5">
                <Layers className="w-4 h-4 text-cyan-400" />
                <span>Risk Levels Legend</span>
              </h2>
              <div className="grid grid-cols-2 gap-3">
                {LEGEND_ITEMS.map((item) => (
                  <div key={item.val} className="flex items-center gap-2.5">
                    <span
                      className="w-4 h-4 rounded border border-white/10 shrink-0"
                      style={{ backgroundColor: item.color }}
                    ></span>
                    <span className="text-xs text-slate-300 font-bold">{item.val}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Variable Info Card */}
            <div className="custom-glass rounded-3xl p-5 md:p-6 shadow-2xl space-y-3.5">
              <h2 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                <HelpCircle className="w-4 h-4 text-cyan-400" />
                <span>Variable Details</span>
              </h2>
              <div className="p-4 rounded-2xl bg-slate-950/60 border border-white/5 space-y-2">
                <h3 className="text-sm font-black text-white">
                  {VARIABLE_INFO[selectedVariable].name}
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed font-medium">
                  {VARIABLE_INFO[selectedVariable].desc}
                </p>
              </div>
            </div>

            {/* Disclaimer and Important Information */}
            <div className="custom-glass rounded-3xl p-5 md:p-6 shadow-2xl space-y-3">
              <h2 className="text-xs font-black text-red-500 uppercase tracking-widest flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-red-500" />
                <span>Safety Notice</span>
              </h2>
              <div className="text-xs text-slate-400 space-y-2.5 leading-relaxed font-medium">
                <p>
                  These risk assessment maps are derived from the experimental **Google DeepMind FuXi-Nazca V3 (FNV3)** weather model.
                </p>
                <p>
                  A <strong>"Strike"</strong> is defined as the storm center passing within 120 km of a location. Higher percentages indicate a greater consensus among the 1,000 ensemble members that a storm will affect that province.
                </p>
                <p className="text-orange-400/90 font-bold border-t border-white/5 pt-2.5">
                  WARNING: This is an experimental guidance product and should not be used for critical decision-making. Always refer to PAGASA for official warnings, track cones, and disaster response guidelines.
                </p>
              </div>
            </div>

          </div>
        </div>

        </div>

        {/* Full Screen Interactive Image Modal (Pinch/Scroll Zoomable Lightbox) */}
        {enlargedImage && (
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/95 p-4 backdrop-blur-md overflow-hidden"
            onClick={() => { setEnlargedImage(null); resetZoom(); }}
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
                  onClick={(e) => { e.stopPropagation(); resetZoom(); }}
                  className="p-2.5 rounded-xl bg-slate-900 border border-white/10 hover:border-slate-500 text-white cursor-pointer transition-all hover:scale-105 active:scale-95"
                  title="Reset Zoom"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
                <button
                  onClick={() => { setEnlargedImage(null); resetZoom(); }}
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
                alt="Enlarged risk map visualizer"
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

export default RiskArea;
