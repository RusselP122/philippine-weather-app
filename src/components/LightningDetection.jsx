import React, { useEffect, useState } from "react";
import { MapContainer, TileLayer, Polygon, Marker } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const PAR_COORDS = [
    [5, 115],
    [5, 135],
    [25, 135],
    [25, 120],
    [21, 120],
    [21, 115],
];

const intensityCategories = [
    { min: 100, colorClass: 'text-fuchsia-100 drop-shadow-[0_0_15px_rgba(217,70,239,1)]', minOpac: 1, pulse: 'animate-pulse' },
    { min: 80, colorClass: 'text-red-100 drop-shadow-[0_0_10px_rgba(239,68,68,1)]', minOpac: 1, pulse: 'animate-pulse' },
    { min: 60, colorClass: 'text-orange-100 drop-shadow-[0_0_8px_rgba(249,115,22,1)]', minOpac: 1, pulse: 'animate-pulse' },
    { min: 40, colorClass: 'text-blue-100 drop-shadow-[0_0_8px_rgba(59,130,246,1)]', minOpac: 1, pulse: '' },
    { min: 20, colorClass: 'text-cyan-100 drop-shadow-[0_0_8px_rgba(6,182,212,1)]', minOpac: 0.8, pulse: '' },
    { min: 0, colorClass: 'text-slate-100 drop-shadow-[0_0_5px_rgba(255,255,255,0.6)]', minOpac: 0.5, pulse: '' }
];

const createLightningIcon = (intensity) => {
    let category = intensityCategories[0];
    for (let cat of intensityCategories) {
        if (intensity >= cat.min) {
            category = cat;
            break;
        }
    }

    return L.divIcon({
        className: 'lightning-icon',
        html: `<div class="w-8 h-8 rounded-full border-2 border-dashed border-amber-600/50 bg-transparent flex items-center justify-center cursor-pointer ${category.pulse}" style="opacity: ${category.minOpac}; margin-top:-12px; margin-left:-12px;">
                <svg class="w-5 h-5 ml-0.5 ${category.colorClass}" fill="currentColor" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
             </div>`
    });
};

const LightningDetection = () => {
    const [liveTime, setLiveTime] = useState("");
    const [strikeCount, setStrikeCount] = useState(0);
    const [lastUpdateStrikes, setLastUpdateStrikes] = useState(0);
    const [activeStrikes, setActiveStrikes] = useState([]);
    return (
        <div className="bg-slate-950 text-slate-100 flex items-center justify-center min-h-screen p-4 md:p-8 font-sans">
            <style>{`
        @keyframes verticalGlow {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.7; }
        }
        .animate-vertical-glow {
            animation: verticalGlow 3s ease-in-out infinite;
        }
      `}</style>
            <div className="max-w-6xl w-full bg-slate-900/60 backdrop-blur-md border border-slate-800 rounded-3xl p-6 md:p-8 shadow-2xl flex flex-col mt-16 md:mt-4">

                <div className="border-b border-slate-700/60 pb-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                    <div>
                        <h2 className="text-3xl font-black text-white tracking-tight flex items-center gap-2">
                            <span className="text-amber-400 drop-shadow-[0_0_10px_rgba(251,191,36,0.8)] animate-pulse">⚡</span>
                            Lightning Detection System
                        </h2>
                        <p className="text-slate-400 font-medium mt-1">Simulation of real-time lightning detections over the Philippine Area of Responsibility (PAR).</p>
                    </div>
                    <div className="bg-slate-800/80 backdrop-blur-sm border border-slate-700 rounded-xl p-3 flex justify-between items-center w-full md:max-w-[280px]">
                        <div className="flex items-center gap-1.5 px-2 py-1 bg-red-500/10 text-red-400 text-xs font-bold uppercase rounded border border-red-500/20">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shadow-[0_0_5px_rgba(239,68,68,0.8)]"></span>
                            Live Monitoring
                        </div>
                        <p className="text-xs text-slate-400">{liveTime || "Loading time..."}</p>
                    </div>
                </div>

                <div className="bg-slate-950/50 border border-slate-800 p-6 rounded-2xl flex flex-col sm:flex-row items-center justify-between mb-6 shadow-md gap-4">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-amber-500/10 rounded-xl border border-amber-500/20 text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.8)]">
                            <svg className="w-8 h-8 fill-current" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                        </div>
                        <div className="text-center sm:text-left">
                            <h3 className="text-xl font-bold text-slate-100 tracking-tight">Detection Status</h3>
                            <p className="text-sm text-slate-500 mt-1">Updates on a regular interval based on simulated data.</p>
                        </div>
                    </div>
                    <div className="bg-slate-800/80 backdrop-blur-sm border border-slate-700 p-4 rounded-xl flex items-center gap-4 group cursor-pointer hover:border-amber-500/50 transition-colors">
                        <div className="text-center">
                            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Data Source</p>
                            <p className="drop-shadow-[0_0_15px_rgba(251,191,36,1)] text-3xl font-black text-amber-400 tracking-tighter mb-1 transition-all">WO-Cloud API</p>
                            <p className="text-xs text-slate-400">Live Tile Rendering</p>
                        </div>
                    </div>
                </div>

                <div className="relative w-full aspect-[4/3] lg:aspect-[21/9] bg-slate-800 rounded-2xl overflow-hidden border border-slate-700 shadow-inner group" style={{ isolation: 'isolate' }}>
                    <MapContainer
                        center={[15, 125]}
                        zoom={5}
                        minZoom={4}
                        maxZoom={9}
                        scrollWheelZoom={false}
                        dragging={false}
                        className="w-full h-full absolute inset-0 z-0 bg-[#0f172a]"
                    >
                        <TileLayer
                            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                            attribution="&copy; CartoDB"
                            className="filter grayscale opacity-30 blur-[2px]"
                        />

                        <Polygon
                            positions={PAR_COORDS}
                            pathOptions={{
                                color: 'red',
                                weight: 2,
                                fillColor: 'none',
                                className: 'filter drop-shadow-[0_0_10px_rgba(239,68,68,0.3)] opacity-50'
                            }}
                        />
                    </MapContainer>

                    {/* Under Development Overlay */}
                    <div className="absolute inset-0 z-20 bg-slate-950/60 backdrop-blur-[4px] flex flex-col items-center justify-center p-6 text-center">
                        <div className="w-16 h-16 rounded-full bg-slate-800/80 border border-amber-500/30 flex shadow-[0_0_15px_rgba(251,191,36,0.2)] items-center justify-center mb-4">
                            <span className="text-amber-500/80 text-3xl">🚧</span>
                        </div>
                        <h3 className="text-2xl md:text-3xl font-black text-white tracking-tight mb-2">Under Development</h3>
                        <p className="text-slate-300 max-w-md cursor-default">We are currently evaluating real-time atmospheric data providers to bring you the most accurate live lightning tracking. Check back soon!</p>
                    </div>

                    <div className="absolute top-4 left-4 z-10 bg-slate-950/80 backdrop-blur-sm border border-slate-700 p-3 rounded-xl shadow-lg flex items-center gap-2 pointer-events-none opacity-50">
                        <div className="w-2 h-2 rounded-full bg-slate-500"></div>
                        <h4 className="text-xs font-bold text-white tracking-wider uppercase">System Offline</h4>
                    </div>

                    <div className="absolute hidden md:block bottom-4 right-20 z-10 bg-slate-900/80 backdrop-blur-md border border-slate-700 p-3 rounded-xl shadow-lg text-right text-xs pointer-events-none opacity-50">
                        <div className="font-black text-slate-400 mb-1 tracking-wide">React-Leaflet Detection</div>
                        <div className="text-slate-500 tracking-wide"> Philippine Area of Responsibility</div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LightningDetection;
