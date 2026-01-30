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

// ... (imports remain)
const MODELS = [
    { id: "gfs_seamless", name: "GFS Seamless (Direct)", color: "#22c55e" },
];

const PERIODS = [
    { id: "24h", label: "24 Hours" },
    { id: "3d", label: "3 Days" },
    { id: "7d", label: "7 Days" },
];

const Rainfall = () => {
    const [selectedModel, setSelectedModel] = useState(MODELS[0].id);
    const [timePeriod, setTimePeriod] = useState("24h");
    const [imageTimestamp, setImageTimestamp] = useState(Date.now());
    const [metadata, setMetadata] = useState(null);
    const [isZoomed, setIsZoomed] = useState(false);

    // Image Path: e.g., /images/rainfall/gfs_24h.png
    // Note: The script outputs gfs_24h.png, gfs_3d.png, gfs_7d.png
    // Let's ensure consistency with Python script: "gfs_{period_name}"
    const imagePath = `/images/rainfall/${selectedModel.split('_')[0]}_${timePeriod}.png`;

    useEffect(() => {
        // Fetch Metadata
        fetch('/data/rainfall_meta.json')
            .then(res => res.json())
            .then(data => setMetadata(data))
            .catch(err => console.error("Failed to load metadata", err));
    }, [imageTimestamp]); // Reload meta on refresh too

    const handleRefresh = () => {
        setImageTimestamp(Date.now());
    };

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
                    </div>

                    <div className="flex flex-col gap-3">
                        {/* Controls */}
                        <div className="flex flex-wrap items-center gap-4">
                            {/* Period Selector */}
                            <div className="bg-slate-900 p-1 rounded-lg border border-slate-700 flex">
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

                            <div className="flex gap-2">
                                <button
                                    onClick={handleRefresh}
                                    className="p-2 bg-slate-800 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                                    title="Refresh Image"
                                >
                                    <RefreshCw className="h-4 w-4" />
                                </button>
                            </div>
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
                            {timePeriod.toUpperCase()} RAINFALL FORECAST
                        </h3>
                    </div>

                    <div className="absolute bottom-4 right-4 z-10 pointer-events-none text-right">
                        <div className="bg-white/90 backdrop-blur px-3 py-2 rounded-md shadow-sm border border-slate-200 text-slate-900 text-xs font-mono">
                            <div className="font-bold">NOAA GFS | THREDDS</div>
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
                            The <b>{PERIODS.find(p => p.id === timePeriod)?.label}</b> forecast map has not been generated yet.
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
                                {timePeriod.toUpperCase()} Forecast
                            </div>
                        </div>
                    </div>
                )}

            </div>
        </section>
    );
};

export default Rainfall;
