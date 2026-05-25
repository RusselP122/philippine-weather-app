import React, { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Polygon, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { AlertCircle, Wind, AlertTriangle, Info, MapPin, Maximize2, Search, X, CheckCircle2 } from "lucide-react";

const ALERT_API = "/api/cap-alerts";

const PH_BOUNDS = [
    [4, 116],
    [22.5, 127.5],
];

// TCWS Color Mapping (Standard PAGASA Colors)
const SIGNAL_COLORS = {
    1: { fill: "#3498db", edge: "#1f618d", label: "Signal No. 1", borderTheme: "border-sky-500/30", colorClasses: "bg-sky-500/10 text-sky-300" }, // Blue
    2: { fill: "#f1c40f", edge: "#b7950b", label: "Signal No. 2", borderTheme: "border-yellow-500/30", colorClasses: "bg-yellow-500/10 text-yellow-300" }, // Yellow
    3: { fill: "#e67e22", edge: "#a04000", label: "Signal No. 3", borderTheme: "border-orange-500/30", colorClasses: "bg-orange-500/10 text-orange-300" }, // Orange
    4: { fill: "#e74c3c", edge: "#922b21", label: "Signal No. 4", borderTheme: "border-red-500/30", colorClasses: "bg-red-500/10 text-red-300" }, // Red
    5: { fill: "#9b59b6", edge: "#6c3483", label: "Signal No. 5", borderTheme: "border-fuchsia-500/30", colorClasses: "bg-fuchsia-500/10 text-fuchsia-300 shadow-[0_0_10px_rgba(217,70,239,0.2)]" }, // Purple
};

function parseSignalLevel(text) {
    const t = String(text || "").toLowerCase();
    if (t.includes("signal no. 5") || t.includes("signal #5")) return 5;
    if (t.includes("signal no. 4") || t.includes("signal #4")) return 4;
    if (t.includes("signal no. 3") || t.includes("signal #3")) return 3;
    if (t.includes("signal no. 2") || t.includes("signal #2")) return 2;
    if (t.includes("signal no. 1") || t.includes("signal #1")) return 1;
    return null;
}

function parseAlertDate(dateStr) {
    if (!dateStr) return null;
    const trimmed = String(dateStr).trim();
    if (!trimmed) return null;

    let d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) return d;

    const isoLike = trimmed.replace(" ", "T");
    d = new Date(isoLike);
    if (!Number.isNaN(d.getTime())) return d;

    const withOffset = `${isoLike}+08:00`;
    d = new Date(withOffset);
    if (!Number.isNaN(d.getTime())) return d;

    return null;
}

function shapeToLatLngs(shapeStr) {
    if (!shapeStr || typeof shapeStr !== "string") return null;
    try {
        const raw = JSON.parse(shapeStr);
        if (!Array.isArray(raw) || raw.length === 0) return null;

        const normalize = (coords) => {
            if (coords.length === 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
                const [v1, v2] = coords;
                if (v1 > 50 && v2 < 50) return [v2, v1];
                if (v1 < 50 && v2 > 50) return [v1, v2];
                return [v1, v2];
            }
            const mapped = coords.map(c => Array.isArray(c) ? normalize(c) : null).filter(Boolean);
            return mapped.length > 0 ? mapped : null;
        };

        return normalize(raw);
    } catch (err) {
        return null;
    }
}

function polygonStringToLatLngs(polygonStr) {
    if (!polygonStr || typeof polygonStr !== "string") return null;
    const parts = polygonStr
        .split(/\s+/)
        .map((p) => p.trim())
        .filter(Boolean);
    if (parts.length < 3) return null;
    const ring = [];
    parts.forEach((pair) => {
        const [latStr, lonStr] = pair.split(",");
        const lat = parseFloat(latStr);
        const lon = parseFloat(lonStr);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
            ring.push([lat, lon]);
        }
    });
    if (ring.length < 3) return null;
    return [ring];
}

function normalizeProvinces(provinces) {
    if (!provinces) return [];
    if (Array.isArray(provinces)) return provinces;
    if (typeof provinces === "object") {
        return Object.keys(provinces)
            .map((key) => provinces[key])
            .filter((p) => p && typeof p === "object");
    }
    return [];
}

function getHighestSignalPerArea(alerts) {
    const areaMap = new Map();

    alerts.forEach((alert) => {
        const provinces = normalizeProvinces(alert.provinces);
        provinces.forEach((prov) => {
            const provinceName = prov.province || prov.areaDesc;
            const municipalityName = prov.municipality || "";
            if (!provinceName) return;

            const combinedText = `${prov.headline || ""} ${prov.description || ""} ${alert.headline || ""} ${alert.description || ""} ${alert.subtype || ""}`;
            const signal = parseSignalLevel(combinedText);

            if (signal) {
                const key = `${provinceName}|${municipalityName}`;
                if (!areaMap.has(key) || signal > areaMap.get(key).maxSignal) {
                    areaMap.set(key, { maxSignal: signal, alert, prov });
                }
            }
        });
    });

    return Array.from(areaMap.values());
}

function collectSignalPolygons(alerts) {
    const uniqueAreas = getHighestSignalPerArea(alerts);
    const results = [];

    uniqueAreas.forEach(({ maxSignal, alert, prov }, index) => {
        const name = prov.province || prov.areaDesc;
        let latlngs = null;
        if (prov.shape) {
            latlngs = shapeToLatLngs(prov.shape);
        }
        if (!latlngs && prov.polygon) {
            latlngs = polygonStringToLatLngs(prov.polygon);
        }

        if (latlngs && latlngs.length) {
            results.push({
                id: `${alert.identifier || "tcws"}-${name}-${index}-${maxSignal}`,
                name,
                latlngs,
                alert,
                signal: maxSignal,
            });
        }
    });

    return results;
}

function buildSignalSummary(alerts) {
    const uniqueAreas = getHighestSignalPerArea(alerts);
    const summary = {
        1: {},
        2: {},
        3: {},
        4: {},
        5: {},
    };

    uniqueAreas.forEach(({ maxSignal, prov }) => {
        const provinceName = prov.province || prov.areaDesc;
        const municipalityName = prov.municipality || "";

        if (summary[maxSignal]) {
            if (!summary[maxSignal][provinceName]) {
                summary[maxSignal][provinceName] = new Set();
            }
            if (municipalityName && municipalityName !== provinceName) {
                summary[maxSignal][provinceName].add(municipalityName);
            }
        }
    });

    return summary;
}

function getCycloneName(alerts) {
    if (!alerts || !alerts.length) return null;
    const regex = /((?:Typhoon|Tropical\s+Storm|Severe\s+Tropical\s+Storm|Tropical\s+Depression)\s+(?:["']?)([^"'\n\r]+?)(?:["']?))(?=\s+Signal|\s+Wind|$)/i;

    for (const alert of alerts) {
        const text = (alert.headline || "") + " " + (alert.description || "") + " " + (alert.parameter?.value || "");
        const match = text.match(regex);
        if (match && match[1]) {
            return match[1].trim();
        }
    }
    return "Active Tropical Cyclone";
}

// React Leaflet controller component to dynamically fit bounds of active wind signals
function MapBoundsController({ activePolygons, fitTrigger }) {
  const map = useMap();
  useEffect(() => {
    if (activePolygons && activePolygons.length > 0 && fitTrigger > 0) {
      let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
      let hasPoints = false;
      activePolygons.forEach((p) => {
        p.latlngs.forEach((ring) => {
          // Geometry could be nested or array of latlngs
          const processRing = (r) => {
            if (Array.isArray(r[0]) && typeof r[0][0] === "number") {
              r.forEach(([lat, lng]) => {
                if (lat < minLat) minLat = lat;
                if (lat > maxLat) maxLat = lat;
                if (lng < minLng) minLng = lng;
                if (lng > maxLng) maxLng = lng;
                hasPoints = true;
              });
            } else if (Array.isArray(r)) {
              r.forEach(processRing);
            }
          };
          processRing(ring);
        });
      });
      if (hasPoints) {
        map.fitBounds([
          [minLat, minLng],
          [maxLat, maxLng]
        ], { padding: [40, 40], maxZoom: 9, animate: true, duration: 1.2 });
      }
    }
  }, [fitTrigger, activePolygons, map]);
  return null;
}

const Warning = () => {
    const [alerts, setAlerts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [lastUpdated, setLastUpdated] = useState(null);
    
    // Premium UI States (same as alert.jsx)
    const [mobileTab, setMobileTab] = useState("map");
    const [hoveredProvince, setHoveredProvince] = useState(null);
    const [selectedProvince, setSelectedProvince] = useState(null);
    const [modalContent, setModalContent] = useState(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [fitTrigger, setFitTrigger] = useState(0);

    useEffect(() => {
        let cancelled = false;

        async function fetchAlerts() {
            try {
                setLoading(true);
                setError(null);
                const cacheBust = `t=${Date.now()}`;
                const url = ALERT_API.includes("?")
                    ? `${ALERT_API}&${cacheBust}`
                    : `${ALERT_API}?${cacheBust}`;

                const resp = await fetch(url);
                if (!resp.ok) {
                    throw new Error(`HTTP ${resp.status}`);
                }
                const json = await resp.json();
                if (cancelled) return;

                const data =
                    json && json.data && Array.isArray(json.data.alert_data)
                        ? json.data.alert_data
                        : [];

                const filtered = data.filter((a) => {
                    if (!a) return false;
                    const headline = String(a.headline || "").toLowerCase();
                    const event = String(a.event || "").toLowerCase();
                    const subtype = String(a.subtype || "").toLowerCase();
                    const msg = String(a.message || "").toLowerCase();

                    return (
                        (headline.includes("signal") && headline.includes("no.")) ||
                        (msg.includes("signal") && msg.includes("no.")) ||
                        event.includes("tropical cyclone wind signal") ||
                        subtype.includes("tropical cyclone wind signal")
                    );
                });

                const now = new Date();
                const cutoffMs = 12 * 60 * 60 * 1000;

                const recent = filtered.filter((a) => {
                    if (a.expires) {
                        const expires = parseAlertDate(a.expires);
                        if (expires && expires.getTime() <= now.getTime()) {
                            return false;
                        }
                    }
                    const issued = parseAlertDate(a.issued_date);
                    if (!issued) return false;
                    const diff = now.getTime() - issued.getTime();
                    return diff >= -300000 && diff <= cutoffMs;
                });

                setAlerts(recent);
                setLastUpdated(new Date());
            } catch (err) {
                if (!cancelled) {
                    console.error("Failed to fetch warning signals:", err);
                    setError("Unable to load warning signals right now.");
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        }

        fetchAlerts();
        const intervalId = window.setInterval(fetchAlerts, 60 * 1000);

        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
        };
    }, []);

    const signalPolygons = useMemo(
        () => collectSignalPolygons(alerts).sort((a, b) => a.signal - b.signal),
        [alerts]
    );

    const signalSummary = useMemo(
        () => buildSignalSummary(alerts),
        [alerts]
    );

    const hasSignals = Object.values(signalSummary).some(obj => Object.keys(obj).length > 0);
    const cycloneName = useMemo(() => getCycloneName(alerts), [alerts]);

    const triggerMapFocus = () => {
        setFitTrigger(prev => prev + 1);
    };

    // Helper renderer for warning items in list with syncing
    const renderAreaListDict = (obj, colorClasses, borderTheme, signalNo, severityLabel) => {
        const keys = Object.keys(obj);
        if (keys.length === 0) return null;
        
        const maxVisible = 6;
        const visibleKeys = keys.slice(0, maxVisible);
        const hiddenCount = keys.length - maxVisible;

        const renderItem = (prov) => {
            const isHovered = hoveredProvince === prov;
            const isSelected = selectedProvince?.province === prov;

            return (
                <button
                    key={prov}
                    onMouseEnter={() => setHoveredProvince(prov)}
                    onMouseLeave={() => setHoveredProvince(null)}
                    onClick={() => {
                        const correspondingPolygon = signalPolygons.find(p => p.name === prov);
                        setSelectedProvince({
                            province: prov,
                            severity: severityLabel,
                            municipalities: Array.from(obj[prov]).sort(),
                            alertDetails: correspondingPolygon?.alert || signalPolygons[0]?.alert
                        });
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border flex items-center gap-1.5 cursor-pointer text-left ${
                        isHovered || isSelected
                            ? `${colorClasses} scale-105 shadow-lg shadow-black/35 ring-1 ring-white/20`
                            : "bg-slate-900/60 border-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-800/60"
                    }`}
                >
                    <MapPin className="w-3.5 h-3.5 opacity-80" />
                    <span>{prov}</span>
                    {obj[prov].size > 0 && (
                        <span className="text-[10px] opacity-60 bg-black/40 px-1.5 py-0.5 rounded-full font-medium">
                            {obj[prov].size}
                        </span>
                    )}
                </button>
            );
        };

        return (
            <div className="flex flex-wrap gap-2 items-center">
                {visibleKeys.map(renderItem)}
                {hiddenCount > 0 && (
                    <button 
                        onClick={() => setModalContent({ title: severityLabel, icon: "🌀", list: obj })}
                        className="px-3 py-1.5 bg-slate-950/80 border border-dashed border-slate-700 hover:border-slate-500 text-slate-400 hover:text-white text-xs font-black rounded-xl cursor-pointer transition-all hover:scale-105 active:scale-95"
                    >
                        + {hiddenCount} More
                    </button>
                )}
            </div>
        );
    };

    // Filter keys inside standard search dialog
    const filteredModalKeys = useMemo(() => {
        if (!modalContent?.list) return [];
        return Object.keys(modalContent.list).filter(key => 
            key.toLowerCase().includes(searchQuery.toLowerCase()) ||
            Array.from(modalContent.list[key]).some(m => String(m).toLowerCase().includes(searchQuery.toLowerCase()))
        ).sort();
    }, [modalContent, searchQuery]);

    return (
    <div className="bg-slate-950 text-slate-200 font-sans min-h-screen relative overflow-x-hidden p-4 md:p-8 flex justify-center items-start selection:bg-orange-500 selection:text-white">
      <style>{`
        .bg-grid-pattern {
            background-image: linear-gradient(to right, rgba(255,255,255,0.015) 1px, transparent 1px),
                              linear-gradient(to bottom, rgba(255,255,255,0.015) 1px, transparent 1px);
            background-size: 32px 32px;
        }
        @keyframes swirl {
            0% { transform: rotate(0deg) scale(1); }
            50% { transform: rotate(180deg) scale(1.05); }
            100% { transform: rotate(360deg) scale(1); }
        }
        .animate-swirl {
            animation: swirl 12s linear infinite;
        }
        @keyframes pulseWarning {
            0%, 100% { filter: drop-shadow(0 0 10px rgba(249, 115, 22, 0.4)); opacity: 0.95; }
            50% { filter: drop-shadow(0 0 20px rgba(249, 115, 22, 0.8)); opacity: 1; }
        }
        .glow-active-orange {
            animation: pulseWarning 2.5s infinite ease-in-out;
        }
        .custom-glass {
            background: rgba(15, 23, 42, 0.65);
            backdrop-filter: blur(16px);
            border: 1px solid rgba(255, 255, 255, 0.07);
        }
        .leaflet-interactive:focus,
        .leaflet-container :focus,
        path.leaflet-interactive:focus {
          outline: none !important;
          box-shadow: none !important;
        }
      `}</style>

      <div className="absolute inset-0 bg-grid-pattern pointer-events-none z-0"></div>

      <div className="relative z-10 max-w-7xl w-full flex flex-col gap-6 md:gap-8">
        
        {/* Unified Premium Header */}
        <header className="custom-glass rounded-3xl p-5 md:p-7 shadow-2xl flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 border-b border-white/5 relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-80 h-80 bg-gradient-to-br from-orange-500/10 to-pink-500/10 rounded-full blur-3xl pointer-events-none"></div>
            
            <div className="flex items-center gap-4">
                <div className="relative flex h-14 w-14 items-center justify-center shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-2xl bg-orange-500 opacity-20"></span>
                    <div className="relative h-12 w-12 bg-slate-900 border border-orange-500/40 rounded-2xl flex items-center justify-center text-orange-400 overflow-hidden shadow-lg shadow-orange-950/50">
                        <svg className="w-8 h-8 animate-swirl" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4"></path></svg>
                    </div>
                </div>
                <div>
                    <h1 className="text-2xl md:text-3xl font-black tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent">
                        Tropical Cyclone Wind Signal (TCWS)
                    </h1>
                    <div className="flex items-center gap-2 mt-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse"></span>
                        <p className="text-xs md:text-sm font-semibold text-slate-400">
                            Active Bulletin: <span className="text-slate-200">{cycloneName || "No Storm Tracked"}</span>
                        </p>
                    </div>
                </div>
            </div>
            
            <div className="bg-slate-950/60 border border-white/5 p-3 rounded-2xl text-left lg:text-right min-w-[210px] w-full lg:w-auto flex lg:flex-col justify-between items-center lg:items-end gap-3 shadow-inner">
                <div>
                    <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-0.5">LATEST PAGASA BULLETIN</p>
                    <p className="text-xs font-bold text-slate-200">
                        {lastUpdated ? lastUpdated.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "---"}
                    </p>
                </div>
                <div className="text-right">
                    <p className="text-xs font-bold text-orange-400">
                        {lastUpdated ? lastUpdated.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", second: "2-digit" }) + " PST" : "---"}
                    </p>
                </div>
            </div>
        </header>

        {/* Mobile Viewport Toggle Button (Only visible on mobile screens) */}
        <div className="lg:hidden flex rounded-xl border border-white/5 bg-slate-950/60 p-1.5 shadow-inner">
          <button
            onClick={() => setMobileTab("map")}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              mobileTab === "map" ? "bg-slate-800 text-white shadow-md" : "text-slate-400"
            }`}
          >
            🗺️ Interactive Map
          </button>
          <button
            onClick={() => setMobileTab("list")}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              mobileTab === "list" ? "bg-slate-800 text-white shadow-md" : "text-slate-400"
            }`}
          >
            📋 Wind Signals {signalPolygons.length > 0 && `(${signalPolygons.length})`}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 md:gap-8">
            
            {/* Left Column (Map & Legend) - Hidden/Visible based on mobileTab on smaller viewports */}
            <div className={`lg:col-span-7 flex flex-col gap-6 ${mobileTab !== "map" ? "hidden lg:flex" : "flex"}`}>
                <div className="custom-glass rounded-3xl p-3 shadow-2xl relative group h-[480px] md:h-[540px] flex flex-col">
                    
                    {/* Map Float Controls */}
                    <div className="absolute top-6 left-6 z-[1000] flex flex-col gap-2.5 pointer-events-none">
                        <div className="bg-slate-950/90 backdrop-blur-md border border-white/10 px-4 py-2.5 rounded-2xl shadow-2xl flex items-center gap-2.5">
                            <span className="w-2.5 h-2.5 rounded-full bg-orange-500 animate-pulse glow-active-orange"></span>
                            <h2 className="text-xs font-black uppercase tracking-wider text-slate-200">
                                Geographic Signal Warnings
                            </h2>
                        </div>

                        {signalPolygons.length > 0 && (
                            <button
                                onClick={triggerMapFocus}
                                className="bg-slate-950/90 hover:bg-slate-900 border border-white/10 hover:border-slate-500 p-2.5 rounded-2xl shadow-2xl flex items-center gap-2 text-xs font-bold text-orange-400 pointer-events-auto transition-all cursor-pointer hover:scale-105 active:scale-95 w-fit"
                            >
                                <Maximize2 className="w-3.5 h-3.5" />
                                <span>Fit Warnings Bounds</span>
                            </button>
                        )}
                    </div>

                    <div className="w-full h-full rounded-2xl overflow-hidden relative border border-white/5 bg-slate-900" style={{ isolation: "isolate" }}>
                        <MapContainer
                            center={[12.8797, 121.774]}
                            zoom={5.5}
                            minZoom={4.5}
                            maxZoom={11}
                            scrollWheelZoom
                            zoomControl={false}
                            className="w-full h-full bg-[#030712] relative z-10"
                            maxBounds={PH_BOUNDS}
                            maxBoundsViscosity={0.9}
                        >
                            <TileLayer
                                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                                attribution='&copy; OpenStreetMap &copy; CARTO'
                            />
                            
                            <MapBoundsController activePolygons={signalPolygons} fitTrigger={fitTrigger} />

                            {signalPolygons.map((prov) => {
                                const colors = SIGNAL_COLORS[prov.signal] || SIGNAL_COLORS[1];
                                
                                const isSyncHovered = hoveredProvince === prov.name;
                                const baseStyle = {
                                    weight: isSyncHovered ? 3.5 : 1.5,
                                    color: isSyncHovered ? "#ffffff" : colors.edge,
                                    fillColor: colors.fill,
                                    fillOpacity: isSyncHovered ? 0.8 : 0.5,
                                    dashArray: isSyncHovered ? "4" : undefined,
                                };

                                return (
                                    <Polygon
                                        key={prov.id}
                                        positions={prov.latlngs}
                                        pathOptions={baseStyle}
                                        eventHandlers={{
                                            mouseover: () => setHoveredProvince(prov.name),
                                            mouseout: () => setHoveredProvince(null),
                                            click: () => {
                                                setSelectedProvince({
                                                    province: prov.name,
                                                    severity: `TCWS Signal No. ${prov.signal}`,
                                                    municipalities: prov.alert?.provinces ? [prov.alert.provinces] : [],
                                                    alertDetails: prov.alert
                                                });
                                            }
                                        }}
                                    >
                                        <Tooltip sticky className="custom-leaflet-tooltip">
                                            <div className="p-1.5 text-xs text-slate-800">
                                                <p className="font-black text-slate-900 border-b border-slate-200 pb-1 mb-1">{prov.name}</p>
                                                <p className="text-[10px] font-bold text-orange-700">
                                                    Signal No. {prov.signal}
                                                </p>
                                            </div>
                                        </Tooltip>
                                    </Polygon>
                                );
                            })}
                        </MapContainer>
                        
                        {/* Swirling storm overlay animations when cyclones are tracked */}
                        {hasSignals && (
                           <>
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 border border-dashed border-cyan-500/20 bg-cyan-500/5 rounded-full animate-[spin_25s_linear_infinite] pointer-events-none z-0"></div>
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 border border-dashed border-yellow-500/20 bg-yellow-500/5 rounded-full animate-[spin_20s_linear_infinite_reverse] pointer-events-none z-0"></div>
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 border border-dashed border-orange-500/30 bg-orange-500/10 rounded-full animate-[spin_15s_linear_infinite] pointer-events-none z-0"></div>
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 bg-fuchsia-500/30 blur-xl rounded-full animate-pulse shadow-[0_0_40px_rgba(217,70,239,0.5)] pointer-events-none z-0"></div>
                           </>
                        )}
                    </div>
                </div>

                {/* Styled TCWS Scale Guides */}
                <div className="custom-glass rounded-3xl p-6 shadow-2xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-orange-500/5 blur-2xl rounded-full pointer-events-none"></div>
                    <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                        <Info className="w-4 h-4" />
                        <span>Tropical Cyclone Wind Signal (TCWS) Scale</span>
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                        <div className="flex flex-col items-center text-center gap-2 bg-slate-900/30 p-2.5 rounded-2xl border border-white/5">
                            <div className="w-full h-2 rounded-full bg-[#3498db] shadow-[0_0_8px_rgba(52,152,219,0.8)]"></div>
                            <span className="text-[10px] font-black text-sky-400 mt-1 uppercase">SIGNAL 1</span>
                            <span className="text-[9px] text-slate-400 leading-tight">39-61 km/h<br />Minimal</span>
                        </div>
                        <div className="flex flex-col items-center text-center gap-2 bg-slate-900/30 p-2.5 rounded-2xl border border-white/5">
                            <div className="w-full h-2 rounded-full bg-[#f1c40f] shadow-[0_0_8px_rgba(241,196,15,0.8)]"></div>
                            <span className="text-[10px] font-black text-yellow-400 mt-1 uppercase">SIGNAL 2</span>
                            <span className="text-[9px] text-slate-400 leading-tight">62-88 km/h<br />Minor-Mod</span>
                        </div>
                        <div className="flex flex-col items-center text-center gap-2 bg-slate-900/30 p-2.5 rounded-2xl border border-white/5">
                            <div className="w-full h-2 rounded-full bg-[#e67e22] shadow-[0_0_8px_rgba(230,126,34,0.8)]"></div>
                            <span className="text-[10px] font-black text-orange-400 mt-1 uppercase">SIGNAL 3</span>
                            <span className="text-[9px] text-slate-400 leading-tight">89-117 km/h<br />Moderate</span>
                        </div>
                        <div className="flex flex-col items-center text-center gap-2 bg-slate-900/30 p-2.5 rounded-2xl border border-white/5">
                            <div className="w-full h-2 rounded-full bg-[#e74c3c] shadow-[0_0_8px_rgba(231,76,60,0.8)] glow-active-orange"></div>
                            <span className="text-[10px] font-black text-red-400 mt-1 uppercase">SIGNAL 4</span>
                            <span className="text-[9px] text-slate-400 leading-tight">118-184 km/h<br />Severe</span>
                        </div>
                        <div className="flex flex-col items-center text-center gap-2 bg-slate-900/30 p-2.5 rounded-2xl border border-white/5">
                            <div className="w-full h-2 rounded-full bg-[#9b59b6] shadow-[0_0_8px_rgba(155,89,182,0.8)]"></div>
                            <span className="text-[10px] font-black text-fuchsia-400 mt-1 uppercase">SIGNAL 5</span>
                            <span className="text-[9px] text-slate-400 leading-tight">{">"} 185 km/h<br />Extreme</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Right Column (Affected Areas / Summaries) */}
            <div className={`lg:col-span-5 flex flex-col gap-5 ${mobileTab !== "list" ? "hidden lg:flex" : "flex"}`}>
                
                {/* selectedProvince Inspector Drawer/Expandable details */}
                {selectedProvince && (
                  <div className="bg-gradient-to-r from-slate-900 to-orange-950/50 border border-orange-500/30 rounded-3xl p-5 shadow-[0_0_30px_rgba(249,115,22,0.1)] relative overflow-hidden transition-all duration-300">
                    <div className="absolute top-2 right-2 z-20">
                      <button 
                        onClick={() => setSelectedProvince(null)} 
                        className="p-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-white transition-all cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="absolute top-0 left-0 w-1 h-full bg-orange-500"></div>

                    <div className="flex items-center gap-2 mb-3">
                      <div className="px-2 py-0.5 rounded-md bg-orange-500/20 text-orange-400 text-[10px] font-black uppercase tracking-wider">
                        {selectedProvince.severity}
                      </div>
                      <h4 className="text-lg font-black text-white">{selectedProvince.province}</h4>
                    </div>

                    <p className="text-xs text-slate-300 leading-relaxed mb-4">
                      {selectedProvince.alertDetails?.message || selectedProvince.alertDetails?.headline || "Tropical cyclone gale warnings actively observed."}
                    </p>

                    {selectedProvince.municipalities.length > 0 && (
                      <div>
                        <h5 className="text-[10px] uppercase font-black tracking-widest text-slate-400 mb-2">Affected Areas:</h5>
                        <div className="max-h-36 overflow-y-auto pr-1 flex flex-wrap gap-1.5 text-xs text-slate-300">
                          {selectedProvince.municipalities.map(m => (
                            <span key={m} className="px-2 py-1 rounded-lg bg-slate-950/50 border border-white/5">{m}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    <div className="flex justify-between items-center text-[10px] text-slate-500 font-medium mt-4 pt-3 border-t border-white/5">
                      <span>Issued: {selectedProvince.alertDetails?.issued_date ? new Date(selectedProvince.alertDetails.issued_date).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }) : "---"}</span>
                      {selectedProvince.alertDetails?.expires && (
                        <span className="text-amber-500">Expires: {new Date(selectedProvince.alertDetails.expires).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}</span>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    {loading ? (
                      <span className="w-4 h-4 border-2 border-orange-500 border-t-transparent rounded-full animate-spin"></span>
                    ) : (
                      <CheckCircle2 className="w-4.5 h-4.5 text-slate-500 animate-pulse" />
                    )}
                    <span>Active Wind Warning Sectors</span>
                  </h3>
                </div>

                {error && (
                    <div className="flex items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3.5 text-red-300">
                        <AlertTriangle className="h-4.5 w-4.5 mt-0.5 shrink-0" />
                        <p className="text-xs">{error}</p>
                    </div>
                )}

                {!loading && !error && (
                    <div className="flex flex-col gap-4">
                        
                        {/* Signal 5 Card */}
                        {Object.keys(signalSummary[5]).length > 0 && (
                          <div className="custom-glass rounded-3xl p-5 shadow-2xl relative overflow-hidden group border-l-2 border-fuchsia-500">
                            <div className="flex justify-between items-center mb-3">
                              <div className="flex items-center gap-2.5">
                                <div className="w-6.5 h-6.5 rounded-full bg-fuchsia-500 text-white font-black text-xs flex items-center justify-center animate-pulse">5</div>
                                <h4 className="text-sm font-black text-fuchsia-400 uppercase tracking-wider">Signal No. 5</h4>
                              </div>
                              <span className="text-[10px] text-fuchsia-300 font-bold bg-fuchsia-500/10 px-2 py-0.5 rounded border border-fuchsia-500/20">Winds {">"} 185 km/h</span>
                            </div>
                            <p className="text-[11px] text-slate-400 mb-3.5">Extreme danger to life and property. Super typhoon category winds.</p>
                            {renderAreaListDict(signalSummary[5], SIGNAL_COLORS[5].colorClasses, SIGNAL_COLORS[5].borderTheme, 5, "Signal No. 5 Area")}
                          </div>
                        )}

                        {/* Signal 4 Card */}
                        {Object.keys(signalSummary[4]).length > 0 && (
                          <div className="custom-glass rounded-3xl p-5 shadow-2xl relative overflow-hidden group border-l-2 border-red-500">
                            <div className="flex justify-between items-center mb-3">
                              <div className="flex items-center gap-2.5">
                                <div className="w-6.5 h-6.5 rounded-full bg-red-500 text-white font-black text-xs flex items-center justify-center">4</div>
                                <h4 className="text-sm font-black text-red-400 uppercase tracking-wider">Signal No. 4</h4>
                              </div>
                              <span className="text-[10px] text-red-300 font-bold bg-red-500/10 px-2 py-0.5 rounded border border-red-500/20">Winds 118-184 km/h</span>
                            </div>
                            <p className="text-[11px] text-slate-400 mb-3.5">Significant destructive typhoon winds expected within 12 hours.</p>
                            {renderAreaListDict(signalSummary[4], SIGNAL_COLORS[4].colorClasses, SIGNAL_COLORS[4].borderTheme, 4, "Signal No. 4 Area")}
                          </div>
                        )}

                        {/* Signal 3 Card */}
                        {Object.keys(signalSummary[3]).length > 0 && (
                          <div className="custom-glass rounded-3xl p-5 shadow-2xl relative overflow-hidden group border-l-2 border-orange-500">
                            <div className="flex justify-between items-center mb-3">
                              <div className="flex items-center gap-2.5">
                                <div className="w-6.5 h-6.5 rounded-full bg-orange-500 text-white font-black text-xs flex items-center justify-center">3</div>
                                <h4 className="text-sm font-black text-orange-400 uppercase tracking-wider">Signal No. 3</h4>
                              </div>
                              <span className="text-[10px] text-orange-300 font-bold bg-orange-500/10 px-2 py-0.5 rounded border border-orange-500/20">Winds 89-117 km/h</span>
                            </div>
                            <p className="text-[11px] text-slate-400 mb-3.5">Stormy conditions expected. Secure light-structured houses.</p>
                            {renderAreaListDict(signalSummary[3], SIGNAL_COLORS[3].colorClasses, SIGNAL_COLORS[3].borderTheme, 3, "Signal No. 3 Area")}
                          </div>
                        )}

                        {/* Signal 2 Card */}
                        {Object.keys(signalSummary[2]).length > 0 && (
                          <div className="custom-glass rounded-3xl p-5 shadow-2xl relative overflow-hidden group border-l-2 border-yellow-500">
                            <div className="flex justify-between items-center mb-3">
                              <div className="flex items-center gap-2.5">
                                <div className="w-6.5 h-6.5 rounded-full bg-yellow-500 text-slate-950 font-black text-xs flex items-center justify-center">2</div>
                                <h4 className="text-sm font-black text-yellow-400 uppercase tracking-wider">Signal No. 2</h4>
                              </div>
                              <span className="text-[10px] text-yellow-300 font-bold bg-yellow-500/10 px-2 py-0.5 rounded border border-yellow-500/20">Winds 62-88 km/h</span>
                            </div>
                            <p className="text-[11px] text-slate-400 mb-3.5">Gale winds expected. Some damage to high-risk structures.</p>
                            {renderAreaListDict(signalSummary[2], SIGNAL_COLORS[2].colorClasses, SIGNAL_COLORS[2].borderTheme, 2, "Signal No. 2 Area")}
                          </div>
                        )}

                        {/* Signal 1 Card */}
                        {Object.keys(signalSummary[1]).length > 0 && (
                          <div className="custom-glass rounded-3xl p-5 shadow-2xl relative overflow-hidden group border-l-2 border-sky-500">
                            <div className="flex justify-between items-center mb-3">
                              <div className="flex items-center gap-2.5">
                                <div className="w-6.5 h-6.5 rounded-full bg-[#3498db] text-white font-black text-xs flex items-center justify-center">1</div>
                                <h4 className="text-sm font-black text-sky-400 uppercase tracking-wider">Signal No. 1</h4>
                              </div>
                              <span className="text-[10px] text-sky-300 font-bold bg-sky-500/10 px-2 py-0.5 rounded border border-sky-500/20">Winds 39-61 km/h</span>
                            </div>
                            <p className="text-[11px] text-slate-400 mb-3.5">Strong breeze. Very light to no damage expected locally.</p>
                            {renderAreaListDict(signalSummary[1], SIGNAL_COLORS[1].colorClasses, SIGNAL_COLORS[1].borderTheme, 1, "Signal No. 1 Area")}
                          </div>
                        )}

                        {!hasSignals && (
                            <div className="flex flex-col items-center justify-center py-12 text-center custom-glass border border-dashed border-white/10 rounded-3xl h-full">
                                <div className="mb-4 rounded-2xl bg-slate-900 border border-white/5 p-4 shadow-inner">
                                    <Wind className="w-8 h-8 text-slate-500 animate-pulse" />
                                </div>
                                <p className="text-sm font-black text-slate-300">Quiet Weather Systems</p>
                                <p className="text-[11px] text-slate-500 mt-2 max-w-xs leading-relaxed">
                                    There are currently no active areas in the Philippines under PAGASA wind signals.
                                </p>
                            </div>
                        )}
                    </div>
                )}

                {/* Safety Advisory Banner */}
                <div className="bg-slate-900/30 border border-white/5 rounded-3xl p-4.5 mt-auto flex items-start gap-4">
                  <div className="text-xl shrink-0">⚠️</div>
                  <div>
                    <h5 className="text-slate-200 font-bold text-xs mb-1">Precautionary Directives</h5>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      Fisherfolk and small seacrafts are advised not to venture out into the seaboards of areas under active storm signals. Stay tuned for PAGASA weather bulletins.
                    </p>
                  </div>
                </div>

            </div>
        </div>

        {/* See More Modal Dialog with search filter */}
        {modalContent && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
            <div className="bg-slate-900 border border-white/10 rounded-3xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl relative overflow-hidden transition-all duration-300">
              
              {/* Modal Header */}
              <div className="flex justify-between items-center p-5 border-b border-white/5 bg-slate-900/90 z-10 sticky top-0">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{modalContent.icon}</span>
                  <div>
                    <h3 className="text-lg font-black text-white tracking-tight">{modalContent.title} Areas</h3>
                    <p className="text-[10px] text-slate-400">Search and navigate through affected provinces.</p>
                  </div>
                </div>
                <button 
                  onClick={() => { setModalContent(null); setSearchQuery(""); }}
                  className="text-slate-400 hover:text-white transition-colors p-2 rounded-xl hover:bg-slate-800 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Live Search */}
              <div className="px-5 py-3.5 border-b border-white/5 bg-slate-950/40 flex items-center gap-2">
                <Search className="w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search regions, provinces or municipalities..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-transparent border-none outline-none text-xs text-white placeholder-slate-500 w-full"
                  autoFocus
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery("")} className="text-slate-400 hover:text-white cursor-pointer">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Scrollable list grouped cleanly inside accordions */}
              <div className="p-5 overflow-y-auto flex flex-col gap-3">
                {filteredModalKeys.length === 0 ? (
                  <p className="text-xs text-slate-500 italic text-center py-8">No matching locations found.</p>
                ) : (
                  filteredModalKeys.map((key) => {
                    const municipalities = Array.from(modalContent.list[key]).sort();
                    return (
                      <div key={key} className="bg-slate-950/40 border border-white/5 rounded-2xl p-4 flex flex-col gap-2">
                        <div className="flex items-center justify-between border-b border-white/5 pb-2">
                          <span className="text-sm font-black text-slate-200 flex items-center gap-1.5">
                            <MapPin className="w-4 h-4 text-orange-400" />
                            {key}
                          </span>
                          <span className="text-[10px] text-slate-500 font-bold bg-slate-900 px-2 py-0.5 rounded-lg">
                            {municipalities.length > 0 ? `${municipalities.length} Areas` : "Province Wide"}
                          </span>
                        </div>
                        {municipalities.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-1 text-xs text-slate-400 pl-1">
                            {municipalities.map(m => (
                              <span key={m} className="px-2.5 py-1 rounded-lg bg-slate-900 border border-white/5 hover:border-slate-700 transition-colors">
                                {m}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );

};

export default Warning;
