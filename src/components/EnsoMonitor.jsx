import React, { useState, useEffect } from 'react';
import ensoData from '../data/enso_data.json';
import { 
    Thermometer, 
    ThermometerSun, 
    ThermometerSnowflake, 
    AlertTriangle, 
    Info, 
    TrendingUp, 
    TrendingDown, 
    Minus,
    Activity,
    Wind
} from 'lucide-react';

const EnsoMonitor = () => {
    const [data, setData] = useState(null);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        // Simulate a slight delay to allow entrance animations to trigger
        setTimeout(() => {
            setData(ensoData);
            setMounted(true);
        }, 100);
    }, []);

    if (!data) return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
                <div className="w-10 h-10 border-4 border-sky-500 border-t-transparent rounded-full animate-spin"></div>
                <div className="text-sky-400 font-medium tracking-widest uppercase text-sm animate-pulse">Loading Climate Data...</div>
            </div>
        </div>
    );

    const getStatusTheme = (status) => {
        if (status === 'El Niño') return {
            color: 'text-red-500',
            bg: 'bg-red-500/10',
            border: 'border-red-500/20',
            glow: 'shadow-[0_0_30px_rgba(239,68,68,0.2)]',
            icon: <ThermometerSun className="w-8 h-8 md:w-10 md:h-10 text-red-500" />,
            blob: 'bg-red-600/20'
        };
        if (status === 'La Niña') return {
            color: 'text-blue-500',
            bg: 'bg-blue-500/10',
            border: 'border-blue-500/20',
            glow: 'shadow-[0_0_30px_rgba(59,130,246,0.2)]',
            icon: <ThermometerSnowflake className="w-8 h-8 md:w-10 md:h-10 text-blue-500" />,
            blob: 'bg-blue-600/20'
        };
        return {
            color: 'text-emerald-400',
            bg: 'bg-emerald-500/10',
            border: 'border-emerald-500/20',
            glow: 'shadow-[0_0_30px_rgba(52,211,153,0.1)]',
            icon: <Thermometer className="w-8 h-8 md:w-10 md:h-10 text-emerald-400" />,
            blob: 'bg-emerald-600/10'
        };
    };

    const theme = getStatusTheme(data.phase);

    // Calculate rotation for the gauge needle (-90 to 90 degrees)
    const clamped = Math.min(Math.max(data.latest_value, -2.5), 2.5);
    const needleRotation = mounted ? (clamped / 2.5) * 90 : -90; // Start at La Niña side, animate to current

    // Calculate forecast rotation based on trend for the ghost arrow
    const getForecastValue = () => {
        if (data.trend === 'Warming') return Math.min(data.latest_value + 0.8, 2.5);
        if (data.trend === 'Cooling') return Math.max(data.latest_value - 0.8, -2.5);
        return data.latest_value;
    };
    const forecastClamped = Math.min(Math.max(getForecastValue(), -2.5), 2.5);
    const forecastRotation = mounted ? (forecastClamped / 2.5) * 90 : -90;

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 py-12 px-4 sm:px-6 lg:px-8 relative overflow-hidden font-sans">
            
            {/* Background Decorative Blob */}
            <div className={`absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-4xl h-[500px] blur-[120px] rounded-full pointer-events-none transition-colors duration-1000 ${theme.blob}`}></div>

            <div className={`max-w-5xl mx-auto space-y-8 relative z-10 transition-all duration-1000 transform ${mounted ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'}`}>

                {/* Header */}
                <div className="text-center space-y-4 mb-12">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-400 text-xs font-semibold tracking-widest uppercase mb-2">
                        <Activity className="w-3 h-3" /> Live Climate Monitoring
                    </div>
                    <h1 className="text-4xl md:text-5xl lg:text-6xl font-black bg-clip-text text-transparent bg-gradient-to-br from-white via-sky-100 to-sky-400 drop-shadow-sm">
                        ENSO Monitor
                    </h1>
                    <p className="text-slate-400 text-sm md:text-base max-w-2xl mx-auto leading-relaxed">
                        Tracking the El Niño Southern Oscillation (ENSO) status to anticipate major shifts in Philippine weather patterns.
                    </p>
                </div>

                {/* Main Status Card */}
                <div className={`relative overflow-hidden rounded-3xl border backdrop-blur-md p-6 md:p-10 flex flex-col md:flex-row items-center justify-between gap-8 transition-all duration-500 hover:scale-[1.01] ${theme.bg} ${theme.border} ${theme.glow}`}>
                    
                    {/* Decorative Background Icon */}
                    <div className="absolute -right-10 -bottom-10 opacity-5 pointer-events-none">
                        <Wind className="w-64 h-64" />
                    </div>

                    <div className="flex flex-col md:flex-row items-center gap-6 text-center md:text-left z-10">
                        <div className={`p-4 rounded-full bg-slate-950/50 backdrop-blur-sm border border-white/5 shadow-inner`}>
                            {theme.icon}
                        </div>
                        <div className="space-y-1">
                            <h2 className="text-sm uppercase tracking-widest text-slate-400 font-bold">Current Phase</h2>
                            <div className={`text-4xl md:text-6xl font-black tracking-tight ${theme.color} drop-shadow-md`}>
                                {data.current_status}
                            </div>
                            {data.alert_status && (
                                <div className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-slate-300 text-xs font-semibold uppercase tracking-wider">
                                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                                    NOAA: {data.alert_status}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-col items-center md:items-end gap-3 z-10 bg-slate-950/40 p-5 rounded-2xl border border-white/5 backdrop-blur-sm min-w-[200px]">
                        <span className="text-slate-400 text-xs font-bold uppercase tracking-widest">Oceanic Niño Index</span>
                        <div className="flex items-baseline gap-1">
                            <span className="text-4xl font-black text-white">{data.latest_value > 0 ? '+' : ''}{data.latest_value}</span>
                            <span className="text-slate-400 text-lg">°C</span>
                        </div>
                        <div className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full border bg-slate-950/50 ${
                            data.trend === 'Warming' ? 'text-red-400 border-red-400/30' : 
                            data.trend === 'Cooling' ? 'text-blue-400 border-blue-400/30' : 
                            'text-emerald-400 border-emerald-400/30'
                        }`}>
                            {data.trend === 'Warming' ? <TrendingUp className="w-3 h-3" /> : 
                             data.trend === 'Cooling' ? <TrendingDown className="w-3 h-3" /> : 
                             <Minus className="w-3 h-3" />}
                            {data.trend} Trend
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Gauge Section */}
                    <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-3xl p-6 md:p-8 flex flex-col items-center shadow-xl relative group">
                        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent rounded-3xl pointer-events-none"></div>
                        <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2 w-full">
                            <Activity className="w-5 h-5 text-sky-400" />
                            ENSO Index Gauge
                        </h3>
                        <div className="w-full max-w-[480px] relative transition-transform duration-500 group-hover:scale-105">
                            <svg viewBox="0 0 500 280" className="w-full drop-shadow-2xl">
                                {/* Gradient Definitions */}
                                <defs>
                                    <linearGradient id="laNinaGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                                        <stop offset="0%" stopColor="#1e3a8a" />
                                        <stop offset="100%" stopColor="#3b82f6" />
                                    </linearGradient>
                                    <linearGradient id="neutralGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                                        <stop offset="0%" stopColor="#94a3b8" />
                                        <stop offset="100%" stopColor="#cbd5e1" />
                                    </linearGradient>
                                    <linearGradient id="elNinoGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                                        <stop offset="0%" stopColor="#ef4444" />
                                        <stop offset="100%" stopColor="#991b1b" />
                                    </linearGradient>
                                    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                                        <feGaussianBlur stdDeviation="8" result="blur" />
                                        <feComposite in="SourceGraphic" in2="blur" operator="over" />
                                    </filter>
                                </defs>

                                {/* Background arc for depth */}
                                <path d="M 70 240 A 180 180 0 0 1 430 240" fill="none" stroke="#0f172a" strokeWidth="50" strokeLinecap="round" />

                                {/* 7 Sectors */}
                                {/* Sector 1: LA NIÑA (180° → 154.29°) */}
                                <path d="M 70 240 A 180 180 0 0 1 87.8 161.9" fill="none" stroke="#1d4ed8" strokeWidth="44" />
                                {/* Sector 2: ALERT — Blue (154.29° → 128.57°) */}
                                <path d="M 87.8 161.9 A 180 180 0 0 1 137.8 99.3" fill="none" stroke="#3b82f6" strokeWidth="44" />
                                {/* Sector 3: WATCH — Light Blue (128.57° → 102.86°) */}
                                <path d="M 137.8 99.3 A 180 180 0 0 1 210 64.5" fill="none" stroke="#93c5fd" strokeWidth="44" />
                                {/* Sector 4: Neutral — Gray (102.86° → 77.14°) */}
                                <path d="M 210 64.5 A 180 180 0 0 1 290 64.5" fill="none" stroke="#d1d5db" strokeWidth="44" />
                                {/* Sector 5: WATCH — Light Red (77.14° → 51.43°) */}
                                <path d="M 290 64.5 A 180 180 0 0 1 362.2 99.3" fill="none" stroke="#fca5a5" strokeWidth="44" />
                                {/* Sector 6: ALERT — Red (51.43° → 25.71°) */}
                                <path d="M 362.2 99.3 A 180 180 0 0 1 412.2 161.9" fill="none" stroke="#ef4444" strokeWidth="44" />
                                {/* Sector 7: EL NIÑO — Deep Red (25.71° → 0°) */}
                                <path d="M 412.2 161.9 A 180 180 0 0 1 430 240" fill="none" stroke="#dc2626" strokeWidth="44" />

                                {/* Sector divider lines (inner r=158, outer r=202) */}
                                <line x1="92" y1="240" x2="48" y2="240" stroke="#0f172a" strokeWidth="2" />
                                <line x1="107.6" y1="171.4" x2="67.9" y2="152.4" stroke="#0f172a" strokeWidth="2" />
                                <line x1="150.9" y1="114.1" x2="124.7" y2="84.4" stroke="#0f172a" strokeWidth="2" />
                                <line x1="214.8" y1="86.1" x2="205.1" y2="43" stroke="#0f172a" strokeWidth="2" />
                                <line x1="285.2" y1="86.1" x2="294.9" y2="43" stroke="#0f172a" strokeWidth="2" />
                                <line x1="349.1" y1="114.1" x2="375.3" y2="84.4" stroke="#0f172a" strokeWidth="2" />
                                <line x1="392.4" y1="171.4" x2="432.1" y2="152.4" stroke="#0f172a" strokeWidth="2" />
                                <line x1="408" y1="240" x2="452" y2="240" stroke="#0f172a" strokeWidth="2" />

                                {/* Labels — white text rotated inside each sector */}
                                <text x="74.5" y="200" fill="white" fontSize="10" fontWeight="bold" textAnchor="middle" dominantBaseline="central" transform="rotate(-77.1, 74.5, 200)" style={{ letterSpacing: '1px' }}>LA NIÑA</text>
                                <text x="109.3" y="127.8" fill="white" fontSize="10" fontWeight="bold" textAnchor="middle" dominantBaseline="central" transform="rotate(-51.4, 109.3, 127.8)" style={{ letterSpacing: '1px' }}>ALERT</text>
                                <text x="171.9" y="77.8" fill="white" fontSize="10" fontWeight="bold" textAnchor="middle" dominantBaseline="central" transform="rotate(-25.7, 171.9, 77.8)" style={{ letterSpacing: '1px' }}>WATCH</text>
                                <text x="250" y="60" fill="#0f172a" fontSize="11" fontWeight="bold" textAnchor="middle" dominantBaseline="central" style={{ letterSpacing: '1px' }}>Neutral</text>
                                <text x="328.1" y="77.8" fill="white" fontSize="10" fontWeight="bold" textAnchor="middle" dominantBaseline="central" transform="rotate(25.7, 328.1, 77.8)" style={{ letterSpacing: '1px' }}>WATCH</text>
                                <text x="390.7" y="127.8" fill="white" fontSize="10" fontWeight="bold" textAnchor="middle" dominantBaseline="central" transform="rotate(51.4, 390.7, 127.8)" style={{ letterSpacing: '1px' }}>ALERT</text>
                                <text x="425.5" y="200" fill="white" fontSize="10" fontWeight="bold" textAnchor="middle" dominantBaseline="central" transform="rotate(77.1, 425.5, 200)" style={{ letterSpacing: '1px' }}>EL NIÑO</text>

                                {/* Forecast Arrow (Ghost Needle) */}
                                {data.trend && data.trend !== 'Neutral' && (
                                    <g style={{ transform: `rotate(${forecastRotation}deg)`, transformOrigin: '250px 240px', transition: 'transform 2s cubic-bezier(0.34, 1.56, 0.64, 1) 0.5s', opacity: mounted ? 0.9 : 0 }}>
                                        {/* Dashed line */}
                                        <line x1="250" y1="55" x2="250" y2="240" stroke="#fbbf24" strokeWidth="2.5" strokeDasharray="6 4" strokeLinecap="round" filter="url(#glow)" />
                                        {/* Arrow Head */}
                                        <polygon points="250,40 257,55 243,55" fill="#fbbf24" filter="url(#glow)" />
                                        {/* "FORECAST" Label */}
                                        <text x="250" y="28" fill="#fbbf24" fontSize="10" fontWeight="900" textAnchor="middle" style={{ letterSpacing: '1px' }} filter="url(#glow)">FORECAST</text>
                                    </g>
                                )}

                                {/* Animated Needle Group */}
                                <g style={{ transform: `rotate(${needleRotation}deg)`, transformOrigin: '250px 240px', transition: 'transform 1.5s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
                                    {/* Needle Shadow */}
                                    <polygon points="250,55 260,240 240,240" fill="rgba(0,0,0,0.4)" filter="blur(4px)" transform="translate(0, 5)" />
                                    {/* Needle Main */}
                                    <polygon points="250,50 256,240 244,240" fill="white" />
                                    {/* Needle Highlight */}
                                    <polygon points="250,50 250,240 244,240" fill="#e2e8f0" />
                                </g>

                                {/* Center Hub */}
                                <circle cx="250" cy="240" r="18" fill="#1e293b" stroke="white" strokeWidth="4" filter="url(#glow)" />
                                <circle cx="250" cy="240" r="6" fill="white" />
                            </svg>
                        </div>
                    </div>

                    {/* Advisory & Thresholds Sidebar */}
                    <div className="space-y-8 flex flex-col justify-between">
                        {/* Advisory Card */}
                        <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-3xl p-6 md:p-8 shadow-xl relative group overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-br from-sky-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>
                            <h3 className="text-lg font-bold text-sky-400 mb-4 flex items-center gap-2">
                                <Info className="w-5 h-5" />
                                Climate Advisory
                            </h3>
                            <p className="text-slate-300 leading-relaxed text-sm md:text-base mb-6 font-medium">
                                {data.advisory}
                            </p>
                            <div className="flex items-center justify-between text-xs text-slate-500 border-t border-slate-800 pt-4 mt-auto">
                                <span>Updated: {data.last_updated}</span>
                                <span className="font-semibold text-slate-400">Source: NOAA CPC</span>
                            </div>
                        </div>

                        {/* Thresholds Card */}
                        <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-3xl p-6 md:p-8 shadow-xl relative group flex-grow">
                            <h3 className="text-lg font-bold text-white mb-5 flex items-center gap-2">
                                <Activity className="w-5 h-5 text-slate-400" />
                                Key Thresholds
                            </h3>
                            <div className="space-y-4">
                                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/50 border border-slate-800 transition-colors hover:border-red-500/30 hover:bg-red-500/5">
                                    <div className="flex items-center gap-3">
                                        <div className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]"></div>
                                        <span className="font-semibold text-slate-200">El Niño</span>
                                    </div>
                                    <span className="font-mono text-slate-400 text-sm">&gt; +0.5 °C</span>
                                </div>
                                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/50 border border-slate-800 transition-colors hover:border-slate-400/30 hover:bg-slate-500/5">
                                    <div className="flex items-center gap-3">
                                        <div className="w-2.5 h-2.5 rounded-full bg-slate-400 shadow-[0_0_10px_rgba(148,163,184,0.5)]"></div>
                                        <span className="font-semibold text-slate-200">Neutral</span>
                                    </div>
                                    <span className="font-mono text-slate-400 text-sm">-0.5 to +0.5 °C</span>
                                </div>
                                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/50 border border-slate-800 transition-colors hover:border-blue-500/30 hover:bg-blue-500/5">
                                    <div className="flex items-center gap-3">
                                        <div className="w-2.5 h-2.5 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]"></div>
                                        <span className="font-semibold text-slate-200">La Niña</span>
                                    </div>
                                    <span className="font-mono text-slate-400 text-sm">&lt; -0.5 °C</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* ENSO Forecast Probability */}
                <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-3xl p-6 md:p-8 shadow-xl mt-8 relative group overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.02] to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>
                    <div className="flex flex-col md:flex-row gap-8 items-start">
                        <div className="md:w-1/3 space-y-4">
                            <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                <TrendingUp className="w-6 h-6 text-amber-400" />
                                Forecast Probability
                            </h3>
                            {data.forecast_summary && (
                                <p className="text-slate-400 text-sm leading-relaxed">
                                    {data.forecast_summary}
                                </p>
                            )}
                            <div className="space-y-3 pt-4 border-t border-slate-800">
                                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Legend</div>
                                <div className="flex items-center gap-2 text-sm text-slate-300">
                                    <div className="w-3 h-3 rounded bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.4)]"></div> La Niña
                                </div>
                                <div className="flex items-center gap-2 text-sm text-slate-300">
                                    <div className="w-3 h-3 rounded bg-slate-400 shadow-[0_0_8px_rgba(148,163,184,0.4)]"></div> Neutral
                                </div>
                                <div className="flex items-center gap-2 text-sm text-slate-300">
                                    <div className="w-3 h-3 rounded bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]"></div> El Niño
                                </div>
                            </div>
                        </div>
                        <div className="md:w-2/3 w-full">
                            <div className="rounded-2xl overflow-hidden border border-slate-700/50 bg-slate-950 p-2 shadow-inner">
                                <img
                                    src={data.forecast_image || 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/figure07.gif'}
                                    alt="ENSO Forecast Probability Chart"
                                    className="w-full h-auto rounded-xl object-contain opacity-90 hover:opacity-100 transition-opacity mix-blend-lighten"
                                />
                            </div>
                            <div className="mt-3 text-xs text-slate-500 text-right">
                                Source: NOAA Climate Prediction Center
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default EnsoMonitor;
