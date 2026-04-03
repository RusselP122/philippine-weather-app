import React, { useState, useEffect } from "react";
import { Play, Pause, X, SlidersHorizontal } from "lucide-react";

const ForecastModels = () => {
    const [activeParam, setActiveParam] = useState("rainfall");
    const [activeModel, setActiveModel] = useState("gfs"); // "gfs" | "aifs"
    const [rainfallView, setRainfallView] = useState("daily"); // 'daily' | '24h' | '3d' | '7d'
    const [metadata, setMetadata] = useState(null);
    const [frameIndex, setFrameIndex] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [imageTimestamp] = useState(Date.now());
    const [sidebarOpen, setSidebarOpen] = useState(false); // Mobile drawer state

    useEffect(() => {
        let url = "";
        if (activeParam === "rainfall") {
            url = "/data/rainfall_meta.json";
        } else if (activeParam === "wind") {
            url = "/data/wind_meta.json";
        } else if (activeParam === "precip_mslp") {
            url = activeModel === "aifs" ? "/data/precip_mslp_aifs_meta.json" : "/data/precip_mslp_meta.json";
        }

        fetch(url)
            .then(res => res.json())
            .then(data => {
                setMetadata(data);
                if (data.animation_frames) {
                    data.animation_frames.forEach(frame => {
                        const img = new Image();
                        const folder = activeParam === "rainfall" ? "rainfall" : activeParam === "wind" ? "wind" : (activeModel === "aifs" ? "precip_mslp_aifs" : "precip_mslp");
                        img.src = `/images/${folder}/${frame}.png?t=${imageTimestamp}`;
                    });
                }
            })
            .catch(err => console.error("Failed to load metadata", err));
        setFrameIndex(0);
        setIsPlaying(false);
    }, [activeParam, activeModel, imageTimestamp]);

    const frames = metadata?.animation_frames || [];
    const currentFrameName = frames[frameIndex] || "";

    const isStaticRainfall = activeParam === "rainfall" && rainfallView !== "daily";

    let imagePath = "";
    if (isStaticRainfall) {
        imagePath = `/images/rainfall/gfs_${rainfallView}.png`;
    } else if (activeParam === "rainfall" && currentFrameName) {
        imagePath = `/images/rainfall/${currentFrameName}.png`;
    } else if (activeParam === "wind" && currentFrameName) {
        imagePath = `/images/wind/${currentFrameName}.png`;
    } else if (activeParam === "precip_mslp" && currentFrameName) {
        const folder = activeModel === "aifs" ? "precip_mslp_aifs" : "precip_mslp";
        imagePath = `/images/${folder}/${currentFrameName}.png`;
    }

    let stepHours = 0;
    let dayNum = 1;
    if (activeParam === "wind" && currentFrameName) {
        stepHours = parseInt(currentFrameName.split('_').pop(), 10) || 0;
        dayNum = Math.floor(stepHours / 24) + 1;
    } else if (activeParam === "precip_mslp" && currentFrameName) {
        stepHours = parseInt(currentFrameName.split('_').pop(), 10) || 0;
        dayNum = Math.floor(stepHours / 24) + 1;
    } else if (activeParam === "rainfall" && currentFrameName) {
        const parts = currentFrameName.split('_');
        dayNum = parseInt(parts[2], 10) || 1;
        stepHours = Math.min(dayNum * 24, 168);
    }

    useEffect(() => {
        let interval;
        if (isPlaying && frames.length > 0 && !isStaticRainfall) {
            interval = setInterval(() => {
                setFrameIndex(prev => (prev + 1) % frames.length);
            }, 1000 / (activeParam === "wind" ? 5 : 2));
        }
        return () => clearInterval(interval);
    }, [isPlaying, frames, activeParam, isStaticRainfall]);

    const togglePlay = () => setIsPlaying(!isPlaying);

    const btnClass = (param) => {
        const base = "w-full flex items-center justify-between p-3 rounded-lg border transition-colors text-left cursor-pointer ";
        if (activeParam === param) {
            return base + "bg-slate-700 border-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.15)] relative overflow-hidden";
        }
        return base + "bg-slate-900 border-slate-700 hover:border-slate-500";
    };

    const SidebarContent = () => (
        <div className="flex-1 overflow-y-auto">
            <div className="p-4 border-b border-slate-700">
                <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Weather Parameters</h2>
                <div className="space-y-2">

                    <button onClick={() => { setActiveParam("rainfall"); setActiveModel("gfs"); setRainfallView("daily"); setSidebarOpen(false); }} className={btnClass("rainfall")}>
                        {activeParam === "rainfall" && <div className="absolute left-0 top-0 bottom-0 w-1 bg-cyan-500"></div>}
                        <div className="flex items-center gap-3 pl-2">
                            <div className="w-3 h-3 rounded-full bg-blue-500 flex-shrink-0"></div>
                            <span className={`text-sm ${activeParam === "rainfall" ? "font-bold text-white" : "font-medium text-slate-300"}`}>Precipitation Rate</span>
                        </div>
                    </button>

                    {/* Rainfall sub-view toggle */}
                    {activeParam === "rainfall" && (
                        <div className="ml-2 pl-3 border-l border-slate-700 grid grid-cols-4 gap-1 mt-1">
                            {[{id:"daily", label:"Daily"}, {id:"24h", label:"1-Day"}, {id:"3d", label:"3-Day"}, {id:"7d", label:"7-Day"}].map(v => (
                                <button
                                    key={v.id}
                                    onClick={() => { setRainfallView(v.id); setIsPlaying(false); }}
                                    className={`text-[10px] font-bold py-1 px-1 rounded cursor-pointer transition border ${
                                        rainfallView === v.id
                                            ? "bg-cyan-600 text-white border-cyan-500"
                                            : "bg-slate-900 text-slate-400 border-slate-700 hover:border-slate-500 hover:text-white"
                                    }`}
                                >
                                    {v.label}
                                </button>
                            ))}
                        </div>
                    )}

                    <button onClick={() => { setActiveParam("wind"); setActiveModel("aifs"); setSidebarOpen(false); }} className={btnClass("wind")}>
                        {activeParam === "wind" && <div className="absolute left-0 top-0 bottom-0 w-1 bg-cyan-500"></div>}
                        <div className="flex items-center gap-3 pl-2">
                            <div className="relative w-4 h-4 flex-shrink-0">
                                <div className="absolute inset-0 border border-slate-400 rounded-full opacity-50 scale-150"></div>
                                <div className="absolute inset-0 bg-cyan-400 rounded-full w-2 h-2 m-auto"></div>
                            </div>
                            <div>
                                <span className={`block text-sm ${activeParam === "wind" ? "font-bold text-white" : "font-medium text-slate-300"}`}>Wind &amp; MSLP</span>
                                {activeParam === "wind" && <span className="block text-[10px] text-cyan-300 font-mono mt-0.5">Particles + Isobars</span>}
                            </div>
                        </div>
                    </button>

                    <button onClick={() => { setActiveParam("precip_mslp"); setSidebarOpen(false); }} className={btnClass("precip_mslp")}>
                        {activeParam === "precip_mslp" && <div className="absolute left-0 top-0 bottom-0 w-1 bg-cyan-500"></div>}
                        <div className="flex items-center gap-3 pl-2">
                            <div className="w-3 h-3 rounded-full bg-gradient-to-br from-green-400 to-blue-500 flex-shrink-0"></div>
                            <div>
                                <span className={`block text-sm ${activeParam === "precip_mslp" ? "font-bold text-white" : "font-medium text-slate-300"}`}>Precip + MSLP</span>
                                {activeParam === "precip_mslp" && <span className="block text-[10px] text-cyan-300 font-mono mt-0.5">6h Rate + Thickness</span>}
                            </div>
                        </div>
                    </button>

                    <button className={btnClass("clouds") + " opacity-50 cursor-not-allowed"}>
                        <div className="flex items-center gap-3 pl-2">
                            <div className="w-3 h-3 rounded-full bg-slate-400 flex-shrink-0"></div>
                            <span className="text-sm font-medium text-slate-300">Cloud Cover</span>
                        </div>
                    </button>
                </div>
            </div>

            <div className="p-4 bg-slate-800/50">
                <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse"></span>
                    Active Source Data
                </h2>
                <div className="mb-4">
                    <label className="block text-xs text-slate-500 mb-2 font-mono">Select Forecast Model</label>
                    <div className="grid grid-cols-2 gap-2">
                        <button 
                            onClick={() => {
                                setActiveModel("aifs");
                                if (activeParam === "rainfall") setActiveParam("wind"); // Fallback if param doesn't support AIFS
                            }}
                            className={`px-3 py-2 text-xs font-bold font-mono rounded border transition ${activeModel === "aifs" ? "bg-cyan-600 text-white border-cyan-500 hover:bg-cyan-500" : "bg-slate-900 text-slate-400 border-slate-700 hover:border-slate-500 hover:text-white"}`}
                        >
                            ECMWF AIFS
                        </button>
                        <button 
                            onClick={() => {
                                setActiveModel("gfs");
                                if (activeParam === "wind") setActiveParam("rainfall"); // Fallback
                            }}
                            className={`px-3 py-2 text-xs font-bold font-mono rounded border transition ${activeModel === "gfs" ? "bg-cyan-600 text-white border-cyan-500 hover:bg-cyan-500" : "bg-slate-900 text-slate-400 border-slate-700 hover:border-slate-500 hover:text-white"}`}
                        >
                            GFS 0.25°
                        </button>
                        <button className="px-3 py-2 text-xs font-medium font-mono rounded bg-slate-900 text-slate-400 border border-slate-700 opacity-50 cursor-not-allowed">
                            ICON Global
                        </button>
                        <button className="px-3 py-2 text-xs font-medium font-mono rounded bg-slate-900 text-slate-400 border border-slate-700 opacity-50 cursor-not-allowed">
                            HRRR
                        </button>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-2 font-mono text-right">
                        Run: {metadata?.run_time || "12Z"} | Res: {activeParam === "rainfall" ? "27km" : "9km"}
                    </p>
                </div>
            </div>
        </div>
    );

    return (
        <div className="bg-slate-900 text-slate-200 font-sans flex overflow-hidden selection:bg-cyan-500 selection:text-white" style={{ height: "calc(100vh - 64px)" }}>

            {/* ── Mobile Overlay ── */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/60 z-30 lg:hidden"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* ── Sidebar: hidden on mobile, slides in as drawer ── */}
            <aside className={`
                fixed lg:relative top-0 left-0 h-full z-40
                w-72 lg:w-80
                bg-slate-800 border-r border-slate-700
                flex flex-col shadow-2xl flex-shrink-0
                transition-transform duration-300 ease-in-out
                ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
            `} style={{ marginTop: sidebarOpen ? "0" : undefined }}>

                {/* Mobile close button */}
                <div className="flex items-center justify-between p-4 border-b border-slate-700 lg:hidden">
                    <span className="text-sm font-bold text-white">Controls</span>
                    <button onClick={() => setSidebarOpen(false)} className="p-1.5 rounded-lg bg-slate-700 text-slate-300 hover:text-white cursor-pointer">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <SidebarContent />
            </aside>

            {/* ── Main Visualizer Area ── */}
            <main className="flex-1 relative bg-slate-800 flex flex-col z-10 overflow-hidden">

                {/* Mobile top bar with open-sidebar button + parameter label */}
                <div className="flex lg:hidden items-center gap-3 px-3 py-2 bg-slate-900/90 border-b border-slate-700 z-20">
                    <button
                        onClick={() => setSidebarOpen(true)}
                        className="p-2 rounded-lg bg-slate-700 text-slate-300 hover:text-white cursor-pointer flex-shrink-0"
                    >
                        <SlidersHorizontal className="w-4 h-4" />
                    </button>
                    <span className="text-xs font-semibold text-slate-300 truncate">
                        {activeParam === "rainfall"
                            ? `Precipitation · ${rainfallView === "daily" ? "Daily Animation" : rainfallView === "24h" ? "1-Day Total" : rainfallView === "3d" ? "3-Day Total" : "7-Day Total"}`
                            : activeParam === "precip_mslp"
                                ? `6h Precip Rate + MSLP + Thickness · ${activeModel === "aifs" ? "ECMWF AIFS" : "GFS"}`
                                : "Wind & MSLP · ECMWF AIFS"}
                    </span>
                </div>

                {/* Visualizer: fills to the bottom bar, starts below the mobile top bar on small screens */}
                <div className="absolute inset-0 top-[44px] lg:top-0 bottom-16 lg:bottom-20 z-0 bg-slate-950 flex items-center justify-center overflow-hidden">

                    {imagePath ? (
                        <img
                            key={`${imagePath}-${imageTimestamp}`}
                            src={`${imagePath}?t=${imageTimestamp}`}
                            alt="Forecast Map"
                            className="w-full h-full object-contain pointer-events-none transition-opacity duration-300"
                            style={{ opacity: 0.95 }}
                            onError={(e) => { e.target.style.display = "none"; }}
                        />
                    ) : (
                        <div className="flex flex-col items-center justify-center gap-3 text-slate-600">
                            <div className="w-16 h-16 rounded-full border-2 border-slate-700 flex items-center justify-center">
                                <SlidersHorizontal className="w-6 h-6" />
                            </div>
                            <span className="text-xs">Select a parameter to view forecast</span>
                        </div>
                    )}

                    <div className="absolute inset-0 opacity-10 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCI+PHBhdGggZD0iTTAgMjBRMjAgMTAgNDAgMjAiIHN0cm9rZT0iIzZlN2I4YiIgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMC41Ii8+PC9zdmc+')] pointer-events-none"></div>
                </div>

                {/* ── Bottom Animation Controller ── */}
                <div className="absolute bottom-0 left-0 right-0 h-16 lg:h-20 bg-slate-900/95 backdrop-blur border-t border-slate-700 z-30 px-3 lg:px-6 flex items-center gap-2 lg:gap-6 shadow-[0_-10px_30px_rgba(0,0,0,0.5)]">

                    {/* Play Button */}
                    <button
                        onClick={togglePlay}
                        disabled={isStaticRainfall}
                        className={`w-10 h-10 lg:w-12 lg:h-12 rounded-full flex-shrink-0 flex items-center justify-center text-white shadow-[0_0_15px_rgba(6,182,212,0.4)] transition-transform hover:scale-105 cursor-pointer ${
                            isStaticRainfall ? "bg-slate-700 opacity-40 cursor-not-allowed" : "bg-cyan-600 hover:bg-cyan-500"
                        }`}
                    >
                        {isPlaying ? <Pause className="h-4 w-4 lg:h-5 lg:w-5" /> : <Play className="h-4 w-4 lg:h-5 lg:w-5 ml-0.5" />}
                    </button>

                    {/* Day/Time Badge — hidden on very small screens */}
                    <div className="hidden sm:block text-center min-w-[100px] lg:min-w-[140px] bg-slate-800 rounded p-1.5 lg:p-2 border border-slate-700 flex-shrink-0">
                        <div className="text-xs lg:text-sm font-bold text-white uppercase">
                            {metadata?.generated_at
                                ? new Date(metadata.generated_at).toLocaleDateString("en-US", { weekday: "long" })
                                : "Loading"}
                        </div>
                        <div className="text-[9px] lg:text-[10px] text-cyan-400 font-mono uppercase tracking-wider">
                            T {activeParam === "wind" ? `+${stepHours}h` : activeParam === "precip_mslp" ? `+${stepHours}h` : `day ${dayNum}`}
                        </div>
                    </div>

                    {/* Timeline Slider */}
                    <div className="flex-1 relative flex items-center group">
                        <div className="absolute w-full flex justify-between px-1 -top-4 text-[9px] lg:text-[10px] text-slate-500 font-mono">
                            <span>Init</span>
                            <span className="hidden sm:inline">Day {Math.floor((activeParam === "precip_mslp" ? (activeModel === "aifs" ? 15 : 16) : (activeParam === "wind" ? 15 : 7)) * 0.25)}</span>
                            <span className="hidden sm:inline">Day {Math.floor((activeParam === "precip_mslp" ? (activeModel === "aifs" ? 15 : 16) : (activeParam === "wind" ? 15 : 7)) * 0.5)}</span>
                            <span className="hidden sm:inline">Day {Math.floor((activeParam === "precip_mslp" ? (activeModel === "aifs" ? 15 : 16) : (activeParam === "wind" ? 15 : 7)) * 0.75)}</span>
                            <span>Day {(activeParam === "precip_mslp" ? (activeModel === "aifs" ? 15 : 16) : (activeParam === "wind" ? 15 : 7))}</span>
                        </div>
                        <input
                            type="range"
                            min="0"
                            max={Math.max(0, frames.length - 1)}
                            value={frameIndex}
                            disabled={isStaticRainfall}
                            onChange={(e) => {
                                setFrameIndex(parseInt(e.target.value));
                                setIsPlaying(false);
                            }}
                            className={`w-full h-2 lg:h-2.5 rounded-lg appearance-none focus:outline-none accent-cyan-500 transition-colors ${
                                isStaticRainfall
                                    ? "bg-slate-800 opacity-30 cursor-not-allowed"
                                    : "bg-slate-700 cursor-pointer group-hover:bg-slate-600"
                            }`}
                        />
                    </div>
                </div>
            </main>
        </div>
    );
};

export default ForecastModels;
