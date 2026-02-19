
import React, { useState, useEffect } from 'react';
import ensoData from '../data/enso_data.json';

const EnsoMonitor = () => {
    const [data, setData] = useState(null);

    useEffect(() => {
        setData(ensoData);
    }, []);

    if (!data) return <div className="text-white text-center py-20">Loading Climate Data...</div>;

    const getStatusColor = (status) => {
        if (status === 'El Niño') return 'text-red-500';
        if (status === 'La Niña') return 'text-blue-500';
        return 'text-gray-400';
    };

    const getStatusBg = (status) => {
        if (status === 'El Niño') return 'bg-red-500/10 border-red-500/20';
        if (status === 'La Niña') return 'bg-blue-500/10 border-blue-500/20';
        return 'bg-slate-800/50 border-slate-700';
    };



    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-5xl mx-auto space-y-8">

                {/* Header */}
                <div className="text-center space-y-2">
                    <h1 className="text-3xl md:text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-sky-400 to-blue-600">
                        ENSO Climate Monitor
                    </h1>
                    <p className="text-slate-400 text-sm md:text-base max-w-2xl mx-auto">
                        Monitoring the El Niño Southern Oscillation (ENSO) status and its potential impact on Philippine weather patterns.
                    </p>
                </div>

                {/* Status Card */}
                <div className={`rounded-2xl border p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-6 ${getStatusBg(data.phase)}`}>
                    <div className="text-center md:text-left space-y-2">
                        <h2 className="text-sm uppercase tracking-widest text-slate-400 font-semibold">Current Status</h2>
                        <div className={`text-4xl md:text-5xl font-black tracking-tight ${getStatusColor(data.phase)}`}>
                            {data.current_status}
                        </div>
                        {data.alert_status && (
                            <div className="text-slate-500 text-xs font-medium uppercase tracking-wider">
                                NOAA Alert: {data.alert_status}
                            </div>
                        )}
                        <div className="flex items-center gap-2 justify-center md:justify-start mt-2">
                            <span className="text-slate-400 text-sm">ONI Value:</span>
                            <span className="text-xl font-bold">{data.latest_value}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full border ${data.trend === 'Warming' ? 'text-red-400 border-red-400/30' : data.trend === 'Cooling' ? 'text-blue-400 border-blue-400/30' : 'text-slate-400 border-slate-600'}`}>
                                {data.trend} Trend
                            </span>
                        </div>
                    </div>
                </div>

                {/* Gauge Section */}
                <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 md:p-8 flex flex-col items-center">
                    <h3 className="text-lg font-semibold text-slate-200 mb-2">ENSO Index Gauge</h3>
                    <div className="w-full max-w-[520px]">
                        <svg viewBox="0 0 500 300" className="w-full">
                            {/*
                                Pre-computed semicircle gauge.
                                Center: (250, 240), Radius: 180, StrokeWidth: 44
                                7 sectors × 25.714° = 180° exact (symmetric semicircle)
                                Boundary angles: 180°, 154.29°, 128.57°, 102.86°, 77.14°, 51.43°, 25.71°, 0°
                                Coordinates: x = 250 + 180·cos(θ), y = 240 - 180·sin(θ)
                            */}

                            {/* Sector 1: LA NIÑA — Deep Blue (180° → 154.29°) */}
                            <path d="M 70 240 A 180 180 0 0 1 87.8 161.9" fill="none" stroke="#1d4ed8" strokeWidth="44" />
                            {/* Sector 2: ALERT — Blue (154.29° → 128.57°) */}
                            <path d="M 87.8 161.9 A 180 180 0 0 1 137.8 99.3" fill="none" stroke="#3b82f6" strokeWidth="44" />
                            {/* Sector 3: WATCH — Light Blue (128.57° → 102.86°) */}
                            <path d="M 137.8 99.3 A 180 180 0 0 1 210 64.5" fill="none" stroke="#93c5fd" strokeWidth="44" />
                            {/* Sector 4: INACTIVE — Gray (102.86° → 77.14°) */}
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
                            {/* Mid-angle positions at r=180 with rotation = -(midAngle - 90) */}
                            <text x="74.5" y="200" fill="white" fontSize="11" fontWeight="bold" textAnchor="middle" dominantBaseline="central" transform="rotate(-77.1, 74.5, 200)" style={{ letterSpacing: '2px' }}>LA NIÑA</text>
                            <text x="109.3" y="127.8" fill="white" fontSize="11" fontWeight="bold" textAnchor="middle" dominantBaseline="central" transform="rotate(-51.4, 109.3, 127.8)" style={{ letterSpacing: '2px' }}>ALERT</text>
                            <text x="171.9" y="77.8" fill="white" fontSize="11" fontWeight="bold" textAnchor="middle" dominantBaseline="central" transform="rotate(-25.7, 171.9, 77.8)" style={{ letterSpacing: '2px' }}>WATCH</text>
                            <text x="250" y="60" fill="#1e293b" fontSize="11" fontWeight="bold" textAnchor="middle" dominantBaseline="central" style={{ letterSpacing: '2px' }}>INACTIVE</text>
                            <text x="328.1" y="77.8" fill="white" fontSize="11" fontWeight="bold" textAnchor="middle" dominantBaseline="central" transform="rotate(25.7, 328.1, 77.8)" style={{ letterSpacing: '2px' }}>WATCH</text>
                            <text x="390.7" y="127.8" fill="white" fontSize="11" fontWeight="bold" textAnchor="middle" dominantBaseline="central" transform="rotate(51.4, 390.7, 127.8)" style={{ letterSpacing: '2px' }}>ALERT</text>
                            <text x="425.5" y="200" fill="white" fontSize="11" fontWeight="bold" textAnchor="middle" dominantBaseline="central" transform="rotate(77.1, 425.5, 200)" style={{ letterSpacing: '2px' }}>EL NIÑO</text>

                            {/* Needle — white arrow with clean tip */}
                            {(() => {
                                const clamped = Math.min(Math.max(data.latest_value, -2.5), 2.5);
                                const angle = 90 - (clamped / 2.5) * 90;
                                const rad = angle * Math.PI / 180;
                                const cosA = Math.cos(rad), sinA = Math.sin(rad);
                                // Needle shaft from center to just before the tip
                                const shaftEnd = 130;
                                const sx = 250 + shaftEnd * cosA;
                                const sy = 240 - shaftEnd * sinA;
                                // Arrow tip — sharp point extending to inner edge of arc
                                const tipR = 158;
                                const tipX = 250 + tipR * cosA;
                                const tipY = 240 - tipR * sinA;
                                // Arrow head base — perpendicular wings at shaft end
                                const wingSize = 8;
                                const wx = -sinA * wingSize;
                                const wy = cosA * wingSize;

                                return (
                                    <g>
                                        {/* Shaft */}
                                        <line x1="250" y1="240" x2={sx} y2={sy} stroke="white" strokeWidth="4" strokeLinecap="round" />
                                        {/* Arrowhead — clean triangle */}
                                        <polygon
                                            points={`${tipX},${tipY} ${sx + wx},${sy + wy} ${sx - wx},${sy - wy}`}
                                            fill="white"
                                        />
                                        {/* Center hub */}
                                        <circle cx="250" cy="240" r="12" fill="white" stroke="#0f172a" strokeWidth="3" />
                                        <circle cx="250" cy="240" r="5" fill="#0f172a" />
                                    </g>
                                );
                            })()}

                            {/* ONI Value */}
                            <text x="250" y="285" fill="white" fontSize="28" fontWeight="bold" textAnchor="middle" fontFamily="monospace">
                                {data.latest_value > 0 ? '+' : ''}{data.latest_value}
                            </text>
                        </svg>
                    </div>
                </div>

                {/* Advisory + Thresholds Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="md:col-span-2 bg-slate-900/50 border border-slate-800 rounded-xl p-6">
                        <h3 className="text-lg font-semibold text-sky-400 mb-3 flex items-center gap-2">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                            Climate Advisory
                        </h3>
                        <p className="text-slate-300 leading-relaxed text-sm md:text-base">
                            {data.advisory}
                        </p>
                        <div className="mt-4 text-xs text-slate-500">
                            Last Updated: {data.last_updated} | Source: NOAA CPC
                        </div>
                    </div>

                    <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
                        <h3 className="text-lg font-semibold text-slate-200 mb-3">Key Thresholds</h3>
                        <ul className="space-y-3 text-sm text-slate-400">
                            <li className="flex items-center gap-3">
                                <span className="w-3 h-3 rounded-full bg-red-500"></span>
                                <span>El Niño: <strong className="text-slate-200">&gt; +0.5</strong></span>
                            </li>
                            <li className="flex items-center gap-3">
                                <span className="w-3 h-3 rounded-full bg-slate-500"></span>
                                <span>Neutral: <strong className="text-slate-200">-0.5 to +0.5</strong></span>
                            </li>
                            <li className="flex items-center gap-3">
                                <span className="w-3 h-3 rounded-full bg-blue-500"></span>
                                <span>La Niña: <strong className="text-slate-200">&lt; -0.5</strong></span>
                            </li>
                        </ul>
                    </div>
                </div>

                {/* ENSO Forecast Probability */}
                <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
                    <h3 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
                        <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
                        ENSO Forecast Probability
                    </h3>
                    {data.forecast_summary && (
                        <p className="text-slate-300 text-sm leading-relaxed mb-5">
                            {data.forecast_summary}
                        </p>
                    )}
                    <div className="rounded-lg overflow-hidden border border-slate-700 bg-white">
                        <img
                            src={data.forecast_image || 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/figure07.gif'}
                            alt="ENSO Forecast Probability Chart"
                            className="w-full h-auto"
                        />
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                        <span>Source: NOAA Climate Prediction Center</span>
                        <div className="flex items-center gap-4">
                            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-500 inline-block"></span> La Niña</span>
                            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-gray-400 inline-block"></span> Neutral</span>
                            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500 inline-block"></span> El Niño</span>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default EnsoMonitor;
