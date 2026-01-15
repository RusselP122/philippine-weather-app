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

function collectSignalPolygons(alerts) {
    const results = [];
    alerts.forEach((alert) => {
        const provinces = normalizeProvinces(alert.provinces);
        provinces.forEach((prov, index) => {
            const name = prov.province || prov.areaDesc;
            if (!name) return;
            let latlngs = null;
            if (prov.shape) {
                latlngs = shapeToLatLngs(prov.shape);
            }
            if (!latlngs && prov.polygon) {
                latlngs = polygonStringToLatLngs(prov.polygon);
            }
            if (!latlngs || !latlngs.length) return;

            // Determine signal level
            // Check province level info first, then alert hierarchy
            const combinedText = `${prov.headline || ""} ${prov.description || ""} ${alert.headline || ""} ${alert.description || ""} ${alert.subtype || ""}`;
            const signal = parseSignalLevel(combinedText);

            if (signal) {
                results.push({
                    id: `${alert.identifier || alert.headline || "tcws"}-${name}-${index}`,
                    name,
                    latlngs,
                    alert,
                    signal,
                });
            }
        });
    });
    return results;
}

function buildSignalSummary(alerts) {
    const summary = {
        1: new Set(),
        2: new Set(),
        3: new Set(),
        4: new Set(),
        5: new Set(),
    };

    alerts.forEach((alert) => {
        const provinces = normalizeProvinces(alert.provinces);
        provinces.forEach((prov) => {
            const name = prov.province || prov.areaDesc;
            if (!name) return;

            const combinedText = `${prov.headline || ""} ${prov.description || ""} ${alert.headline || ""} ${alert.description || ""} ${alert.subtype || ""}`;
            const signal = parseSignalLevel(combinedText);

            if (signal && summary[signal]) {
                summary[signal].add(name);
            }
        });
    });

    return {
        1: Array.from(summary[1]).sort(),
        2: Array.from(summary[2]).sort(),
        3: Array.from(summary[3]).sort(),
        4: Array.from(summary[4]).sort(),
        5: Array.from(summary[5]).sort(),
    };
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
        () => collectSignalPolygons(alerts),
        [alerts]
    );

    const signalSummary = useMemo(
        () => buildSignalSummary(alerts),
        [alerts]
    );

    const hasSignals = Object.values(signalSummary).some(list => list.length > 0);
    const cycloneName = useMemo(() => getCycloneName(alerts), [alerts]);

    return (
        <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col">
            <div className="max-w-6xl mx-auto w-full px-6 py-12 md:px-8">
                <header className="mb-10 flex flex-col gap-6 rounded-2xl border border-slate-800/70 bg-slate-900/50 px-6 py-6 shadow-[0_20px_70px_-40px_rgba(234,179,8,0.5)] md:flex-row md:items-center md:justify-between">
                    <div className="space-y-4">
                        <div className="flex items-center gap-4">
                            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-orange-500/10 text-orange-400">
                                <Wind className="h-6 w-6" />
                            </span>

                            <div>
                                <p className="text-[10px] uppercase tracking-[0.35em] text-slate-500">Hazard Monitoring</p>
                                <h1 className="text-2xl font-semibold tracking-tight text-slate-50 md:text-3xl">
                                    Tropical Cyclone Warning Signals
                                </h1>
                            </div>
                        </div>
                        <div>
                            <p className="text-sm leading-relaxed text-slate-400">
                                Real-time active Wind Signals (TCWS) raised by PAGASA.
                            </p>
                            <div className="mt-3 h-px w-28 bg-gradient-to-r from-orange-400/70 via-red-300/60 to-transparent" />
                        </div>
                    </div>
                </header>

                <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
                    {/* Map Section */}
                    <div className="lg:col-span-2 overflow-hidden rounded-2xl border border-slate-800/70 bg-slate-900/50 shadow-2xl shadow-slate-950/50">
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
                    </div>

                    {/* Sidebar Summary */}
                    <aside className="rounded-2xl border border-slate-800/70 bg-gradient-to-br from-slate-950/90 via-slate-900/70 to-slate-900/40 p-6 shadow-xl">
                        <div className="mb-6 flex items-center justify-between">
                            <div>
                                <h2 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                                    Active Signals
                                </h2>
                                {hasSignals && cycloneName && (
                                    <p className="mt-1 text-sm font-bold text-orange-400">
                                        {cycloneName}
                                    </p>
                                )}
                            </div>
                            {lastUpdated && (
                                <span className="text-[10px] text-slate-600">
                                    {lastUpdated.toLocaleTimeString("en-PH", {
                                        hour: "2-digit",
                                        minute: "2-digit",
                                    })}
                                </span>
                            )}
                        </div>

                        <div className="space-y-6">
                            {loading && (
                                <div className="flex items-center gap-3 rounded-lg border border-sky-500/20 bg-sky-500/10 px-4 py-3 text-sky-300">
                                    <span className="h-2 w-2 rounded-full bg-sky-400 animate-pulse" />
                                    <span className="text-xs font-medium">Checking for signals...</span>
                                </div>
                            )}

                            {error && (
                                <div className="flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-red-300">
                                    <AlertTriangle className="h-4 w-4 mt-0.5" />
                                    <p className="text-xs">{error}</p>
                                </div>
                            )}

                            {!loading && !error && (
                                <div className="divide-y divide-slate-800/50">
                                    {hasSignals ? (
                                        <>
                                            {[5, 4, 3, 2, 1].map(num => {
                                                const list = signalSummary[num];
                                                if (!list.length) return null;
                                                const color = SIGNAL_COLORS[num];

                                                return (
                                                    <div key={num} className="py-4 first:pt-0 last:pb-0">
                                                        <p className="mb-2 flex items-center gap-2 text-xs font-bold" style={{ color: color.fill }}>
                                                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color.fill }}></span>
                                                            Signal No. {num}
                                                        </p>
                                                        <p className="text-[11px] leading-relaxed text-slate-400 pl-4">
                                                            {formatList(list)}
                                                        </p>
                                                    </div>
                                                );
                                            })}
                                        </>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center py-8 text-center">
                                            <div className="mb-3 rounded-full bg-slate-800/50 p-3">
                                                <AlertCircle className="h-5 w-5 text-slate-600" />
                                            </div>
                                            <p className="text-xs font-medium text-slate-400">No Active Wind Signals</p>
                                            <p className="text-[10px] text-slate-600 mt-1">There are no areas currently under TCWS.</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="mt-8 rounded-xl bg-slate-900/40 p-3 text-[10px] text-slate-500 border border-slate-800/50">
                            <p>
                                <strong>Note:</strong> Data is sourced from PAGASA Severe Weather Bulletins. Always verify with local authorities.
                            </p>
                        </div>
                    </aside>
                </div>
            </div>
        </div>
    );
};

export default Warning;
