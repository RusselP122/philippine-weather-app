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
    ShieldAlert
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
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

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

const MAP_CENTER_DEFAULT = [12.2, 122.3]; // Centered on the Visayas/PH
const ZOOM_DEFAULT = 6;
const PH_BOUNDS = [
    [4.0, 115.0],
    [22.0, 128.0]
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

// Custom Marker Creator (Leaftlet divIcon)
const createVolcanoMarker = (volcano, isSelected) => {
    const alertLevel = volcano.alertLevel;
    const config = getAlertConfig(alertLevel);
    const color = config.color;
    
    let pulseClass = "";
    if (alertLevel === 1) pulseClass = "animate-ping opacity-25";
    else if (alertLevel === 2) pulseClass = "animate-ping opacity-45";
    else if (alertLevel === 3) pulseClass = "animate-ping opacity-60";
    else if (alertLevel >= 4) pulseClass = "animate-ping opacity-75";

    const size = isSelected ? 34 : 26;
    const innerSize = isSelected ? 16 : 12;
    const pulseSize = isSelected ? 50 : 38;

    return L.divIcon({
        className: 'custom-volcano-leaflet-marker',
        html: `
            <div class="relative flex items-center justify-center" style="width: ${size}px; height: ${size}px;">
                ${alertLevel > 0 ? `
                <div class="absolute rounded-full ${pulseClass}" 
                     style="width: ${pulseSize}px; height: ${pulseSize}px; background-color: ${color}; animation-duration: 2.5s; animation-iteration-count: infinite;">
                </div>` : ''}
                
                <div class="absolute rounded-full flex items-center justify-center shadow-lg border backdrop-blur-sm transition-all duration-300 ${isSelected ? 'scale-110 shadow-slate-950/50' : ''}"
                     style="width: ${size}px; height: ${size}px; background-color: ${color}20; border-color: ${color};">
                     
                     <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}" stroke="${color}" stroke-width="1.5" 
                          style="width: ${innerSize}px; height: ${innerSize}px;">
                          <path d="m8 3 4 8 5-5 5 15H2L8 3z"/>
                     </svg>
                </div>
            </div>
        `,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        popupAnchor: [0, -size / 2],
    });
};

// Map Recenter Component
const MapRecenter = ({ selectedCoordinates }) => {
    const map = useMap();
    useEffect(() => {
        if (selectedCoordinates) {
            map.setView(selectedCoordinates, 9, {
                animate: true,
                duration: 1.2
            });
        }
    }, [selectedCoordinates, map]);
    return null;
};

// Reset Bounds Component
const ResetMapButton = ({ coordinatesList }) => {
    const map = useMap();
    const handleReset = () => {
        map.fitBounds(coordinatesList, { padding: [50, 50], maxZoom: 8 });
    };
    return (
        <button
            onClick={handleReset}
            className="absolute bottom-4 left-4 z-[400] bg-slate-900/90 hover:bg-slate-900 border border-slate-700/80 hover:border-rose-500/50 text-slate-200 text-xs px-3 py-1.5 rounded-lg backdrop-blur-md transition-all shadow-lg flex items-center gap-1.5 cursor-pointer font-medium"
        >
            <Globe className="h-3.5 w-3.5" />
            Fit All Volcanoes
        </button>
    );
};

const Volcanoes = () => {
    const [historyData, setHistoryData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filterType, setFilterType] = useState('today'); // today, yesterday, custom
    const [customDate, setCustomDate] = useState(new Date().toISOString().split('T')[0]);
    const [metadata, setMetadata] = useState(null);
    const [selectedVolcanoId, setSelectedVolcanoId] = useState(null);
    const [activeModalVolcano, setActiveModalVolcano] = useState(null);
    
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

    // Reference Table Accordion
    const [expandedAlertAccordion, setExpandedAlertAccordion] = useState(null);

    // Fetch Data
    useEffect(() => {
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

    // Alert guide structure
    const ALERT_GUIDE_DATA = [
        {
            level: 0,
            title: "Alert Level 0: Normal or Baseline Activity",
            criteria: "Quiet. Background levels of seismicity, gas emission, and ground deformation. No eruption forecast in the near term.",
            actions: "Safe for standard operations. Local tourists and communities should observe normal caution near active craters."
        },
        {
            level: 1,
            title: "Alert Level 1: Low-level Unrest",
            criteria: "Slight increase in volcanic earthquakes, gas output, or hot spring temperatures. Hydrothermal fluctuations. Hydrothermal or steam explosions may occur near crater.",
            actions: "Entry into the designated Permanent Danger Zone (PDZ) is strictly discouraged. Communities must review preparedness plans."
        },
        {
            level: 2,
            title: "Alert Level 2: Moderate Unrest",
            criteria: "Sustained increases in volcanic earthquakes, carbon dioxide/sulfur dioxide gas output, and regional swelling of the volcanic building. Indicative of magmatic intrusion.",
            actions: "Strictly prohibit entry into the PDZ. Keep evacuation routes clear. Local government alerts activated."
        },
        {
            level: 3,
            title: "Alert Level 3: Relatively High Unrest",
            criteria: "Magma is shallow or degassing actively at the summit. Increasing frequency of tremors, lava flows, dome growth, or mild ash vents.",
            actions: "Evacuate high-risk zones, expand the danger zones as recommended. Strict ban on travel within critical radii."
        },
        {
            level: 4,
            title: "Alert Level 4: Imminent Hazardous Eruption",
            criteria: "Intense volcanic earthquake storms, continuous ash plumes, lava fountaining, or rapid structural swelling. Eruption expected within days.",
            actions: "Mandatory evacuation of designated hazardous areas. Strict restriction of all flight paths and ground access."
        },
        {
            level: 5,
            title: "Alert Level 5: Hazardous Eruption in Progress",
            criteria: "Extreme threat. Explosive tall ash columns, sweeping hot pyroclastic flows, massive lava inundation, or collapsing volcanic slopes.",
            actions: "Total evacuation, seek shelter from ashfall, absolute flight bans over affected sectors."
        }
    ];

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center">
                <div className="text-center space-y-4">
                    <div className="h-10 w-10 border-4 border-rose-500 border-t-transparent rounded-full animate-spin mx-auto" />
                    <p className="text-slate-400 text-sm font-medium">Loading seismic and volcanic telemetry...</p>
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
                                <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-slate-50 via-slate-100 to-rose-400">
                                    Volcano Status
                                </h1>
                            </div>
                        </div>
                        <p className="text-xs md:text-sm text-slate-400 max-w-xl leading-relaxed">
                            Geospatial tracking and seismicity metrics of major volcanic centers in the Philippines. 
                            <span className="text-[10px] text-slate-500 block mt-1">Telemetry mirror: {metadata?.data_source || 'PHIVOLCS (DOST)'}</span>
                        </p>
                    </div>

                    {/* Filters & Options */}
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
                    </div>
                </header>

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

                {/* GEOSPATIAL MAP & INTERACTIVE PANELS */}
                <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-8">
                    
                    {/* Leaflet Map panel */}
                    <div className="lg:col-span-7 bg-slate-900/30 border border-slate-900/80 rounded-2xl p-3 flex flex-col h-[480px] shadow-2xl relative overflow-hidden group">
                        {/* Map label overlay */}
                        <div className="absolute top-6 right-6 z-[400] pointer-events-none bg-slate-950/80 backdrop-blur-md px-2.5 py-1.5 rounded-lg border border-slate-800/80 text-[10px] uppercase font-bold tracking-widest text-slate-400 flex items-center gap-1.5 shadow-md">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
                            Live Geotags
                        </div>

                        <div className="flex-1 w-full rounded-xl overflow-hidden relative">
                            <MapContainer
                                center={MAP_CENTER_DEFAULT}
                                zoom={ZOOM_DEFAULT}
                                scrollWheelZoom={true}
                                className="h-full w-full z-10"
                                maxBounds={PH_BOUNDS}
                                maxBoundsViscosity={0.9}
                                style={{ height: "100%", width: "100%", background: "#090d16" }}
                            >
                                <TileLayer
                                    url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                                />
                                
                                <ResetMapButton coordinatesList={VOLCANO_INFO.map(v => v.coordinates)} />
                                
                                {selectedVolcanoId && (
                                    <MapRecenter selectedCoordinates={VOLCANO_INFO.find(v => v.id === selectedVolcanoId)?.coordinates} />
                                )}

                                {VOLCANO_INFO.map((volcano) => {
                                    const isSelected = selectedVolcanoId === volcano.id;
                                    const eqCount = filteredData[volcano.id] || 0;
                                    
                                    return (
                                        <Marker
                                            key={volcano.id}
                                            position={volcano.coordinates}
                                            icon={createVolcanoMarker(volcano, isSelected)}
                                            eventHandlers={{
                                                click: () => {
                                                    setSelectedVolcanoId(volcano.id);
                                                }
                                            }}
                                        >
                                            <Popup className="custom-storm-popup">
                                                <div className="popup-tail relative z-20 w-[220px] bg-slate-900/95 backdrop-blur-md border border-slate-700/80 shadow-2xl rounded-xl p-3.5 text-slate-200">
                                                    <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2">
                                                        <span className="font-bold text-sm text-slate-100">{volcano.name}</span>
                                                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 font-bold border border-rose-500/30">
                                                            Lvl {volcano.alertLevel}
                                                        </span>
                                                    </div>
                                                    <p className="text-[10px] text-slate-400 flex items-center gap-1">
                                                        <MapPin className="h-3 w-3 text-slate-500" />
                                                        {volcano.location}
                                                    </p>
                                                    <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                                                        <Compass className="h-3 w-3 text-slate-500" />
                                                        {volcano.type}
                                                    </p>
                                                    <div className="mt-2.5 pt-2 border-t border-slate-800 flex justify-between items-center text-[10px]">
                                                        <span className="text-slate-500">24h Seismicity:</span>
                                                        <span className="font-extrabold text-rose-400">{eqCount} quakes</span>
                                                    </div>
                                                </div>
                                            </Popup>
                                        </Marker>
                                    );
                                })}
                            </MapContainer>
                        </div>
                    </div>

                    {/* Scrollable Volcano lists card */}
                    <div className="lg:col-span-5 flex flex-col h-[480px] bg-slate-900/20 border border-slate-900/80 rounded-2xl p-4 shadow-xl">
                        <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
                            <div className="flex items-center gap-2">
                                <h2 className="text-sm font-bold tracking-wider text-slate-350 uppercase flex items-center gap-2">
                                    <Activity className="h-4 w-4 text-rose-450" />
                                    Volcano System Inventory
                                </h2>
                                {formattedActiveDate && (
                                    <span className="text-[9px] text-slate-500 bg-slate-950 px-2.5 py-0.5 rounded-full border border-slate-800/80 font-semibold hidden sm:inline">
                                        {formattedActiveDate}
                                    </span>
                                )}
                            </div>
                            {selectedVolcanoId && (
                                <button 
                                    onClick={() => setSelectedVolcanoId(null)}
                                    className="text-[10px] font-semibold text-rose-400/80 hover:text-rose-400 transition-colors"
                                >
                                    Deselect
                                </button>
                            )}
                        </div>

                        {/* List panel */}
                        <div className="flex-1 overflow-y-auto space-y-3 pr-1 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-800 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-700">
                            {VOLCANO_INFO.map((volcano) => {
                                const isSelected = selectedVolcanoId === volcano.id;
                                const eqCount = filteredData[volcano.id] || 0;
                                const config = getAlertConfig(volcano.alertLevel);
                                
                                return (
                                    <div
                                        key={volcano.id}
                                        onClick={() => handleVolcanoSelect(volcano.id)}
                                        className={`group relative overflow-hidden rounded-xl border p-3.5 transition-all duration-300 cursor-pointer ${
                                            isSelected 
                                                ? "bg-slate-900/80 border-rose-500/40 shadow-lg shadow-rose-950/10" 
                                                : "bg-slate-900/30 border-slate-800/80 hover:border-slate-700/80"
                                        }`}
                                    >
                                        {/* Color background glow on select */}
                                        {isSelected && (
                                            <div 
                                                className="absolute -right-4 -bottom-4 h-20 w-20 rounded-full blur-2xl pointer-events-none opacity-20"
                                                style={{ backgroundColor: config.color }}
                                            />
                                        )}

                                        <div className="flex justify-between items-start mb-2.5">
                                            <div>
                                                <div className="flex items-center gap-1.5">
                                                    <h3 className="text-sm font-bold text-slate-100 group-hover:text-rose-400 transition-colors">{volcano.name}</h3>
                                                    <span className="text-[9px] text-slate-500">• {volcano.type}</span>
                                                </div>
                                                <p className="text-[10px] text-slate-500 flex items-center gap-0.5 mt-0.5">
                                                    <MapPin className="h-3 w-3 text-slate-600" />
                                                    {volcano.location}
                                                </p>
                                            </div>
                                            
                                            <div className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${config.colorClass}`}>
                                                Alert {volcano.alertLevel}
                                            </div>
                                        </div>

                                        {/* Status progress bar */}
                                        <div className="mb-3 space-y-1">
                                            <div className="flex justify-between text-[9px] text-slate-500">
                                                <span>Threat Severity</span>
                                                <span className="font-semibold" style={{ color: config.color }}>{config.label}</span>
                                            </div>
                                            <div className="h-1.5 w-full bg-slate-950 rounded-full overflow-hidden border border-slate-900">
                                                <div 
                                                    className="h-full rounded-full transition-all duration-500"
                                                    style={{ 
                                                        width: `${config.percentage}%`,
                                                        backgroundColor: config.color 
                                                    }}
                                                />
                                            </div>
                                        </div>

                                        {/* Seismicity count and expand options */}
                                        <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-800/60">
                                            <div className="flex items-center gap-1.5">
                                                <Activity className="h-3.5 w-3.5 text-slate-600" />
                                                <span className="text-[10px] text-slate-400">Daily Earthquakes:</span>
                                                <span className="font-bold text-slate-200">{eqCount}</span>
                                            </div>

                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation(); // Avoid selecting card
                                                    setActiveModalVolcano(volcano);
                                                }}
                                                className="text-[10px] font-bold text-rose-400/90 hover:text-rose-300 flex items-center gap-0.5 focus:outline-none py-0.5 px-2 rounded bg-rose-500/5 border border-rose-500/10 hover:border-rose-500/25 transition-all"
                                            >
                                                Details
                                                <Maximize2 className="h-2.5 w-2.5" />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
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

                {/* PHIVOLCS ALERT SYSTEM REFERENCE GUIDE */}
                <section className="bg-slate-900/20 border border-slate-900/60 rounded-2xl p-5">
                    <div className="flex items-center gap-2.5 border-b border-slate-800 pb-4 mb-4">
                        <ShieldAlert className="h-5 w-5 text-rose-400" />
                        <div>
                            <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider">PHIVOLCS Volcanic Alert Classification Scheme</h2>
                            <p className="text-[11px] text-slate-500">Standard operational guidelines set by the government for public hazard level alignment.</p>
                        </div>
                    </div>

                    <div className="space-y-2">
                        {ALERT_GUIDE_DATA.map((guide) => {
                            const isExpanded = expandedAlertAccordion === guide.level;
                            const config = getAlertConfig(guide.level);
                            
                            return (
                                <div 
                                    key={guide.level}
                                    className="border border-slate-800/60 rounded-xl overflow-hidden bg-slate-900/20 transition-all"
                                >
                                    <button
                                        onClick={() => setExpandedAlertAccordion(isExpanded ? null : guide.level)}
                                        className="w-full flex items-center justify-between p-3.5 text-left focus:outline-none hover:bg-slate-900/40 transition-colors cursor-pointer"
                                    >
                                        <div className="flex items-center gap-3">
                                            <span 
                                                className="w-6 h-6 rounded-md flex items-center justify-center font-bold text-xs border"
                                                style={{ 
                                                    backgroundColor: `${config.color}15`, 
                                                    borderColor: `${config.color}40`,
                                                    color: config.color 
                                                }}
                                            >
                                                L{guide.level}
                                            </span>
                                            <span className="text-xs font-bold text-slate-200 leading-none">{guide.title}</span>
                                        </div>
                                        <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                                    </button>

                                    {isExpanded && (
                                        <div className="p-4 bg-slate-900/40 border-t border-slate-800/50 space-y-3.5 text-xs text-slate-300 animate-in slide-in-from-top-2 duration-200">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div>
                                                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Observation Criteria</h4>
                                                    <p className="leading-relaxed font-medium text-slate-300">{guide.criteria}</p>
                                                </div>
                                                <div>
                                                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-rose-400 mb-1">Recommended Response & Danger Sectors</h4>
                                                    <p className="leading-relaxed font-medium text-slate-200">{guide.actions}</p>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </section>
            </div>

            {/* ADVISORY & BULLETIN MODAL DETAIL OVERLAY */}
            {activeModalVolcano && (() => {
                const volcano = activeModalVolcano;
                const config = getAlertConfig(volcano.alertLevel);
                const eqCount = filteredData[volcano.id] || 0;
                
                return (
                    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                        <div 
                            className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl relative animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Alert Level Accent bar */}
                            <div className="h-1.5 w-full" style={{ backgroundColor: config.color }} />

                            {/* Header */}
                            <div className="flex justify-between items-center p-5 border-b border-slate-800/80">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <h2 className="text-lg font-black text-slate-100">{volcano.name} Volcano Advisory</h2>
                                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-bold border border-slate-700">
                                            {volcano.type}
                                        </span>
                                    </div>
                                    <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold flex items-center gap-1">
                                        <MapPin className="h-3 w-3" />
                                        {volcano.location} Province, Philippines
                                    </p>
                                </div>
                                <button 
                                    onClick={() => setActiveModalVolcano(null)}
                                    className="p-1.5 rounded-lg bg-slate-850 hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>

                            {/* Content (Scrollable) */}
                            <div className="flex-1 overflow-y-auto p-6 space-y-6 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-slate-950/20 [&::-webkit-scrollbar-thumb]:bg-slate-800 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-700">
                                
                                {/* Info block */}
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-xl bg-slate-950/50 border border-slate-800/80">
                                    <div>
                                        <span className="text-[9px] uppercase tracking-wider font-bold text-slate-500 block mb-0.5">Elevation</span>
                                        <span className="text-xs font-bold text-slate-350">{volcano.elevation}</span>
                                    </div>
                                    <div>
                                        <span className="text-[9px] uppercase tracking-wider font-bold text-slate-500 block mb-0.5">Coordinates</span>
                                        <span className="text-xs font-bold text-slate-350">{volcano.coordinates[0].toFixed(4)}°N, {volcano.coordinates[1].toFixed(4)}°E</span>
                                    </div>
                                    <div>
                                        <span className="text-[9px] uppercase tracking-wider font-bold text-slate-500 block mb-0.5">24h Seismicity</span>
                                        <span className="text-xs font-extrabold text-rose-400">{eqCount} earthquakes</span>
                                    </div>
                                    <div>
                                        <span className="text-[9px] uppercase tracking-wider font-bold text-slate-500 block mb-0.5">Active Status</span>
                                        <span className="text-xs font-bold flex items-center gap-1" style={{ color: config.color }}>
                                            Level {volcano.alertLevel}
                                        </span>
                                    </div>
                                </div>

                                {/* Volcano description */}
                                <div className="space-y-1.5">
                                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Geological Profile</h3>
                                    <p className="text-xs text-slate-300 leading-relaxed font-medium">{volcano.description}</p>
                                </div>

                                {/* Volcano alert condition detail */}
                                <div className="p-4 rounded-xl border space-y-2" style={{ backgroundColor: `${config.color}08`, borderColor: `${config.color}25` }}>
                                    <h3 className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: config.color }}>
                                        <AlertTriangle className="h-4 w-4" />
                                        Current Status: {config.label}
                                    </h3>
                                    <p className="text-xs text-slate-200 leading-relaxed font-semibold">{volcano.alertDetails}</p>
                                </div>

                                {/* PHIVOLCS official recommendation */}
                                <div className="space-y-2">
                                    <h3 className="text-xs font-bold text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
                                        <ShieldAlert className="h-4 w-4" />
                                        Safety Advisory & Response Plan
                                    </h3>
                                    <p className="text-xs text-slate-350 bg-slate-950/20 border border-slate-800/80 rounded-xl p-3.5 leading-relaxed font-medium">{volcano.recommendations}</p>
                                </div>
                            </div>

                            {/* Footer */}
                            <div className="p-5 border-t border-slate-800/80 bg-slate-950/30 flex flex-col sm:flex-row gap-3 justify-between items-center">
                                <span className="text-[10px] text-slate-500 font-medium">Source: PHIVOLCS Bulletin Portal</span>
                                <div className="flex items-center gap-2.5 w-full sm:w-auto">
                                    <a
                                        href={volcano.bulletinUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex-1 sm:flex-initial text-center text-xs font-bold border border-slate-800 hover:border-slate-700 bg-slate-900 text-slate-200 px-4 py-2 rounded-xl transition-all flex items-center justify-center gap-1.5"
                                    >
                                        Official Bulletin
                                        <ExternalLink className="h-3 w-3" />
                                    </a>
                                    <button
                                        onClick={() => setActiveModalVolcano(null)}
                                        className="flex-1 sm:flex-initial text-xs font-bold bg-rose-500 hover:bg-rose-600 text-white px-5 py-2 rounded-xl transition-colors cursor-pointer text-center"
                                    >
                                        Close
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
};

export default Volcanoes;
