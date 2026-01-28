// src/components/Volcanoes.jsx
import React, { useMemo, useState } from "react";
import { Activity, AlertTriangle, Info, Mountain, Calendar, ChevronDown } from "lucide-react";
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Legend
} from "recharts";

// Mock Static Data for Volcano Information (Location, Alert Level) - Status could potentially be fetched too if available
const VOLCANO_INFO = [
    { id: 'mvo', name: "Mayon", location: "Albay", alertLevel: 3, status: "Low Level Unrest" },
    { id: 'tvo', name: "Taal", location: "Batangas", alertLevel: 1, status: "Low Level Unrest" },
    { id: 'kvo', name: "Kanlaon", location: "Negros Island", alertLevel: 2, status: "Increasing Unrest" },
    { id: 'bvo', name: "Bulusan", location: "Sorsogon", alertLevel: 1, status: "Normal" },
    { id: 'pvo', name: "Pinatubo", location: "Zambales", alertLevel: 0, status: "Normal" },
    { id: 'hvo', name: "Hibok-hibok", location: "Camiguin", alertLevel: 0, status: "Normal" },
];

const getAlertColor = (level) => {
    switch (level) {
        case 0: return "text-emerald-400 border-emerald-500/30 bg-emerald-500/10";
        case 1: return "text-yellow-400 border-yellow-500/30 bg-yellow-500/10";
        case 2: return "text-orange-400 border-orange-500/30 bg-orange-500/10";
        case 3: return "text-red-400 border-red-500/30 bg-red-500/10";
        case 4: return "text-rose-500 border-rose-600/30 bg-rose-600/10";
        case 5: return "text-purple-400 border-purple-500/30 bg-purple-500/10";
        default: return "text-slate-400 border-slate-500/30 bg-slate-500/10";
    }
};

const Volcanoes = () => {
    const [historyData, setHistoryData] = useState([]);
    const [currentDisplayData, setCurrentDisplayData] = useState({});
    const [loading, setLoading] = useState(true);
    const [filterType, setFilterType] = useState('today'); // today, yesterday, 7days, custom
    const [customDate, setCustomDate] = useState(new Date().toISOString().split('T')[0]);
    const [metadata, setMetadata] = useState(null);

    // Fetch Data
    React.useEffect(() => {
        const fetchData = async () => {
            try {
                const response = await fetch("/data/volcano_data.json");
                if (response.ok) {
                    const json = await response.json();
                    setMetadata(json.metadata);
                    if (json.records && Array.isArray(json.records)) {
                        setHistoryData(json.records);
                    }
                }
            } catch (error) {
                console.error("Failed to fetch volcano data", error);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    // Filter Logic
    const filteredData = useMemo(() => {
        if (!historyData.length) return {};

        // Use PHT (Asia/Manila) to determine "Today" and "Yesterday"
        // This ensures the reset happens at 12:00 AM PHT regardless of user's local time
        const phtOptions = { timeZone: 'Asia/Manila' };
        const now = new Date();
        const todayStr = now.toLocaleDateString('en-CA', phtOptions);

        // Helper to find record by date
        const findRecord = (dateStr) => {
            // Find the LAST record for that specific date (latest update)
            const dayRecords = historyData.filter(r => r.date === dateStr);
            if (dayRecords.length > 0) {
                return dayRecords[dayRecords.length - 1].data;
            }
            return null;
        };

        if (filterType === 'today') {
            const data = findRecord(todayStr);
            // If no data for PHT today (e.g. script runs every 6 hours and it's 12:01 AM PHT), return zeros
            return data || {};
        }

        if (filterType === 'yesterday') {
            // Subtract 24 hours to get a time within the previous PHT day
            const yesterday = new Date(now.getTime() - 86400000);
            const yStr = yesterday.toLocaleDateString('en-CA', phtOptions);
            return findRecord(yStr) || {};
        }

        if (filterType === 'custom') {
            return findRecord(customDate) || {};
        }

        return {}; // 'trend' is handled separately for the chart
    }, [historyData, filterType, customDate]);

    // Chart Data Preparation (All History - Daily Trend)
    const chartData = useMemo(() => {
        // Show chart if filter is 'trend'
        if (filterType !== 'trend' || !historyData.length) return [];

        const dailyMap = new Map();

        // Process all history to get the latest entry for each unique date
        historyData.forEach(record => {
            dailyMap.set(record.date, record.data);
        });

        // Sort dates chronologically
        const sortedDates = Array.from(dailyMap.keys()).sort();

        return sortedDates.map(dateStr => {
            const d = new Date(dateStr);
            const dayData = dailyMap.get(dateStr);
            return {
                date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                ...VOLCANO_INFO.reduce((acc, volcano) => {
                    acc[volcano.name] = parseInt(dayData[volcano.id] || 0);
                    acc[volcano.id] = parseInt(dayData[volcano.id] || 0);
                    return acc;
                }, {})
            };
        });
    }, [historyData, filterType]);

    // Toast State
    const [showToast, setShowToast] = useState(false);

    // Auto-hide toast
    React.useEffect(() => {
        if (showToast) {
            const timer = setTimeout(() => setShowToast(false), 3000);
            return () => clearTimeout(timer);
        }
    }, [showToast]);

    return (
        <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col relative">
            {/* Custom Toast Notification */}
            {showToast && (
                <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-4 duration-300">
                    <div className="bg-slate-900/90 border border-rose-500/30 text-rose-100 px-4 py-2.5 rounded-full shadow-xl flex items-center gap-2 backdrop-blur-md">
                        <Info className="h-4 w-4 text-rose-400" />
                        <span className="text-xs font-medium">This feature is still under development.</span>
                    </div>
                </div>
            )}

            <div className="max-w-6xl mx-auto w-full px-6 py-12 md:px-8">

                {/* Header (Same as before) */}
                <header className="mb-10 flex flex-col gap-6 rounded-2xl border border-slate-800/70 bg-slate-900/50 px-6 py-6 shadow-[0_20px_70px_-40px_rgba(244,63,94,0.5)] md:flex-row md:items-center md:justify-between">
                    <div className="space-y-4">
                        <div className="flex items-center gap-4">
                            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10 text-rose-400">
                                <Mountain className="h-6 w-6" />
                            </span>
                            <div>
                                <p className="text-[10px] uppercase tracking-[0.35em] text-slate-500">Hazard Monitoring</p>
                                <h1 className="text-2xl font-semibold tracking-tight text-slate-50 md:text-3xl">
                                    Volcano Status
                                </h1>
                            </div>
                        </div>
                        <div>
                            <p className="text-sm leading-relaxed text-slate-400">
                                Monitoring active volcanoes in the Philippines.
                                <br />
                                <span className="text-xs text-slate-500">Data source: {metadata?.data_source || 'PHIVOLCS'}</span>
                            </p>
                            <div className="mt-3 h-px w-28 bg-gradient-to-r from-rose-400/70 via-pink-300/60 to-transparent" />
                        </div>
                    </div>
                </header>

                {/* Filters */}
                <div className="mb-8 flex flex-wrap items-center gap-3">
                    {/* Standard Filters */}
                    {['today', 'yesterday', 'trend'].map((type) => (
                        <button
                            key={type}
                            onClick={() => setFilterType(type)}
                            className={`px-4 py-2 rounded-full text-xs font-medium transition-all cursor-pointer ${filterType === type
                                ? "bg-rose-500 text-slate-50 shadow-lg shadow-rose-500/25"
                                : "bg-slate-900 border border-slate-700 text-slate-400 hover:border-rose-500/50 hover:text-rose-300"
                                }`}
                        >
                            {type === 'trend' ? 'Daily Trend' : type.charAt(0).toUpperCase() + type.slice(1)}
                        </button>
                    ))}

                    {/* Custom Date Picker */}
                    <div className={`flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-full px-3 py-1.5 focus-within:border-rose-500/50 transition-colors ${filterType === 'custom' ? 'border-rose-500/50 ring-1 ring-rose-500/20' : ''}`}>
                        <Calendar className="h-3.5 w-3.5 text-slate-400" />
                        <input
                            type="date"
                            max={new Date().toISOString().split('T')[0]}
                            value={customDate}
                            onChange={(e) => {
                                setCustomDate(e.target.value);
                                setFilterType('custom');
                            }}
                            className="bg-transparent text-xs text-slate-300 focus:outline-none w-24 [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:left-0 [&::-webkit-calendar-picker-indicator]:w-full cursor-pointer"
                        />
                        <span className="text-xs text-slate-500 pointer-events-none hidden sm:inline">
                            {filterType === 'custom' ? 'Custom' : 'History'}
                        </span>
                    </div>

                    {/* Last Updated Label */}
                    {metadata && (
                        <div className="ml-auto text-[10px] text-slate-500 hidden md:block">
                            Updated: {new Date(metadata.last_updated).toLocaleString('en-US')}
                        </div>
                    )}
                </div>

                {/* Content Area - Switch between Grid and Chart */}
                {filterType === 'trend' ? (
                    <div className="mb-12">
                        <h3 className="text-lg font-semibold text-slate-100 mb-6 flex items-center gap-2">
                            <Activity className="h-5 w-5 text-rose-400" />
                            Volcanic Earthquake Trend (All History)
                        </h3>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {VOLCANO_INFO.map((volcano) => (
                                <div key={volcano.id} className="rounded-xl border border-slate-800/70 bg-slate-900/50 p-5 h-[300px] flex flex-col">
                                    <div className="flex justify-between items-center mb-4">
                                        <h4 className="text-base font-semibold text-slate-200">{volcano.name}</h4>
                                        <span className={`text-[10px] px-2 py-0.5 rounded border ${getAlertColor(volcano.alertLevel)}`}>
                                            Alert Level {volcano.alertLevel}
                                        </span>
                                    </div>
                                    <div className="flex-1 w-full min-h-0">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <LineChart data={chartData}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                                                <XAxis dataKey="date" stroke="#64748b" tick={{ fontSize: 10 }} tickMargin={5} />
                                                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} allowDecimals={false} />
                                                <Tooltip
                                                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f8fafc', fontSize: '12px' }}
                                                />
                                                <Line
                                                    type="monotone"
                                                    dataKey={volcano.name}
                                                    stroke="#f43f5e"
                                                    strokeWidth={2}
                                                    dot={{ r: 3, fill: '#f43f5e' }}
                                                    activeDot={{ r: 5, fill: '#fff' }}
                                                />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    /* Grid Layout for Single Day View */
                    <div className="mb-12">
                        <h2 className="text-xl font-semibold text-slate-100 mb-6 flex items-center gap-2">
                            <Activity className="h-5 w-5 text-rose-400" />
                            Active Volcanoes Summary {filterType !== 'today' && `(${filterType === 'custom' ? customDate : 'Yesterday'})`}
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {VOLCANO_INFO.map((volcano) => {
                                const earthquakeCount = filteredData[volcano.id] || 0;

                                return (
                                    <div
                                        key={volcano.id}
                                        className="group relative overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 p-5 hover:border-rose-500/30 transition-all"
                                    >
                                        <div className="flex justify-between items-start mb-4">
                                            <div>
                                                <h3 className="text-lg font-bold text-slate-100">{volcano.name}</h3>
                                                <p className="text-xs text-slate-400">{volcano.location}</p>
                                            </div>
                                            <div className={`px-2.5 py-1 rounded-md text-xs font-semibold border ${getAlertColor(volcano.alertLevel)}`}>
                                                Alert Level {volcano.alertLevel}
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between mb-4 bg-slate-950/40 rounded-lg p-3 border border-slate-800/50">
                                            <div>
                                                <p className="text-[10px] text-slate-400 uppercase tracking-wide">Volcanic Earthquakes</p>
                                                <p className="text-2xl font-bold text-slate-100">{earthquakeCount}</p>
                                            </div>
                                            <Activity className="h-6 w-6 text-rose-500/50" />
                                        </div>

                                        <div className="mb-2">
                                            <p className="text-sm text-slate-300 font-medium">Status: <span className="text-slate-200">{volcano.status}</span></p>
                                        </div>

                                        <div className="flex justify-end mt-4">
                                            <button
                                                onClick={() => setShowToast(true)}
                                                title="This feature is still under development"
                                                className="text-xs text-rose-400 hover:text-rose-300 font-medium flex items-center gap-1 focus:outline-none"
                                            >
                                                View Bulletin <Info className="h-3 w-3" />
                                            </button>
                                        </div>

                                        {/* Decorative background glow */}
                                        <div className="absolute -bottom-4 -right-4 h-24 w-24 rounded-full bg-rose-500/5 blur-2xl group-hover:bg-rose-500/10 transition-all" />
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}



            </div>
        </div>
    );
};

export default Volcanoes;
