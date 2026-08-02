// src/components/ForecastTrackComparison.jsx
import React, { useState, useEffect } from "react";
import {
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Download,
  Info,
  Layers,
  Compass,
  AlertTriangle,
  Activity,
  X,
  Globe
} from "lucide-react";

// Helper to resolve asset URLs relative to base path
const getAssetUrl = (path) => {
  const base = import.meta.env.BASE_URL || "/";
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  return `${base}${cleanPath}`;
};

const STORMS_LIST = [
  { id: "12W", name: "DOLPHIN (12W)", status: "Active Typhoon" },
  { id: "94W", name: "INVEST (94W)", status: "Active Disturbance" },
  { id: "90W", name: "INVEST (90W)", status: "Historical Sample" }
];

const ForecastTrackComparison = () => {
  const [selectedStorm, setSelectedStorm] = useState("12W");
  const [zoomScale, setZoomScale] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [imgError, setImgError] = useState(false);

  // Reset zoom on storm change
  useEffect(() => {
    setZoomScale(1);
    setPanOffset({ x: 0, y: 0 });
    setImgError(false);
  }, [selectedStorm]);

  // Zoom controls
  const handleZoomIn = () => setZoomScale((prev) => Math.min(prev + 0.35, 4));
  const handleZoomOut = () => setZoomScale((prev) => Math.max(prev - 0.35, 1));
  const handleResetZoom = () => {
    setZoomScale(1);
    setPanOffset({ x: 0, y: 0 });
  };

  // Pan controls
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

  const handleMouseUp = () => setIsDragging(false);

  const currentImagePath = getAssetUrl(`/assets/forecasttrack_${selectedStorm}.png`);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-6 px-3 sm:px-6 lg:px-8 font-sans">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/90 border border-slate-800 p-5 rounded-2xl backdrop-blur shadow-xl">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-md bg-sky-500/20 text-sky-400 border border-sky-500/30 text-xs font-bold uppercase tracking-wider">
                Forecast Track Comparison
              </span>
              <span className="px-2.5 py-1 rounded-md bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 text-xs font-semibold">
                Official Agencies vs. Models
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white mt-2 tracking-tight">
              Tropical Cyclone Forecast Track Comparison
            </h1>
            <p className="text-slate-400 text-xs sm:text-sm mt-1 max-w-3xl">
              Side-by-side trajectory map comparing official meteorological agency forecasts (PAGASA, JTWC, JMA) against state-of-the-art AI & dynamical ensemble mean model tracks.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <a
              href={currentImagePath}
              download={`forecasttrack_${selectedStorm}.png`}
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs sm:text-sm transition-all flex items-center gap-2 shadow-lg shadow-sky-600/30"
            >
              <Download className="w-4 h-4" />
              Download Image
            </a>
          </div>
        </div>

        {/* Storm Selection Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider mr-2 flex items-center gap-1">
            <Activity className="w-3.5 h-3.5 text-sky-400" /> Active Systems:
          </span>
          {STORMS_LIST.map((storm) => (
            <button
              key={storm.id}
              onClick={() => setSelectedStorm(storm.id)}
              className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-2 whitespace-nowrap border ${
                selectedStorm === storm.id
                  ? "bg-sky-600 text-white border-sky-400 shadow-md shadow-sky-600/30"
                  : "bg-slate-900/80 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white"
              }`}
            >
              <Compass className="w-3.5 h-3.5" />
              <span>{storm.name}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                {storm.status}
              </span>
            </button>
          ))}
        </div>

        {/* Main Display Container */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl relative">
          
          {/* Top Control Bar */}
          <div className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-sky-400" />
              <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                Multi-Model Comparison Map View
              </span>
            </div>

            {/* Interactive Zoom & Pan Controls */}
            <div className="flex items-center gap-1.5 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
              <button
                onClick={handleZoomIn}
                title="Zoom In"
                className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300 hover:text-white transition-colors"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                onClick={handleZoomOut}
                title="Zoom Out"
                className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300 hover:text-white transition-colors"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <button
                onClick={handleResetZoom}
                title="Reset View"
                className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300 hover:text-white transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                onClick={() => setIsFullscreen(!isFullscreen)}
                title="Toggle Fullscreen"
                className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300 hover:text-white transition-colors border-l border-slate-800 ml-1 pl-2"
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Interactive Image Viewport */}
          <div
            className={`relative bg-slate-950 overflow-hidden flex items-center justify-center cursor-grab active:cursor-grabbing ${
              isFullscreen ? "fixed inset-0 z-[3000] bg-slate-950 p-4" : "min-h-[500px] max-h-[750px]"
            }`}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            {isFullscreen && (
              <button
                onClick={() => setIsFullscreen(false)}
                className="absolute top-4 right-4 z-10 p-2.5 rounded-xl bg-slate-900/90 text-white border border-slate-700 hover:bg-slate-800 transition-all shadow-xl"
              >
                <X className="w-5 h-5" />
              </button>
            )}

            {!imgError ? (
              <img
                src={currentImagePath}
                alt={`Forecast Track Comparison - Storm ${selectedStorm}`}
                className="max-w-full h-auto object-contain transition-transform duration-75 select-none"
                style={{
                  transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomScale})`
                }}
                onError={() => setImgError(true)}
              />
            ) : (
              <div className="py-20 text-center space-y-3 px-4">
                <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto animate-pulse" />
                <h3 className="text-lg font-bold text-slate-200 font-sans">Image Generating or Not Available</h3>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  The comparison plot for storm {selectedStorm} is currently being generated. Run <code className="bg-slate-900 px-1.5 py-0.5 rounded text-amber-300">python forecasttrack.py</code> to render latest comparison tracks.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Track Legend & Agency Details Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          
          {/* Card 1: Official Agencies */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-2 text-sky-400 font-bold text-sm">
              <Globe className="w-4 h-4" /> Official Meteorological Agencies
            </div>
            <div className="space-y-2 text-xs text-slate-300">
              <div className="flex items-center justify-between p-2 rounded-xl bg-slate-950/60 border border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-[#008000]"></span>
                  <span className="font-bold text-white">DOST-PAGASA</span>
                </div>
                <span className="text-[11px] text-slate-400">Official Philippine Weather Bureau</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-xl bg-slate-950/60 border border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-[#FF0000]"></span>
                  <span className="font-bold text-white">JTWC</span>
                </div>
                <span className="text-[11px] text-slate-400">US Joint Typhoon Warning Center</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-xl bg-slate-950/60 border border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-[#FF8C00]"></span>
                  <span className="font-bold text-white">JMA</span>
                </div>
                <span className="text-[11px] text-slate-400">Japan Meteorological Agency (RSMC Tokyo)</span>
              </div>
            </div>
          </div>

          {/* Card 2: AI & Dynamical Models */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-2 text-indigo-400 font-bold text-sm">
              <Layers className="w-4 h-4" /> Ensemble & AI Model Means
            </div>
            <div className="space-y-2 text-xs text-slate-300">
              <div className="flex items-center justify-between p-2 rounded-xl bg-slate-950/60 border border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-[#000080]"></span>
                  <span className="font-bold text-white">GDM FNV3p2</span>
                </div>
                <span className="text-[11px] text-slate-400">Google DeepMind FuXi-Nazca V3</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-xl bg-slate-950/60 border border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-[#334155]"></span>
                  <span className="font-bold text-white">ECMWF IFS</span>
                </div>
                <span className="text-[11px] text-slate-400">High Resolution Integrated Forecasting System</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-xl bg-slate-950/60 border border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-[#0d9488]"></span>
                  <span className="font-bold text-white">ECMWF AIFS</span>
                </div>
                <span className="text-[11px] text-slate-400">ECMWF Artificial Intelligence Forecasting System</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-xl bg-slate-950/60 border border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-[#78350f]"></span>
                  <span className="font-bold text-white">NOAA AIGEFS</span>
                </div>
                <span className="text-[11px] text-slate-400">AI Global Ensemble Forecast System</span>
              </div>
            </div>
          </div>

        </div>

        {/* Disclaimer Footer Note */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 text-xs text-slate-400 leading-relaxed flex items-start gap-3">
          <Info className="w-5 h-5 text-sky-400 flex-shrink-0 mt-0.5" />
          <div>
            Official agency tracks reflect operational bulletins released by PAGASA, JTWC, and JMA. Model tracks represent ensemble geometric mean centers extracted from operational model initialization cycles.
          </div>
        </div>

      </div>
    </div>
  );
};

export default ForecastTrackComparison;
