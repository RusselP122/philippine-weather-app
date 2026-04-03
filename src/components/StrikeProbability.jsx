import React, { useEffect, useRef, useState } from "react";

// ── Leaflet asset injection ───────────────────────────────────────────────
const injectLeafletCSS = () => {
    if (!document.getElementById("leaflet-css")) {
        const link = document.createElement("link");
        link.id = "leaflet-css";
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.appendChild(link);
    }
    
    if (!document.getElementById("strike-bg-css")) {
        const s = document.createElement("style");
        s.id = "strike-bg-css";
        s.textContent = `
          .leaflet-container { background: #020617 !important; }
          
          input[type=range] {
              -webkit-appearance: none;
              background: #334155;
              border-radius: 8px;
              height: 6px;
          }
          input[type=range]::-webkit-slider-thumb {
              -webkit-appearance: none;
              height: 16px;
              width: 16px;
              border-radius: 50%;
              background: #0ea5e9;
              cursor: pointer;
              box-shadow: 0 0 10px rgba(14, 165, 233, 0.5);
          }
          ::-webkit-scrollbar { width: 6px; }
          ::-webkit-scrollbar-track { background: #0f172a; }
          ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
        `;
        document.head.appendChild(s);
    }
};

const loadLeaflet = () =>
    new Promise((resolve) => {
        if (window.L) return resolve(window.L);
        const s = document.createElement("script");
        s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
        s.onload = () => resolve(window.L);
        document.head.appendChild(s);
    });

const VAR_OPTIONS = [
    { 
        id: "track_probability", 
        label: "Track Probability",
        accent: "bg-slate-400",
        border: "border-slate-400",
        shadow: "",
        ctx: "Chance that the exact center of the storm will pass within 65nm of a location."
    },
    { 
        id: "34_knot_strike_probability", 
        label: "≥34-Knot Wind (TS)",
        accent: "bg-cyan-500",
        border: "border-cyan-500",
        shadow: "shadow-[0_0_10px_rgba(6,182,212,0.15)]",
        ctx: "Cumulative probability of experiencing 34-knot (TS) winds. Notice the massive footprint."
    },
    { 
        id: "50_knot_strike_probability", 
        label: "≥50-Knot Wind (STS)",
        accent: "bg-yellow-500",
        border: "border-yellow-500",
        shadow: "shadow-[0_0_10px_rgba(234,179,8,0.15)]",
        ctx: "Cumulative probability of experiencing 50-knot (STS) winds. Capable of moderate damage."
    },
    { 
        id: "64_knot_strike_probability", 
        label: "≥64-Knot Wind (TY)",
        accent: "bg-red-500",
        border: "border-red-500",
        shadow: "shadow-[0_0_10px_rgba(239,68,68,0.15)]",
        ctx: "Cumulative probability of experiencing 64-knot (Typhoon) winds. This tight swath stays close to the main track."
    }
];

export default function StrikeProbability() {
    const mapRef = useRef(null);
    const mapInstanceRef = useRef(null);
    const dataLayerRef = useRef(null);

    const [day, setDay] = useState(15); 
    const [variable, setVariable] = useState(VAR_OPTIONS[1].id);
    const [status, setStatus] = useState("ok");
    const [meta, setMeta] = useState(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);

    useEffect(() => {
        injectLeafletCSS();
        loadLeaflet().then((L) => {
            if (mapInstanceRef.current || !mapRef.current) return;

            const map = L.map(mapRef.current, {
                zoomControl: false,
                worldCopyJump: false,
                maxBounds: [[-85, -180], [85, 180]],
                maxBoundsViscosity: 1.0,
                minZoom: 3
            }).setView([15, 125], 4);
            L.control.zoom({ position: 'topright' }).addTo(map);

            L.tileLayer(
                "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png",
                { attribution: "© CARTO", subdomains: "abcd", maxZoom: 10, noWrap: true }
            ).addTo(map);

            fetch('/assets/country.0.1.json')
                .then(res => res.json())
                .then(data => {
                    L.geoJSON(data, {
                        style: {
                            color: "#FFD700",
                            weight: 1,
                            opacity: 0.5,
                            fillOpacity: 0,
                        }
                    }).addTo(map);
                })
                .catch(() => { });

            // PAR Boundary
            const PAR = [[5, 115], [15, 115], [21, 120], [25, 120], [25, 135], [5, 135], [5, 115]];
            L.polyline(PAR, {
                color: '#ef4444',
                weight: 1.5,
                opacity: 0.8,
                fill: false,
                interactive: false
            }).addTo(map);

            dataLayerRef.current = L.layerGroup().addTo(map);
            mapInstanceRef.current = map;

            // Load Metadata
            fetch('/data/strike_prob/meta.json')
                .then(res => res.json())
                .then(setMeta)
                .catch(() => { });

            loadDataLayer(variable, day, L);
        });

        return () => {
            mapInstanceRef.current?.remove();
            mapInstanceRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const loadDataLayer = async (varId, dayIndex, L = window.L) => {
        if (!L || !dataLayerRef.current) return;
        setStatus("loading");
        dataLayerRef.current.clearLayers();

        try {
            const url = "/data/strike_prob/" + varId + "_day" + dayIndex + ".json";
            const req = await fetch(url);
            if (!req.ok) throw new Error("Not found");
            const geojsonData = await req.json();

            if (geojsonData.features && geojsonData.features.length > 0) {
                L.geoJSON(geojsonData, {
                    style: (feature) => {
                        let fillCol = feature.properties.fill || "#bbbbbb";
                        const title = feature.properties.title || "";
                        
                        // Map 0.05 bounds to user's requested palette
                        if (title.startsWith("0.05")) fillCol = "#0ea5e9";
                        else if (title.startsWith("0.10")) fillCol = "#22c55e";
                        else if (title.startsWith("0.20") || title.startsWith("0.30")) fillCol = "#eab308";
                        else if (title.startsWith("0.40") || title.startsWith("0.50")) fillCol = "#ef4444";
                        else if (title.startsWith("0.6") || title.startsWith("0.7") || title.startsWith("0.8") || title.startsWith("0.9") || title.startsWith("1.")) fillCol = "#9333ea";

                        return {
                            fillColor: fillCol,
                            fillOpacity: 0.65,
                            color: "rgba(0,0,0,0.15)", // subtle border between bands
                            weight: 0.5,
                            opacity: 1.0
                        };
                    }
                }).addTo(dataLayerRef.current);
            }
            setStatus("ok");
        } catch (e) {
            setStatus("error");
        }
    };

    // React to day/variable changes but do not block UI thread
    useEffect(() => {
        loadDataLayer(variable, day);
    }, [day, variable]);

    // Playback loop
    useEffect(() => {
        let interval;
        if (isPlaying) {
            interval = setInterval(() => {
                setDay(prev => {
                    if (prev >= 15) {
                        setIsPlaying(false);
                        return prev; // stop
                    }
                    return prev + 1;
                });
            }, 600); // 600ms per day 
        }
        return () => clearInterval(interval);
    }, [isPlaying]);

    const activeOption = VAR_OPTIONS.find(opt => opt.id === variable) || VAR_OPTIONS[1];

    let statusClass = "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    if (status === "loading") statusClass = "bg-amber-500/20 text-amber-400 border-amber-500/30";
    else if (status === "error") statusClass = "bg-red-500/20 text-red-400 border-red-500/30";

    return (
        <div className="bg-slate-900 text-slate-100 font-sans flex overflow-hidden relative" style={{ height: "calc(100vh - 64px)" }}>
            
            {/* Mobile Overlay */}
            {sidebarOpen && (
                <div className="fixed inset-0 bg-black/60 z-[1000] lg:hidden" onClick={() => setSidebarOpen(false)} />
            )}

            {/* Sidebar Overlay */}
            <aside className={`w-80 bg-slate-900 border-r border-slate-800 flex flex-col z-[1001] shadow-2xl flex-shrink-0 absolute left-0 top-0 bottom-24 lg:bottom-24 opacity-95 transition-transform duration-300 ease-in-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
                <div className="p-5 border-b border-slate-800">
                    <div className="flex items-center justify-between mb-2">
                        <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                            <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                            Strike Probability
                        </h1>
                        
                        <div className="flex items-center gap-2">
                            <span className={"text-[10px] font-bold uppercase py-0.5 px-2 rounded border hidden lg:block " + statusClass}>
                                {status === "loading" ? "..." : status}
                            </span>
                            <button onClick={() => setSidebarOpen(false)} className="lg:hidden p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                        </div>
                    </div>
                    {meta ? (                     
                        <p className="text-[10px] text-slate-400 font-mono uppercase tracking-widest">{meta.init_date.replace(/_/g, "-")} {meta.init_hour}:00 UTC</p>
                    ) : ( 
                        <p className="text-[10px] text-slate-400 font-mono uppercase tracking-widest">Cumulative 15-Day Forecast</p>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-6">
                    <div>
                        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Probability Type</h2>
                        <div className="space-y-2">
                            {VAR_OPTIONS.map(opt => {
                                const isActive = variable === opt.id;
                                const btnClass = "w-full flex items-center justify-between p-3 rounded bg-slate-800 border transition-colors text-left group relative overflow-hidden " + (isActive ? opt.border + " " + opt.shadow : "border-slate-700 hover:border-slate-500");
                                const indicatorClass = "absolute left-0 top-0 bottom-0 w-1 " + opt.accent + (isActive ? " block" : " hidden");
                                const spanClass = "text-sm tracking-tight " + (isActive ? "font-bold text-white pl-2" : "font-medium text-slate-300");

                                return (
                                    <button 
                                        key={opt.id}
                                        onClick={() => {
                                            setVariable(opt.id);
                                            if(window.innerWidth < 1024) setSidebarOpen(false);
                                        }}
                                        className={btnClass}
                                    >
                                        <div className={indicatorClass}></div>
                                        <span className={spanClass}>
                                            {opt.label}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="mt-4">
                        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Probability (%)</h2>
                        <div className="grid grid-cols-5 gap-1 mb-2 h-4">
                            <div className="bg-[#0ea5e9]" title="5-10%"></div>
                            <div className="bg-[#22c55e]" title="10-20%"></div>
                            <div className="bg-[#eab308]" title="20-40%"></div>
                            <div className="bg-[#ef4444]" title="40-60%"></div>
                            <div className="bg-[#9333ea]" title=">60%"></div>
                        </div>
                        <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                            <span>5%</span>
                            <span>20%</span>
                            <span>40%</span>
                            <span>60%</span>
                            <span>90%</span>
                        </div>
                    </div>

                    <div className="bg-slate-800/50 rounded p-4 border border-slate-700/50 mt-6">
                        <p className="text-xs text-slate-400 leading-relaxed">
                            {activeOption.ctx}
                        </p>
                    </div>
                </div>
            </aside>

            {/* Map Container */}
            <main ref={mapRef} className="w-full h-full z-10"></main>

            {/* Mobile Header Toggle */}
            <div className="flex lg:hidden items-center gap-3 px-3 py-2 bg-slate-900/90 border-b border-slate-700 absolute top-0 left-0 right-0 z-[500] shadow">
                <button onClick={() => setSidebarOpen(true)} className="p-1.5 rounded-lg bg-slate-700 text-slate-300 hover:text-white shadow">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" /></svg>
                </button>
                <span className="text-xs font-semibold text-white">Strike Controls</span>
                <span className={"ml-auto text-[10px] font-bold uppercase py-0.5 px-2 rounded border " + statusClass}>
                    {status === "loading" ? "..." : status}
                </span>
            </div>

            {/* Bottom Playback Bar */}
            <div className="absolute bottom-0 left-0 right-0 h-24 bg-slate-900 border-t border-slate-800 z-[1000] px-4 lg:px-8 flex items-center gap-3 lg:gap-6 shadow-[0_-10px_30px_rgba(0,0,0,0.5)] opacity-95">
                
                <button 
                    onClick={() => {
                        if(!isPlaying && day >= 15) setDay(1); // loop
                        setIsPlaying(!isPlaying);
                    }}
                    className="w-12 h-12 rounded-full bg-cyan-600 hover:bg-cyan-500 flex items-center justify-center text-white shadow-[0_0_15px_rgba(6,182,212,0.4)] transition-transform hover:scale-105 flex-shrink-0 cursor-pointer"
                >
                    {!isPlaying ? (
                        <svg className="w-5 h-5 ml-1" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd"></path></svg>
                    ) : (
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd"></path></svg>
                    )}
                </button>

                <div className="text-center min-w-[100px] bg-slate-800 rounded p-2 border border-slate-700">
                    <div className="text-xl font-bold text-white font-mono">+{day * 24}h</div>
                </div>

                <div className="flex-1 relative flex items-center pt-4">
                    <div className="absolute w-full flex justify-between px-2 top-0 text-[10px] text-slate-500 font-mono">
                        <span>Init</span>
                        <span>Day 3</span>
                        <span>Day 6</span>
                        <span>Day 9</span>
                        <span>Day 12</span>
                        <span>Day 15</span>
                    </div>
                    <input 
                        type="range" 
                        min="1" max="15" step="1" 
                        value={day}
                        onChange={(e) => {
                            setIsPlaying(false);
                            setDay(parseInt(e.target.value));
                        }}
                        className="w-full cursor-pointer"
                    />
                </div>
            </div>
            
        </div>
    );
}
