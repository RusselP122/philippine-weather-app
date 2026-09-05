import React, { useEffect, useMemo, useState, useRef } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap, Marker, Popup, useMapEvents, GeoJSON, Circle } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
    Activity, AlertTriangle, Layers, Calendar, ChevronDown, ChevronUp,
    ExternalLink, Waves, MapPin, Radio, ShieldAlert, Info, RefreshCw, Compass
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import EarthquakeWorker from "../workers/earthquakeWorker?worker";

// Internal component to handle map movement
const MapController = ({ center, zoom }) => {
    const map = useMap();
    useEffect(() => {
        if (center && center[0] && center[1]) {
            map.flyTo(center, zoom, {
                duration: 1.8,
                easeLinearity: 0.25
            });
        }
    }, [center, zoom, map]);
    return null;
};

// Internal component to track zoom level
const ZoomHandler = ({ setZoom }) => {
    const map = useMapEvents({
        zoomend: () => {
            setZoom(map.getZoom());
        },
    });
    return null;
};

const EARTHQUAKE_API = "/api/earthquakes-phivolcs";
const BULLETIN_API = "/api/earthquake-bulletin";

const PH_BOUNDS = [
    [4, 116],
    [22.5, 127.5],
];

// Volcano Data
const VOLCANO_DATA = [
    { name: "Banahaw", lat: 14.06038, lon: 121.48803 },
    { name: "Bulusan", lat: 12.76853, lon: 124.05445 },
    { name: "Hibok-hibok", lat: 9.20427, lon: 124.67115 },
    { name: "Kanlaon", lat: 10.41129, lon: 123.13243 },
    { name: "Mayon", lat: 13.25519, lon: 123.68615 },
    { name: "Pinatubo", lat: 15.14162, lon: 120.350845 },
    { name: "Taal", lat: 14.01024, lon: 120.99812 },
];

// Custom Volcano Icon Generator
const getVolcanoIcon = (zoom) => {
    let size = 24;
    if (zoom < 6) size = 12;
    else if (zoom < 8) size = 18;
    else if (zoom < 10) size = 24;
    else size = 25;

    return L.divIcon({
        className: 'custom-volcano-icon',
        html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#ef4444" stroke="#7f1d1d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-full h-full drop-shadow-md"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/></svg>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size],
        popupAnchor: [0, -size],
    });
};

// Custom Epicenter Icon for Seismic Intensity ShakeMap
const getEpicenterIcon = () => {
    return L.divIcon({
        className: 'custom-epicenter-marker',
        html: `
            <div style="position:relative; width:36px; height:36px; display:flex; align-items:center; justify-content:center;">
                <div style="position:absolute; width:36px; height:36px; border-radius:50%; background:rgba(239, 68, 68, 0.45); animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
                <div style="position:relative; width:26px; height:26px; border-radius:50%; background:#ef4444; border:2px solid #ffffff; box-shadow:0 0 14px rgba(239,68,68,0.9); display:flex; align-items:center; justify-content:center;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="#ffffff" stroke="#ffffff" stroke-width="1.5">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                    </svg>
                </div>
            </div>
        `,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
    });
};

// Helper to determine color based on magnitude
const getMagColor = (mag) => {
    if (mag >= 7) return "#7f00ff"; // Violet - Major
    if (mag >= 6) return "#ff0000"; // Red - Strong
    if (mag >= 5) return "#ff8c00"; // Orange - Moderate
    if (mag >= 4) return "#ffca28"; // Yellow - Light
    return "#4caf50"; // Green - Minor
};

// Helper to determine radius based on magnitude
const getMagRadius = (mag) => {
    return Math.max(mag * 3, 5);
};

// Helper for relative time
const getRelativeTime = (time) => {
    const ageMs = Date.now() - time.getTime();
    if (ageMs < 60000) return `${Math.floor(ageMs / 1000)}s ago`;
    if (ageMs < 3600000) return `${Math.floor(ageMs / 60000)}m ago`;
    if (ageMs < 86400000) return `${Math.floor(ageMs / 3600000)}h ago`;
    return time.toLocaleDateString();
};

// Helper to get current or given date string in Philippine Time (YYYY-MM-DD)
const getPhtDateString = (d = new Date()) => {
    const pht = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Manila" }));
    const year = pht.getFullYear();
    const month = String(pht.getMonth() + 1).padStart(2, '0');
    const day = String(pht.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const FILTER_OPTIONS = [
    { id: 'today', label: 'Today' },
    { id: 'yesterday', label: 'Yesterday' },
    { id: 'month', label: 'This Month' },
];

// PEIS (PHIVOLCS Earthquake Intensity Scale) Metadata & Reference Colors
const PEIS_DISPLAY_COLUMNS = [
    { label: "I", color: "#e2e8f0", textColor: "#0f172a", shaking: "Not felt", damage: "None", desc: "Scarcely Perceptible" },
    { label: "II - III", color: "#73dfff", textColor: "#082f49", shaking: "Weak", damage: "None", desc: "Slightly Felt to Weak" },
    { label: "IV", color: "#00e5ff", textColor: "#042f2e", shaking: "Light", damage: "None", desc: "Moderately Strong" },
    { label: "V", color: "#55ff00", textColor: "#052e16", shaking: "Moderate", damage: "Very light", desc: "Strong" },
    { label: "VI", color: "#ffff00", textColor: "#422006", shaking: "Strong", damage: "Light", desc: "Very Strong" },
    { label: "VII", color: "#ffaa00", textColor: "#431407", shaking: "Very strong", damage: "Moderate", desc: "Destructive" },
    { label: "VIII", color: "#ff5500", textColor: "#450a0a", shaking: "Severe", damage: "Mod/Heavy", desc: "Very Destructive" },
    { label: "IX", color: "#ff0000", textColor: "#ffffff", shaking: "Violent", damage: "Heavy", desc: "Devastating" },
    { label: "X+", color: "#990000", textColor: "#ffffff", shaking: "Extreme", damage: "Very Heavy", desc: "Completely Devastating" },
];

const getPeisColor = (level) => {
    if (!level) return null;
    const l = String(level).toUpperCase().trim();
    if (l === 'I') return '#e2e8f0';
    if (l === 'II' || l === 'III') return '#73dfff';
    if (l === 'IV') return '#00e5ff';
    if (l === 'V') return '#55ff00';
    if (l === 'VI') return '#ffff00';
    if (l === 'VII') return '#ffaa00';
    if (l === 'VIII') return '#ff5500';
    if (l === 'IX') return '#ff0000';
    if (l === 'X' || l === 'X+') return '#990000';
    return '#73dfff';
};

const Earthquake = () => {
    // Mode State: 'map' (National Monitoring) | 'intensity' (Seismic Intensity ShakeMap)
    const [activeMode, setActiveMode] = useState('map');

    const [quakes, setQuakes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [lastUpdated, setLastUpdated] = useState(null);

    // View State for Zoom interaction
    const [mapView, setMapView] = useState(null);
    const [currentZoom, setCurrentZoom] = useState(6);

    // Filter State
    const [filterType, setFilterType] = useState('today');
    const [customDate, setCustomDate] = useState(() => getPhtDateString());
    const dateInputRef = useRef(null);

    const handleOpenDatePicker = () => {
        if (dateInputRef.current) {
            try {
                if (typeof dateInputRef.current.showPicker === 'function') {
                    dateInputRef.current.showPicker();
                } else {
                    dateInputRef.current.focus();
                }
            } catch (err) {
                dateInputRef.current.focus();
            }
        }
    };

    // Legend State
    const [isLegendOpen, setIsLegendOpen] = useState(true);

    // Fault Lines State
    const [showFaultLines, setShowFaultLines] = useState(true);
    const [faultLineData, setFaultLineData] = useState(null);

    // Intensity ShakeMap State
    const [selectedFeltQuake, setSelectedFeltQuake] = useState(null);
    const [bulletinData, setBulletinData] = useState(null);
    const [bulletinLoading, setBulletinLoading] = useState(false);
    const [bulletinError, setBulletinError] = useState(null);
    const [municipalitiesGeo, setMunicipalitiesGeo] = useState(null);

    // Load Fault Line Data Once
    useEffect(() => {
        const worker = new EarthquakeWorker();
        worker.onmessage = (e) => {
            if (e.data.type === "FAULTS_LOADED") {
                setFaultLineData(e.data.payload);
            } else if (e.data.type === "FAULTS_ERROR") {
                console.error("Error loading fault lines via worker:", e.data.error);
            }
        };
        worker.postMessage({ type: "LOAD_FAULTS" });
        return () => worker.terminate();
    }, []);

    // Lazy load Philippine Municipalities GeoJSON when entering intensity mode
    useEffect(() => {
        if (activeMode === 'intensity' && !municipalitiesGeo) {
            fetch('/data/ph_municipalities.json')
                .then(r => r.json())
                .then(data => setMunicipalitiesGeo(data))
                .catch(err => console.error("Error loading municipalities GeoJSON:", err));
        }
    }, [activeMode, municipalitiesGeo]);

    const handleQuakeClick = (quake) => {
        if (!quake || !quake.geometry) return;
        const [lon, lat] = quake.geometry.coordinates;
        setMapView({ center: [lat, lon], zoom: 10 });
    };

    const filteredQuakes = useMemo(() => {
        if (!quakes.length) return [];
        const now = new Date();
        const phtNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Manila" }));
        const todayPhtStr = `${phtNow.getFullYear()}-${String(phtNow.getMonth() + 1).padStart(2, '0')}-${String(phtNow.getDate()).padStart(2, '0')}`;
        const startOfToday = new Date(`${todayPhtStr}T00:00:00+08:00`);
        const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);

        const filtered = quakes.filter(q => {
            if (!q.properties || !q.properties.time) return false;
            const qDate = new Date(q.properties.time);

            switch (filterType) {
                case 'today':
                    return qDate >= startOfToday;
                case 'yesterday':
                    return qDate >= startOfYesterday && qDate < startOfToday;
                case 'month':
                    return true;
                case 'custom': {
                    if (!customDate) return true;
                    const qPht = new Date(qDate.toLocaleString("en-US", { timeZone: "Asia/Manila" }));
                    const qPhtStr = `${qPht.getFullYear()}-${String(qPht.getMonth() + 1).padStart(2, '0')}-${String(qPht.getDate()).padStart(2, '0')}`;
                    return qPhtStr === customDate;
                }
                default:
                    return true;
            }
        });

        return filtered.sort((a, b) => new Date(b.properties.time).getTime() - new Date(a.properties.time).getTime());
    }, [quakes, filterType, customDate]);

    // Earthquakes that have reported or instrumental intensities
    const feltQuakes = useMemo(() => {
        return quakes.filter(q => q.properties?.hasIntensity === true);
    }, [quakes]);

    // Select initial felt earthquake when switching to intensity mode or when feltQuakes updates
    useEffect(() => {
        if (activeMode === 'intensity' && feltQuakes.length > 0) {
            const isValid = selectedFeltQuake && feltQuakes.some(q => q.id === selectedFeltQuake.id);
            if (!isValid) {
                setSelectedFeltQuake(feltQuakes[0]);
            }
        }
    }, [activeMode, selectedFeltQuake, feltQuakes]);

    // Fetch bulletin data when a felt quake is selected
    useEffect(() => {
        if (activeMode !== 'intensity' || !selectedFeltQuake) return;
        const bulletinUrl = selectedFeltQuake.properties?.bulletinUrl;
        if (!bulletinUrl) return;

        let cancelled = false;
        async function fetchBulletin() {
            try {
                setBulletinLoading(true);
                setBulletinError(null);
                const res = await fetch(`${BULLETIN_API}?url=${encodeURIComponent(bulletinUrl)}`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                if (cancelled) return;
                setBulletinData(data);
            } catch (err) {
                if (!cancelled) {
                    console.error("Failed to load bulletin details:", err);
                    setBulletinError("Unable to load official PHIVOLCS intensity bulletin.");
                }
            } finally {
                if (!cancelled) setBulletinLoading(false);
            }
        }
        fetchBulletin();
        return () => { cancelled = true; };
    }, [activeMode, selectedFeltQuake]);

    // Determine which year-month to load from PHIVOLCS
    const targetMonthKey = useMemo(() => {
        const now = new Date();
        const phtNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Manila" }));

        if (filterType === 'custom' && customDate) {
            const parts = customDate.split('-');
            if (parts.length >= 2) {
                const y = parseInt(parts[0], 10);
                const m = parseInt(parts[1], 10);
                if (!isNaN(y) && !isNaN(m)) {
                    return `${y}-${m}`;
                }
            }
        }
        if (filterType === 'yesterday' && phtNow.getDate() === 1) {
            const prev = new Date(phtNow.getFullYear(), phtNow.getMonth() - 1, 1);
            return `${prev.getFullYear()}-${prev.getMonth() + 1}`;
        }
        return `${phtNow.getFullYear()}-${phtNow.getMonth() + 1}`;
    }, [filterType, customDate]);

    useEffect(() => {
        let cancelled = false;

        async function fetchQuakes(isBackground = false) {
            try {
                if (!isBackground) {
                    setLoading(true);
                }
                setError(null);

                const [year, month] = targetMonthKey.split('-');
                const now = new Date();
                const isCurrentMonth = Number(year) === now.getFullYear() && Number(month) === (now.getMonth() + 1);

                const cacheBust = `t=${Date.now()}`;
                const queryParams = isCurrentMonth
                    ? `?${cacheBust}`
                    : `?year=${year}&month=${month}&${cacheBust}`;
                const url = `${EARTHQUAKE_API}${queryParams}`;

                const resp = await fetch(url);
                if (!resp.ok) {
                    throw new Error(`HTTP ${resp.status}`);
                }
                const json = await resp.json();

                if (cancelled) return;

                if (json.earthquakes && Array.isArray(json.earthquakes)) {
                    const formatted = json.earthquakes.map((q, index) => ({
                        id: `eq-${index}-${q.timestamp_iso || Date.now()}`,
                        geometry: {
                            coordinates: [
                                Number(q.longitude) || 0,
                                Number(q.latitude) || 0,
                                Number(q.depth_km) || 0
                            ]
                        },
                        properties: {
                            mag: Number(q.magnitude) || 0,
                            place: q.location || "Unknown Location",
                            time: q.timestamp_iso || new Date().toISOString(),
                            timePht: q.time_pht || null,
                            bulletinUrl: q.bulletin_url || null,
                            hasIntensity: Boolean(q.has_intensity)
                        }
                    }));
                    setQuakes(formatted);
                } else if (json.features) {
                    setQuakes(json.features);
                }
                setLastUpdated(new Date());

            } catch (err) {
                if (!cancelled) {
                    console.error("Failed to fetch earthquake data:", err);
                    if (!isBackground) {
                        setError("Unable to load earthquake data from PHIVOLCS.");
                    }
                }
            } finally {
                if (!cancelled && !isBackground) {
                    setLoading(false);
                }
            }
        }

        fetchQuakes(false);

        const [year, month] = targetMonthKey.split('-');
        const now = new Date();
        const isCurrentMonth = Number(year) === now.getFullYear() && Number(month) === (now.getMonth() + 1);

        let intervalId = null;
        if (isCurrentMonth) {
            intervalId = window.setInterval(() => fetchQuakes(true), 60 * 1000);
        }

        return () => {
            cancelled = true;
            if (intervalId) window.clearInterval(intervalId);
        };
    }, [targetMonthKey]);

    // GeoJSON polygon styling for the Seismic Intensity Map
    const styleMunicipality = (feature) => {
        if (!bulletinData || !bulletinData.affected_places) {
            return { fillOpacity: 0, weight: 0.2, color: '#334155', opacity: 0.15 };
        }
        const name2 = feature.properties?.NAME_2 || '';
        const prov = feature.properties?.PROVINCE || feature.properties?.NAME_1 || '';
        const normTown = name2.toLowerCase().replace(/city of|city/gi, '').replace(/[^a-z0-9]/g, '').trim();
        const normProv = prov.toLowerCase().replace(/[^a-z0-9]/g, '').trim();

        const match = bulletinData.affected_places[`${normTown}|${normProv}`] || bulletinData.affected_places[normTown];
        if (match) {
            const color = getPeisColor(match.level);
            return {
                fillColor: color,
                fillOpacity: 0.85,
                color: '#ffffff',
                weight: 1.5,
                opacity: 0.95
            };
        }
        return {
            fillColor: '#0f172a',
            fillOpacity: 0.1,
            color: '#334155',
            weight: 0.3,
            opacity: 0.2
        };
    };

    const onEachMunicipality = (feature, layer) => {
        const name2 = feature.properties?.NAME_2 || '';
        const prov = feature.properties?.PROVINCE || feature.properties?.NAME_1 || '';
        const normTown = name2.toLowerCase().replace(/city of|city/gi, '').replace(/[^a-z0-9]/g, '').trim();
        const normProv = prov.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
        const match = bulletinData?.affected_places?.[`${normTown}|${normProv}`] || bulletinData?.affected_places?.[normTown];

        if (match) {
            const color = getPeisColor(match.level);
            layer.bindTooltip(`
                <div style="font-family: sans-serif; padding: 4px;">
                    <strong style="font-size: 12px; color: #0f172a;">${name2}, ${prov}</strong>
                    <div style="margin-top: 4px; display: flex; align-items: center; gap: 6px; font-size: 11px;">
                        <span style="display:inline-block; width:12px; height:12px; border-radius:2px; background:${color}; border: 1px solid #000;"></span>
                        <span style="font-weight: 700; color: #0f172a;">Intensity ${match.level}</span>
                    </div>
                    <p style="font-size: 10px; color: #475569; margin-top: 2px;">${match.type} Intensity</p>
                </div>
            `, { sticky: true, className: 'custom-intensity-tooltip' });
        }
    };

    return (
        <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col">
            <div className="max-w-6xl mx-auto w-full px-6 py-12 md:px-8">
                {/* Header & Mode Switcher */}
                <header className="mb-8 flex flex-col gap-6 rounded-2xl border border-slate-800/70 bg-slate-900/50 px-6 py-6 shadow-[0_20px_70px_-40px_rgba(139,92,246,0.5)] md:flex-row md:items-center md:justify-between">
                    <div className="space-y-3">
                        <div className="flex items-center gap-4">
                            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-violet-500/10 text-violet-400">
                                {activeMode === 'map' ? <Activity className="h-6 w-6" /> : <Waves className="h-6 w-6 text-amber-400" />}
                            </span>

                            <div>
                                <p className="text-[10px] uppercase tracking-[0.35em] text-slate-500">Hazard Monitoring</p>
                                <h1 className="text-2xl font-semibold tracking-tight text-slate-50 md:text-3xl">
                                    {activeMode === 'map' ? 'Earthquake Map' : 'Seismic Intensity Map'}
                                </h1>
                            </div>
                        </div>
                        <div>
                            <p className="text-sm leading-relaxed text-slate-400">
                                {activeMode === 'map'
                                    ? 'Real-time earthquake monitoring and hypocenters across the Philippines.'
                                    : 'Community seismic ground shaking and intensity distribution (PEIS) based on PHIVOLCS bulletins.'}
                                <br />
                                <span className="text-xs text-slate-500">Data source: DOST-PHIVOLCS</span>
                            </p>
                        </div>
                    </div>

                    {/* Mode Navigation Tabs */}
                    <div className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950/80 p-1.5 shadow-inner">
                        <button
                            onClick={() => setActiveMode('map')}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${activeMode === 'map'
                                ? "bg-violet-600 text-white shadow-lg shadow-violet-600/30"
                                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                                }`}
                        >
                            <Activity className="h-3.5 w-3.5" />
                            <span>Earthquake Map</span>
                        </button>
                        <button
                            onClick={() => setActiveMode('intensity')}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${activeMode === 'intensity'
                                ? "bg-amber-500 text-slate-950 font-bold shadow-lg shadow-amber-500/30"
                                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                                }`}
                        >
                            <Waves className="h-3.5 w-3.5" />
                            <span>Seismic Intensity Map</span>
                            {feltQuakes.length > 0 && (
                                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-normal ${activeMode === 'intensity' ? 'bg-slate-900 text-amber-300' : 'bg-amber-500/20 text-amber-300'}`}>
                                    {feltQuakes.length} Felt
                                </span>
                            )}
                        </button>
                    </div>
                </header>

                {/* ========================================================================= */}
                {/* TAB 1: EARTHQUAKE MAP (EPICENTERS & RECENT EVENTS) */}
                {/* ========================================================================= */}
                {activeMode === 'map' && (
                    <motion.div
                        key="earthquake-map-view"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3 }}
                    >
                        {/* Filters Bar */}
                        <div className="mb-8 flex flex-wrap items-center gap-2.5">
                            {FILTER_OPTIONS.map((opt) => (
                                <button
                                    key={opt.id}
                                    onClick={() => {
                                        setFilterType(opt.id);
                                    }}
                                    className={`px-4 py-2 rounded-full text-xs font-medium transition-all cursor-pointer border ${filterType === opt.id
                                        ? "bg-violet-500 text-slate-50 border-transparent shadow-lg shadow-violet-500/25"
                                        : "bg-slate-900 border-slate-700 text-slate-400 hover:border-violet-500/50 hover:text-violet-300"
                                        }`}
                                >
                                    {opt.label}
                                </button>
                            ))}

                            {/* Clean Interactive Date Picker Pill */}
                            <div
                                onClick={handleOpenDatePicker}
                                className={`relative flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium transition-all cursor-pointer border select-none ${filterType === 'custom'
                                    ? "bg-violet-500 text-slate-50 border-transparent shadow-lg shadow-violet-500/25"
                                    : "bg-slate-900 border-slate-700 text-slate-400 hover:border-violet-500/50 hover:text-violet-300"
                                    }`}
                                title="Click to choose any date"
                            >
                                <Calendar className={`h-3.5 w-3.5 shrink-0 ${filterType === 'custom' ? 'text-white' : 'text-slate-400'}`} />
                                <span>{filterType === 'custom' && customDate ? customDate : 'Pick Date'}</span>
                                <input
                                    ref={dateInputRef}
                                    type="date"
                                    max={getPhtDateString()}
                                    value={filterType === 'custom' ? (customDate || '') : ''}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        try {
                                            if (typeof e.target.showPicker === 'function') {
                                                e.target.showPicker();
                                            }
                                        } catch (err) {}
                                    }}
                                    onChange={(e) => {
                                        if (e.target.value) {
                                            setCustomDate(e.target.value);
                                            setFilterType('custom');
                                        }
                                    }}
                                    onInput={(e) => {
                                        if (e.target.value) {
                                            setCustomDate(e.target.value);
                                            setFilterType('custom');
                                        }
                                    }}
                                    className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10"
                                    style={{ colorScheme: 'dark' }}
                                />
                            </div>

                            {/* Fault Line Toggle */}
                            <button
                                onClick={() => setShowFaultLines(!showFaultLines)}
                                className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium transition-all cursor-pointer border ${showFaultLines
                                    ? "bg-red-500/10 border-red-500/50 text-red-400"
                                    : "bg-slate-900 border-slate-700 text-slate-400 hover:border-red-500/30 hover:text-red-300"
                                    }`}
                            >
                                <Activity className="h-3.5 w-3.5" />
                                {showFaultLines ? 'Hide Faults' : 'Show Faults'}
                            </button>
                        </div>

                        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
                            {/* Map Section */}
                            <div className="lg:col-span-2 overflow-hidden rounded-2xl border border-slate-800/70 bg-slate-900/50 shadow-2xl shadow-slate-950/50 relative">
                                <MapContainer
                                    center={[12.8797, 121.774]}
                                    zoom={6}
                                    minZoom={4.5}
                                    maxZoom={11}
                                    scrollWheelZoom
                                    preferCanvas={true}
                                    className="h-[60vh] w-full"
                                    maxBounds={PH_BOUNDS}
                                    maxBoundsViscosity={0.8}
                                    style={{ background: '#0f172a' }}
                                >
                                    <TileLayer
                                        url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
                                        attribution="Tiles &copy; Esri"
                                    />

                                    <ZoomHandler setZoom={setCurrentZoom} />

                                    {showFaultLines && faultLineData && (
                                        <GeoJSON
                                            data={faultLineData}
                                            style={() => ({
                                                color: "#ef4444",
                                                weight: 2,
                                                opacity: 0.8,
                                            })}
                                            onEachFeature={(feature, layer) => {
                                                if (feature.properties && feature.properties.name) {
                                                    layer.bindTooltip(feature.properties.name, {
                                                        direction: 'top',
                                                        sticky: true,
                                                        className: 'bg-slate-900 border border-slate-700 text-slate-100 font-sans text-xs px-2 py-1 rounded shadow-lg'
                                                    });
                                                }
                                            }}
                                        />
                                    )}

                                    {mapView && (
                                        <MapController center={mapView.center} zoom={mapView.zoom} />
                                    )}

                                    {VOLCANO_DATA.map((volcano) => (
                                        <Marker
                                            key={volcano.name}
                                            position={[volcano.lat, volcano.lon]}
                                            icon={getVolcanoIcon(currentZoom)}
                                        >
                                            <Popup className="font-sans text-sm font-semibold text-slate-800">
                                                {volcano.name} Volcano
                                            </Popup>
                                        </Marker>
                                    ))}

                                    {filteredQuakes.map((quake) => {
                                        if (!quake || !quake.geometry || !quake.geometry.coordinates || !quake.properties) {
                                            return null;
                                        }

                                        const coords = quake.geometry.coordinates;
                                        const [lon, lat, depth] = coords;
                                        const mag = quake.properties.mag;
                                        const place = quake.properties.place;
                                        let timeString = "Unknown Time";
                                        try {
                                            timeString = new Date(quake.properties.time).toLocaleString('en-PH');
                                        } catch (e) {
                                            console.error("Time parse error:", e);
                                        }

                                        const color = getMagColor(mag);
                                        const isRecent = (Date.now() - new Date(quake.properties.time).getTime()) < 3600000;

                                        return (
                                            <CircleMarker
                                                key={quake.id}
                                                center={[lat, lon]}
                                                pathOptions={{
                                                    color: isRecent ? '#ffffff' : color,
                                                    fillColor: color,
                                                    fillOpacity: isRecent ? 0.9 : 0.5,
                                                    weight: isRecent ? 2 : 1
                                                }}
                                                radius={getMagRadius(mag) * (isRecent ? 1.2 : 1)}
                                            >
                                                <Tooltip sticky className="custom-leaflet-tooltip">
                                                    <div className="text-xs p-1">
                                                        <p className="font-bold text-slate-800 text-sm mb-1">{place}</p>
                                                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-slate-600">
                                                            <span>Magnitude:</span>
                                                            <span className="font-semibold" style={{ color: '#d97706' }}>M {Number(mag).toFixed(1)}</span>
                                                            <span>Depth:</span>
                                                            <span className="font-semibold">{Number(depth).toFixed(1)} km</span>
                                                            <span>Time:</span>
                                                            <span>{timeString}</span>
                                                            {quake.properties.hasIntensity && (
                                                                <span className="col-span-2 text-amber-600 font-bold mt-1 text-[11px] flex items-center gap-1">
                                                                    ★ Felt Intensity Data Available
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </Tooltip>
                                            </CircleMarker>
                                        );
                                    })}
                                </MapContainer>

                                {/* Legend Overlay */}
                                <div className="absolute bottom-4 left-4 z-[400] rounded-lg border border-slate-700/50 bg-slate-900/90 p-3 backdrop-blur-sm shadow-xl transition-all duration-300 min-w-[160px]">
                                    <div
                                        className="flex items-center justify-between gap-2 cursor-pointer"
                                        onClick={() => setIsLegendOpen(!isLegendOpen)}
                                    >
                                        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Magnitude Scale</h3>
                                        <button className="text-slate-400 hover:text-slate-200 transition-colors">
                                            {isLegendOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
                                        </button>
                                    </div>

                                    {isLegendOpen && (
                                        <div className="space-y-1.5 mt-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                            {[
                                                { label: "Major (7+)", color: "#7f00ff" },
                                                { label: "Strong (6.0-6.9)", color: "#ff0000" },
                                                { label: "Moderate (5.0-5.9)", color: "#ff8c00" },
                                                { label: "Light (4.0-4.9)", color: "#ffca28" },
                                                { label: "Minor (<4.0)", color: "#4caf50" },
                                            ].map((item) => (
                                                <div key={item.label} className="flex items-center gap-2">
                                                    <span className="h-2 w-2 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.5)]" style={{ backgroundColor: item.color }}></span>
                                                    <span className="text-[10px] text-slate-300">{item.label}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Sidebar Summary */}
                            <aside className="rounded-2xl border border-slate-800/70 bg-gradient-to-br from-slate-950/90 via-slate-900/70 to-slate-900/40 p-6 shadow-xl flex flex-col h-[60vh]">
                                <div className="mb-4 flex items-center justify-between shrink-0">
                                    <div>
                                        <h2 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400 flex items-center gap-1.5">
                                            <span>Recent Events</span>
                                            <span className="text-slate-600">•</span>
                                            <span className="text-violet-400 font-normal">
                                                {filterType === 'today' ? 'Today' : filterType === 'yesterday' ? 'Yesterday' : filterType === 'month' ? 'This Month' : customDate}
                                            </span>
                                        </h2>
                                        <div className="flex flex-col gap-0.5 mt-1">
                                            <span className="text-xl font-bold text-slate-200">
                                                {filteredQuakes.length} <span className="text-xs font-normal text-slate-500">earthquakes</span>
                                            </span>
                                            {lastUpdated && (
                                                <span className="text-[10px] text-slate-400 flex items-center gap-1.5 font-mono">
                                                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                                    Live sync: {lastUpdated.toLocaleTimeString("en-PH", {
                                                        hour: "2-digit",
                                                        minute: "2-digit",
                                                        second: "2-digit"
                                                    })}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="grow overflow-y-auto space-y-3 pr-2 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
                                    {loading && (
                                        <div className="flex items-center gap-3 rounded-lg border border-sky-500/20 bg-sky-500/10 px-4 py-3 text-sky-300">
                                            <span className="h-2 w-2 rounded-full bg-sky-400 animate-pulse" />
                                            <span className="text-xs font-medium">Fetching data...</span>
                                        </div>
                                    )}

                                    {error && (
                                        <div className="flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-red-300">
                                            <AlertTriangle className="h-4 w-4 mt-0.5" />
                                            <p className="text-xs">{error}</p>
                                        </div>
                                    )}

                                    {!loading && !error && filteredQuakes.length === 0 && (
                                        <div className="text-center py-8 text-slate-500 text-xs">
                                            No earthquakes recorded for this period.
                                        </div>
                                    )}

                                    <AnimatePresence initial={false}>
                                        {!loading && !error && filteredQuakes.map((quake) => {
                                            if (!quake || !quake.properties || !quake.geometry) return null;

                                            const mag = quake.properties.mag ? Number(quake.properties.mag) : 0;
                                            const place = quake.properties.place || "Unknown Location";
                                            let time = new Date();
                                            let isRecent = false;

                                            try {
                                                if (quake.properties.time) {
                                                    time = new Date(quake.properties.time);
                                                    isRecent = (new Date() - time) < 1 * 60 * 60 * 1000;
                                                } else {
                                                    isRecent = (new Date() - time) < 1 * 60 * 60 * 1000;
                                                }
                                            } catch (e) {
                                                console.error("Date parse error", e);
                                            }

                                            const depth = quake.geometry.coordinates && quake.geometry.coordinates[2]
                                                ? Number(quake.geometry.coordinates[2])
                                                : 0;

                                            return (
                                                <motion.div
                                                    key={quake.id}
                                                    initial={{ opacity: 0, y: -20, scale: 0.95 }}
                                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                                    exit={{ opacity: 0, scale: 0.95 }}
                                                    transition={{ type: "spring", stiffness: 350, damping: 25 }}
                                                    onClick={() => handleQuakeClick(quake)}
                                                    className="group relative rounded-lg border border-slate-800 bg-slate-900/50 p-3 hover:bg-slate-800/80 hover:border-violet-500/30 transition-all cursor-pointer overflow-hidden"
                                                >
                                                    {isRecent && <div className="absolute inset-0 bg-violet-500/5 animate-pulse pointer-events-none" />}
                                                    <div className="flex items-start justify-between gap-3 relative z-10">
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-xs font-medium text-slate-200 truncate" title={place}>
                                                                {place}
                                                            </p>
                                                            <div className="flex flex-wrap items-center gap-2 mt-1 text-[10px] text-slate-400 font-mono">
                                                                <span>{getRelativeTime(time)}</span>
                                                                <span className="opacity-60 hidden sm:inline">• {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                                {isRecent && (
                                                                    <span className="bg-violet-500/20 text-violet-300 px-1.5 py-0.5 rounded text-[9px] border border-violet-500/30 animate-pulse">
                                                                        NEW
                                                                    </span>
                                                                )}
                                                                {quake.properties.hasIntensity && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            setSelectedFeltQuake(quake);
                                                                            setActiveMode('intensity');
                                                                        }}
                                                                        title="View Seismic Intensity ShakeMap for this felt earthquake"
                                                                        className="inline-flex items-center gap-1 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 px-1.5 py-0.5 rounded text-[9px] font-semibold border border-amber-500/40 transition-colors"
                                                                    >
                                                                        <Waves className="h-2.5 w-2.5" />
                                                                        Intensity Map
                                                                    </button>
                                                                )}
                                                                {quake.properties.bulletinUrl && (
                                                                    <a
                                                                        href={quake.properties.bulletinUrl}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        onClick={(e) => e.stopPropagation()}
                                                                        title="View Official PHIVOLCS Bulletin"
                                                                        className="inline-flex items-center gap-0.5 text-[9px] text-sky-400 hover:text-sky-300 hover:underline transition-colors"
                                                                    >
                                                                        Bulletin <ExternalLink className="h-2.5 w-2.5" />
                                                                    </a>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div className="flex flex-col items-end shrink-0">
                                                            <span
                                                                className="font-black text-sm"
                                                                style={{ color: getMagColor(mag), textShadow: `0 0 10px ${getMagColor(mag)}40` }}
                                                            >
                                                                M {mag.toFixed(1)}
                                                            </span>
                                                            <span className="text-[10px] text-slate-500 font-mono">
                                                                {depth.toFixed(0)} km
                                                            </span>
                                                        </div>
                                                    </div>
                                                </motion.div>
                                            );
                                        })}
                                    </AnimatePresence>
                                </div>
                            </aside>
                        </div>
                    </motion.div>
                )}

                {/* ========================================================================= */}
                {/* TAB 2: SEISMIC INTENSITY MAP (COMMUNITY SHAKEMAP) */}
                {/* ========================================================================= */}
                {activeMode === 'intensity' && (
                    <motion.div
                        key="seismic-intensity-view"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3 }}
                        className="space-y-6"
                    >
                        {/* Felt Earthquake Selector Bar */}
                        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                                <span className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
                                    <Waves className="h-5 w-5" />
                                </span>
                                <div>
                                    <p className="text-[10px] uppercase tracking-wider text-slate-400">
                                        Felt Earthquake Bulletins ({feltQuakes.length} with Intensities)
                                    </p>
                                    <p className="text-xs text-slate-300 font-medium">
                                        Displaying only earthquakes with reported or instrumental intensities:
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                <select
                                    value={selectedFeltQuake?.id || ''}
                                    onChange={(e) => {
                                        const found = feltQuakes.find(q => q.id === e.target.value);
                                        if (found) setSelectedFeltQuake(found);
                                    }}
                                    disabled={feltQuakes.length === 0}
                                    className="bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-amber-500/50 cursor-pointer min-w-[300px] max-w-full truncate disabled:opacity-50"
                                >
                                    {feltQuakes.length === 0 && <option value="">No earthquakes with reported intensities</option>}
                                    {feltQuakes.map(q => (
                                        <option key={q.id} value={q.id}>
                                            M{Number(q.properties?.mag || 0).toFixed(1)} - {q.properties?.place} ({q.properties?.timePht || new Date(q.properties?.time).toLocaleDateString()})
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {feltQuakes.length === 0 ? (
                            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/60 p-12 text-center flex flex-col items-center justify-center gap-4 shadow-xl">
                                <div className="p-4 rounded-full bg-amber-500/10 text-amber-400">
                                    <Radio className="h-8 w-8" />
                                </div>
                                <div className="space-y-1 max-w-md">
                                    <h3 className="text-base font-bold text-slate-200">No Earthquakes with Reported Intensities</h3>
                                    <p className="text-xs text-slate-400 leading-relaxed">
                                        None of the earthquakes in the loaded period have reported or instrumental intensities recorded in PHIVOLCS bulletins.
                                    </p>
                                </div>
                                <button
                                    onClick={() => setActiveMode('map')}
                                    className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 font-medium transition-colors"
                                >
                                    Return to Earthquake Map
                                </button>
                            </div>
                        ) : (
                            /* Main ShakeMap Grid */
                            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                                {/* Map & ShakeMap Table Card */}
                                <div className="lg:col-span-2 flex flex-col rounded-2xl border border-slate-800/80 bg-slate-900/70 p-5 shadow-2xl overflow-hidden">
                                    {/* ShakeMap Title Box (Matching Community Intensity Header style) */}
                                    <div className="text-center pb-4 mb-4 border-b border-slate-800/80">
                                        <h2 className="text-base md:text-lg font-bold text-slate-100 tracking-wide">
                                            Community Seismic Intensity Map for {bulletinData?.location || selectedFeltQuake?.properties?.place || 'Philippine Earthquake'}
                                        </h2>
                                        <p className="text-xs text-slate-400 font-mono mt-1">
                                            {bulletinData?.date_time ? `${bulletinData.date_time} PST` : ''}
                                            {bulletinData?.magnitude ? ` • Mag=${bulletinData.magnitude}` : ''}
                                            {bulletinData?.depth_km ? ` • Depth=${bulletinData.depth_km} km` : ''}
                                            {bulletinData?.latitude ? ` • Lat=${bulletinData.latitude}°N Lon=${bulletinData.longitude}°E` : ''}
                                        </p>
                                        <div className="flex items-center justify-center gap-3 mt-2">
                                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 text-xs font-semibold border border-amber-500/30">
                                                Max Reported Intensity: {bulletinData?.max_intensity_level || 'N/A'}
                                            </span>
                                            {bulletinData?.origin && (
                                                <span className="text-[11px] text-slate-400 bg-slate-800/80 px-2.5 py-0.5 rounded-full border border-slate-700">
                                                    Origin: {bulletinData.origin}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Leaflet Map */}
                                    <div className="overflow-hidden rounded-xl border border-slate-800 relative h-[50vh] min-h-[360px]">
                                        {bulletinLoading && (
                                            <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm z-[500] flex flex-col items-center justify-center gap-3 text-amber-400">
                                                <RefreshCw className="h-7 w-7 animate-spin" />
                                                <p className="text-xs font-medium text-slate-300">Parsing PHIVOLCS Bulletin Intensities & Shaking Zones...</p>
                                            </div>
                                        )}

                                        {bulletinError && (
                                            <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm z-[500] flex flex-col items-center justify-center gap-3 text-red-400 p-6 text-center">
                                                <AlertTriangle className="h-8 w-8" />
                                                <p className="text-xs font-medium">{bulletinError}</p>
                                            </div>
                                        )}

                                        <MapContainer
                                            center={bulletinData?.latitude && bulletinData?.longitude ? [bulletinData.latitude, bulletinData.longitude] : [15.54, 119.92]}
                                            zoom={8.5}
                                            minZoom={5}
                                            maxZoom={12}
                                            scrollWheelZoom
                                            preferCanvas={true}
                                            className="h-full w-full"
                                            style={{ background: '#0b1120' }}
                                        >
                                            <TileLayer
                                                url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
                                                attribution="Tiles &copy; Esri"
                                            />

                                            {bulletinData?.latitude && bulletinData?.longitude && (
                                                <MapController center={[bulletinData.latitude, bulletinData.longitude]} zoom={8.5} />
                                            )}

                                            {/* Municipalities Intensity Choropleth */}
                                            {municipalitiesGeo && (
                                                <GeoJSON
                                                    key={`intensity-geojson-${selectedFeltQuake?.id || 'default'}-${bulletinData?.max_intensity_level || '0'}`}
                                                    data={municipalitiesGeo}
                                                    style={styleMunicipality}
                                                    onEachFeature={onEachMunicipality}
                                                />
                                            )}

                                            {/* Epicenter Marker */}
                                            {bulletinData?.latitude && bulletinData?.longitude && (
                                                <Marker
                                                    position={[bulletinData.latitude, bulletinData.longitude]}
                                                    icon={getEpicenterIcon()}
                                                >
                                                    <Popup className="font-sans">
                                                        <div className="p-1">
                                                            <p className="font-bold text-slate-900 text-xs">Epicenter</p>
                                                            <p className="text-[11px] text-slate-700 mt-0.5">{bulletinData.location}</p>
                                                            <p className="text-[10px] text-slate-500 font-mono mt-1">
                                                                Depth: {bulletinData.depth_km} km | Mag: {bulletinData.magnitude}
                                                            </p>
                                                        </div>
                                                    </Popup>
                                                </Marker>
                                            )}
                                        </MapContainer>
                                    </div>

                                    {/* PEIS Intensity Scale Table (Matching user's reference image style) */}
                                    <div className="mt-4 overflow-x-auto rounded-xl border border-slate-700/80 bg-slate-950 p-2 shadow-inner">
                                        <table className="w-full text-center border-collapse text-[10px] md:text-xs">
                                            <thead>
                                                <tr>
                                                    <th className="border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-300 font-bold uppercase tracking-wider text-left min-w-[75px]">
                                                        Intensity
                                                    </th>
                                                    {PEIS_DISPLAY_COLUMNS.map((col) => (
                                                        <th
                                                            key={col.label}
                                                            style={{ backgroundColor: col.color, color: col.textColor }}
                                                            className="border border-slate-700 px-2 py-1.5 font-black min-w-[50px]"
                                                        >
                                                            {col.label}
                                                        </th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <tr>
                                                    <td className="border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-300 font-semibold uppercase tracking-wider text-left">
                                                        Shaking
                                                    </td>
                                                    {PEIS_DISPLAY_COLUMNS.map((col) => (
                                                        <td
                                                            key={`shaking-${col.label}`}
                                                            className="border border-slate-700/60 bg-slate-900/60 px-1.5 py-1 text-slate-200 text-[10px]"
                                                        >
                                                            {col.shaking}
                                                        </td>
                                                    ))}
                                                </tr>
                                                <tr>
                                                    <td className="border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-300 font-semibold uppercase tracking-wider text-left">
                                                        Damage
                                                    </td>
                                                    {PEIS_DISPLAY_COLUMNS.map((col) => (
                                                        <td
                                                            key={`damage-${col.label}`}
                                                            className="border border-slate-700/60 bg-slate-900/60 px-1.5 py-1 text-slate-400 text-[10px]"
                                                        >
                                                            {col.damage}
                                                        </td>
                                                    ))}
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                {/* Sidebar: Intensity Breakdown Details */}
                                <aside className="flex flex-col gap-4 rounded-2xl border border-slate-800/80 bg-slate-900/70 p-5 shadow-xl h-auto">
                                    <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
                                        <div>
                                            <h3 className="text-xs font-bold uppercase tracking-widest text-amber-400 flex items-center gap-1.5">
                                                <Radio className="h-3.5 w-3.5" />
                                                Intensity Details
                                            </h3>
                                            <p className="text-[10px] text-slate-400 mt-0.5">Data from PHIVOLCS official bulletin</p>
                                        </div>
                                        {bulletinData?.bulletin_url && (
                                            <a
                                                href={bulletinData.bulletin_url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1 text-[10px] text-sky-400 hover:text-sky-300 hover:underline"
                                            >
                                                Bulletin <ExternalLink className="h-3 w-3" />
                                            </a>
                                        )}
                                    </div>

                                    <div className="space-y-4 overflow-y-auto max-h-[58vh] pr-1 scrollbar-thin scrollbar-thumb-slate-700">
                                        {/* Reported Intensities */}
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                                                <span className="h-2 w-2 rounded-full bg-amber-400"></span>
                                                Reported Intensities (Felt Reports)
                                            </div>

                                            {bulletinData?.reported_intensities?.length === 0 && (
                                                <p className="text-[11px] text-slate-500 italic">No reported felt intensities in this bulletin.</p>
                                            )}

                                            {bulletinData?.reported_intensities?.map((group) => {
                                                const color = getPeisColor(group.level);
                                                return (
                                                    <div key={`rep-${group.level}`} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-1.5">
                                                        <div className="flex items-center justify-between">
                                                            <span
                                                                style={{ backgroundColor: color }}
                                                                className="px-2 py-0.5 rounded text-xs font-black text-slate-950"
                                                            >
                                                                Intensity {group.level}
                                                            </span>
                                                            <span className="text-[10px] text-slate-400">
                                                                {group.places?.length || 1} {group.places?.length === 1 ? 'locality' : 'localities'}
                                                            </span>
                                                        </div>
                                                        <p className="text-xs text-slate-300 leading-relaxed">
                                                            {group.raw_text}
                                                        </p>
                                                    </div>
                                                );
                                            })}
                                        </div>

                                        {/* Instrumental Intensities */}
                                        <div className="space-y-2 pt-2 border-t border-slate-800/80">
                                            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                                                <span className="h-2 w-2 rounded-full bg-cyan-400"></span>
                                                Instrumental Intensities (Seismic Meters)
                                            </div>

                                            {bulletinData?.instrumental_intensities?.length === 0 && (
                                                <p className="text-[11px] text-slate-500 italic">No instrumental intensity reports recorded.</p>
                                            )}

                                            {bulletinData?.instrumental_intensities?.map((group) => {
                                                const color = getPeisColor(group.level);
                                                return (
                                                    <div key={`inst-${group.level}`} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-1.5">
                                                        <div className="flex items-center justify-between">
                                                            <span
                                                                style={{ backgroundColor: color }}
                                                                className="px-2 py-0.5 rounded text-xs font-black text-slate-950"
                                                            >
                                                                Intensity {group.level}
                                                            </span>
                                                            <span className="text-[10px] text-slate-400">
                                                                {group.places?.length || 1} {group.places?.length === 1 ? 'locality' : 'localities'}
                                                            </span>
                                                        </div>
                                                        <p className="text-xs text-slate-300 leading-relaxed">
                                                            {group.raw_text}
                                                        </p>
                                                    </div>
                                                );
                                            })}
                                        </div>

                                        {/* Impact Assessment Card */}
                                        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 space-y-2 pt-2 border-t border-slate-800">
                                            <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Impact Assessment</p>
                                            <div className="grid grid-cols-2 gap-2 text-xs">
                                                <div className="rounded-lg bg-slate-900 p-2 border border-slate-800">
                                                    <span className="text-[10px] text-slate-500 block">Expecting Damage</span>
                                                    <span className={`font-bold ${bulletinData?.expecting_damage?.toUpperCase() === 'YES' ? 'text-red-400' : 'text-emerald-400'}`}>
                                                        {bulletinData?.expecting_damage || 'NO'}
                                                    </span>
                                                </div>
                                                <div className="rounded-lg bg-slate-900 p-2 border border-slate-800">
                                                    <span className="text-[10px] text-slate-500 block">Expecting Aftershocks</span>
                                                    <span className={`font-bold ${bulletinData?.expecting_aftershocks?.toUpperCase() === 'YES' ? 'text-amber-400' : 'text-emerald-400'}`}>
                                                        {bulletinData?.expecting_aftershocks || 'NO'}
                                                    </span>
                                                </div>
                                            </div>
                                            {bulletinData?.issued_on && (
                                                <p className="text-[9px] text-slate-500">
                                                    Bulletin Issued: {bulletinData.issued_on}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </aside>
                            </div>
                        )}
                    </motion.div>
                )}
            </div>
        </div>
    );
};

export default Earthquake;
