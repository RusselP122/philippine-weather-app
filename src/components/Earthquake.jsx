import React, { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { Activity, AlertTriangle, Layers, Calendar, ChevronDown, ChevronUp } from "lucide-react";

// Internal component to handle map movement
const MapController = ({ center, zoom }) => {
    const map = useMap();
    useEffect(() => {
        if (center) {
            map.flyTo(center, zoom, {
                duration: 2, // Smooth animation duration in seconds
                easeLinearity: 0.25
            });
        }
    }, [center, zoom, map]);
    return null;
};

const EARTHQUAKE_API = "/api/earthquake-data";

const PH_BOUNDS = [
    [4, 116],
    [22.5, 127.5],
];

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

const Earthquake = () => {
    const [quakes, setQuakes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [lastUpdated, setLastUpdated] = useState(null);

    // View State for Zoom interaction
    const [mapView, setMapView] = useState(null);

    // Filter State
    const [filterType, setFilterType] = useState('today'); // today, yesterday, month, year, custom
    const [customDate, setCustomDate] = useState(new Date().toISOString().split('T')[0]);

    // Legend State
    const [isLegendOpen, setIsLegendOpen] = useState(true);

    const handleQuakeClick = (quake) => {
        if (!quake || !quake.geometry) return;
        const [lon, lat] = quake.geometry.coordinates;
        setMapView({ center: [lat, lon], zoom: 10 });
    };

    const filteredQuakes = useMemo(() => {
        if (!quakes.length) return [];

        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        return quakes.filter(q => {
            if (!q.properties || !q.properties.time) return false;
            const qDate = new Date(q.properties.time);

            switch (filterType) {
                case 'today':
                    return qDate >= startOfDay;
                case 'yesterday': {
                    const yesterdayStart = new Date(startOfDay);
                    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
                    const yesterdayEnd = new Date(startOfDay);
                    return qDate >= yesterdayStart && qDate < yesterdayEnd;
                }
                case 'month':
                    return qDate.getMonth() === now.getMonth() && qDate.getFullYear() === now.getFullYear();
                case 'year':
                    return qDate.getFullYear() === now.getFullYear();
                case 'custom': {
                    const target = new Date(customDate);
                    return qDate.getFullYear() === target.getFullYear() &&
                        qDate.getMonth() === target.getMonth() &&
                        qDate.getDate() === target.getDate();
                }
                default:
                    return true;
            }
        });
    }, [quakes, filterType, customDate]);

    useEffect(() => {
        let cancelled = false;

        async function fetchQuakes() {
            try {
                setLoading(true);
                setError(null);

                const cacheBust = `t=${Date.now()}`;
                const url = `${EARTHQUAKE_API}?${cacheBust}`;

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
                            time: q.timestamp_iso || new Date().toISOString()
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
                    setError("Unable to load earthquake data.");
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        }

        fetchQuakes();
        // Auto refresh every 5 minutes
        const intervalId = window.setInterval(fetchQuakes, 5 * 60 * 1000);

        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
        };
    }, []);

    return (
        <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col">
            <div className="max-w-6xl mx-auto w-full px-6 py-12 md:px-8">
                <header className="mb-10 flex flex-col gap-6 rounded-2xl border border-slate-800/70 bg-slate-900/50 px-6 py-6 shadow-[0_20px_70px_-40px_rgba(139,92,246,0.5)] md:flex-row md:items-center md:justify-between">
                    <div className="space-y-4">
                        <div className="flex items-center gap-4">
                            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-violet-500/10 text-violet-400">
                                <Activity className="h-6 w-6" />
                            </span>

                            <div>
                                <p className="text-[10px] uppercase tracking-[0.35em] text-slate-500">Hazard Monitoring</p>
                                <h1 className="text-2xl font-semibold tracking-tight text-slate-50 md:text-3xl">
                                    Earthquake Map
                                </h1>
                            </div>
                        </div>
                        <div>
                            <p className="text-sm leading-relaxed text-slate-400">
                                Real-time earthquake monitoring for the Philippines.
                                <br />
                                <span className="text-xs text-slate-500">Data source: PHIVOLCS </span>
                            </p>
                            <div className="mt-3 h-px w-28 bg-gradient-to-r from-violet-400/70 via-purple-300/60 to-transparent" />
                        </div>
                    </div>
                </header>

                <div className="mb-8 flex flex-wrap items-center gap-3">
                    {['today', 'yesterday', 'month', 'year'].map((type) => (
                        <button
                            key={type}
                            onClick={() => {
                                setFilterType(type);
                                // Sync customDate picker to the selected filter for better UX
                                const now = new Date();
                                if (type === 'yesterday') {
                                    now.setDate(now.getDate() - 1);
                                }
                                setCustomDate(now.toISOString().split('T')[0]);
                            }}
                            className={`px-4 py-2 rounded-full text-xs font-medium transition-all cursor-pointer ${filterType === type
                                ? "bg-violet-500 text-slate-50 shadow-lg shadow-violet-500/25"
                                : "bg-slate-900 border border-slate-700 text-slate-400 hover:border-violet-500/50 hover:text-violet-300"
                                }`}
                        >
                            {type.charAt(0).toUpperCase() + type.slice(1)}
                        </button>
                    ))}

                    <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-full px-3 py-1.5 focus-within:border-violet-500/50 transition-colors">
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
                            {filterType === 'custom' ? 'Custom' : 'Date'}
                        </span>
                    </div>
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
                            className="h-[60vh] w-full"
                            maxBounds={PH_BOUNDS}
                            maxBoundsViscosity={0.8}
                            style={{ background: '#0f172a' }}
                        >
                            <TileLayer
                                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                            />

                            {mapView && (
                                <MapController center={mapView.center} zoom={mapView.zoom} />
                            )}

                            {filteredQuakes.map((quake) => {
                                if (!quake || !quake.geometry || !quake.geometry.coordinates || !quake.properties) {
                                    return null;
                                }

                                const coords = quake.geometry.coordinates; // Ion, Lat, Depth
                                const [lon, lat, depth] = coords;
                                const mag = quake.properties.mag;
                                const place = quake.properties.place;
                                // Safety check for time
                                let timeString = "Unknown Time";
                                try {
                                    timeString = new Date(quake.properties.time).toLocaleString('en-PH');
                                } catch (e) {
                                    console.error("Time parse error:", e);
                                }

                                const color = getMagColor(mag);

                                return (
                                    <CircleMarker
                                        key={quake.id}
                                        center={[lat, lon]}
                                        pathOptions={{
                                            color: color,
                                            fillColor: color,
                                            fillOpacity: 0.5,
                                            weight: 1
                                        }}
                                        radius={getMagRadius(mag)}
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
                                <h2 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                                    Recent Events
                                </h2>
                                <div className="flex flex-col gap-0.5 mt-1">
                                    <span className="text-xl font-bold text-slate-200">
                                        {filteredQuakes.length} <span className="text-xs font-normal text-slate-500">earthquakes</span>
                                    </span>
                                    {lastUpdated && (
                                        <span className="text-[10px] text-slate-600">
                                            Updated {lastUpdated.toLocaleTimeString("en-PH", {
                                                hour: "2-digit",
                                                minute: "2-digit",
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

                            {!loading && !error && filteredQuakes.map((quake) => {
                                if (!quake || !quake.properties || !quake.geometry) return null;

                                const mag = Number(quake.properties.mag) || 0;
                                const place = quake.properties.place || "Unknown";
                                let time = new Date();
                                let isRecent = false;

                                try {
                                    time = new Date(quake.properties.time);
                                    if (isNaN(time.getTime())) {
                                        time = new Date(); // Fallback
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
                                    <div
                                        key={quake.id}
                                        onClick={() => handleQuakeClick(quake)}
                                        className="group relative rounded-lg border border-slate-800 bg-slate-900/50 p-3 hover:bg-slate-800/80 hover:border-violet-500/30 transition-all cursor-pointer"
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex-1 min-w-0">
                                                <p className="text-xs font-medium text-slate-200 truncate" title={place}>
                                                    {place}
                                                </p>
                                                <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400">
                                                    <span>{time.toLocaleDateString()}</span>
                                                    <span>{time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                    {isRecent && (
                                                        <span className="bg-violet-500/20 text-violet-300 px-1.5 py-0.5 rounded text-[9px] border border-violet-500/30">
                                                            NEW
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex flex-col items-end">
                                                <span
                                                    className="font-bold text-sm"
                                                    style={{ color: getMagColor(mag) }}
                                                >
                                                    M{mag.toFixed(1)}
                                                </span>
                                                <span className="text-[10px] text-slate-500">
                                                    {depth.toFixed(0)}km
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </aside>
                </div>
            </div>
        </div>
    );
};

export default Earthquake;
