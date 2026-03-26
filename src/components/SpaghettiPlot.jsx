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
    if (p < 920)   return "#5B0E2D";   // Super Typhoon
    if (p <= 945)  return "#A83232";   // Typhoon
    if (p <= 970)  return "#E67E22";   // Severe Tropical Storm
    if (p <= 990)  return "#F1C40F";   // Tropical Storm
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
    base:  "/data/fnv3_base_latest.csv",
    large: "/data/fnv3_large_latest.csv",
};

// ── PAR boundary ──────────────────────────────────────────────────────────
const PAR = [[5, 115], [15, 115], [21, 120], [25, 120], [25, 135], [5, 135], [5, 115]];

// ── Pressure legend entries ───────────────────────────────────────────────
const PRESSURE_LEGEND = [
    { label: "< 920 hPa · Super Typhoon",        color: "#5B0E2D" },
    { label: "920–945 hPa · Typhoon",             color: "#A83232" },
    { label: "945–970 hPa · Sev. Tropical Storm", color: "#E67E22" },
    { label: "970–990 hPa · Tropical Storm",      color: "#F1C40F" },
    { label: "990–1005 hPa · Tropical Dep.",      color: "#2ECC71" },
    { label: "> 1005 hPa · LPA",                  color: "#3498DB" },
];

// ── Component ─────────────────────────────────────────────────────────────
export default function SpaghettiPlot() {
    const mapRef = useRef(null);
    const mapInstanceRef = useRef(null);
    const layerGroupRef = useRef(null);

    const [horizon, setHorizon] = useState("5day");     // '5day' | '15day'
    const [dataset, setDataset] = useState("base");      // 'base' | 'large'
    const [status, setStatus] = useState("idle");        // idle | loading | ok | none | error
    const [statusMsg, setStatusMsg] = useState("");
    const [runLabel, setRunLabel] = useState("");
    const [trackCount, setTrackCount] = useState(0);
    const [rawRowCount, setRawRowCount] = useState(0);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [leafletReady, setLeafletReady] = useState(false);

    // ── Init map once ─────────────────────────────────────────────────────
    useEffect(() => {
        injectLeafletCSS();
        loadLeaflet().then((L) => {
            if (mapInstanceRef.current || !mapRef.current) return;

            const map = L.map(mapRef.current, { zoomControl: false }).setView([18, 130], 4);
            L.control.zoom({ position: "bottomright" }).addTo(map);

            L.tileLayer(
                "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png",
                { attribution: "© CARTO", subdomains: "abcd", maxZoom: 19 }
            ).addTo(map);

            // PAR boundary
            L.polyline(PAR, { color: "#3b82f6", weight: 1.8, dashArray: "5,7", opacity: 0.85 }).addTo(map);

            // Inject pulse CSS
            if (!document.getElementById("fnv3-pulse-css")) {
                const s = document.createElement("style");
                s.id = "fnv3-pulse-css";
                s.textContent = `
                  .storm-dot{border-radius:50%;background:rgba(239,68,68,.85);
                    animation:fnvPulse 2s infinite}
                  @keyframes fnvPulse{
                    0%{transform:scale(.9);box-shadow:0 0 0 0 rgba(239,68,68,.7)}
                    70%{transform:scale(1);box-shadow:0 0 0 8px rgba(239,68,68,0)}
                    100%{transform:scale(.9);box-shadow:0 0 0 0 rgba(239,68,68,0)}}
                `;
                document.head.appendChild(s);
            }

            layerGroupRef.current = L.layerGroup().addTo(map);
            mapInstanceRef.current = map;
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

        setRunLabel(isLarge ? "FNV3 Large Ensemble · latest" : "FNV3 Base · latest");
        setStatusMsg("Parsing tracks…");

        const { rows, cols } = parseCSV(csvText);
        const rawRows = rows.filter(r => r.lead_time_hours !== undefined && r.lat !== undefined);
        setRawRowCount(rawRows.length);
        const maxHours = horizon === "5day" ? 120 : 360;

        // Group by track_id → sample (use rawRows to skip header-less rows)
        const grouped = {};
        for (const row of rawRows) {
            const leadH = parseFloat(row.lead_time_hours);
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

        let drawn = 0;
        const originSet = {};

        for (const [, points] of Object.entries(grouped)) {
            if (points.length < 2) continue;
            points.sort((a, b) => a.h - b.h);
            const latlngs = points.map(pt => [pt.lat, pt.lon]);

            let bad = false;
            for (let i = 1; i < latlngs.length; i++) {
                if (Math.abs(latlngs[i][0] - latlngs[i-1][0]) > 10 ||
                    Math.abs(latlngs[i][1] - latlngs[i-1][1]) > 10) { bad = true; break; }
            }
            if (bad) continue;

            L.polyline(latlngs, {
                color: "#606060", weight: 2, opacity: 0.55,
                lineCap: "round", lineJoin: "round",
            }).addTo(layerGroupRef.current);

            for (const pt of points) {
                L.circleMarker([pt.lat, pt.lon], {
                    radius: 3.5, color: "white", weight: 0.8,
                    fillColor: pressureColor(pt.p), fillOpacity: 0.9,
                }).addTo(layerGroupRef.current);
            }

            const origin = points.find(pt => pt.h === 0);
            if (origin) {
                const oKey = `${origin.lat.toFixed(1)},${origin.lon.toFixed(1)}`;
                if (!originSet[oKey]) {
                    originSet[oKey] = true;
                    const icon = L.divIcon({ className: "storm-dot", iconSize: [10, 10] });
                    L.marker([origin.lat, origin.lon], { icon })
                        .addTo(layerGroupRef.current)
                        .bindTooltip(`Origin: ${origin.lat.toFixed(1)}°N ${origin.lon.toFixed(1)}°E`, { direction: "top" });
                }
            }
            drawn++;
        }

        setTrackCount(drawn);
        if (drawn > 0) {
            setStatus("ok");
            setStatusMsg("");
        } else if (rawRows.length > 0) {
            setStatus("none");
            setStatusMsg(
                `${rawRows.length} rows parsed, 0 valid tracks. ` +
                `Columns detected: [${cols.join(", ")}]. ` +
                "No active disturbances in current FNV3 run."
            );
        } else {
            setStatus("none");
            setStatusMsg(
                `CSV loaded (${rows.length} rows) but columns not matched. ` +
                `Detected: [${cols.join(", ")}]`
            );
        }

    }, [leafletReady, horizon, dataset]);

    useEffect(() => { loadData(); }, [loadData]);

    // ── Sidebar panel ─────────────────────────────────────────────────────
    const Panel = () => (
        <div className="flex-1 overflow-y-auto p-4 space-y-5 text-sm">

            {/* Header */}
            <div className="border-b border-slate-700 pb-4">
                <div className="flex items-start justify-between gap-2 mb-1">
                    <h1 className="text-base font-bold text-white leading-tight">
                        GDM FNV3 Spaghetti
                    </h1>
                    <span className={`flex-shrink-0 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border ${
                        status === "ok"      ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" :
                        status === "loading" ? "bg-amber-500/20 text-amber-400 border-amber-500/30" :
                        status === "none"    ? "bg-sky-500/20 text-sky-400 border-sky-500/30" :
                        status === "error"   ? "bg-red-500/20 text-red-400 border-red-500/30" :
                        "bg-slate-700 text-slate-400 border-slate-600"
                    }`}>
                        {status === "ok" ? "Live" : status === "loading" ? "…" : status === "none" ? "Quiet" : status === "error" ? "Err" : "–"}
                    </span>
                </div>
                <p className="text-[10px] text-slate-400 font-mono leading-relaxed">
                    {status === "loading" ? statusMsg :
                     status === "error"   ? statusMsg :
                     status === "none"    ? statusMsg :
                     status === "ok"      ? `Run: ${runLabel} · ${trackCount} tracks · ${rawRowCount} rows` :
                     "Select a horizon to load."}
                </p>
            </div>

            {/* Dataset selector */}
            <div>
                <h2 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Dataset</h2>
                <div className="flex rounded-lg overflow-hidden border border-slate-700 mb-3">
                    {[{ id: "base", label: "FNV3 Base", sub: "Forcast.py" },
                      { id: "large", label: "Large Ensemble", sub: "Forcast3.py" }]
                        .map(opt => (
                        <button
                            key={opt.id}
                            onClick={() => setDataset(opt.id)}
                            className={`flex-1 py-2 px-2 text-left transition-colors cursor-pointer ${
                                dataset === opt.id
                                    ? "bg-cyan-700 text-white"
                                    : "bg-slate-900 text-slate-400 hover:bg-slate-800"
                            }`}
                        >
                            <span className="block text-xs font-bold">{opt.label}</span>
                            <span className={`block text-[9px] font-mono mt-0.5 ${dataset === opt.id ? "text-cyan-200" : "text-slate-600"}`}>
                                {opt.sub}
                            </span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Horizon selector */}
            <div>
                <h2 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Forecast Horizon</h2>
                <div className="flex rounded-lg overflow-hidden border border-slate-700">
                    {[{ id: "5day", label: "5-Day (≤ 120 h)", sub: "Forcast3 equivalent" },
                      { id: "15day", label: "15-Day (≤ 360 h)", sub: "forcast4 equivalent" }]
                        .map(opt => (
                        <button
                            key={opt.id}
                            onClick={() => setHorizon(opt.id)}
                            className={`flex-1 py-2.5 px-2 text-left transition-colors cursor-pointer ${
                                horizon === opt.id
                                    ? "bg-cyan-600 text-white"
                                    : "bg-slate-900 text-slate-400 hover:bg-slate-800"
                            }`}
                        >
                            <span className="block text-xs font-bold">{opt.label}</span>
                            <span className={`block text-[9px] font-mono mt-0.5 ${horizon === opt.id ? "text-cyan-200" : "text-slate-600"}`}>
                                {opt.sub}
                            </span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Refresh */}
            <button
                onClick={loadData}
                disabled={status === "loading"}
                className={`w-full py-2 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                    status === "loading"
                        ? "bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed"
                        : "bg-slate-700 border-slate-600 text-white hover:bg-slate-600"
                }`}
            >
                {status === "loading" ? "Loading…" : "↻ Refresh Data"}
            </button>

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

            {/* Map legend */}
            <div>
                <h2 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Map Legend</h2>
                <ul className="space-y-1.5 text-[10px] text-slate-400 font-mono">
                    <li className="flex items-center gap-2.5">
                        <span className="w-3.5 h-3.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                        Disturbance Origin
                    </li>
                    <li className="flex items-center gap-2.5">
                        <span className="w-5 border-b-2 border-[#606060] flex-shrink-0" />
                        Ensemble Track Line
                    </li>
                    <li className="flex items-center gap-2.5">
                        <span className="w-5 border-b-2 border-dashed border-blue-500 flex-shrink-0" />
                        PAR Boundary
                    </li>
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
