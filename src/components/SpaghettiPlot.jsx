import React, { useEffect, useRef, useState, useCallback } from "react";

// ── Leaflet asset injection ───────────────────────────────────────────────
const injectLeafletCSS = () => {
    if (!document.getElementById("leaflet-css")) {
        const link = document.createElement("link");
        link.id = "leaflet-css";
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.appendChild(link);
    }
};
const loadLeaflet = () =>
    new Promise((resolve) => {
        if (window.L) return resolve(window.L);
        const s = document.createElement("script");
        s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
        s.onload = () => resolve(window.L);
        document.head.appendChild(s);
    });

// ── Pressure → colour (matches Forcast3/4.py exactly) ────────────────────
function pressureColor(p) {
    if (isNaN(p)) return "#3498DB";
    if (p < 920) return "#5B0E2D";   // Super Typhoon
    if (p <= 945) return "#A83232";   // Typhoon
    if (p <= 970) return "#E67E22";   // Severe Tropical Storm
    if (p <= 990) return "#F1C40F";   // Tropical Storm
    if (p <= 1005) return "#2ECC71";   // Tropical Depression
    return "#3498DB";                  // Low Pressure Area
}

// ── CSV parser (robust: handles \r\n, returns cols for diagnostics) ────────
function parseCSV(text) {
    // Normalize line endings, strip comments
    const lines = text
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .split("\n")
        .filter(l => l.trim() && !l.startsWith("#"));
    if (lines.length < 2) return { rows: [], cols: [] };
    const cols = lines[0].split(",").map(h => h.trim().toLowerCase());
    const rows = lines.slice(1).map(line => {
        const vals = line.split(",");
        const row = {};
        cols.forEach((h, i) => { row[h] = vals[i]?.trim(); });
        return row;
    });
    return { rows, cols };
}

// ── Local CSV paths served as static assets (committed by GitHub Actions) ──
// Forcast.py  → public/data/fnv3_base_latest.csv
// Forcast3.py → public/data/fnv3_large_latest.csv
const LOCAL_CSV = {
    base: "/data/fnv3_base_latest.csv",
    large: "/data/fnv3_large_latest.csv",
};

// ── PAR boundary ──────────────────────────────────────────────────────────
const PAR = [[5, 115], [15, 115], [21, 120], [25, 120], [25, 135], [5, 135], [5, 115]];

// ── Basin definitions ─────────────────────────────────────────────────────
const BASINS = [
    { id: "wpac", label: "Western Pacific", center: [18, 130], zoom: 4, latMin: -5, latMax: 45, lonMin: 100, lonMax: 180 },
    { id: "spac", label: "South Pacific", center: [-15, 170], zoom: 4, latMin: -50, latMax: 0, lonMin: 130, lonMax: 230 },
    { id: "cpac", label: "Central Pacific", center: [20, -155], zoom: 4, latMin: 0, latMax: 45, lonMin: -180, lonMax: -120 },
    { id: "epac", label: "Eastern Pacific", center: [15, -100], zoom: 4, latMin: 0, latMax: 45, lonMin: -140, lonMax: -60 },
    { id: "nio", label: "North Indian Ocean", center: [14, 75], zoom: 4, latMin: 0, latMax: 35, lonMin: 40, lonMax: 100 },
    { id: "sio", label: "Southern Indian", center: [-20, 75], zoom: 4, latMin: -50, latMax: 0, lonMin: 30, lonMax: 115 },
    { id: "natl", label: "North Atlantic", center: [25, -60], zoom: 4, latMin: 0, latMax: 60, lonMin: -100, lonMax: -10 },
];

// ── Pressure legend entries ───────────────────────────────────────────────
const PRESSURE_LEGEND = [
    { label: "< 920 hPa", color: "#5B0E2D" },
    { label: "920–945 hPa", color: "#A83232" },
    { label: "945–970 hPa", color: "#E67E22" },
    { label: "970–990 hPa", color: "#F1C40F" },
    { label: "990–1005 hPa", color: "#2ECC71" },
    { label: "> 1005 hPa", color: "#3498DB" },
];

// ── Pressure → category name ──────────────────────────────────────────────
function pressureCategory(p) {
    if (isNaN(p)) return "Unknown";
    if (p < 920) return "Super Typhoon";
    if (p <= 945) return "Typhoon";
    if (p <= 970) return "Sev. Tropical Storm";
    if (p <= 990) return "Tropical Storm";
    if (p <= 1005) return "Tropical Depression";
    return "LPA";
}

// ── Haversine-ish fast distance (degrees, not km — good enough for clustering)
function degreeDist(a, b) {
    return Math.sqrt((a.lat - b.lat) ** 2 + (a.lon - b.lon) ** 2);
}

// ── Cluster origins into distinct disturbances (5° threshold) ─────────────
function clusterOrigins(origins, threshold = 5) {
    const clusters = [];
    for (const o of origins) {
        let merged = false;
        for (const c of clusters) {
            if (degreeDist(c.center, o) < threshold) {
                // Update running average center
                const n = c.origins.length;
                c.center = {
                    lat: (c.center.lat * n + o.lat) / (n + 1),
                    lon: (c.center.lon * n + o.lon) / (n + 1),
                };
                c.origins.push(o);
                merged = true;
                break;
            }
        }
        if (!merged) {
            clusters.push({ center: { lat: o.lat, lon: o.lon }, origins: [o] });
        }
    }
    return clusters;
}

// ── Region name from lat/lon ──────────────────────────────────────────────
function regionName(lat, lon) {
    if (lon >= 100 && lon <= 120 && lat >= 5 && lat <= 25) return "South China Sea";
    if (lon > 120 && lon <= 135 && lat >= 5 && lat <= 25) return "Philippine Sea";
    if (lon > 135 && lon <= 180 && lat >= 0 && lat <= 25) return "W. Pacific";
    if (lon > 120 && lon <= 145 && lat > 25 && lat <= 45) return "NW Pacific";
    if (lat < 0) return "Southern Hemisphere";
    return "Open Pacific";label na, me
}

// ── Component ─────────────────────────────────────────────────────────────
export default function SpaghettiPlot() {
    const mapRef = useRef(null);
    const mapInstanceRef = useRef(null);
    const layerGroupRef = useRef(null);

    const [horizon, setHorizon] = useState("5day");
    const [dataset, setDataset] = useState("base");
    const [basin, setBasin] = useState("wpac");          // default Western Pacific
    const [status, setStatus] = useState("idle");
    const [statusMsg, setStatusMsg] = useState("");
    const [runLabel, setRunLabel] = useState("");
    const [trackCount, setTrackCount] = useState(0);
    const [rawRowCount, setRawRowCount] = useState(0);
    const [disturbances, setDisturbances] = useState([]);
    const [activeDisturbanceId, setActiveDisturbanceId] = useState(null);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [leafletReady, setLeafletReady] = useState(false);

    // ── Init map once ─────────────────────────────────────────────────────
    useEffect(() => {
        injectLeafletCSS();
        loadLeaflet().then((L) => {
            if (mapInstanceRef.current || !mapRef.current) return;

            const map = L.map(mapRef.current, {
                zoomControl: false,
                worldCopyJump: false,
                maxBounds: [[-85, -180], [85, 180]],
                maxBoundsViscosity: 1.0,
                minZoom: 3
            }).setView([18, 130], 4);
            L.control.zoom({ position: "bottomright" }).addTo(map);

            L.tileLayer(
                "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png",
                { attribution: "© CARTO", subdomains: "abcd", maxZoom: 19, noWrap: true }
            ).addTo(map);

            // Fetch and add countries GeoJSON
            fetch('/assets/country.0.1.json')
                .then(res => res.json())
                .then(data => {
                    L.geoJSON(data, {
                        style: {
                            color: "#FFD700",
                            weight: 1,
                            opacity: 0.6,
                            fillOpacity: 0,
                        }
                    }).addTo(map);
                })
                .catch(err => console.error("Error loading countries topojson:", err));

            // PAR boundary (solid red)
            L.polyline(PAR, { color: "#ef4444", weight: 2 }).addTo(map);

            // Inject map background
            if (!document.getElementById("fnv3-bg-css")) {
                const s = document.createElement("style");
                s.id = "fnv3-bg-css";
                s.textContent = `
                  .leaflet-container { background: #0f172a !important; }
                `;
                document.head.appendChild(s);
            }

            layerGroupRef.current = L.layerGroup().addTo(map);
            mapInstanceRef.current = map;
            // Fly to default basin
            const def = BASINS.find(b => b.id === "wpac");
            map.setView(def.center, def.zoom);
            setLeafletReady(true);
        });
        return () => {
            mapInstanceRef.current?.remove();
            mapInstanceRef.current = null;
        };
    }, []);

    // ── Fetch + draw when horizon changes or map is ready ─────────────────
    const loadData = useCallback(async () => {
        if (!leafletReady) return;
        const L = window.L;
        layerGroupRef.current.clearLayers();
        setStatus("loading");
        setStatusMsg("Loading latest FNV3 CSV…");
        setTrackCount(0);
        setRunLabel("");

        const isLarge = dataset === "large";
        const csvUrl = LOCAL_CSV[dataset];
        let csvText = null;

        try {
            const res = await fetch(csvUrl);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            csvText = await res.text();
        } catch (err) {
            setStatus("error");
            setStatusMsg(
                `CSV not found at ${csvUrl}. ` +
                "Run the GitHub Action workflow first to generate it."
            );
            return;
        }

        const { rows, cols } = parseCSV(csvText);

        // Determine init time from first available row
        let runInitTime = "latest";
        if (rows.length > 0 && rows[0].init_time) {
            runInitTime = rows[0].init_time;
        }

        setRunLabel(isLarge ? `FNV3 Large Ensemble · ${runInitTime}` : `FNV3 Base · ${runInitTime}`);
        setStatusMsg("Parsing tracks…");
        const rawRows = rows.filter(r => (r.lead_time_hours !== undefined || r.lead_time !== undefined) && r.lat !== undefined);
        setRawRowCount(rawRows.length);
        const maxHours = horizon === "5day" ? 120 : 360;

        // Basin bounds filter
        const b = BASINS.find(b => b.id === basin);

        // Group by track_id → sample (use rawRows to skip header-less rows)
        const grouped = {};
        for (const row of rawRows) {
            let leadH = parseFloat(row.lead_time_hours);
            if (isNaN(leadH) || row.lead_time_hours === undefined) {
                const str = row.lead_time || "";
                const parts = str.match(/(?:(\d+)\s+days\s+)?(\d+):(\d+):(\d+)/);
                if (parts) {
                    const d = parseInt(parts[1] || 0);
                    const h = parseInt(parts[2] || 0);
                    leadH = d * 24 + h;
                }
            }
            if (isNaN(leadH) || leadH > maxHours) continue;
            const lat = parseFloat(row.lat);
            const lon = parseFloat(row.lon);
            const pres = parseFloat(row.minimum_sea_level_pressure_hpa);
            if (isNaN(lat) || isNaN(lon)) continue;
            const llon = lon > 180 ? lon - 360 : lon;
            const key = `${row.track_id}__${row.sample}`;
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push({ lat, lon: llon, p: pres, h: leadH });
        }

        // Keep only tracks whose origin point falls inside the selected basin
        const basinFiltered = Object.values(grouped).filter(points => {
            const origin = points.find(p => p.h === 0) || points[0];
            if (!origin) return false;
            return origin.lat >= b.latMin && origin.lat <= b.latMax &&
                origin.lon >= b.lonMin && origin.lon <= b.lonMax;
        });

        let drawn = 0;
        const tracksByOriginKey = {};  // oKey → array of tracks

        // Pass 1: Gather all valid origins for clustering
        const allOrigins = [];
        const uniqueOrigins = new Set();
        for (const points of basinFiltered) {
            if (points.length < 2) continue;
            let bad = false;
            for (let i = 1; i < points.length; i++) {
                if (Math.abs(points[i].lat - points[i - 1].lat) > 10 ||
                    Math.abs(points[i].lon - points[i - 1].lon) > 10) { bad = true; break; }
            }
            if (bad) continue;

            const origin = points.find(pt => pt.h === 0) || points[0];
            if (!origin) continue;
            const oKey = `${origin.lat.toFixed(1)},${origin.lon.toFixed(1)}`;
            if (!uniqueOrigins.has(oKey)) {
                uniqueOrigins.add(oKey);
                allOrigins.push({ lat: origin.lat, lon: origin.lon, oKey });
            }
        }

        // Cluster origins into distinct disturbances
        const clusters = clusterOrigins(allOrigins, 5);
        clusters.forEach((c, idx) => c.distId = idx + 1);

        const originSetDone = new Set();

        // Pass 2: Draw tracks and attach cluster IDs
        for (const points of basinFiltered) {
            if (points.length < 2) continue;
            points.sort((a, b) => a.h - b.h);
            const latlngs = points.map(pt => [pt.lat, pt.lon]);

            let bad = false;
            for (let i = 1; i < latlngs.length; i++) {
                if (Math.abs(latlngs[i][0] - latlngs[i - 1][0]) > 10 ||
                    Math.abs(latlngs[i][1] - latlngs[i - 1][1]) > 10) { bad = true; break; }
            }
            if (bad) continue;

            const origin = points.find(pt => pt.h === 0) || points[0];
            const oKey = `${origin.lat.toFixed(1)},${origin.lon.toFixed(1)}`;
            const myCluster = clusters.find(c => c.origins.some(o => o.oKey === oKey));
            const distId = myCluster ? myCluster.distId : null;

            const line = L.polyline(latlngs, {
                color: "#606060", weight: 2, opacity: 0.55,
                lineCap: "round", lineJoin: "round",
            });
            line.distId = distId;
            line.defaultOpacity = 0.55;
            line.addTo(layerGroupRef.current);

            for (const pt of points) {
                const mark = L.circleMarker([pt.lat, pt.lon], {
                    radius: 3.5, color: "white", weight: 0.8,
                    fillColor: pressureColor(pt.p), fillOpacity: 0.9,
                    opacity: 1
                });
                mark.distId = distId;
                mark.defaultFillOpacity = 0.9;
                mark.defaultStrokeOpacity = 1;
                mark.addTo(layerGroupRef.current);
            }

            if (!originSetDone.has(oKey)) {
                originSetDone.add(oKey);
                tracksByOriginKey[oKey] = [];
            }
            // Store the min pressure across all points in this track
            const minP = Math.min(...points.map(pt => isNaN(pt.p) ? 9999 : pt.p));
            if (tracksByOriginKey[oKey]) {
                tracksByOriginKey[oKey].push(minP);
            }
            drawn++;
        }

        // Build disturbance metadata
        const disturbanceList = clusters.map(cluster => {
            const allMinP = [];
            for (const o of cluster.origins) {
                const trks = tracksByOriginKey[o.oKey] || [];
                allMinP.push(...trks);
            }
            const peakP = allMinP.length > 0 ? Math.min(...allMinP) : 9999;
            const peakCat = pressureCategory(peakP);
            const peakColor = pressureColor(peakP);
            const region = regionName(cluster.center.lat, cluster.center.lon);

            // Count tracks by category
            const catCounts = {};
            for (const p of allMinP) {
                const cat = pressureCategory(p);
                catCounts[cat] = (catCounts[cat] || 0) + 1;
            }

            return {
                id: cluster.distId,
                lat: cluster.center.lat,
                lon: cluster.center.lon,
                region,
                trackCount: allMinP.length,
                peakP,
                peakCat,
                peakColor,
                catCounts,
            };
        });

        setDisturbances(disturbanceList);
        setActiveDisturbanceId(null);

        setTrackCount(drawn);
        if (drawn > 0) {
            setStatus("ok");
            setStatusMsg("");
        } else if (rawRows.length > 0) {
            setStatus("none");
            setStatusMsg("No active tropical disturbances are being tracked in the current FNV3 run.");
        } else {
            setStatus("none");
            setStatusMsg("No tracks found in the current FNV3 run data.");
        }

    }, [leafletReady, horizon, dataset, basin]);

    // Fly map to basin when basin selection changes
    useEffect(() => {
        if (!mapInstanceRef.current) return;
        const b = BASINS.find(b => b.id === basin);
        if (b) mapInstanceRef.current.flyTo(b.center, b.zoom, { duration: 1 });
    }, [basin]);

    useEffect(() => { loadData(); }, [loadData]);

    // Update map layer visibilities when active disturbance changes
    useEffect(() => {
        if (!layerGroupRef.current) return;
        const L = window.L;

        layerGroupRef.current.eachLayer(layer => {
            const isSelected = activeDisturbanceId === null || layer.distId === activeDisturbanceId;

            if (layer instanceof L.Polyline && !(layer instanceof L.CircleMarker)) {
                layer.setStyle({ opacity: isSelected ? layer.defaultOpacity : 0.05 });
            } else if (layer instanceof L.CircleMarker) {
                layer.setStyle({
                    fillOpacity: isSelected ? layer.defaultFillOpacity : 0.05,
                    opacity: isSelected ? layer.defaultStrokeOpacity : 0.05
                });
            }
        });

        // Fly to disturbance center if selected
        if (activeDisturbanceId !== null && mapInstanceRef.current) {
            const dist = disturbances.find(d => d.id === activeDisturbanceId);
            if (dist) {
                mapInstanceRef.current.flyTo([dist.lat, dist.lon], 5, { duration: 1.5 });
            }
        }
    }, [activeDisturbanceId, disturbances]);

    // ── Sidebar panel ─────────────────────────────────────────────────────
    const Panel = () => (
        <div className="flex-1 overflow-y-auto p-4 space-y-5 text-sm">

            {/* Header */}
            <div className="border-b border-slate-700 pb-4">
                <div className="flex items-start justify-between gap-2 mb-1">
                    <h1 className="text-base font-bold text-white leading-tight">
                        GDM FNV3 Spaghetti
                    </h1>
                    <span className={`flex-shrink-0 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border ${status === "ok" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" :
                        status === "loading" ? "bg-amber-500/20 text-amber-400 border-amber-500/30" :
                            status === "none" ? "bg-sky-500/20 text-sky-400 border-sky-500/30" :
                                status === "error" ? "bg-red-500/20 text-red-400 border-red-500/30" :
                                    "bg-slate-700 text-slate-400 border-slate-600"
                        }`}>
                        {status === "ok" ? "Live" : status === "loading" ? "…" : status === "none" ? "Quiet" : status === "error" ? "Err" : "–"}
                    </span>
                </div>
                <p className="text-[10px] text-slate-400 font-mono leading-relaxed mt-2">
                    {status === "loading" ? statusMsg :
                        status === "error" ? statusMsg :
                            status === "none" ? statusMsg :
                                status === "ok" ? `Run: ${runLabel}` :
                                    "Select a horizon to load."}
                </p>
            </div>

            {/* Basin selector */}
            <div>
                <h2 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Basin</h2>
                <div className="flex flex-col gap-1">
                    {BASINS.map(opt => (
                        <button
                            key={opt.id}
                            onClick={() => {
                                setBasin(opt.id);
                                setSidebarOpen(false);
                            }}
                            className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${basin === opt.id
                                ? "bg-cyan-600 text-white"
                                : "bg-slate-900 text-slate-400 hover:bg-slate-700 hover:text-white"
                                }`}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Dataset selector */}
            <div>
                <h2 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Dataset</h2>
                <div className="flex rounded-lg overflow-hidden border border-slate-700 mb-3">
                    {[{ id: "base", label: "FNV3 Base" },
                    { id: "large", label: "Large Ensemble" }]
                        .map(opt => (
                            <button
                                key={opt.id}
                                onClick={() => setDataset(opt.id)}
                                className={`flex-1 py-2 px-2 text-left transition-colors cursor-pointer flex items-center justify-center ${dataset === opt.id
                                    ? "bg-cyan-700 text-white"
                                    : "bg-slate-900 text-slate-400 hover:bg-slate-800"
                                    }`}
                            >
                                <span className="block text-xs font-bold text-center">{opt.label}</span>
                            </button>
                        ))}
                </div>
            </div>

            {/* Horizon selector */}
            <div>
                <h2 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Forecast Horizon</h2>
                <div className="flex rounded-lg overflow-hidden border border-slate-700">
                    {[{ id: "5day", label: "5-Day (≤ 120 h)" },
                    { id: "15day", label: "15-Day (≤ 360 h)" }]
                        .map(opt => (
                            <button
                                key={opt.id}
                                onClick={() => setHorizon(opt.id)}
                                className={`flex-1 py-3 px-2 text-left transition-colors cursor-pointer flex items-center justify-center ${horizon === opt.id
                                    ? "bg-cyan-600 text-white"
                                    : "bg-slate-900 text-slate-400 hover:bg-slate-800"
                                    }`}
                            >
                                <span className="block text-xs font-bold text-center">{opt.label}</span>
                            </button>
                        ))}
                </div>
            </div>

            {/* Refresh */}
            <button
                onClick={loadData}
                disabled={status === "loading"}
                className={`w-full py-2 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${status === "loading"
                    ? "bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed"
                    : "bg-slate-700 border-slate-600 text-white hover:bg-slate-600"
                    }`}
            >
                {status === "loading" ? "Loading…" : "↻ Refresh Data"}
            </button>

            {/* Detected disturbances */}
            {disturbances.length > 0 && (
                <div>
                    <h2 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                        Detected Disturbances ({disturbances.length})
                    </h2>
                    <div className="space-y-2">
                        {disturbances.map(d => (
                            <div
                                key={d.id}
                                onClick={() => {
                                    setActiveDisturbanceId(activeDisturbanceId === d.id ? null : d.id);
                                    setSidebarOpen(false);
                                }}
                                className={`rounded-lg p-2.5 border cursor-pointer transition-all ${activeDisturbanceId === d.id ? 'bg-slate-800 border-cyan-500 shadow-md shadow-cyan-900/20' : 'bg-slate-900/80 border-slate-700 hover:border-slate-500 hover:bg-slate-800/80'}`}
                            >
                                <div className="flex items-center gap-2 mb-1.5">
                                    <span className="w-3 h-3 rounded-full flex-shrink-0 border border-slate-600" style={{ background: d.peakColor }} />
                                    <span className="text-[11px] font-bold text-white">Disturbance #{d.id}</span>
                                </div>
                                <div className="text-[10px] text-slate-400 font-mono space-y-0.5 pl-5">
                                    <p>{d.region}</p>
                                    <p>{d.lat.toFixed(1)}°N, {d.lon.toFixed(1)}°E</p>
                                    <p>Peak: <span className="font-bold" style={{ color: d.peakColor }}>{d.peakP < 9999 ? `${d.peakP.toFixed(0)} hPa` : "N/A"}</span></p>
                                    <p>{d.trackCount} ensemble tracks</p>
                                    {Object.entries(d.catCounts).map(([cat, count]) => (
                                        <p key={cat} className="text-slate-500">
                                            <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: pressureColor(cat === "Super Typhoon" ? 900 : cat === "Typhoon" ? 930 : cat === "Sev. Tropical Storm" ? 960 : cat === "Tropical Storm" ? 980 : cat === "Tropical Depression" ? 1000 : 1010) }} />
                                            {cat}: {count}
                                        </p>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Pressure legend */}
            <div>
                <h2 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Intensity (by MSLP)</h2>
                <ul className="space-y-1.5">
                    {PRESSURE_LEGEND.map(({ label, color }) => (
                        <li key={label} className="flex items-center gap-2.5 text-[10px] text-slate-300 font-mono">
                            <span className="w-3.5 h-3.5 rounded-full flex-shrink-0 border border-slate-600" style={{ background: color }} />
                            {label}
                        </li>
                    ))}
                </ul>
            </div>


            <p className="text-[9px] text-slate-600 border-t border-slate-800 pt-3 leading-relaxed">
                Data: GDM FNV3_LARGE_ENSEMBLE via Google DeepMind WeatherLab.
                For official guidance consult PAGASA, JTWC & JMA bulletins.
            </p>
        </div>
    );

    return (
        <div className="bg-slate-900 text-slate-200 font-sans flex overflow-hidden" style={{ height: "calc(100vh - 64px)" }}>

            {/* Mobile overlay */}
            {sidebarOpen && (
                <div className="fixed inset-0 bg-black/60 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />
            )}

            {/* Sidebar */}
            <aside className={`
                fixed lg:relative top-0 left-0 h-full z-40
                w-72 lg:w-76 flex-shrink-0
                bg-slate-800 border-r border-slate-700 flex flex-col shadow-2xl
                transition-transform duration-300 ease-in-out
                ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
            `}>
                <div className="flex items-center justify-between p-3 border-b border-slate-700 lg:hidden">
                    <span className="text-sm font-bold text-white">FNV3 Controls</span>
                    <button onClick={() => setSidebarOpen(false)} className="p-1.5 rounded-lg bg-slate-700 text-slate-300 hover:text-white cursor-pointer">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                <Panel />
            </aside>

            {/* Map */}
            <main className="flex-1 relative z-10 overflow-hidden">
                {/* Mobile top bar */}
                <div className="flex lg:hidden items-center gap-3 px-3 py-2 bg-slate-900/90 border-b border-slate-700 absolute top-0 left-0 right-0 z-20">
                    <button onClick={() => setSidebarOpen(true)} className="p-2 rounded-lg bg-slate-700 text-slate-300 hover:text-white cursor-pointer flex-shrink-0">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                    </button>
                    <span className="text-xs font-semibold text-slate-300 truncate">
                        GDM FNV3 · {horizon === "5day" ? "5-Day" : "15-Day"} Spaghetti
                    </span>
                </div>

                {/* Loading overlay on the map */}
                {status === "loading" && (
                    <div className="absolute inset-0 top-[44px] lg:top-0 z-10 bg-slate-950/70 flex flex-col items-center justify-center gap-3 pointer-events-none">
                        <div className="w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" />
                        <span className="text-xs text-slate-300 font-mono">{statusMsg}</span>
                    </div>
                )}

                <div ref={mapRef} className="absolute inset-0 top-[44px] lg:top-0" />
            </main>
        </div>
    );
}
