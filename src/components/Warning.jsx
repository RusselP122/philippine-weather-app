import React, { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Polygon, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { AlertCircle, Wind, AlertTriangle } from "lucide-react";

const ALERT_API = "/api/cap-alerts";

const PH_BOUNDS = [
    [4, 116],
    [22.5, 127.5],
];

// TCWS Color Mapping (Standard PAGASA Colors)
const SIGNAL_COLORS = {
    1: { fill: "#3498db", edge: "#1f618d", label: "Signal No. 1" }, // Blue
    2: { fill: "#f1c40f", edge: "#b7950b", label: "Signal No. 2" }, // Yellow
    3: { fill: "#e67e22", edge: "#a04000", label: "Signal No. 3" }, // Orange
    4: { fill: "#e74c3c", edge: "#922b21", label: "Signal No. 4" }, // Red
    5: { fill: "#9b59b6", edge: "#6c3483", label: "Signal No. 5" }, // Purple
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

// Reusing geometry parsing logic from alert.jsx but enhanced for recursion
function shapeToLatLngs(shapeStr) {
    if (!shapeStr || typeof shapeStr !== "string") return null;
    try {
        const raw = JSON.parse(shapeStr);
        if (!Array.isArray(raw) || raw.length === 0) return null;

        // Recursive helper to normalize coordinates
        // Returns:
        // - [lat, lon] if it's a point (depth 0 relative to point)
        // - Array of [lat, lon] if it's a ring
        // - Array of Rings if Polygon
        // - Array of Polygons if MultiPolygon
        const normalize = (coords) => {
            // Check if this is a coordinate pair [x, y]
            if (coords.length === 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
                const [v1, v2] = coords;
                // Heuristic for Lat/Lon vs Lon/Lat
                // PH Lat: 4-22, Lon: 116-127
                // if v1 > 50, it's likely Lon. v2 < 50 is Lat. -> Swap to [Lat, Lon]
                if (v1 > 50 && v2 < 50) return [v2, v1];
                // if v1 < 50 and v2 > 50, it's likely [Lat, Lon] -> Keep
                if (v1 < 50 && v2 > 50) return [v1, v2];
                // Fallback
                return [v1, v2];
            }

            // Otherwise, it's an array of something
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
    const areaMap = new Map(); // Key: "Province|Municipality", Value: { maxSignal, alert, provData }

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

function formatList(items) {
    if (!items || !items.length) return "None indicated.";
    return items.join(", ");
}

function getCycloneName(alerts) {
    if (!alerts || !alerts.length) return null;

    // Look for patterns like "Typhoon 'NAME'", "Tropical Storm 'NAME'", "Tropical Depression 'NAME'"
    // Or "Severe Tropical Storm 'NAME'"
    // Case insensitive, capturing the name in quotes or after the system type
    const regex = /((?:Typhoon|Tropical\s+Storm|Severe\s+Tropical\s+Storm|Tropical\s+Depression)\s+(?:["']?)([^"'\n\r]+?)(?:["']?))(?=\s+Signal|\s+Wind|$)/i;

    for (const alert of alerts) {
        const text = (alert.headline || "") + " " + (alert.description || "") + " " + (alert.parameter?.value || "");
        const match = text.match(regex);
        if (match && match[1]) {
            // Clean up the name (remove "Agaton", just get "Agaton" if duplicated, etc.)
            let name = match[1].trim();

            // Sometimes it captures "Tropical Depression Agaton", so we remove the type if repeated? 
            // Actually regex group 1 should just be the name if structured well.
            // Let's rely on the first good match.
            return match[1].trim();
        }
    }
    return "Active Tropical Cyclone";
}

function renderSignalList(data) {
    if (!data || Object.keys(data).length === 0) return <p className="text-[11px] text-slate-500 pl-4">None indicated.</p>;

    return (
        <ul className="space-y-3 pl-4">
            {Object.entries(data).sort().map(([province, municipalities]) => (
                <li key={province} className="text-[11px] leading-relaxed text-slate-400">
                    <span className="font-semibold text-slate-300 block">{province}</span>
                    {municipalities.size > 0 && (
                        <span className="block text-slate-500 pl-2 mt-0.5 border-l-2 border-slate-800">
                            {Array.from(municipalities).sort().join(", ")}
                        </span>
                    )}
                </li>
            ))}
        </ul>
    );
}

const Warning = () => {
    const [alerts, setAlerts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [lastUpdated, setLastUpdated] = useState(null);

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

                // STRICT TCWS FILTERING FILTER
                const filtered = data.filter((a) => {
                    if (!a) return false;
                    const headline = String(a.headline || "").toLowerCase();
                    const event = String(a.event || "").toLowerCase();
                    const subtype = String(a.subtype || "").toLowerCase();
                    const msg = String(a.message || "").toLowerCase();

                    // Must be related to Tropical Cyclone Wind Signal
                    return (
                        (headline.includes("signal") && headline.includes("no.")) ||
                        (msg.includes("signal") && msg.includes("no.")) ||
                        event.includes("tropical cyclone wind signal") ||
                        subtype.includes("tropical cyclone wind signal")
                    );
                });

                const now = new Date();
                const cutoffMs = 12 * 60 * 60 * 1000; // 12 hours window for TCWS generally

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

    return (
    <div className="bg-slate-950 text-slate-200 font-sans min-h-screen relative overflow-x-hidden p-4 md:p-8 flex justify-center items-start">
      <style>{`
        .bg-grid-pattern {
            background-image: linear-gradient(to right, rgba(255,255,255,0.02) 1px, transparent 1px),
                              linear-gradient(to bottom, rgba(255,255,255,0.02) 1px, transparent 1px);
            background-size: 40px 40px;
        }
        @keyframes swirl {
            0% { transform: rotate(0deg) scale(1); }
            50% { transform: rotate(180deg) scale(1.1); }
            100% { transform: rotate(360deg) scale(1); }
        }
        .animate-swirl {
            animation: swirl 4s linear infinite;
        }
      `}</style>

      <div className="absolute inset-0 bg-grid-pattern pointer-events-none z-0"></div>

      <div className="relative z-10 max-w-7xl w-full flex flex-col gap-8">
        <header className="bg-slate-900/60 backdrop-blur-md border border-slate-800 rounded-3xl p-6 md:p-8 shadow-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
            <div className="flex items-center gap-4">
                <div className="relative flex h-14 w-14 items-center justify-center">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-500 opacity-20"></span>
                    <div className="relative h-12 w-12 bg-slate-800 border-2 border-orange-500 rounded-full flex items-center justify-center text-orange-400 overflow-hidden shadow-[0_0_15px_rgba(249,115,22,0.4)]">
                        <svg className="w-8 h-8 animate-swirl" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4"></path></svg>
                    </div>
                </div>
                <div>
                    <h1 className="text-3xl font-black text-white tracking-tight">Tropical Cyclone Wind Signal (TCWS)</h1>
                    <p className="text-slate-400 font-medium mt-1">{cycloneName || "Active Tropical Cyclone"}</p>
                </div>
            </div>
            <div className="bg-slate-950/80 border border-slate-700 p-3 rounded-xl text-right min-w-[200px]">
                <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">LATEST BULLETIN</p>
                <p className="text-sm font-bold text-slate-200">
                    {lastUpdated ? lastUpdated.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "---"}
                </p>
                <p className="text-sm text-slate-400">
                    {lastUpdated ? lastUpdated.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }) + " PST" : "---"}
                </p>
            </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-7 flex flex-col gap-6">
                <div className="bg-slate-900/60 backdrop-blur-md border border-slate-800 rounded-3xl p-4 shadow-2xl relative group h-[650px]">
                    <div className="absolute top-8 left-8 z-[1000] bg-slate-950/80 backdrop-blur-sm border border-slate-700 px-4 py-2 rounded-lg shadow-lg pointer-events-none">
                        <h2 className="font-bold text-white flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                            Live TCWS Map
                        </h2>
                    </div>

                    <div className="w-full h-full rounded-2xl overflow-hidden relative border border-slate-700/50 bg-slate-800" style={{ isolation: "isolate" }}>
                        <MapContainer
                            center={[12.8797, 121.774]}
                            zoom={6}
                            minZoom={4.5}
                            maxZoom={11}
                            scrollWheelZoom
                            zoomControl={false}
                            className="w-full h-full bg-[#0f172a] relative z-10"
                            maxBounds={PH_BOUNDS}
                            maxBoundsViscosity={0.8}
                        >
                            <TileLayer
                                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                                attribution='&copy; OpenStreetMap contributors &copy; CARTO'
                            />
                            {signalPolygons.map((prov) => {
                                const colors = SIGNAL_COLORS[prov.signal] || SIGNAL_COLORS[1];
                                const baseStyle = {
                                    weight: 1,
                                    color: colors.edge,
                                    fillColor: colors.fill,
                                    fillOpacity: 0.6,
                                };
                                const highlightStyle = {
                                    ...baseStyle,
                                    weight: 2,
                                    fillOpacity: 0.8,
                                };

                                return (
                                    <Polygon
                                        key={prov.id}
                                        positions={prov.latlngs}
                                        pathOptions={baseStyle}
                                        eventHandlers={{
                                            mouseover: (e) => {
                                                e.target.setStyle(highlightStyle);
                                            },
                                            mouseout: (e) => {
                                                e.target.setStyle(baseStyle);
                                            },
                                        }}
                                    >
                                        <Tooltip sticky className="custom-leaflet-tooltip">
                                            <div className="text-xs">
                                                <p className="font-semibold text-slate-800">{prov.name}</p>
                                                <p className="text-[10px] font-bold text-orange-700">
                                                    Signal No. {prov.signal}
                                                </p>
                                            </div>
                                        </Tooltip>
                                    </Polygon>
                                );
                            })}
                        </MapContainer>
                        
                        {hasSignals && (
                           <>
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 border-2 border-dashed border-cyan-500/50 bg-cyan-500/10 rounded-full animate-[spin_20s_linear_infinite] pointer-events-none z-0"></div>
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 border-2 border-dashed border-yellow-500/50 bg-yellow-500/10 rounded-full animate-[spin_15s_linear_infinite_reverse] pointer-events-none z-0"></div>
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 border-2 border-dashed border-orange-500/60 bg-orange-500/20 rounded-full animate-[spin_10s_linear_infinite] pointer-events-none z-0"></div>
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 border-2 border-red-500/80 bg-red-500/30 rounded-full animate-[spin_5s_linear_infinite_reverse] pointer-events-none z-0"></div>
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 bg-fuchsia-500/60 blur-md rounded-full animate-pulse shadow-[0_0_30px_rgba(217,70,239,1)] pointer-events-none z-0"></div>
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-[0_0_10px_rgba(255,255,255,1)] pointer-events-none z-0"></div>
                           </>
                        )}
                    </div>
                </div>
            </div>

            <div className="lg:col-span-5 flex flex-col gap-4">
                <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                    {loading && <span className="w-4 h-4 border-2 border-sky-500 border-t-transparent rounded-full animate-spin"></span>}
                    {!loading && (
                        <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    )}
                    Active Signals & Areas
                </h3>

                {error && (
                    <div className="flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-red-300">
                        <svg className="h-4 w-4 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                        <p className="text-xs">{error}</p>
                    </div>
                )}

                {!loading && !error && Object.keys(signalSummary[5]).length > 0 && (
                    <div className="bg-fuchsia-950/20 backdrop-blur-sm border border-fuchsia-500/50 rounded-2xl p-5 shadow-[0_0_20px_rgba(217,70,239,0.15)] relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-1.5 h-full bg-fuchsia-500 shadow-[0_0_15px_rgba(217,70,239,1)]"></div>
                        <div className="flex justify-between items-start mb-3 pl-3">
                            <div className="flex items-center gap-3">
                                <div className="w-6 h-6 rounded-full bg-fuchsia-500 flex items-center justify-center text-white font-black text-sm shadow-[0_0_10px_rgba(217,70,239,0.8)] animate-pulse">5</div>
                                <h4 className="text-lg font-black text-fuchsia-400 tracking-wide uppercase">Signal No. 5</h4>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 mb-3 pl-3 text-xs border-b border-fuchsia-500/20 pb-3">
                            <div><span className="text-fuchsia-200/50 uppercase tracking-widest">Winds:</span> <span className="font-bold text-fuchsia-100">{">"} 185 km/h</span></div>
                            <div><span className="text-fuchsia-200/50 uppercase tracking-widest">Lead Time:</span> <span className="font-bold text-fuchsia-100">12 hours</span></div>
                        </div>
                        <div className="pl-3 flex flex-wrap gap-2">
                            {Object.keys(signalSummary[5]).sort().map(prov => (
                                <span key={prov} className="px-3 py-1 bg-fuchsia-500/20 border border-fuchsia-500/40 text-fuchsia-200 text-sm font-bold rounded-lg shadow-[0_0_10px_rgba(217,70,239,0.3)]">
                                    {prov} {signalSummary[5][prov].size > 0 ? `(${Array.from(signalSummary[5][prov]).sort().join(", ")})` : ""}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {!loading && !error && Object.keys(signalSummary[4]).length > 0 && (
                    <div className="bg-red-950/20 backdrop-blur-sm border border-red-500/50 rounded-2xl p-4 relative overflow-hidden mt-1">
                        <div className="absolute top-0 left-0 w-1.5 h-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]"></div>
                        <div className="flex justify-between items-start mb-2 pl-3">
                            <div className="flex items-center gap-3">
                                <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center text-white font-black text-xs">4</div>
                                <h4 className="text-base font-black text-red-400 tracking-wide uppercase">Signal No. 4</h4>
                            </div>
                            <div className="text-[10px] text-red-300 font-bold bg-red-500/20 px-2 py-0.5 rounded border border-red-500/30">118-184 km/h</div>
                        </div>
                        <div className="pl-3 flex flex-wrap gap-2 mt-2">
                            {Object.keys(signalSummary[4]).sort().map(prov => (
                                <span key={prov} className="px-2.5 py-1 bg-red-500/10 border border-red-500/30 text-red-200 text-xs font-semibold rounded-md">
                                    {prov} {signalSummary[4][prov].size > 0 ? `(${Array.from(signalSummary[4][prov]).sort().join(", ")})` : ""}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {!loading && !error && Object.keys(signalSummary[3]).length > 0 && (
                    <div className="bg-orange-950/20 backdrop-blur-sm border border-orange-500/50 rounded-2xl p-4 relative overflow-hidden mt-1">
                        <div className="absolute top-0 left-0 w-1.5 h-full bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.8)]"></div>
                        <div className="flex justify-between items-start mb-2 pl-3">
                            <div className="flex items-center gap-3">
                                <div className="w-5 h-5 rounded-full bg-orange-500 flex items-center justify-center text-white font-black text-xs">3</div>
                                <h4 className="text-base font-black text-orange-400 tracking-wide uppercase">Signal No. 3</h4>
                            </div>
                            <div className="text-[10px] text-orange-300 font-bold bg-orange-500/20 px-2 py-0.5 rounded border border-orange-500/30">89-117 km/h</div>
                        </div>
                        <div className="pl-3 flex flex-wrap gap-2 mt-2">
                            {Object.keys(signalSummary[3]).sort().map(prov => (
                                <span key={prov} className="px-2.5 py-1 bg-orange-500/10 border border-orange-500/30 text-orange-200 text-xs font-semibold rounded-md">
                                    {prov} {signalSummary[3][prov].size > 0 ? `(${Array.from(signalSummary[3][prov]).sort().join(", ")})` : ""}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {!loading && !error && Object.keys(signalSummary[2]).length > 0 && (
                    <div className="bg-yellow-950/20 backdrop-blur-sm border border-yellow-500/40 rounded-2xl p-4 relative overflow-hidden mt-1">
                        <div className="absolute top-0 left-0 w-1.5 h-full bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.5)]"></div>
                        <div className="flex justify-between items-start mb-2 pl-3">
                            <div className="flex items-center gap-3">
                                <div className="w-5 h-5 rounded-full bg-yellow-500 flex items-center justify-center text-slate-900 font-black text-xs">2</div>
                                <h4 className="text-base font-black text-yellow-400 tracking-wide uppercase">Signal No. 2</h4>
                            </div>
                            <div className="text-[10px] text-yellow-300 font-bold bg-yellow-500/20 px-2 py-0.5 rounded border border-yellow-500/30">62-88 km/h</div>
                        </div>
                        <div className="pl-3 flex flex-wrap gap-2 mt-2">
                            {Object.keys(signalSummary[2]).sort().map(prov => (
                                <span key={prov} className="px-2.5 py-1 bg-yellow-500/10 border border-yellow-500/30 text-yellow-200 text-xs font-semibold rounded-md">
                                    {prov} {signalSummary[2][prov].size > 0 ? `(${Array.from(signalSummary[2][prov]).sort().join(", ")})` : ""}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {!loading && !error && Object.keys(signalSummary[1]).length > 0 && (
                    <div className="bg-cyan-950/20 backdrop-blur-sm border border-cyan-500/30 rounded-2xl p-4 relative overflow-hidden mt-1">
                        <div className="absolute top-0 left-0 w-1.5 h-full bg-cyan-500"></div>
                        <div className="flex justify-between items-start mb-2 pl-3">
                            <div className="flex items-center gap-3">
                                <div className="w-5 h-5 rounded-full bg-cyan-500 flex items-center justify-center text-slate-900 font-black text-xs">1</div>
                                <h4 className="text-base font-black text-cyan-400 tracking-wide uppercase">Signal No. 1</h4>
                            </div>
                            <div className="text-[10px] text-cyan-300 font-bold bg-cyan-500/20 px-2 py-0.5 rounded border border-cyan-500/30">39-61 km/h</div>
                        </div>
                        <div className="pl-3 flex flex-wrap gap-2 mt-2">
                            {Object.keys(signalSummary[1]).sort().map(prov => (
                                <span key={prov} className="px-2.5 py-1 bg-cyan-500/10 border border-cyan-500/30 text-cyan-200 text-xs font-semibold rounded-md">
                                    {prov} {signalSummary[1][prov].size > 0 ? `(${Array.from(signalSummary[1][prov]).sort().join(", ")})` : ""}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {!loading && !error && !hasSignals && (
                    <div className="flex flex-col items-center justify-center py-10 text-center bg-slate-900/40 border border-slate-800 rounded-2xl h-full">
                        <div className="mb-4 rounded-full bg-slate-800/80 p-4 shadow-inner shadow-slate-950">
                            <span className="text-3xl">🍃</span>
                        </div>
                        <p className="text-sm font-bold text-slate-300">No Active Wind Signals</p>
                        <p className="text-[11px] text-slate-500 mt-2 max-w-xs leading-relaxed">There are currently no areas under Tropical Cyclone Wind Signals. The weather map is clear of major wind disturbances.</p>
                    </div>
                )}
            </div>
        </div>
      </div>
    </div>
  );

};

export default Warning;
