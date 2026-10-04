// src/components/Volcanoes.jsx
import React, { useMemo, useState, useEffect } from "react";
import { 
    Activity, 
    AlertTriangle, 
    Info, 
    Mountain, 
    Calendar, 
    ChevronDown, 
    Globe, 
    X, 
    MapPin, 
    Compass, 
    Maximize2, 
    TrendingUp, 
    ExternalLink, 
    ShieldAlert,
    RefreshCw,
    ChevronLeft,
    ChevronRight,
    ArrowRight
} from "lucide-react";
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Legend
} from "recharts";

// Enriched Static Data for Volcano Information
const VOLCANO_INFO = [
    { 
        id: 'mvo', 
        name: "Mayon", 
        location: "Albay", 
        alertLevel: 3, 
        status: "Low Level Unrest",
        coordinates: [13.2548, 123.6861],
        type: "Stratovolcano",
        elevation: "2,463 m",
        description: "Renowned for its symmetric 'perfect cone' shape, Mayon is the most active and historically volatile volcano in the Philippines.",
        bulletinUrl: "https://www.phivolcs.dost.gov.ph/index.php/volcano-advisory-menu-key/54-volcano-bulletin/mayon-volcano",
        alertDetails: "Relatively high level of unrest. Magma is close to or at the crater, and hazardous eruption is possible within weeks or even days.",
        recommendations: "Strictly prohibit entry into the 6-kilometer radius Permanent Danger Zone (PDZ) due to active danger of rockfalls, landslides, sudden ash puffs, and pyroclastic density currents."
    },
    { 
        id: 'tvo', 
        name: "Taal", 
        location: "Batangas", 
        alertLevel: 1, 
        status: "Low Level Unrest",
        coordinates: [14.0094, 120.9961],
        type: "Caldera / Complex Volcano",
        elevation: "311 m",
        description: "A complex volcanic system situated inside a scenic caldera lake, representing one of the lowest yet most dangerous active volcanoes globally.",
        bulletinUrl: "https://www.phivolcs.dost.gov.ph/index.php/volcano-advisory-menu-key/54-volcano-bulletin/taal-volcano",
        alertDetails: "Low-level unrest. Abnormal seismic or gas emission parameters recorded. Minor hydrothermal activity or localized steam-driven explosions may occur.",
        recommendations: "Entry into Taal Volcano Island (TVI), especially the Main Crater and Daang Kastila fissures, must remain strictly prohibited."
    },
    { 
        id: 'kvo', 
        name: "Kanlaon", 
        location: "Negros Island", 
        alertLevel: 2, 
        status: "Increasing Unrest",
        coordinates: [10.4116, 123.1311],
        type: "Stratovolcano",
        elevation: "2,435 m",
        description: "The highest mountain peak in the Visayas, forming an imposing active stratovolcano spanning Negros Occidental and Negros Oriental.",
        bulletinUrl: "https://www.phivolcs.dost.gov.ph/index.php/volcano-advisory-menu-key/54-volcano-bulletin/kanlaon-volcano",
        alertDetails: "Moderate level of unrest. Elevated volcanic seismicity, gas emission, or localized inflation. Increased likelihood of sudden steam-driven eruptions.",
        recommendations: "Strictly enforce the 4-kilometer radius Permanent Danger Zone (PDZ). Residents must remain highly vigilant against sudden phreatic explosions."
    },
    { 
        id: 'bvo', 
        name: "Bulusan", 
        location: "Sorsogon", 
        alertLevel: 1, 
        status: "Normal",
        coordinates: [12.7705, 124.0567],
        type: "Stratovolcano",
        elevation: "1,565 m",
        description: "An active volcano occupying Sorsogon province, characterized by multiple craters, vents, and abundant geothermal thermal springs.",
        bulletinUrl: "https://www.phivolcs.dost.gov.ph/index.php/volcano-advisory-menu-key/54-volcano-bulletin/bulusan-volcano",
        alertDetails: "Low-level unrest. Slight deviations from baseline parameters, but no imminent major magmatic eruption threatened.",
        recommendations: "Strictly avoid entering the 4-kilometer radius Permanent Danger Zone (PDZ) due to risk of sudden steam-driven ash explosions."
    },
    { 
        id: 'pvo', 
        name: "Pinatubo", 
        location: "Zambales", 
        alertLevel: 0, 
        status: "Normal",
        coordinates: [15.1300, 120.3500],
        type: "Stratovolcano / Caldera",
        elevation: "1,486 m",
        description: "Famed for its cataclysmic, climate-altering 1991 eruption, the volcano now houses a peaceful deep crater lake.",
        bulletinUrl: "https://www.phivolcs.dost.gov.ph/index.php/volcano-advisory-menu-key/54-volcano-bulletin/pinatubo-volcano",
        alertDetails: "Normal or baseline status. Background level seismicity, temperature, and volcanic gas emissions. No threat of eruption detected.",
        recommendations: "Climbing into the crater is open but should be navigated with caution due to localized rockfalls or landslide risks."
    },
    { 
        id: 'hvo', 
        name: "Hibok-hibok", 
        location: "Camiguin", 
        alertLevel: 0, 
        status: "Normal",
        coordinates: [9.2040, 124.6730],
        type: "Stratovolcano / Dome Complex",
        elevation: "1,332 m",
        description: "A dome-building volcano located on Camiguin Island in northern Mindanao, serving as a scenic trekking site.",
        bulletinUrl: "https://www.phivolcs.dost.gov.ph/index.php/volcano-advisory-menu-key/54-volcano-bulletin/hibok-hibok-volcano",
        alertDetails: "Normal or baseline status. No volcanic hazards present. Safe for standard local activities.",
        recommendations: "Observe standard outdoor precautions. Eco-tourism, hiking, and agricultural activities remain fully operational."
    },
];

// Alert Configuration Helper
const getAlertConfig = (level) => {
    switch (level) {
        case 0:
            return {
                label: "Normal",
                colorClass: "text-emerald-400 border-emerald-500/20 bg-emerald-500/10",
                glowClass: "group-hover:shadow-emerald-950/20",
                color: "#10b981",
                percentage: 5
            };
        case 1:
            return {
                label: "Low-level Unrest",
                colorClass: "text-yellow-400 border-yellow-500/20 bg-yellow-500/10",
                glowClass: "group-hover:shadow-yellow-950/20",
                color: "#eab308",
                percentage: 20
            };
        case 2:
            return {
                label: "Increasing Unrest",
                colorClass: "text-orange-400 border-orange-500/20 bg-orange-500/10",
                glowClass: "group-hover:shadow-orange-950/20",
                color: "#f97316",
                percentage: 45
            };
        case 3:
            return {
                label: "High Unrest",
                colorClass: "text-red-400 border-red-500/20 bg-red-500/10",
                glowClass: "group-hover:shadow-red-950/20",
                color: "#ef4444",
                percentage: 65
            };
        case 4:
            return {
                label: "Imminent Eruption",
                colorClass: "text-rose-450 border-rose-500/20 bg-rose-500/10",
                glowClass: "group-hover:shadow-rose-950/20",
                color: "#f43f5e",
                percentage: 85
            };
        case 5:
            return {
                label: "Hazardous Eruption",
                colorClass: "text-purple-400 border-purple-500/20 bg-purple-500/10",
                glowClass: "group-hover:shadow-purple-950/20",
                color: "#a855f7",
                percentage: 100
            };
        default:
            return {
                label: "Unknown",
                colorClass: "text-slate-400 border-slate-500/20 bg-slate-500/10",
                glowClass: "group-hover:shadow-slate-950/20",
                color: "#64748b",
                percentage: 0
            };
    }
};

const Volcanoes = () => {
    const [historyData, setHistoryData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filterType, setFilterType] = useState('today'); // today, yesterday, custom
    const [customDate, setCustomDate] = useState(new Date().toISOString().split('T')[0]);
    const [metadata, setMetadata] = useState(null);
    const [selectedVolcanoId, setSelectedVolcanoId] = useState('mvo');
    
    // Volcano Navigation Helpers
    const activeIndex = useMemo(() => {
        const idx = VOLCANO_INFO.findIndex(v => v.id === selectedVolcanoId);
        return idx >= 0 ? idx : 0;
    }, [selectedVolcanoId]);

    const currentVolcano = VOLCANO_INFO[activeIndex] || VOLCANO_INFO[0];
    const prevVolcano = VOLCANO_INFO[(activeIndex - 1 + VOLCANO_INFO.length) % VOLCANO_INFO.length];
    const nextVolcano = VOLCANO_INFO[(activeIndex + 1) % VOLCANO_INFO.length];

    const handleNextVolcano = () => {
        setSelectedVolcanoId(nextVolcano.id);
    };

    const handlePrevVolcano = () => {
        setSelectedVolcanoId(prevVolcano.id);
    };

    // Chart controls
    const [chartView, setChartView] = useState('compare'); // compare, single
    const [focusedChartVolcanoId, setFocusedChartVolcanoId] = useState('mvo');
    const [enabledVolcanoes, setEnabledVolcanoes] = useState({
        mvo: true,
        tvo: true,
        kvo: true,
        bvo: true,
        pvo: false,
        hvo: false
    });

    // Live API status + manual refresh state
    const [apiStatus, setApiStatus] = useState(null); // 'live' | 'fallback' | 'error'
    const [refreshing, setRefreshing] = useState(false);

    // Fetch Data — reusable for initial load and manual refresh
    const fetchData = async (isRefresh = false) => {
        if (!isRefresh) setLoading(true);
        setRefreshing(isRefresh);
        try {
            let fromFallback = false;
            let response = await fetch("/api/volcano-data").catch(() => null);
            if (!response || !response.ok) {
                response = await fetch("/data/volcano_data.json");
                fromFallback = true;
            }
            if (response && response.ok) {
                const json = await response.json();
                setMetadata(json.metadata);
                if (json.records && Array.isArray(json.records)) {
                    setHistoryData(json.records);
                }
                setApiStatus(fromFallback ? 'fallback' : 'live');
            } else {
                setApiStatus('error');
            }
        } catch (error) {
            console.error("Failed to fetch volcano data", error);
            setApiStatus('error');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    // Filter Logic for Current Seismicity - falls back to latest record if today's record is empty
    const filteredRecord = useMemo(() => {
        if (!historyData.length) return { date: '', data: {} };

        const phtOptions = { timeZone: 'Asia/Manila' };
        const now = new Date();
        const todayStr = now.toLocaleDateString('en-CA', phtOptions);

        const findRecord = (dateStr) => {
            const dayRecords = historyData.filter(r => r.date === dateStr);
            if (dayRecords.length > 0) {
                return dayRecords[dayRecords.length - 1];
            }
            return null;
        };

        if (filterType === 'today') {
            const todayRec = findRecord(todayStr);
            if (todayRec) return todayRec;
            // Fallback to the latest record in historyData
            if (historyData.length > 0) {
                return historyData[historyData.length - 1];
            }
        }

        if (filterType === 'yesterday') {
            const yesterday = new Date(now.getTime() - 86400000);
            const yStr = yesterday.toLocaleDateString('en-CA', phtOptions);
            const yesterdayRec = findRecord(yStr);
            if (yesterdayRec) return yesterdayRec;
            // Fallback to the second-to-last record in historyData
            if (historyData.length > 1) {
                return historyData[historyData.length - 2];
            }
        }

        if (filterType === 'custom') {
            const customRec = findRecord(customDate);
            if (customRec) return customRec;
            return { date: customDate, data: {} };
        }

        return { date: '', data: {} };
    }, [historyData, filterType, customDate]);

    const filteredData = useMemo(() => filteredRecord.data || {}, [filteredRecord]);
    const activeDataDate = filteredRecord.date;

    const formattedActiveDate = useMemo(() => {
        if (!activeDataDate) return '';
        const d = new Date(activeDataDate);
        return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    }, [activeDataDate]);

    const formattedLastUpdated = useMemo(() => {
        if (!metadata?.last_updated) return null;
        try {
            const d = new Date(metadata.last_updated);
            return d.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'Asia/Manila',
                hour12: true
            }) + ' PHT';
        } catch {
            return null;
        }
    }, [metadata]);

    // Aggregate statistics
    const stats = useMemo(() => {
        const totalMonitored = VOLCANO_INFO.length;
        const activeAlerts = VOLCANO_INFO.filter(v => v.alertLevel > 0).length;
        const maxLevel = Math.max(...VOLCANO_INFO.map(v => v.alertLevel));
        
        let earthquakesToday = 0;
        VOLCANO_INFO.forEach(volcano => {
            earthquakesToday += parseInt(filteredData[volcano.id] || 0);
        });

        return {
            totalMonitored,
            activeAlerts,
            maxLevel,
            earthquakesToday
        };
    }, [filteredData]);

    // Chart Data Formulation
    const chartData = useMemo(() => {
        if (!historyData.length) return [];

        const dailyMap = new Map();
        historyData.forEach(record => {
            dailyMap.set(record.date, record.data);
        });

        const sortedDates = Array.from(dailyMap.keys()).sort();

        // Limit chart to last 20 records for clean spacing
        const lastRecords = sortedDates.slice(-20);

        return lastRecords.map(dateStr => {
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
    }, [historyData]);

    // Handler to select volcano on click
    const handleVolcanoSelect = (id) => {
        setSelectedVolcanoId(selectedVolcanoId === id ? null : id);
    };

    // Toggle enabled volcanoes for comparison chart
    const toggleVolcanoChartLine = (id) => {
        setEnabledVolcanoes(prev => ({
            ...prev,
            [id]: !prev[id]
        }));
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-950 text-slate-50 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-[45vw] h-[45vw] rounded-full bg-rose-950/10 blur-[150px] pointer-events-none" />
                <div className="max-w-6xl mx-auto w-full px-4 py-8 md:px-6 space-y-6">
                    {/* Skeleton header */}
                    <div className="h-[112px] rounded-2xl bg-slate-900/60 border border-slate-800/60 animate-pulse" />
                    {/* Skeleton stat cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {[...Array(4)].map((_, i) => (
                            <div key={i} className="h-20 rounded-xl bg-slate-900/60 border border-slate-800/60 animate-pulse" />
                        ))}
                    </div>
                    {/* Skeleton volcano pills */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                        {[...Array(6)].map((_, i) => (
                            <div key={i} className="h-24 rounded-xl bg-slate-900/60 border border-slate-800/60 animate-pulse" />
                        ))}
                    </div>
                    {/* Skeleton featured card */}
                    <div className="h-[440px] rounded-3xl bg-slate-900/60 border border-slate-800/60 flex flex-col items-center justify-center gap-3">
                        <div className="h-8 w-8 border-[3px] border-rose-500 border-t-transparent rounded-full animate-spin" />
                        <p className="text-slate-500 text-xs font-medium tracking-wide">Fetching live PHIVOLCS telemetry...</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-950 text-slate-50 relative pb-16">
            {/* Background mesh decor */}
            <div className="absolute top-0 right-0 w-[45vw] h-[45vw] rounded-full bg-rose-950/10 blur-[150px] pointer-events-none z-0" />
            <div className="absolute top-[40vh] left-0 w-[30vw] h-[30vw] rounded-full bg-amber-950/10 blur-[130px] pointer-events-none z-0" />

            <div className="max-w-6xl mx-auto w-full px-4 py-8 md:px-6 z-10 relative">
                
                {/* HERO HEADER */}
                <header className="mb-8 p-6 rounded-2xl border border-slate-800/80 bg-slate-900/40 backdrop-blur-md flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-[0_15px_40px_-20px_rgba(244,63,94,0.15)]">
                    <div className="space-y-3">
                        <div className="flex items-center gap-3">
                            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.2)] animate-pulse">
                                <Mountain className="h-5.5 w-5.5" />
                            </span>
                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-rose-400/90">Hazard Operations</p>
                                <div className="flex items-center gap-2.5 flex-wrap">
                                    <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-slate-50 via-slate-100 to-rose-400">
                                        Volcano Status
                                    </h1>
                                    {/* Live / Cached / Offline badge */}
                                    {apiStatus === 'live' && (
                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-[10px] font-bold uppercase tracking-wider">
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                                            Live
                                        </span>
                                    )}
                                    {apiStatus === 'fallback' && (
                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-400 text-[10px] font-bold uppercase tracking-wider">
                                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                            Cached
                                        </span>
                                    )}
                                    {apiStatus === 'error' && (
                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-red-500/10 border border-red-500/25 text-red-400 text-[10px] font-bold uppercase tracking-wider">
                                            <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                                            Offline
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <p className="text-xs md:text-sm text-slate-400 max-w-xl leading-relaxed">
                                Geospatial tracking and seismicity metrics of major volcanic centers in the Philippines.
                                <span className="text-[10px] text-slate-500 block mt-0.5">Data source: {metadata?.data_source || 'PHIVOLCS (DOST)'}</span>
                            </p>
                            {formattedLastUpdated && (
                                <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                                    <Activity className="h-3 w-3 text-slate-600" />
                                    <span>Last synced: <span className="text-slate-400 font-semibold">{formattedLastUpdated}</span></span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Filters, Date Picker & Refresh */}
                    <div className="flex flex-wrap items-center gap-2 md:self-end">
                        {['today', 'yesterday'].map((type) => (
                            <button
                                key={type}
                                onClick={() => setFilterType(type)}
                                className={`px-4 py-2 rounded-xl text-xs font-semibold tracking-wide transition-all duration-300 cursor-pointer ${
                                    filterType === type
                                        ? "bg-rose-500 text-slate-50 shadow-lg shadow-rose-500/20 border border-rose-400/40"
                                        : "bg-slate-900/60 border border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                                }`}
                            >
                                {type.charAt(0).toUpperCase() + type.slice(1)}
                            </button>
                        ))}

                        <div className={`flex items-center gap-2 bg-slate-900/60 border border-slate-800 rounded-xl px-3 py-1.5 focus-within:border-rose-500/40 transition-colors ${filterType === 'custom' ? 'border-rose-500/40 ring-1 ring-rose-500/20' : ''}`}>
                            <Calendar className="h-3.5 w-3.5 text-slate-500" />
                            <input
                                type="date"
                                max={new Date().toISOString().split('T')[0]}
                                value={customDate}
                                onChange={(e) => {
                                    setCustomDate(e.target.value);
                                    setFilterType('custom');
                                }}
                                className="bg-transparent text-xs text-slate-300 focus:outline-none w-24 cursor-pointer"
                            />
                            <span className="text-[10px] text-slate-500 pointer-events-none hidden sm:inline">
                                History
                            </span>
                        </div>

                        {/* Manual Refresh button */}
                        <button
                            onClick={() => fetchData(true)}
                            disabled={refreshing}
                            title="Refresh live PHIVOLCS data"
                            className="p-2 rounded-xl bg-slate-900/60 border border-slate-800 text-slate-400 hover:border-rose-500/40 hover:text-rose-400 transition-all duration-300 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <RefreshCw className={`h-3.5 w-3.5 transition-transform ${refreshing ? 'animate-spin' : 'hover:rotate-180 duration-500'}`} />
                        </button>
                    </div>
                </header>

                {/* API Status Banners */}
                {apiStatus === 'fallback' && (
                    <div className="mb-6 flex items-center gap-3 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 font-medium">
                        <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                        <span>Live PHIVOLCS data unavailable — showing archived baseline data. <button onClick={() => fetchData(true)} className="underline text-amber-400 hover:text-amber-300 cursor-pointer transition-colors">Try refresh</button></span>
                    </div>
                )}
                {apiStatus === 'error' && (
                    <div className="mb-6 flex items-center gap-3 p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-300 font-medium">
                        <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
                        <span>Unable to connect to PHIVOLCS VMEPD. Volcanic seismicity data is currently unavailable. <button onClick={() => fetchData(true)} className="underline text-red-400 hover:text-red-300 cursor-pointer transition-colors">Retry</button></span>
                    </div>
                )}

                {/* STATS OVERVIEW BAR */}
                <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                    {/* Stat item 1 */}
                    <div className="bg-slate-900/40 border border-slate-900/80 rounded-xl p-4 flex items-center gap-3.5">
                        <div className="h-10 w-10 rounded-lg bg-slate-800/80 border border-slate-700/50 flex items-center justify-center text-slate-400">
                            <Globe className="h-5 w-5" />
                        </div>
                        <div>
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Monitored</p>
                            <p className="text-xl font-bold text-slate-100">{stats.totalMonitored} Systems</p>
                        </div>
                    </div>

                    {/* Stat item 2 */}
                    <div className="bg-slate-900/40 border border-slate-900/80 rounded-xl p-4 flex items-center gap-3.5">
                        <div className="h-10 w-10 rounded-lg bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center text-yellow-400">
                            <AlertTriangle className="h-5 w-5" />
                        </div>
                        <div>
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Elevated Alert</p>
                            <p className="text-xl font-bold text-yellow-400">{stats.activeAlerts} Active</p>
                        </div>
                    </div>

                    {/* Stat item 3 */}
                    <div className="bg-slate-900/40 border border-slate-900/80 rounded-xl p-4 flex items-center gap-3.5">
                        <div className="h-10 w-10 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
                            <ShieldAlert className="h-5 w-5" />
                        </div>
                        <div>
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Max Threat</p>
                            <p className="text-xl font-bold text-rose-400">Level {stats.maxLevel}</p>
                        </div>
                    </div>

                    {/* Stat item 4 */}
                    <div className="bg-slate-900/40 border border-slate-900/80 rounded-xl p-4 flex items-center gap-3.5">
                        <div className="h-10 w-10 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
                            <Activity className="h-5 w-5 animate-pulse" />
                        </div>
                        <div>
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total Earthquakes</p>
                            <p className="text-xl font-bold text-slate-100">{stats.earthquakesToday} Quakes</p>
                        </div>
                    </div>
                </section>

                {/* VOLCANO SYSTEMS BROWSER & DETAILED CARD */}
                <section className="mb-8 space-y-6">
                    {/* Section Header with Quick Next Controls */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4">
                        <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 shrink-0">
                                <Mountain className="h-5 w-5" />
                            </div>
                            <div>
                                <h2 className="text-sm font-extrabold text-slate-100 uppercase tracking-wider flex items-center gap-2">
                                    Monitored Volcano Systems
                                    <span className="text-[10px] font-semibold normal-case px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700/60">
                                        {activeIndex + 1} of {VOLCANO_INFO.length}
                                    </span>
                                </h2>
                                <p className="text-xs text-slate-400">
                                    Showing real-time PHIVOLCS status, 24h seismicity counters, and safety zones.
                                </p>
                            </div>
                        </div>

                        {/* Quick Prev / Next Buttons */}
                        <div className="flex items-center gap-2 self-start sm:self-center">
                            <button
                                onClick={handlePrevVolcano}
                                className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-sm"
                                title={`Previous: ${prevVolcano.name}`}
                            >
                                <ChevronLeft className="h-4 w-4" />
                                <span className="hidden md:inline">{prevVolcano.name}</span>
                            </button>
                            <button
                                onClick={handleNextVolcano}
                                className="px-4 py-2 rounded-xl bg-gradient-to-r from-rose-500 to-amber-600 hover:from-rose-400 hover:to-amber-500 text-white text-xs font-bold flex items-center gap-2 transition-all active:scale-95 cursor-pointer shadow-lg shadow-rose-950/40"
                                title={`Next: ${nextVolcano.name}`}
                            >
                                <span>Next Volcano</span>
                                <span className="font-medium opacity-90 hidden md:inline">({nextVolcano.name})</span>
                                <ArrowRight className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>

                    {/* Volcano Selector Cards Strip (All 6 volcanoes as selectable cards) */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                        {VOLCANO_INFO.map((volcano) => {
                            const isSelected = volcano.id === currentVolcano.id;
                            const config = getAlertConfig(volcano.alertLevel);
                            const eqCount = filteredData[volcano.id] || 0;
                            return (
                                <button
                                    key={volcano.id}
                                    onClick={() => setSelectedVolcanoId(volcano.id)}
                                    className={`relative p-3.5 rounded-xl border text-left transition-all duration-200 flex flex-col justify-between gap-2.5 cursor-pointer ${
                                        isSelected
                                            ? "bg-slate-800/90 border-slate-600 shadow-xl ring-2"
                                            : "bg-slate-900/40 border-slate-800/80 hover:bg-slate-800/50 hover:border-slate-700"
                                    }`}
                                    style={isSelected ? {
                                        borderColor: config.color,
                                        boxShadow: `0 8px 24px -6px ${config.color}35`,
                                        '--tw-ring-color': `${config.color}40`
                                    } : {}}
                                >
                                    {/* Top alert level indicator dot */}
                                    <div className="flex items-center justify-between w-full">
                                        <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-md border"
                                            style={{
                                                backgroundColor: `${config.color}15`,
                                                color: config.color,
                                                borderColor: `${config.color}35`
                                            }}
                                        >
                                            Lvl {volcano.alertLevel}
                                        </span>
                                        {isSelected && (
                                            <span className="w-2 h-2 rounded-full animate-ping" style={{ backgroundColor: config.color }} />
                                        )}
                                    </div>

                                    <div>
                                        <h3 className="text-sm font-extrabold text-slate-100 leading-tight">
                                            {volcano.name}
                                        </h3>
                                        <p className="text-[10px] text-slate-500 flex items-center gap-0.5 mt-0.5">
                                            <MapPin className="h-2.5 w-2.5" />
                                            {volcano.location}
                                        </p>
                                    </div>

                                    <div className="flex items-center justify-between text-[10px] pt-1.5 border-t border-slate-800/80">
                                        <span className="text-slate-500">24h Quakes</span>
                                        <span className="font-bold text-slate-200">{eqCount}</span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    {/* THE FEATURED VOLCANO DETAILED CARD */}
                    {(() => {
                        const volcano = currentVolcano;
                        const config = getAlertConfig(volcano.alertLevel);
                        const eqCount = filteredData[volcano.id] || 0;

                        return (
                            <div 
                                className="relative overflow-hidden rounded-3xl border bg-slate-900/70 backdrop-blur-xl shadow-2xl transition-all duration-300"
                                style={{
                                    borderColor: `${config.color}40`,
                                    boxShadow: `0 16px 40px -12px ${config.color}20`
                                }}
                            >
                                {/* Glowing Top Alert Bar */}
                                <div className="h-1.5 w-full transition-colors duration-500" style={{ backgroundColor: config.color }} />

                                {/* Subtle Radial Glow in background */}
                                <div 
                                    className="absolute -right-20 -top-20 w-80 h-80 rounded-full blur-3xl pointer-events-none opacity-15"
                                    style={{ backgroundColor: config.color }}
                                />

                                <div className="p-6 sm:p-8 space-y-6">
                                    {/* Header: Identity + Alert Badge + Navigation */}
                                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-6">
                                        <div className="flex items-start gap-4">
                                            {/* Volcano Icon Stamp */}
                                            <div 
                                                className="h-14 w-14 rounded-2xl flex items-center justify-center border shrink-0 shadow-lg"
                                                style={{
                                                    backgroundColor: `${config.color}15`,
                                                    borderColor: `${config.color}40`
                                                }}
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
                                                    fill={config.color} stroke={config.color} strokeWidth="1"
                                                    className="h-8 w-8">
                                                    <path d="m8 3 4 8 5-5 5 15H2L8 3z"/>
                                                </svg>
                                            </div>

                                            <div className="space-y-1">
                                                <div className="flex flex-wrap items-center gap-2.5">
                                                    <h1 className="text-2xl sm:text-3xl font-black text-slate-100 tracking-tight">
                                                        {volcano.name} Volcano
                                                    </h1>
                                                    <span className={`px-2.5 py-1 rounded-xl text-xs font-black border flex items-center gap-1.5 uppercase tracking-wider ${config.colorClass}`}>
                                                        <span className="w-2 h-2 rounded-full animate-ping" style={{ backgroundColor: config.color }} />
                                                        Alert Level {volcano.alertLevel}: {config.label}
                                                    </span>
                                                </div>
                                                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                                                    <span className="flex items-center gap-1">
                                                        <MapPin className="h-3.5 w-3.5 text-rose-400" />
                                                        {volcano.location} Province, Philippines
                                                    </span>
                                                    <span className="text-slate-700">•</span>
                                                    <span className="flex items-center gap-1">
                                                        <Compass className="h-3.5 w-3.5 text-slate-500" />
                                                        {volcano.type}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Top Next Volcano Button */}
                                        <div className="flex items-center gap-2 self-start md:self-auto shrink-0">
                                            <button
                                                onClick={handlePrevVolcano}
                                                className="p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 text-slate-300 hover:text-white transition-all cursor-pointer shadow-sm active:scale-95"
                                                title={`Previous: ${prevVolcano.name}`}
                                            >
                                                <ChevronLeft className="h-5 w-5" />
                                            </button>
                                            <button
                                                onClick={handleNextVolcano}
                                                className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-rose-500 to-amber-600 hover:from-rose-400 hover:to-amber-500 text-white font-extrabold text-xs flex items-center gap-2 transition-all cursor-pointer shadow-lg shadow-rose-950/40 active:scale-95"
                                            >
                                                <span>Next Volcano: {nextVolcano.name}</span>
                                                <ArrowRight className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </div>

                                    {/* 4 Vital Metric Blocks */}
                                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                        {/* Threat Severity */}
                                        <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-2">
                                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Threat Severity</span>
                                            <div className="flex items-baseline justify-between">
                                                <span className="text-base font-extrabold" style={{ color: config.color }}>{config.label}</span>
                                                <span className="text-xs font-bold text-slate-400">{config.percentage}%</span>
                                            </div>
                                            <div className="h-2 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                                                <div
                                                    className="h-full rounded-full transition-all duration-700"
                                                    style={{ width: `${config.percentage}%`, backgroundColor: config.color }}
                                                />
                                            </div>
                                        </div>

                                        {/* 24h Volcanic Earthquakes */}
                                        <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-2">
                                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">24h Seismicity</span>
                                            <div className="flex items-center justify-between">
                                                <span className="text-xl sm:text-2xl font-black text-rose-400 flex items-center gap-1.5">
                                                    <Activity className="h-5 w-5 text-rose-400 animate-pulse" />
                                                    {eqCount}
                                                </span>
                                                <span className="text-[10px] font-bold text-slate-500 uppercase">Quakes Recorded</span>
                                            </div>
                                            <p className="text-[10px] text-slate-500">Live 24h counter from PHIVOLCS</p>
                                        </div>

                                        {/* Summit Elevation */}
                                        <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-2">
                                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Summit Elevation</span>
                                            <div className="flex items-baseline justify-between">
                                                <span className="text-xl sm:text-2xl font-black text-slate-100">{volcano.elevation}</span>
                                                <span className="text-[10px] font-bold text-slate-500">ASL</span>
                                            </div>
                                            <p className="text-[10px] text-slate-500 truncate">{volcano.type}</p>
                                        </div>

                                        {/* Coordinates */}
                                        <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-2">
                                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Coordinates</span>
                                            <span className="text-sm sm:text-base font-extrabold text-slate-200 block truncate">
                                                {volcano.coordinates[0].toFixed(4)}°N, {volcano.coordinates[1].toFixed(4)}°E
                                            </span>
                                            <p className="text-[10px] text-slate-500">Philippine Volcanic Arc</p>
                                        </div>
                                    </div>

                                    {/* Detailed Activity & Advisories (3 Panels) */}
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                                        {/* Panel 1: Current Status & Activity */}
                                        <div 
                                            className="p-5 rounded-2xl border space-y-2.5 flex flex-col justify-between"
                                            style={{ 
                                                backgroundColor: `${config.color}08`, 
                                                borderColor: `${config.color}30` 
                                            }}
                                        >
                                            <div>
                                                <h3 className="text-xs font-black uppercase tracking-wider flex items-center gap-2 mb-2" style={{ color: config.color }}>
                                                    <AlertTriangle className="h-4 w-4" />
                                                    Current Alert Status
                                                </h3>
                                                <p className="text-xs text-slate-200 font-medium leading-relaxed">
                                                    {volcano.alertDetails}
                                                </p>
                                            </div>
                                            <div className="pt-2 border-t border-slate-800/60 text-[10px] text-slate-400">
                                                Status: <strong style={{ color: config.color }}>{volcano.status}</strong>
                                            </div>
                                        </div>

                                        {/* Panel 2: Safety Directives & Danger Zones */}
                                        <div className="p-5 rounded-2xl bg-slate-950/50 border border-slate-800/80 space-y-2.5 flex flex-col justify-between">
                                            <div>
                                                <h3 className="text-xs font-black text-rose-400 uppercase tracking-wider flex items-center gap-2 mb-2">
                                                    <ShieldAlert className="h-4 w-4" />
                                                    Safety Advisory & Zones
                                                </h3>
                                                <p className="text-xs text-slate-300 font-medium leading-relaxed">
                                                    {volcano.recommendations}
                                                </p>
                                            </div>
                                            <div className="pt-2 border-t border-slate-800/60 text-[10px] text-rose-400/90 font-bold">
                                                Strict Permanent Danger Zone Compliance Required
                                            </div>
                                        </div>

                                        {/* Panel 3: Geological Profile */}
                                        <div className="p-5 rounded-2xl bg-slate-950/50 border border-slate-800/80 space-y-2.5 flex flex-col justify-between">
                                            <div>
                                                <h3 className="text-xs font-black text-slate-300 uppercase tracking-wider flex items-center gap-2 mb-2">
                                                    <Mountain className="h-4 w-4 text-slate-500" />
                                                    Geological Profile
                                                </h3>
                                                <p className="text-xs text-slate-400 font-medium leading-relaxed">
                                                    {volcano.description}
                                                </p>
                                            </div>
                                            <div className="pt-2 border-t border-slate-800/60 text-[10px] text-slate-500">
                                                Active Volcano Classification: <strong className="text-slate-300">Monitored</strong>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Bottom Navigation & Actions Bar */}
                                    <div className="pt-6 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-4">
                                        {/* Official Bulletin Link */}
                                        <a
                                            href={volcano.bulletinUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-slate-200 transition-all cursor-pointer shadow"
                                        >
                                            <ExternalLink className="h-3.5 w-3.5 text-rose-400" />
                                            <span>PHIVOLCS Official Bulletin</span>
                                        </a>

                                        {/* Middle: Volcano Switcher Indicators */}
                                        <div className="flex items-center gap-2">
                                            {VOLCANO_INFO.map((v) => (
                                                <button
                                                    key={v.id}
                                                    onClick={() => setSelectedVolcanoId(v.id)}
                                                    className={`transition-all rounded-full cursor-pointer ${
                                                        v.id === volcano.id
                                                            ? "w-8 h-2.5 bg-rose-500"
                                                            : "w-2.5 h-2.5 bg-slate-800 hover:bg-slate-600"
                                                    }`}
                                                    title={v.name}
                                                />
                                            ))}
                                        </div>

                                        {/* Navigation Buttons */}
                                        <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
                                            <button
                                                onClick={handlePrevVolcano}
                                                className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-95 shadow"
                                            >
                                                <ChevronLeft className="h-4 w-4" />
                                                <span>{prevVolcano.name}</span>
                                            </button>
                                            <button
                                                onClick={handleNextVolcano}
                                                className="flex-1 sm:flex-initial px-5 py-2.5 rounded-xl bg-gradient-to-r from-rose-500 to-amber-600 hover:from-rose-400 hover:to-amber-500 text-white text-xs font-extrabold flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-95 shadow-lg shadow-rose-950/40"
                                            >
                                                <span>Next Volcano: {nextVolcano.name}</span>
                                                <ArrowRight className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}
                </section>

                {/* UNIFIED TREND EXPLORER */}
                <section className="bg-slate-900/40 border border-slate-900/80 rounded-2xl p-5 mb-8 shadow-xl">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4 mb-6">
                        <div className="space-y-1">
                            <h2 className="text-base font-bold text-slate-200 flex items-center gap-2">
                                <TrendingUp className="h-5 w-5 text-rose-400" />
                                Seismicity Trend Explorer
                            </h2>
                            <p className="text-xs text-slate-500">Historical daily volcanic earthquake counts from PHIVOLCS sensors.</p>
                        </div>

                        {/* Chart View selector tabs */}
                        <div className="flex items-center gap-2 self-start bg-slate-950 p-1 rounded-xl border border-slate-800/80">
                            <button
                                onClick={() => setChartView('compare')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                                    chartView === 'compare' 
                                        ? "bg-slate-900 text-rose-400 border border-slate-800 shadow" 
                                        : "text-slate-500 hover:text-slate-300"
                                }`}
                            >
                                Compare All
                            </button>
                            <button
                                onClick={() => setChartView('single')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                                    chartView === 'single' 
                                        ? "bg-slate-900 text-rose-400 border border-slate-800 shadow" 
                                        : "text-slate-500 hover:text-slate-300"
                                }`}
                            >
                                Single System
                            </button>
                        </div>
                    </div>

                    {/* Chart configuration controls */}
                    <div className="mb-4">
                        {chartView === 'compare' ? (
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mr-2">Toggle lines:</span>
                                {VOLCANO_INFO.map(volcano => {
                                    const enabled = enabledVolcanoes[volcano.id];
                                    const config = getAlertConfig(volcano.alertLevel);
                                    return (
                                        <button
                                            key={volcano.id}
                                            onClick={() => toggleVolcanoChartLine(volcano.id)}
                                            className={`px-3 py-1 rounded-full text-xs font-medium border flex items-center gap-1.5 transition-all cursor-pointer ${
                                                enabled 
                                                    ? "bg-slate-800 text-slate-100 shadow-md" 
                                                    : "bg-slate-950/40 text-slate-600 border-slate-900/50 hover:border-slate-800/50"
                                            }`}
                                            style={{ borderColor: enabled ? `${config.color}40` : '' }}
                                        >
                                            <span 
                                                className={`w-2 h-2 rounded-full ${enabled ? 'animate-pulse' : ''}`}
                                                style={{ backgroundColor: enabled ? config.color : '#475569' }}
                                            />
                                            {volcano.name}
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="flex items-center gap-3">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Select Volcano:</span>
                                <div className="relative">
                                    <select
                                        value={focusedChartVolcanoId}
                                        onChange={(e) => setFocusedChartVolcanoId(e.target.value)}
                                        className="appearance-none bg-slate-950 border border-slate-800 rounded-xl px-4 py-1.5 pr-8 text-xs text-slate-200 focus:outline-none focus:border-rose-500/40 cursor-pointer font-semibold"
                                    >
                                        {VOLCANO_INFO.map(volcano => (
                                            <option key={volcano.id} value={volcano.id}>{volcano.name}</option>
                                        ))}
                                    </select>
                                    <ChevronDown className="h-3.5 w-3.5 text-slate-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Recharts Chart */}
                    <div className="h-[360px] w-full min-h-0">
                        {chartData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                    <defs>
                                        {VOLCANO_INFO.map(volcano => {
                                            const config = getAlertConfig(volcano.alertLevel);
                                            return (
                                                <linearGradient key={volcano.id} id={`color-${volcano.id}`} x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor={config.color} stopOpacity={0.25} />
                                                    <stop offset="95%" stopColor={config.color} stopOpacity={0.0} />
                                                </linearGradient>
                                            );
                                        })}
                                    </defs>
                                    
                                    <CartesianGrid strokeDasharray="3 3" stroke="#111827" vertical={false} />
                                    <XAxis 
                                        dataKey="date" 
                                        stroke="#4b5563" 
                                        tick={{ fontSize: 10, fill: '#6b7280' }} 
                                        dy={10}
                                        axisLine={false}
                                        tickLine={false}
                                    />
                                    <YAxis 
                                        stroke="#4b5563" 
                                        tick={{ fontSize: 10, fill: '#6b7280' }} 
                                        allowDecimals={false}
                                        axisLine={false}
                                        tickLine={false}
                                    />
                                    
                                    <Tooltip
                                        content={({ active, payload, label }) => {
                                            if (active && payload && payload.length) {
                                                return (
                                                    <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 shadow-2xl backdrop-blur-md">
                                                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">{label}</p>
                                                        <div className="space-y-1.5">
                                                            {payload.map((item, idx) => (
                                                                <div key={idx} className="flex items-center gap-6 justify-between text-xs">
                                                                    <div className="flex items-center gap-2">
                                                                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color || item.stroke }} />
                                                                        <span className="text-slate-300 font-medium">{item.name}</span>
                                                                    </div>
                                                                    <span className="font-extrabold text-slate-100">{item.value} quakes</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                );
                                            }
                                            return null;
                                        }}
                                    />

                                    {chartView === 'compare' ? (
                                        VOLCANO_INFO.map(volcano => {
                                            if (!enabledVolcanoes[volcano.id]) return null;
                                            const config = getAlertConfig(volcano.alertLevel);
                                            return (
                                                <Area
                                                    key={volcano.id}
                                                    type="monotone"
                                                    dataKey={volcano.name}
                                                    name={volcano.name}
                                                    stroke={config.color}
                                                    fill={`url(#color-${volcano.id})`}
                                                    strokeWidth={2}
                                                    dot={{ r: 1.5, fill: config.color }}
                                                    activeDot={{ r: 5 }}
                                                />
                                            );
                                        })
                                    ) : (
                                        (() => {
                                            const volcano = VOLCANO_INFO.find(v => v.id === focusedChartVolcanoId);
                                            if (!volcano) return null;
                                            const config = getAlertConfig(volcano.alertLevel);
                                            return (
                                                <Area
                                                    type="monotone"
                                                    dataKey={volcano.name}
                                                    name={volcano.name}
                                                    stroke={config.color}
                                                    fill={`url(#color-${volcano.id})`}
                                                    strokeWidth={2.5}
                                                    dot={{ r: 2, fill: config.color }}
                                                    activeDot={{ r: 6 }}
                                                />
                                            );
                                        })()
                                    )}
                                </AreaChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex items-center justify-center text-xs text-slate-500 font-medium">
                                No historical trend logs indexed.
                            </div>
                        )}
                    </div>
                </section>

            </div>
        </div>
    );
};

export default Volcanoes;
