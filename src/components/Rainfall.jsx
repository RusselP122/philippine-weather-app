import React, { useState, useEffect } from "react";
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from "recharts";
import { CloudRain, Calendar, Info, RefreshCw, AlertTriangle } from "lucide-react";

// --- Constants ---

const MODELS = [
    { id: "gfs_seamless", name: "GFS Seamless (Direct)", color: "#22c55e" },
];

const PERIODS = [
    { id: "24h", label: "24 Hours" },
    { id: "3d", label: "3 Days" },
    { id: "7d", label: "7 Days" },
    { id: "animation", label: "Animation" },
];

const Rainfall = () => {
    const [selectedModel, setSelectedModel] = useState(MODELS[0].id);
    const [timePeriod, setTimePeriod] = useState("24h");
    const [imageTimestamp, setImageTimestamp] = useState(Date.now());
    const [metadata, setMetadata] = useState(null);
    const [isZoomed, setIsZoomed] = useState(false);

    // Animation State
    const [isPlaying, setIsPlaying] = useState(false);
    const [frameIndex, setFrameIndex] = useState(0);
    const [fps, setFps] = useState(2); // Default 2 FPS for Rainfall (7 frames only)

    // Determine current image path
    let imagePath = "";
    if (timePeriod === "animation" && metadata?.animation_frames?.length > 0) {
        // Use frame index
        const frameName = metadata.animation_frames[frameIndex]; // e.g. "gfs_day_1"
        imagePath = `/images/rainfall/${frameName}.png`;
    } else {
        // Static
        imagePath = `/images/rainfall/${selectedModel.split('_')[0]}_${timePeriod !== 'animation' ? timePeriod : '24h'}.png`;
    }

    useEffect(() => {
        // Fetch Metadata
        fetch('/data/rainfall_meta.json')
            .then(res => res.json())
            .then(data => {
                setMetadata(data);
                // Preload Animation Images
                if (data.animation_frames) {
                    data.animation_frames.forEach(frame => {
                        const img = new Image();
                        img.src = `/images/rainfall/${frame}.png?t=${imageTimestamp}`;
                    });
                }
            })
            .catch(err => console.error("Failed to load metadata", err));
    }, [imageTimestamp]);

    // Animation Loop
    useEffect(() => {
        let interval;
        if (isPlaying && timePeriod === "animation" && metadata?.animation_frames) {
            interval = setInterval(() => {
                setFrameIndex(prev => (prev + 1) % metadata.animation_frames.length);
            }, 1000 / fps);
        } else {
            // Reset if switched away?
            // Optional: setIsPlaying(false) if period changes?
        }
        return () => clearInterval(interval);
    }, [isPlaying, timePeriod, metadata]);

    // Reset frame on period change
    useEffect(() => {
        if (timePeriod === "animation") {
            setIsPlaying(true);
            setFrameIndex(0);
        } else {
            setIsPlaying(false);
        }
    }, [timePeriod]);



    const togglePlay = () => setIsPlaying(!isPlaying);

    return (
        <section className="min-h-screen bg-slate-950 text-slate-50 pt-6 pb-12">
            <div className="max-w-6xl mx-auto px-4">

                {/* Header */}
                <header className="mb-8 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/20 text-blue-400">
                                <CloudRain className="h-6 w-6" />
                            </span>
                            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
                                Accumulated Rainfall Forecast
                            </h1>
                        </div>
                        <p className="text-slate-400 text-sm md:text-base max-w-2xl">
                            Accumulated precipitation forecasts from the NOAA GFS model.
                        </p>
                        <div className="mt-2 text-xs text-slate-500 bg-slate-900/50 p-2 rounded-lg border border-slate-800 max-w-xl">
                            <span className="font-semibold text-slate-400">Note:</span>
                            <ul className="list-disc list-inside mt-1 space-y-0.5">
                                <li><b>24h / 3d / 7d:</b> Total rain accumulated from now until the end of the period.</li>
                                <li><b>Animation:</b> Rain accumulated specifically during each 24-hour day (Daily Increments).</li>
                            </ul>
                        </div>
                    </div>

                    <div className="flex flex-col gap-3">
                        {/* Controls */}
                        <div className="flex flex-wrap items-center gap-4">
                            {/* Period Selector */}
                            <div className="bg-slate-900 p-1 rounded-lg border border-slate-700 flex flex-wrap">
                                {PERIODS.map(p => (
                                    <button
                                        key={p.id}
                                        onClick={() => setTimePeriod(p.id)}
                                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${timePeriod === p.id
                                            ? "bg-blue-600 text-white shadow-sm"
                                            : "text-slate-400 hover:text-slate-200"
                                            }`}
                                    >
                                        {p.label}
                                    </button>
                                ))}
                            </div>

                            {/* Animation Controls (Only visible in animation mode) */}
                            {timePeriod === "animation" && (
                                <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-lg p-1 pr-3">
                                    <button
                                        onClick={togglePlay}
                                        className="p-1 px-3 bg-slate-800 hover:bg-slate-700 rounded text-xs font-bold w-16 text-center transition-colors"
                                    >
                                        {isPlaying ? "PAUSE" : "PLAY"}
                                    </button>

                                    {/* Slider */}
                                    <input
                                        type="range"
                                        min="0"
                                        max={(metadata?.animation_frames?.length || 7) - 1}
                                        value={frameIndex}
                                        onChange={(e) => {
                                            setFrameIndex(parseInt(e.target.value));
                                            setIsPlaying(false); // Pause on scrub
                                        }}
                                        className="w-24 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                                    />

                                    {/* Speed Control */}
                                    {/* Use local logic for Rainfall specific state if not already there */}
                                    <div className="flex items-center gap-1 border-l border-slate-700 pl-2 ml-1">
                                        <span className="text-[9px] text-slate-500 uppercase font-bold tracking-wider hidden sm:block">SPEED</span>
                                        <div className="flex gap-0.5">
                                            {[2, 4, 8].map(s => (
                                                <button
                                                    key={s}
                                                    onClick={() => setFps(s)}
                                                    className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${fps === s ? 'bg-slate-700 text-white' : 'bg-transparent text-slate-500 hover:text-slate-300'}`}
                                                >
                                                    {s === 2 ? '1x' : (s === 4 ? '2x' : '4x')}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="text-xs text-slate-400 px-2 min-w-[60px] text-center font-mono">
                                        Day {frameIndex + 1}/7
                                    </div>
                                </div>
                            )}


                        </div>
                    </div>
                </header>

                {/* Map Image Viewer */}
                <div
                    className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden mb-8 shadow-xl relative min-h-[600px] flex items-center justify-center group cursor-pointer"
                    onClick={() => setIsZoomed(true)}
                >

                    {/* Dynamic Text Overlays */}
                    <div className="absolute top-4 left-4 z-10 pointer-events-none">
                        <h3 className="text-xl font-bold text-slate-900 bg-white/90 backdrop-blur px-3 py-1 rounded-md shadow-sm border border-slate-200">
                            {timePeriod === 'animation'
                                ? `DAY ${frameIndex + 1} FORECAST`
                                : `${timePeriod.toUpperCase()} RAINFALL FORECAST`
                            }
                        </h3>
                    </div>

                    <div className="absolute bottom-4 right-4 z-10 pointer-events-none text-right">
                        <div className="bg-white/90 backdrop-blur px-3 py-2 rounded-md shadow-sm border border-slate-200 text-slate-900 text-xs font-mono">
                            <div className="font-bold">GFS</div>
                            <div>Gen: {metadata?.generated_at || "Loading..."}</div>
                            {metadata?.run_time && <div>Run: {metadata.run_time}</div>}
                        </div>
                    </div>

                    {/* Hint Overlay */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center z-20 pointer-events-none">
                        <span className="opacity-0 group-hover:opacity-100 bg-black/60 text-white text-xs px-3 py-1.5 rounded-full backdrop-blur-sm transition-opacity">
                            Click to Enlarge
                        </span>
                    </div>

                    {/* Main Map Image */}
                    <img
                        key={`${imagePath}-${imageTimestamp}`}
                        src={`${imagePath}?t=${imageTimestamp}`}
                        alt={`Rainfall Forecast - ${timePeriod}`}
                        className="w-full h-auto object-contain max-h-[800px]"
                        onError={(e) => {
                            e.target.onerror = null;
                            e.target.style.display = 'none';
                            e.target.parentElement.classList.add('image-error');
                        }}
                    />

                    {/* Error Fallback */}
                    <div className="hidden image-error:flex absolute inset-0 flex-col items-center justify-center text-slate-400 p-6 text-center z-0">
                        <AlertTriangle className="h-12 w-12 text-yellow-500 mb-4" />
                        <h3 className="text-lg font-semibold text-slate-200">Map Not Available</h3>
                        <p className="text-sm max-w-md mt-2">
                            The data for this forecast is currently processing or unavailable.
                        </p>
                    </div>
                </div>

                {/* ZOOM MODAL */}
                {isZoomed && (
                    <div
                        className="fixed inset-0 z-[9999] bg-black/90 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200"
                        onClick={() => setIsZoomed(false)}
                    >
                        {/* Close Button */}
                        <button
                            className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors z-[10000]"
                            onClick={() => setIsZoomed(false)}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>

                        <div className="relative max-w-7xl w-full max-h-screen flex items-center justify-center" onClick={e => e.stopPropagation()}>
                            <img
                                src={`${imagePath}?t=${imageTimestamp}`}
                                alt={`Rainfall Forecast - ${timePeriod} (Zoomed)`}
                                className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
                            />
                            {/* Overlay Info in Modal too? Optional, keeps context */}
                            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur px-4 py-2 rounded-full text-white text-sm">
                                {timePeriod === 'animation'
                                    ? `DAY ${frameIndex + 1} FORECAST`
                                    : `${timePeriod.toUpperCase()} Forecast`
                                }
                            </div>
                        </div>
                    </div>
                )}

            </div>
        </section>
    );
};

export default Rainfall;
