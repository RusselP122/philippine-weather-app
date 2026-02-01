import React, { useState, useEffect } from "react";
import { Wind, Info, AlertTriangle, Play, Pause, Download } from "lucide-react";

const MODAL_NAME = "ECMWF AIFS (Wind)";

const WindPage = () => {
    // Animation State
    const [isPlaying, setIsPlaying] = useState(false);
    const [frameIndex, setFrameIndex] = useState(0);
    const [fps, setFps] = useState(4); // Default 4 FPS
    const [metadata, setMetadata] = useState(null);
    const [imageTimestamp, setImageTimestamp] = useState(Date.now());
    const [isZoomed, setIsZoomed] = useState(false);

    // Determines Frames from Metadata or Fallback (0 to 168 step 6)
    const frames = metadata?.animation_frames || Array.from({ length: 29 }, (_, i) => `aifs_wind_${String(i * 6).padStart(3, '0')} `);

    // Helpers
    const currentFrameName = frames[frameIndex] || "aifs_wind_000";
    const imagePath = `/ images / wind / ${currentFrameName}.png`;

    // Calculate Time Label (Step Hours)
    // Extract number from "aifs_wind_006" -> 6
    const stepHours = parseInt(currentFrameName.split('_').pop(), 10) || 0;
    const dayNum = Math.floor(stepHours / 24) + 1;
    const hourMod = stepHours % 24;

    useEffect(() => {
        // Fetch Metadata
        fetch('/data/wind_meta.json')
            .then(res => res.json())
            .then(data => {
                setMetadata(data);
                // Preload Images
                if (data.animation_frames) {
                    data.animation_frames.forEach(frame => {
                        const img = new Image();
                        img.src = `/ images / wind / ${frame}.png ? t = ${imageTimestamp} `;
                    });
                }
            })
            .catch(err => console.error("Failed to load metadata", err));
    }, [imageTimestamp]);

    // Animation Loop
    useEffect(() => {
        let interval;
        if (isPlaying && frames.length > 0) {
            interval = setInterval(() => {
                setFrameIndex(prev => (prev + 1) % frames.length);
            }, 1000 / fps);
        }
        return () => clearInterval(interval);
    }, [isPlaying, frames, fps]);

    const togglePlay = () => setIsPlaying(!isPlaying);

    return (
        <section className="min-h-screen bg-slate-950 text-slate-50 pt-6 pb-12">
            <div className="max-w-6xl mx-auto px-4">

                {/* Header */}
                <header className="mb-8 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/20 text-cyan-400">
                                <Wind className="h-6 w-6" />
                            </span>
                            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
                                10m Wind & Pressure Forecast
                            </h1>
                        </div>
                        <p className="text-slate-400 text-sm md:text-base max-w-2xl">
                            Forecasts from the ECMWF AIFS (AI Data-Driven) Model.
                        </p>
                        <div className="mt-2 text-xs text-slate-500 bg-slate-900/50 p-2 rounded-lg border border-slate-800 max-w-xl flex gap-2 items-start">
                            <Info className="h-4 w-4 mt-0.5 text-cyan-500" />
                            <div>
                                <b>Visualization:</b> Wind Speed (Color Fill), Wind Streamlines (Black Arrows), and MSLP Isobars (Black Lines).
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col gap-3">
                        {/* Animation Controls */}
                        <div className="flex flex-col md:flex-row items-center gap-3 bg-slate-900 border border-slate-700 rounded-xl p-2 pr-4 shadow-lg">
                            <button
                                onClick={togglePlay}
                                className="flex items-center justify-center h-10 w-12 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition-colors"
                            >
                                {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-1" />}
                            </button>

                            <div className="flex flex-col gap-1">
                                <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">
                                    Forecast Time: +{stepHours}h
                                </span>
                                <input
                                    type="range"
                                    min="0"
                                    max={frames.length - 1}
                                    value={frameIndex}
                                    onChange={(e) => {
                                        setFrameIndex(parseInt(e.target.value));
                                        setIsPlaying(false);
                                    }}
                                    className="w-32 md:w-48 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                                />
                            </div>

                            {/* Speed Control */}
                            <div className="flex items-center gap-2 border-l border-slate-700 pl-3 ml-1">
                                <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">SPEED</span>
                                <div className="flex gap-1">
                                    {[2, 4, 8].map(s => (
                                        <button
                                            key={s}
                                            onClick={() => setFps(s)}
                                            className={`px - 2 py - 1 text - xs font - bold rounded ${fps === s ? 'bg-slate-700 text-white' : 'bg-transparent text-slate-500 hover:text-slate-300'} `}
                                        >
                                            {s === 2 ? '1x' : (s === 4 ? '2x' : '4x')}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Download GIF */}
                            <a
                                href="/images/wind/wind_forecast.gif"
                                download="Wind_Forecast_Animation.gif"
                                className="flex items-center justify-center h-8 w-8 ml-1 bg-slate-800 hover:bg-slate-700 text-cyan-400 rounded-lg transition-colors border border-slate-700"
                                title="Download Animation (GIF)"
                            >
                                <Download className="h-4 w-4" />
                            </a>

                            <div className="ml-2 text-right hidden md:block">
                                <div className="text-xs font-mono text-slate-400">DAY</div>
                                <div className="text-lg font-bold leading-none text-slate-200">{dayNum}</div>
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
                            {`T + ${stepHours}h WIND FORECAST`}
                        </h3>
                    </div>

                    <div className="absolute bottom-4 right-4 z-10 pointer-events-none text-right">
                        <div className="bg-white/90 backdrop-blur px-3 py-2 rounded-md shadow-sm border border-slate-200 text-slate-900 text-xs font-mono">
                            <div className="font-bold">ECMWF AIFS</div>
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
                        key={`${imagePath} -${imageTimestamp} `}
                        src={`${imagePath}?t = ${imageTimestamp} `}
                        alt={`Wind Forecast T + ${stepHours} h`}
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
                                src={`${imagePath}?t = ${imageTimestamp} `}
                                alt={`Wind Forecast T + ${stepHours} h(Zoomed)`}
                                className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
                            />
                            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur px-4 py-2 rounded-full text-white text-sm">
                                {`T + ${stepHours}h Forecast`}
                            </div>
                        </div>
                    </div>
                )}

            </div>
        </section>
    );
};

export default WindPage;
