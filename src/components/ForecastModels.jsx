import React, { useState, useEffect } from "react";
import { Play, Pause, X, SlidersHorizontal, Video } from "lucide-react";
import GIF from "gif.js";
import gifWorkerUrl from "gif.js/dist/gif.worker.js?url";

const ForecastModels = () => {
    const [activeParam, setActiveParam] = useState("rainfall");
    const [activeModel, setActiveModel] = useState("gfs"); // "gfs" | "aifs"
    const [rainfallView, setRainfallView] = useState("daily"); // 'daily' | '24h' | '3d' | '7d'
    const [thunderstormRegion, setThunderstormRegion] = useState("ph");
    const [metadata, setMetadata] = useState(null);
    const [frameIndex, setFrameIndex] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [imageTimestamp] = useState(Date.now());
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [expandedGroup, setExpandedGroup] = useState("gfs"); // 'gfs' | 'ecmwf' | null
    const [showGifModal, setShowGifModal] = useState(false);
    const [gifStartIdx, setGifStartIdx] = useState(0);
    const [gifEndIdx, setGifEndIdx] = useState(0);
    const [isExporting, setIsExporting] = useState(false);
    const [exportProgress, setExportProgress] = useState(0);
    const [gifFps, setGifFps] = useState(2);
    const [loadedImage, setLoadedImage] = useState("");

    useEffect(() => {
        let url = "";
        if (activeParam === "rainfall") {
            if (activeModel === "weathernext") url = "/data/rainfall_weathernext_meta.json";
            else if (activeModel === "aigfs") url = "/data/rainfall_aigfs_meta.json";
            else url = "/data/rainfall_meta.json";
        }
        else if (activeParam === "wind") {
            if (activeModel === "weathernext") url = "/data/wind_weathernext_meta.json";
            else url = "/data/wind_meta.json";
        }
        else if (activeParam === "wind_gfs") url = "/data/wind_gfs_meta.json";
        else if (activeParam === "wind_aigfs" || activeParam === "wind_hgefs") url = "/data/wind_aigfs_meta.json";
        else if (activeParam === "thunderstorm") url = "/data/thunderstorm_ifs_meta.json";
        else if (activeParam === "precip_mslp") {
            if (activeModel === "aifs") url = "/data/precip_mslp_aifs_meta.json";
            else if (activeModel === "weathernext") url = "/data/precip_mslp_weathernext_meta.json";
            else if (activeModel === "aigfs") url = "/data/precip_mslp_aigfs_meta.json";
            else url = "/data/precip_mslp_meta.json";
        }

        if (!url) return;
        fetch(url)
            .then(res => res.json())
            .then(data => {
                setMetadata(data);
                if (data.animation_frames) {
                    let framesList = data.animation_frames || [];
                    if (activeParam === "thunderstorm") {
                        framesList = data.animation_frames[thunderstormRegion] || [];
                    }
                    framesList.forEach(frame => {
                        const img = new Image();
                        let folder = "rainfall";
                        if (activeParam === "rainfall") {
                            folder = activeModel === "weathernext" ? "rainfall_weathernext" : activeModel === "aigfs" ? "rainfall_aigfs" : "rainfall";
                        }
                        else if (activeParam === "wind") {
                            folder = activeModel === "weathernext" ? "wind_weathernext" : "wind";
                        }
                        else if (activeParam === "wind_gfs") folder = "wind_gfs";
                        else if (activeParam === "wind_aigfs" || activeParam === "wind_hgefs") folder = "wind_aigfs";
                        else if (activeParam === "thunderstorm") folder = "thunderstorm_ifs";
                        else if (activeParam === "precip_mslp") {
                            if (activeModel === "aifs") folder = "precip_mslp_aifs";
                            else if (activeModel === "weathernext") folder = "precip_mslp_weathernext";
                            else if (activeModel === "aigfs") folder = "precip_mslp_aigfs";
                            else folder = "precip_mslp";
                        }
                        img.src = `/images/${folder}/${frame}.png?t=${imageTimestamp}`;
                    });
                }
            })
            .catch(err => console.error("Failed to load metadata", err));
        setFrameIndex(0);
        setIsPlaying(false);
    }, [activeParam, activeModel, imageTimestamp, thunderstormRegion]);

    const frames = activeParam === "thunderstorm"
        ? (metadata?.animation_frames?.[thunderstormRegion] || [])
        : (metadata?.animation_frames || []);
    const currentFrameName = frames[frameIndex] || "";

    const isStaticRainfall = activeParam === "rainfall" && rainfallView !== "daily";
    const isStaticPrecip = activeParam === "thunderstorm";
    const isTimelineDisabled = isStaticRainfall || isStaticPrecip;

    let imagePath = "";
    if (isStaticRainfall) {
        let folder = activeModel === "weathernext" ? "rainfall_weathernext" : activeModel === "aigfs" ? "rainfall_aigfs" : "rainfall";
        let prefix = activeModel === "weathernext" ? "weathernext" : activeModel === "aigfs" ? "aigfs" : "gfs";
        imagePath = `/images/${folder}/${prefix}_${rainfallView}.png`;
    } else if (activeParam === "rainfall" && currentFrameName) {
        let folder = activeModel === "weathernext" ? "rainfall_weathernext" : activeModel === "aigfs" ? "rainfall_aigfs" : "rainfall";
        imagePath = `/images/${folder}/${currentFrameName}.png`;
    } else if (activeParam === "wind" && currentFrameName) {
        let folder = activeModel === "weathernext" ? "wind_weathernext" : "wind";
        imagePath = `/images/${folder}/${currentFrameName}.png`;
    } else if (activeParam === "wind_gfs" && currentFrameName) {
        imagePath = `/images/wind_gfs/${currentFrameName}.png`;
    } else if ((activeParam === "wind_aigfs" || activeParam === "wind_hgefs") && currentFrameName) {
        imagePath = `/images/wind_aigfs/${currentFrameName}.png`;
    } else if (activeParam === "thunderstorm" && currentFrameName) {
        imagePath = `/images/thunderstorm_ifs/${currentFrameName}.png`;
    } else if (activeParam === "precip_mslp" && currentFrameName) {
        let folder = "precip_mslp";
        if (activeModel === "aifs") folder = "precip_mslp_aifs";
        else if (activeModel === "weathernext") folder = "precip_mslp_weathernext";
        else if (activeModel === "aigfs") folder = "precip_mslp_aigfs";
        imagePath = `/images/${folder}/${currentFrameName}.png`;
    }

    useEffect(() => {
        if (!imagePath) return;
        let isCancelled = false;
        const src = `${imagePath}?t=${imageTimestamp}`;
        const img = new Image();
        img.onload = () => {
            if (!isCancelled) setLoadedImage(src);
        };
        img.src = src;
        return () => { isCancelled = true; };
    }, [imagePath, imageTimestamp]);

    let stepHours = 0;
    let dayNum = 1;
    if ((activeParam === "wind" || activeParam === "wind_gfs" || activeParam === "wind_aigfs" || activeParam === "wind_hgefs" || activeParam === "precip_mslp" || activeParam === "thunderstorm") && currentFrameName) {
        stepHours = parseInt(currentFrameName.split('_').pop(), 10) || 0;
        dayNum = Math.floor(stepHours / 24) + 1;
    } else if (activeParam === "rainfall" && currentFrameName) {
        const parts = currentFrameName.split('_');
        dayNum = parseInt(parts[2], 10) || 1;
        stepHours = Math.min(dayNum * 24, activeModel === "weathernext" ? 360 : 168);
    }
    const maxDays =
        activeParam === "thunderstorm" ? 1 :
            activeParam === "wind_gfs" ? 16 :
                (activeParam === "wind_aigfs" || activeParam === "wind_hgefs") ? 16 :
                    activeParam === "wind" ? 15 :
                        activeParam === "precip_mslp" ? (activeModel === "weathernext" ? 15 : activeModel === "aifs" ? 15 : activeModel === "aigfs" ? 16 : 16) :
                            activeParam === "rainfall" ? (activeModel === "weathernext" ? 15 : activeModel === "aigfs" ? 16 : 7) : 7;

    useEffect(() => {
        let interval;
        if (isPlaying && frames.length > 0 && !isTimelineDisabled) {
            const fps = (activeParam === "wind" || activeParam === "wind_gfs" || activeParam === "wind_aigfs" || activeParam === "wind_hgefs") ? 5 : 2;
            interval = setInterval(() => {
                setFrameIndex(prev => (prev + 1) % frames.length);
            }, 1000 / fps);
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

    const SidebarContent = () => {
        const gfsOpen = expandedGroup === "gfs";
        const ecmwfOpen = expandedGroup === "ecmwf";
        const weathernextOpen = expandedGroup === "weathernext";

        const itemClass = (isActive) =>
            `w-full flex items-center gap-2 px-6 py-2 text-xs rounded-r-md transition-all cursor-pointer text-left ${isActive
                ? "text-white bg-slate-700 font-semibold"
                : "text-slate-400 hover:text-white hover:bg-slate-800"
            }`;

        return (
            <div className="flex-1 overflow-y-auto">
                <div className="p-3 space-y-5">

                    {/* ══ Global Models ══ */}
                    <div>
                        <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 px-1">
                            🌐 Global Models
                        </h2>
                        <div className="border-t border-slate-700 pt-2">
                            <button
                                onClick={() => setExpandedGroup(gfsOpen ? null : "gfs")}
                                className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-semibold text-slate-200 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                            >
                                <div className="flex items-center gap-2">
                                    <svg className="w-4 h-4 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064" />
                                    </svg>
                                    <span>GFS</span>
                                </div>
                                <svg className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${gfsOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>

                            {gfsOpen && (
                                <div className="mt-1 ml-4 border-l border-slate-700 space-y-0.5 pb-1">
                                    <button onClick={() => { setActiveParam("rainfall"); setActiveModel("gfs"); setRainfallView("daily"); setSidebarOpen(false); }} className={itemClass(activeParam === "rainfall")}>
                                        🌧️ Precipitation
                                    </button>
                                    {activeParam === "rainfall" && (
                                        <div className="ml-6 grid grid-cols-4 gap-1 py-1 pr-2">
                                            {[{ id: "daily", label: "Daily" }, { id: "24h", label: "1-Day" }, { id: "3d", label: "3-Day" }, { id: "7d", label: "7-Day" }].map(v => (
                                                <button key={v.id} onClick={() => { setRainfallView(v.id); setIsPlaying(false); }}
                                                    className={`text-[9px] font-bold py-1 rounded cursor-pointer transition border ${rainfallView === v.id ? "bg-cyan-600 text-white border-cyan-500" : "bg-slate-900 text-slate-500 border-slate-700 hover:text-white"}`}
                                                >{v.label}</button>
                                            ))}
                                        </div>
                                    )}
                                    <button onClick={() => { setActiveParam("wind_gfs"); setActiveModel("gfs"); setSidebarOpen(false); }} className={itemClass(activeParam === "wind_gfs")}>
                                        💨 Wind &amp; MSLP
                                    </button>
                                    <button onClick={() => { setActiveParam("precip_mslp"); setActiveModel("gfs"); setSidebarOpen(false); }} className={itemClass(activeParam === "precip_mslp" && activeModel === "gfs")}>
                                        🌀 6h Precip + MSLP
                                    </button>
                                </div>
                            )}



                            <button
                                onClick={() => setExpandedGroup(expandedGroup === "ifs" ? null : "ifs")}
                                className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-semibold text-slate-200 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer mt-1"
                            >
                                <div className="flex items-center gap-2">
                                    <svg className="w-4 h-4 text-blue-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064" />
                                    </svg>
                                    <span>ECMWF IFS v2</span>
                                </div>
                                <svg className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${expandedGroup === "ifs" ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>

                            {expandedGroup === "ifs" && (
                                <div className="mt-1 ml-4 border-l border-slate-700 space-y-0.5 pb-1">
                                    <button onClick={() => { setActiveParam("thunderstorm"); setActiveModel("ifs"); setSidebarOpen(false); }} className={itemClass(activeParam === "thunderstorm")}>
                                        🌧️ Accumulated Precipitation
                                    </button>
                                    {activeParam === "thunderstorm" && (
                                        <div className="ml-6 grid grid-cols-2 gap-1 py-1 pr-2">
                                            {[{ id: "ph", label: "National" }, { id: "luzon", label: "Luzon" }, { id: "visayas", label: "Visayas" }, { id: "mindanao", label: "Mindanao" }].map(v => (
                                                <button key={v.id} onClick={() => { setThunderstormRegion(v.id); setIsPlaying(false); }}
                                                    className={`text-[9px] font-bold py-1 rounded cursor-pointer transition border ${thunderstormRegion === v.id ? "bg-cyan-600 text-white border-cyan-500" : "bg-slate-900 text-slate-500 border-slate-700 hover:text-white"}`}
                                                >{v.label}</button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ══ AI Models ══ */}
                    <div>
                        <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 px-1">
                            ✦ AI Models
                        </h2>
                        <div className="border-t border-slate-700 pt-2">
                            <button
                                onClick={() => setExpandedGroup(expandedGroup === "aigfs" ? null : "aigfs")}
                                className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-semibold text-slate-200 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                            >
                                <div className="flex items-center gap-2">
                                    <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                    </svg>
                                    <span>NOAA AIGFS</span>
                                </div>
                                <svg className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${expandedGroup === "aigfs" ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>

                            {expandedGroup === "aigfs" && (
                                <div className="mt-1 ml-4 border-l border-slate-700 space-y-0.5 pb-1">
                                    <button onClick={() => { setActiveParam("wind_aigfs"); setActiveModel("aigfs"); setSidebarOpen(false); }} className={itemClass(activeParam === "wind_aigfs")}>
                                        💨 Wind &amp; MSLP
                                    </button>
                                    <button onClick={() => { setActiveParam("rainfall"); setActiveModel("aigfs"); setSidebarOpen(false); }} className={itemClass(activeParam === "rainfall" && activeModel === "aigfs")}>
                                        🌧️ Precipitation
                                    </button>
                                    <button onClick={() => { setActiveParam("precip_mslp"); setActiveModel("aigfs"); setSidebarOpen(false); }} className={itemClass(activeParam === "precip_mslp" && activeModel === "aigfs")}>
                                        🌀 6h Precip + MSLP
                                    </button>
                                </div>
                            )}

                            <button
                                onClick={() => setExpandedGroup(ecmwfOpen ? null : "ecmwf")}
                                className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-semibold text-slate-200 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer mt-2"
                            >
                                <div className="flex items-center gap-2">
                                    <svg className="w-4 h-4 text-purple-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                    </svg>
                                    <span>ECMWF AIFS</span>
                                </div>
                                <svg className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${ecmwfOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>

                            {ecmwfOpen && (
                                <div className="mt-1 ml-4 border-l border-slate-700 space-y-0.5 pb-1">
                                    <button onClick={() => { setActiveParam("wind"); setActiveModel("aifs"); setSidebarOpen(false); }} className={itemClass(activeParam === "wind")}>
                                        💨 Wind &amp; MSLP
                                    </button>
                                    <button onClick={() => { setActiveParam("precip_mslp"); setActiveModel("aifs"); setSidebarOpen(false); }} className={itemClass(activeParam === "precip_mslp" && activeModel === "aifs")}>
                                        🌀 6h Precip + MSLP
                                    </button>
                                </div>
                            )}

                            <button
                                onClick={() => setExpandedGroup(weathernextOpen ? null : "weathernext")}
                                className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-semibold text-slate-200 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer mt-2"
                            >
                                <div className="flex items-center gap-2">
                                    <svg className="w-4 h-4 text-cyan-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                    </svg>
                                    <span>Google WeatherNext 2</span>
                                </div>
                                <svg className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${weathernextOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>

                            {weathernextOpen && (
                                <div className="mt-1 ml-4 border-l border-slate-700 space-y-0.5 pb-1">
                                    <button onClick={() => { setActiveParam("rainfall"); setActiveModel("weathernext"); setRainfallView("daily"); setSidebarOpen(false); }} className={itemClass(activeParam === "rainfall" && activeModel === "weathernext")}>
                                        🌧️ Precipitation
                                    </button>

                                    <button onClick={() => { setActiveParam("wind"); setActiveModel("weathernext"); setSidebarOpen(false); }} className={itemClass(activeParam === "wind" && activeModel === "weathernext")}>
                                        💨 Wind &amp; MSLP
                                    </button>
                                    <button onClick={() => { setActiveParam("precip_mslp"); setActiveModel("weathernext"); setSidebarOpen(false); }} className={itemClass(activeParam === "precip_mslp" && activeModel === "weathernext")}>
                                        🌀 6h Precip + MSLP
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                </div>
            </div>
        );
    };


    const getFrameLabel = (frameName) => {
        if (!frameName) return "";
        if (activeParam === "rainfall") {
            const parts = frameName.split('_');
            return `Day ${parts[2] || 1}`;
        } else {
            return `Hour +${frameName.split('_').pop()}`;
        }
    };

    const handleExportGif = async () => {
        if (gifStartIdx > gifEndIdx || frames.length === 0) return;
        setIsExporting(true);
        setExportProgress(0);

        try {
            // Load the first image to determine native dimensions
            const firstFrameName = frames[gifStartIdx];
            let folder = "rainfall";
            if (activeParam === "rainfall") {
                folder = activeModel === "weathernext" ? "rainfall_weathernext" : activeModel === "aigfs" ? "rainfall_aigfs" : "rainfall";
            }
            else if (activeParam === "wind") {
                folder = activeModel === "weathernext" ? "wind_weathernext" : "wind";
            }
            else if (activeParam === "wind_gfs") folder = "wind_gfs";
            else if (activeParam === "wind_aigfs" || activeParam === "wind_hgefs") folder = "wind_aigfs";
            else if (activeParam === "thunderstorm") folder = "thunderstorm_ifs";
            else if (activeParam === "precip_mslp") {
                if (activeModel === "aifs") folder = "precip_mslp_aifs";
                else if (activeModel === "weathernext") folder = "precip_mslp_weathernext";
                else if (activeModel === "aigfs") folder = "precip_mslp_aigfs";
                else folder = "precip_mslp";
            }

            const firstImg = await new Promise((resolve, reject) => {
                const image = new Image();
                image.crossOrigin = "Anonymous";
                image.onload = () => resolve(image);
                image.onerror = reject;
                image.src = `/images/${folder}/${firstFrameName}.png?t=${imageTimestamp}`;
            });

            const nativeW = firstImg.naturalWidth;
            const nativeH = firstImg.naturalHeight;
            const frameDelay = Math.round(1000 / gifFps);

            const gif = new GIF({
                workers: 2,
                quality: 10,
                workerScript: gifWorkerUrl,
                width: nativeW,
                height: nativeH,
                transparent: null
            });

            gif.on("progress", (p) => setExportProgress(p));

            const canvas = document.createElement("canvas");
            canvas.width = nativeW;
            canvas.height = nativeH;
            const ctx = canvas.getContext("2d");

            for (let i = gifStartIdx; i <= gifEndIdx; i++) {
                const frameName = frames[i];
                const imgSrc = `/images/${folder}/${frameName}.png?t=${imageTimestamp}`;

                const img = i === gifStartIdx ? firstImg : await new Promise((resolve, reject) => {
                    const image = new Image();
                    image.crossOrigin = "Anonymous";
                    image.onload = () => resolve(image);
                    image.onerror = reject;
                    image.src = imgSrc;
                });

                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, nativeW, nativeH);

                gif.addFrame(ctx, { copy: true, delay: frameDelay });
            }

            gif.on("finished", (blob) => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `forecast_${activeModel}_${activeParam}_${frames[gifStartIdx]}_to_${frames[gifEndIdx]}.gif`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                setIsExporting(false);
                setShowGifModal(false);
            });

            gif.render();

        } catch (err) {
            console.error("GIF export failed", err);
            setIsExporting(false);
        }
    };

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
                                ? `6h Precip Rate + MSLP + Thickness · ${activeModel === "weathernext" ? "WeatherNext 2" : activeModel === "aifs" ? "ECMWF AIFS" : activeModel === "aigfs" ? "NOAA AIGFS" : "GFS"}`
                                : activeParam === "wind_gfs"
                                    ? "Wind & MSLP · GFS 0.25°"
                                    : (activeParam === "wind_aigfs" || activeParam === "wind_hgefs")
                                        ? "Wind & MSLP · NOAA AIGFS 0.25°"
                                        : activeParam === "thunderstorm"
                                            ? "Accumulated Precipitation · ECMWF IFS v2"
                                            : "Wind & MSLP · ECMWF AIFS"}
                    </span>
                </div>

                {/* Visualizer: fills to the bottom bar, starts below the mobile top bar on small screens */}
                <div className="absolute inset-0 top-[44px] lg:top-0 bottom-16 lg:bottom-20 z-0 bg-slate-950 flex items-center justify-center overflow-hidden">

                    {loadedImage ? (
                        <img
                            src={loadedImage}
                            alt="Forecast Map"
                            className="w-full h-full object-contain pointer-events-none"
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
                        disabled={isTimelineDisabled}
                        className={`w-10 h-10 lg:w-12 lg:h-12 rounded-full flex-shrink-0 flex items-center justify-center text-white shadow-[0_0_15px_rgba(6,182,212,0.4)] transition-transform hover:scale-105 cursor-pointer ${isTimelineDisabled ? "bg-slate-700 opacity-40 cursor-not-allowed" : "bg-cyan-600 hover:bg-cyan-500"
                            }`}
                    >
                        {isPlaying ? <Pause className="h-4 w-4 lg:h-5 lg:w-5" /> : <Play className="h-4 w-4 lg:h-5 lg:w-5 ml-0.5" />}
                    </button>

                    {/* GIF Export Button */}
                    {!isTimelineDisabled && frames.length > 0 && (
                        <button
                            onClick={() => {
                                setGifStartIdx(0);
                                setGifEndIdx(frames.length - 1);
                                setShowGifModal(true);
                            }}
                            className="w-10 h-10 lg:w-12 lg:h-12 rounded-full flex-shrink-0 flex items-center justify-center text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-600 transition-colors cursor-pointer"
                            title="Export GIF"
                        >
                            <Video className="w-4 h-4 lg:w-5 lg:h-5" />
                        </button>
                    )}

                    {/* Day/Time Badge — hidden on very small screens */}
                    <div className="hidden sm:block text-center min-w-[100px] lg:min-w-[140px] bg-slate-800 rounded p-1.5 lg:p-2 border border-slate-700 flex-shrink-0">
                        <div className="text-xs lg:text-sm font-bold text-white uppercase">
                            {metadata?.generated_at
                                ? new Date(metadata.generated_at).toLocaleDateString("en-US", { weekday: "long" })
                                : "Loading"}
                        </div>
                        <div className="text-[9px] lg:text-[10px] text-cyan-400 font-mono uppercase tracking-wider">
                            T {(activeParam === "wind" || activeParam === "wind_gfs" || activeParam === "precip_mslp" || activeParam === "thunderstorm") ? `+${stepHours}h` : `day ${dayNum}`}
                        </div>
                    </div>

                    {/* Timeline Slider */}
                    <div className="flex-1 relative flex items-center group">
                        <div className="absolute w-full flex justify-between px-1 -top-4 text-[9px] lg:text-[10px] text-slate-500 font-mono">
                            <span>Init</span>
                            <span className="hidden sm:inline">Day {Math.floor(maxDays * 0.25)}</span>
                            <span className="hidden sm:inline">Day {Math.floor(maxDays * 0.5)}</span>
                            <span className="hidden sm:inline">Day {Math.floor(maxDays * 0.75)}</span>
                            <span>Day {maxDays}</span>
                        </div>
                        <input
                            type="range"
                            min="0"
                            max={Math.max(0, frames.length - 1)}
                            value={frameIndex}
                            disabled={isTimelineDisabled}
                            onChange={(e) => {
                                setFrameIndex(parseInt(e.target.value));
                                setIsPlaying(false);
                            }}
                            className={`w-full h-2 lg:h-2.5 rounded-lg appearance-none focus:outline-none accent-cyan-500 transition-colors ${isTimelineDisabled
                                ? "bg-slate-800 opacity-30 cursor-not-allowed"
                                : "bg-slate-700 cursor-pointer group-hover:bg-slate-600"
                                }`}
                        />
                    </div>
                </div>
            </main>

            {/* ── GIF Export Modal ── */}
            {showGifModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 max-w-sm w-full shadow-2xl relative">
                        <button onClick={() => !isExporting && setShowGifModal(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white cursor-pointer">
                            <X className="w-5 h-5" />
                        </button>
                        <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                            <Video className="w-5 h-5 text-cyan-400" /> Export Forecast GIF
                        </h2>

                        <div className="space-y-4 mb-6">
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Start Frame</label>
                                <select
                                    value={gifStartIdx}
                                    onChange={(e) => setGifStartIdx(parseInt(e.target.value))}
                                    disabled={isExporting}
                                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-slate-200 text-sm outline-none focus:border-cyan-500 cursor-pointer"
                                >
                                    {frames.map((f, i) => (
                                        <option key={`start-${i}`} value={i} disabled={i > gifEndIdx}>{getFrameLabel(f)}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">End Frame</label>
                                <select
                                    value={gifEndIdx}
                                    onChange={(e) => setGifEndIdx(parseInt(e.target.value))}
                                    disabled={isExporting}
                                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-slate-200 text-sm outline-none focus:border-cyan-500 cursor-pointer"
                                >
                                    {frames.map((f, i) => (
                                        <option key={`end-${i}`} value={i} disabled={i < gifStartIdx}>{getFrameLabel(f)}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="mb-6">
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Speed: {gifFps} FPS</label>
                            <input
                                type="range"
                                min="1"
                                max="10"
                                value={gifFps}
                                onChange={(e) => setGifFps(parseInt(e.target.value))}
                                disabled={isExporting}
                                className="w-full h-2 rounded-lg appearance-none bg-slate-700 accent-cyan-500 cursor-pointer"
                            />
                            <div className="flex justify-between text-[9px] text-slate-500 mt-1">
                                <span>Slow (1)</span>
                                <span>Fast (10)</span>
                            </div>
                        </div>

                        {isExporting ? (
                            <div className="space-y-2">
                                <div className="flex justify-between text-xs text-slate-300 font-semibold uppercase">
                                    <span>Generating...</span>
                                    <span>{Math.round(exportProgress * 100)}%</span>
                                </div>
                                <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                                    <div className="bg-cyan-500 h-full transition-all duration-300 ease-out" style={{ width: `${exportProgress * 100}%` }}></div>
                                </div>
                            </div>
                        ) : (
                            <button
                                onClick={handleExportGif}
                                className="w-full py-2.5 rounded-lg font-bold text-white bg-cyan-600 hover:bg-cyan-500 transition-colors shadow-[0_0_15px_rgba(6,182,212,0.3)] hover:shadow-[0_0_20px_rgba(6,182,212,0.5)] cursor-pointer"
                            >
                                Generate GIF
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ForecastModels;
