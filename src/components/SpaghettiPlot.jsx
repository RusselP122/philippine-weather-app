import React, { useEffect, useRef, useState, useCallback } from "react";
import * as turf from "@turf/turf";
import "./SpaghettiPlot.css";

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

// ── Wind → colour (PAGASA Scale) ────────────────────
function windColor(w) {
    if (isNaN(w)) return "#3498DB";
    if (w >= 100) return "#5B0E2D";   // Super Typhoon
    if (w >= 64) return "#A83232";    // Typhoon
    if (w >= 48) return "#E67E22";    // Severe Tropical Storm
    if (w >= 34) return "#F1C40F";    // Tropical Storm
    if (w >= 22) return "#2ECC71";    // Tropical Depression
    return "#3498DB";                 // Low Pressure Area
}

// ── CSV parser (robust: handles \r\n, returns cols for diagnostics) ────────
function parseCSV(text) {
    // Normalize line endings, strip BOM, strip comments
    const lines = text
        .replace(/^\uFEFF/, "")
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
// Forcast.py  → public/data/fnv3_base_latest.csv       (base ensemble members)
// Forcast3.py → public/data/fnv3_large_latest.csv       (large ensemble members)
// FNV3 paired CSVs → official ensemble mean tracks (sample=-1) per dataset
const LOCAL_CSV = {
    base: "/data/fnv3_base_latest.csv",
    large: "/data/fnv3_large_latest.csv",
    basePaired: "/data/fnv3_paired_latest.csv",
    largePaired: "/data/fnv3_large_paired_latest.csv",
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

// ── Wind legend entries (PAGASA Scale) ───────────────────────────────────────────────
const WIND_LEGEND = [
    { label: "≥ 100 kt", color: "#5B0E2D" },
    { label: "64–99 kt", color: "#A83232" },
    { label: "48–63 kt", color: "#E67E22" },
    { label: "34–47 kt", color: "#F1C40F" },
    { label: "22–33 kt", color: "#2ECC71" },
    { label: "< 22 kt", color: "#3498DB" },
];

// ── Wind → category name ──────────────────────────────────────────────
function windCategory(w) {
    if (isNaN(w)) return "Unknown";
    if (w >= 100) return "Super Typhoon";
    if (w >= 64) return "Typhoon";
    if (w >= 48) return "Sev. Tropical Storm";
    if (w >= 34) return "Tropical Storm";
    if (w >= 22) return "Tropical Depression";
    return "LPA";
}

// ── True Haversine distance (km) for accurate cone radii at high latitudes
function haversineKm(a, b) {
    const R = 6371;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLon = (b.lon - a.lon) * Math.PI / 180;
    const lat1 = a.lat * Math.PI / 180;
    const lat2 = b.lat * Math.PI / 180;
    const sinD = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.asin(Math.sqrt(sinD));
}

// ── Single-Linkage Clustering (Allows natural chaining for ensembles) ─────
function clusterOriginsGreedy(origins, distKm = 400, maxGenesisSpread = 96) {
    if (origins.length === 0) return [];

    // Sort by time first to build clusters chronologically
    const sorted = [...origins].sort((a, b) => a.h - b.h);
    const clusters = [];

    for (const origin of sorted) {
        let bestCluster = null;
        let minDistance = Infinity;

        // Check if origin can merge into an existing cluster
        for (const cluster of clusters) {
            // Temporal boundary: Check if adding this point exceeds the max cluster duration
            const newMinH = Math.min(cluster.minH, origin.h);
            const newMaxH = Math.max(cluster.maxH, origin.h);
            if (newMaxH - newMinH > maxGenesisSpread) continue;

            // Single linkage: Find distance to the CLOSEST point anywhere in the cluster
            for (const member of cluster.origins) {
                const dKm = haversineKm(member, origin);
                if (dKm <= distKm && dKm < minDistance) {
                    minDistance = dKm;
                    bestCluster = cluster;
                }
            }
        }

        if (bestCluster) {
            bestCluster.origins.push(origin);
            bestCluster.minH = Math.min(bestCluster.minH, origin.h);
            bestCluster.maxH = Math.max(bestCluster.maxH, origin.h);
        } else {
            clusters.push({
                origins: [origin],
                minH: origin.h,
                maxH: origin.h
            });
        }
    }

    // Post-process: compute the geographic center of each cluster for UI positioning
    for (const c of clusters) {
        const sumLat = c.origins.reduce((s, o) => s + o.lat, 0);
        // Correctly handle longitude wrapping (-180 to 180) for center calculation
        const sumLon = c.origins.reduce((s, o) => s + (o.lon < 0 ? o.lon + 360 : o.lon), 0);
        let avgLon = sumLon / c.origins.length;
        if (avgLon > 180) avgLon -= 360;

        c.center = {
            lat: sumLat / c.origins.length,
            lon: avgLon,
            h: c.minH
        };
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
    return "Open Pacific";
}

// ── Component ─────────────────────────────────────────────────────────────
export default function SpaghettiPlot() {
    const mapRef = useRef(null);
    const mapInstanceRef = useRef(null);
    const layerGroupRef = useRef(null);
    const meanLayerGroupRef = useRef(null);

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
    const [showEnsembleMean, setShowEnsembleMean] = useState(false);
    const [meanOnlyIds, setMeanOnlyIds] = useState(new Set());

    // ── Init map once ─────────────────────────────────────────────────────
    useEffect(() => {
        let cancelled = false;
        injectLeafletCSS();

        // Wait for Leaflet CSS to actually load before creating the map
        const waitForCSS = () => new Promise((resolve) => {
            const link = document.getElementById("leaflet-css");
            if (!link) return resolve();
            if (link.sheet) return resolve();  // already loaded
            link.onload = resolve;
            link.onerror = resolve;
            // Safety timeout
            setTimeout(resolve, 3000);
        });

        waitForCSS().then(() => loadLeaflet()).then((L) => {
            if (cancelled || mapInstanceRef.current || !mapRef.current) return;

            // Inject map background BEFORE creating the map
            if (!document.getElementById("fnv3-bg-css")) {
                const s = document.createElement("style");
                s.id = "fnv3-bg-css";
                s.textContent = `.leaflet-container { background: #0f172a !important; }`;
                document.head.appendChild(s);
            }

            // Use Canvas renderer — far more resilient to the SVG _clipPoints
            // 'reading x' crash and handles thousands of polylines better
            const map = L.map(mapRef.current, {
                zoomControl: false,
                worldCopyJump: false,
                maxBounds: [[-85, -180], [85, 180]],
                maxBoundsViscosity: 1.0,
                minZoom: 3,
                preferCanvas: true,
                renderer: L.canvas({ padding: 0.5 }),
            }).setView([18, 130], 4);

            L.control.zoom({ position: "bottomright" }).addTo(map);

            L.tileLayer(
                "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png",
                { attribution: "© CARTO", subdomains: "abcd", maxZoom: 19, noWrap: true }
            ).addTo(map);

            // PAR boundary (solid red)
            L.polyline(PAR, { color: "#ef4444", weight: 2 }).addTo(map);

            // Country boundaries (matches Python BORDERS styling)
            fetch("/assets/country.0.1_small.json")
                .then(r => r.ok ? r.json() : null)
                .then(geo => {
                    if (geo && map) {
                        L.geoJSON(geo, {
                            style: { color: "#facc15", weight: 1, opacity: 0.7, fillOpacity: 0 }
                        }).addTo(map);
                    }
                })
                .catch(() => { /* silently skip if unavailable */ });

            layerGroupRef.current = L.layerGroup().addTo(map);
            meanLayerGroupRef.current = L.layerGroup(); // not added to map — default OFF
            mapInstanceRef.current = map;

            // Fly to default basin
            const def = BASINS.find(b => b.id === "wpac");
            map.setView(def.center, def.zoom);

            // Force Leaflet to recalculate its internal pixel bounds from the
            // now-guaranteed-visible container, then mark ready on next frame
            map.invalidateSize({ animate: false });
            requestAnimationFrame(() => {
                if (!cancelled) {
                    map.invalidateSize({ animate: false });
                    setLeafletReady(true);
                }
            });
        });

        return () => {
            cancelled = true;
            mapInstanceRef.current?.remove();
            mapInstanceRef.current = null;
        };
    }, []);

    // ── Fetch + draw when horizon changes or map is ready ─────────────────
    const loadData = useCallback(async () => {
        if (!leafletReady) return;
        const L = window.L;
        const map = mapInstanceRef.current;
        // Detach layer group from the map during bulk operations
        // to prevent per-layer re-render crashes in the canvas renderer
        if (map && layerGroupRef.current) {
            map.removeLayer(layerGroupRef.current);
        }
        layerGroupRef.current.clearLayers();
        if (meanLayerGroupRef.current) {
            meanLayerGroupRef.current.clearLayers();
            map?.removeLayer(meanLayerGroupRef.current);
        }
        setShowEnsembleMean(false);
        setMeanOnlyIds(new Set());
        setStatus("loading");
        setStatusMsg("Loading latest FNV3 CSV\u2026");
        setTrackCount(0);
        setRunLabel("");

        const isLarge = dataset === "large";
        const csvUrl = LOCAL_CSV[dataset];
        let csvText = null;
        let pairedCsvText = null;

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
            // Re-attach the layer group before returning
            if (map && layerGroupRef.current) layerGroupRef.current.addTo(map);
            return;
        }

        // Attempt to fetch the official FNV3 paired/ensemble-mean CSV (non-blocking)
        // Base → fnv3_paired_latest.csv, Large → fnv3_large_paired_latest.csv
        const pairedUrl = isLarge ? LOCAL_CSV.largePaired : LOCAL_CSV.basePaired;
        try {
            const pairedRes = await fetch(pairedUrl);
            if (pairedRes.ok) pairedCsvText = await pairedRes.text();
        } catch (_) {
            // Silently skip — we fall back to computed median
        }

        const { rows, cols } = parseCSV(csvText);

        // Determine init time from first available row
        let runInitTime = "latest";
        if (rows.length > 0 && rows[0].init_time) {
            runInitTime = rows[0].init_time;
        }

        setRunLabel(isLarge ? `FNV3 Large Ensemble \u00b7 ${runInitTime}` : `FNV3 Base \u00b7 ${runInitTime}`);
        setStatusMsg("Parsing tracks…");
        const rawRows = rows.filter(r => (r.lead_time_hours !== undefined || r.lead_time !== undefined) && r.lat !== undefined);
        setRawRowCount(rawRows.length);
        const maxHours = horizon === "5day" ? 120 : 360;

        try {
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
                const windKt = parseFloat(row.maximum_sustained_wind_speed_knots);
                if (isNaN(lat) || isNaN(lon)) continue;
                const llon = lon > 180 ? lon - 360 : lon;
                const key = `${row.track_id}__${row.sample}`;
                if (!grouped[key]) grouped[key] = [];
                grouped[key].push({ lat, lon: llon, p: pres, windKt, h: leadH });
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

                // Find the absolute first point by time
                const origin = points.find(pt => pt.h === 0) || points.reduce((prev, curr) => curr.h < prev.h ? curr : prev, points[0]);
                if (!origin) continue;
                const oKey = `${origin.lat.toFixed(1)},${origin.lon.toFixed(1)}`;
                if (!uniqueOrigins.has(oKey)) {
                    uniqueOrigins.add(oKey);
                    allOrigins.push({ lat: origin.lat, lon: origin.lon, h: origin.h || 0, oKey });
                }
            }

            // Cluster origins greedily
            const clusters = clusterOriginsGreedy(allOrigins, 300);
            clusters.forEach((c, idx) => c.distId = idx + 1);

            const originSetDone = new Set();
            const tracksByDisturbance = {};

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

                // Assign to nearest cluster (using true Haversine distance)
                let distId = null;
                let bestDistKm = Infinity;
                for (const c of clusters) {
                    const dd = haversineKm(c.center, origin);
                    if (dd < bestDistKm) {
                        bestDistKm = dd;
                        distId = c.distId;
                    }
                }
                // Only assign if reasonably close (within 2x the DBSCAN epsKm, ~666km)
                if (bestDistKm > 666) distId = null;

                // Collect tracks for ensemble median computation
                if (distId !== null) {
                    if (!tracksByDisturbance[distId]) tracksByDisturbance[distId] = [];
                    tracksByDisturbance[distId].push(points);
                }

                const line = L.polyline(latlngs, {
                    color: "#00d4ff", weight: 2.5, opacity: 0.5,
                    lineCap: "round", lineJoin: "round",
                    noClip: true,
                });
                line.distId = distId;
                line.defaultOpacity = 0.5;
                line.addTo(layerGroupRef.current);

                for (const pt of points) {
                    const mark = L.circleMarker([pt.lat, pt.lon], {
                        radius: 3.5, color: "white", weight: 0.8,
                        fillColor: windColor(pt.windKt), fillOpacity: 0.9,
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
                // Store the max wind across all points in this track
                const maxW = Math.max(...points.map(pt => isNaN(pt.windKt) ? 0 : pt.windKt));
                if (tracksByOriginKey[oKey]) {
                    tracksByOriginKey[oKey].push(maxW);
                }
                drawn++;
            }

            let initDate = null;
            if (runInitTime && runInitTime !== "latest") {
                const timeStr = runInitTime.includes('Z') ? runInitTime : runInitTime.replace(/-/g, '/');
                initDate = new Date(timeStr);
            }

            // Build disturbance metadata using tracksByDisturbance as single source of truth
            const disturbanceList = clusters.map(cluster => {
                const distTracks = tracksByDisturbance[cluster.distId] || [];
                
                // Compute peak wind from actual tracks assigned to this disturbance
                const allMaxW = distTracks.map(pts => {
                    const winds = pts.map(pt => isNaN(pt.windKt) ? 0 : pt.windKt);
                    return winds.length > 0 ? Math.max(...winds) : 0;
                });
                
                const peakW = allMaxW.length > 0 ? Math.max(...allMaxW) : 0;
                const peakCat = windCategory(peakW);
                const peakColor = windColor(peakW);
                const region = regionName(cluster.center.lat, cluster.center.lon);

                // Count tracks by category
                const catCounts = {};
                for (const w of allMaxW) {
                    const cat = windCategory(w);
                    catCounts[cat] = (catCounts[cat] || 0) + 1;
                }

                let formationDateStr = "Unknown";
                if (initDate && !isNaN(initDate.getTime())) {
                    const minH = cluster.minH || 0;
                    const d = new Date(initDate.getTime() + minH * 3600000);
                    formationDateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
                }

                return {
                    id: cluster.distId,
                    lat: cluster.center.lat,
                    lon: cluster.center.lon,
                    region,
                    trackCount: distTracks.length,
                    peakW,
                    peakCat,
                    peakColor,
                    catCounts,
                    formationDateStr,
                };
            });

            // ── Renumber disturbances: most tracks = Disturbance 1 ──────────
            disturbanceList.sort((a, b) => b.trackCount - a.trackCount);
            const oldToNew = {};
            disturbanceList.forEach((d, idx) => {
                const newId = idx + 1;
                oldToNew[d.id] = newId;
                d.id = newId;
            });

            // Update all drawn map layers to reference the new disturbance IDs
            if (layerGroupRef.current) {
                layerGroupRef.current.eachLayer(layer => {
                    if (layer.distId != null && oldToNew[layer.distId] != null) {
                        layer.distId = oldToNew[layer.distId];
                    }
                });
            }

            // Rebuild tracksByDisturbance with updated IDs
            const updatedTracksByDist = {};
            for (const [oldId, trks] of Object.entries(tracksByDisturbance)) {
                const newId = oldToNew[parseInt(oldId)] || oldId;
                updatedTracksByDist[newId] = trks;
            }
            Object.keys(tracksByDisturbance).forEach(k => delete tracksByDisturbance[k]);
            Object.assign(tracksByDisturbance, updatedTracksByDist);

            // ── Parse official paired mean tracks (sample=-1, WP systems) ────
            const pairedMeanByTrackId = {};
            if (pairedCsvText) {
                const { rows: pairedRows } = parseCSV(pairedCsvText);
                for (const row of pairedRows) {
                    const trackId = (row.track_id || "").trim();
                    const sampleVal = (row.sample || "").trim();
                    // Only use the official ensemble mean (sample=-1) for WP-prefixed storms
                    if (sampleVal !== "-1" || !trackId.toUpperCase().startsWith("WP")) continue;

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
                    const windKt = parseFloat(row.maximum_sustained_wind_speed_knots);
                    if (isNaN(lat) || isNaN(lon)) continue;

                    if (!pairedMeanByTrackId[trackId]) pairedMeanByTrackId[trackId] = { points: [], trackId };
                    pairedMeanByTrackId[trackId].points.push({
                        lat, lon: lon > 180 ? lon - 360 : lon,
                        p: pres, windKt, h: leadH
                    });
                }

                // Sort each paired track by lead time
                for (const key of Object.keys(pairedMeanByTrackId)) {
                    pairedMeanByTrackId[key].points.sort((a, b) => a.h - b.h);
                }
            }

            // ── Ensemble analysis: mean, spread, agreement ──────────────
            // 1) Mean: prefer official paired track when available for WP systems
            // 2) Fallback: computed median from 100% of ensemble members
            // 3) Spread: std-dev envelope at each time step
            // 4) Agreement: % of members within 2° of mean
            const AGREEMENT_RADIUS = 2; // degrees

            // ── Pre-assign each paired track to its BEST disturbance (exclusive) ──
            // Each paired track matches at most one disturbance (the closest).
            // Each disturbance matches at most one paired track.
            const pairedAssignment = {}; // distId → { paired, trackName }
            const usedPairedTracks = new Set();
            const usedDisturbances = new Set();

            // Build candidate matches: for each (pairedTrack, disturbance) pair, record distance
            const candidates = [];
            for (const [tId, paired] of Object.entries(pairedMeanByTrackId)) {
                if (paired.points.length < 2) continue;
                const pOrigin = paired.points[0];
                for (const dist of disturbanceList) {
                    const tracks = tracksByDisturbance[dist.id] || [];
                    if (tracks.length < 2) continue;
                    const dKm = haversineKm(
                        { lat: dist.lat, lon: dist.lon },
                        { lat: pOrigin.lat, lon: pOrigin.lon }
                    );
                    if (dKm < 500) {
                        candidates.push({ tId, paired, dist, dKm });
                    }
                }
            }

            // Sort by distance (closest first), then assign greedily
            candidates.sort((a, b) => a.dKm - b.dKm);
            for (const c of candidates) {
                if (usedPairedTracks.has(c.tId) || usedDisturbances.has(c.dist.id)) continue;
                usedPairedTracks.add(c.tId);
                usedDisturbances.add(c.dist.id);
                const numMatch = c.tId.match(/WP(\d{2})/i);
                pairedAssignment[c.dist.id] = {
                    paired: c.paired,
                    trackName: numMatch ? `${numMatch[1]}W` : c.tId,
                };
            }

            if (meanLayerGroupRef.current) {
                for (const dist of disturbanceList) {
                    const tracks = tracksByDisturbance[dist.id] || [];
                    if (tracks.length < 2) {
                        dist.hasEnsembleMean = false;
                        dist.agreement = 0;
                        dist.spreadKm = 0;
                        continue;
                    }
                    dist.hasEnsembleMean = true;

                    // Look up pre-assigned paired track for this disturbance
                    let matchedPaired = null;
                    const assignment = pairedAssignment[dist.id];
                    if (assignment) {
                        matchedPaired = assignment.paired;
                        dist.pairedTrackName = assignment.trackName;
                        dist.meanSource = "paired";
                    }

                    // Group all points by lead time hour
                    const byHour = {};
                    for (let tIdx = 0; tIdx < tracks.length; tIdx++) {
                        const track = tracks[tIdx];
                        for (const pt of track) {
                            if (!byHour[pt.h]) byHour[pt.h] = { lats: [], lons: [], ps: [], winds: [], trackIndices: [] };
                            byHour[pt.h].lats.push(pt.lat);
                            byHour[pt.h].lons.push(pt.lon);
                            byHour[pt.h].ps.push(!isNaN(pt.p) ? pt.p : NaN);
                            byHour[pt.h].winds.push(!isNaN(pt.windKt) ? pt.windKt : NaN);
                            byHour[pt.h].trackIndices.push(tIdx);
                        }
                    }

                    const hours = Object.keys(byHour).map(Number).sort((a, b) => a - b);

                    // Compute mean, std-dev, agreement at each hour
                    const meanPts = [];
                    const upperEnv = [];
                    const lowerEnv = [];
                    let totalAgreement = 0;
                    let agreementSteps = 0;

                    // Median helper
                    const median = arr => {
                        const s = [...arr].sort((a, b) => a - b);
                        const mid = Math.floor(s.length / 2);
                        return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
                    };

                    // Weighted median helper
                    const weightedMedian = (values, weights) => {
                        if (values.length === 0) return 0;
                        const pairs = values.map((v, i) => ({ v, w: weights[i] })).sort((a, b) => a.v - b.v);
                        const totalWeight = pairs.reduce((sum, p) => sum + p.w, 0);
                        let cumulative = 0;
                        for (const p of pairs) {
                            cumulative += p.w;
                            if (cumulative >= totalWeight / 2) return p.v;
                        }
                        return pairs[pairs.length - 1].v;
                    };

                    // --- PRE-CALCULATE TRACK WEIGHTS (PERSISTENCE) ---
                    const trackWeights = [];
                    for (const track of tracks) {
                        let maxJumpSpeed = 0; // km/h
                        for (let i = 1; i < track.length; i++) {
                            const pt1 = track[i - 1];
                            const pt2 = track[i];
                            const dH = pt2.h - pt1.h;
                            if (dH > 0) {
                                const dKm = haversineKm({ lat: pt1.lat, lon: pt1.lon }, { lat: pt2.lat, lon: pt2.lon });
                                const speed = dKm / dH;
                                if (speed > maxJumpSpeed) maxJumpSpeed = speed;
                            }
                        }
                        let weight = 1.0;
                        if (maxJumpSpeed > 60) weight = 0.3; // Very erratic
                        else if (maxJumpSpeed > 45) weight = 0.6; // Slightly erratic
                        trackWeights.push(weight);
                    }

                    // --- SELECTIVE ENSEMBLE MEAN (SEM) PRE-PROCESSING ---
                    let refHour = 24;
                    if (!byHour[24]) {
                        refHour = hours.filter(h => h <= 24).pop() || hours[hours.length - 1];
                    }
                    let semSelectedIndices = new Set(tracks.map((_, i) => i)); 
                    
                    if (byHour[refHour] && byHour[refHour].lats.length >= 3) {
                        const refMedianLat = median(byHour[refHour].lats);
                        const refMedianLon = median(byHour[refHour].lons);
                        
                        const trackErrors = [];
                        let totalError = 0;
                        for (let i = 0; i < byHour[refHour].lats.length; i++) {
                            const tIdx = byHour[refHour].trackIndices[i];
                            const err = haversineKm(
                                { lat: byHour[refHour].lats[i], lon: byHour[refHour].lons[i] },
                                { lat: refMedianLat, lon: refMedianLon }
                            );
                            trackErrors.push({ tIdx, err });
                            totalError += err;
                        }
                        
                        const avgError = totalError / trackErrors.length;
                        const selected = trackErrors.filter(t => t.err <= avgError).map(t => t.tIdx);
                        if (selected.length > 0) {
                            semSelectedIndices = new Set(selected);
                        }
                    }

                    // Percentile helper (0-1)
                    const percentile = (arr, p) => {
                        const s = [...arr].sort((a, b) => a - b);
                        const idx = Math.ceil(p * s.length) - 1;
                        return s[Math.max(0, Math.min(idx, s.length - 1))];
                    };

                    for (const h of hours) {
                        const d = byHour[h];
                        const n = d.lats.length;

                        // ── Mean position: prefer official paired track if available ──
                        let mLat, mLon, mW;
                        const usePaired = matchedPaired !== null;

                        if (usePaired) {
                            // Find the paired point closest to this lead time hour
                            const pairedPt = matchedPaired.points.reduce((best, pt) => {
                                return Math.abs(pt.h - h) < Math.abs(best.h - h) ? pt : best;
                            }, matchedPaired.points[0]);
                            // Only use if the paired point is within 3h of this step
                            if (Math.abs(pairedPt.h - h) <= 3) {
                                mLat = pairedPt.lat;
                                mLon = pairedPt.lon;
                                mW = pairedPt.windKt;
                            } else {
                                // Paired data ended, stop drawing the mean track
                                continue;
                            }
                        } else {
                            // Selective Ensemble Mean (SEM) for position
                            const semLats = [];
                            const semLons = [];
                            for (let i = 0; i < d.lats.length; i++) {
                                if (semSelectedIndices.has(d.trackIndices[i])) {
                                    semLats.push(d.lats[i]);
                                    semLons.push(d.lons[i]);
                                }
                            }
                            
                            if (semLats.length > 0) {
                                mLat = median(semLats);
                                mLon = median(semLons);
                            } else {
                                mLat = median(d.lats);
                                mLon = median(d.lons);
                            }

                            // Survivorship-bias-corrected weighted median intensity
                            const windVals = [];
                            const windWeights = [];
                            
                            // Active members (weighted by persistence)
                            for (let i = 0; i < d.winds.length; i++) {
                                if (!isNaN(d.winds[i])) {
                                    windVals.push(d.winds[i]);
                                    windWeights.push(trackWeights[d.trackIndices[i]]);
                                }
                            }
                            
                            // Dead members (Decay Curve)
                            const activeCount = windVals.length;
                            const deadCount = tracks.length - activeCount;
                            for (let i = 0; i < deadCount; i++) {
                                // Spread dead values from 10 to 20 knots (Decay "Smear")
                                const decayVal = deadCount > 1 ? 10 + (i / (deadCount - 1)) * 10 : 15;
                                windVals.push(decayVal);
                                windWeights.push(1.0); // Full weight for penalty
                            }
                            
                            mW = weightedMedian(windVals, windWeights);

                            // Integrated "RI" Check (Secondary High-End Mean)
                            if (activeCount > 0) {
                                const sortedActive = [...windVals.slice(0, activeCount)].sort((a, b) => b - a);
                                const top10Count = Math.max(1, Math.floor(sortedActive.length * 0.1));
                                const top10Mean = sortedActive.slice(0, top10Count).reduce((a, b) => a + b, 0) / top10Count;
                                
                                if (top10Mean - mW > 40) {
                                    dist.highIntensityUncertainty = true;
                                }
                            }
                        }

                        const distsKm = [];
                        for (let i = 0; i < n; i++) {
                            const dd_km = haversineKm(
                                { lat: d.lats[i], lon: d.lons[i] },
                                { lat: mLat, lon: mLon }
                            );
                            distsKm.push(dd_km);
                        }

                        // True Std Dev of distances from median (in km)
                        const meanDistKm = distsKm.reduce((s, v) => s + v, 0) / n;
                        const varianceKm = distsKm.reduce((s, v) => s + Math.pow(v - meanDistKm, 2), 0) / n;
                        const sdKm = Math.sqrt(varianceKm);

                        // 67th percentile distance from median (NHC-style cone radius)
                        const p67km = percentile(distsKm, 0.67);
                        const r67km = p67km;

                        // Agreement: fraction within AGREEMENT_RADIUS degrees of median
                        let inside = 0;
                        for (let i = 0; i < n; i++) {
                            if (distsKm[i] <= (AGREEMENT_RADIUS * 111.32)) inside++;
                        }
                        totalAgreement += inside / n;
                        agreementSteps++;

                        // Survival tracking
                        const activeMembers = n;
                        const totalMembers = tracks.length;

                        meanPts.push({ lat: mLat, lon: mLon, windKt: mW, h, sdKm, r67km, activeMembers, totalMembers });
                    }

                    // Tag disturbance with source info
                    dist.meanSource = matchedPaired ? "paired" : "computed";

                    dist.agreement = agreementSteps > 0 ? Math.round((totalAgreement / agreementSteps) * 100) : 0;
                    const avgSdKm = meanPts.reduce((s, p) => s + p.sdKm, 0) / (meanPts.length || 1);
                    dist.spreadKm = Math.round(avgSdKm);

                    if (meanPts.length < 2) continue;
                    const meanLL = meanPts.map(pt => [pt.lat, pt.lon]);

                    // Official NHC historical error radii (in km)
                    const NHC_RADII_KM = {
                        0: 0.1,
                        12: 48,
                        24: 74,
                        36: 102,
                        48: 130,
                        72: 195,
                        96: 278,
                        120: 361
                    };

                    const getNhcRadius = (h) => {
                        const keys = Object.keys(NHC_RADII_KM).map(Number).sort((a, b) => a - b);
                        if (h <= 0) return 0.1;
                        if (h >= 120) {
                            // Extrapolate linearly past 120h using the Day 4 to Day 5 growth rate (~3.45 km/h)
                            const rate = (NHC_RADII_KM[120] - NHC_RADII_KM[96]) / 24;
                            return NHC_RADII_KM[120] + (h - 120) * rate;
                        }
                        for (let i = 0; i < keys.length - 1; i++) {
                            const h1 = keys[i];
                            const h2 = keys[i + 1];
                            if (h >= h1 && h <= h2) {
                                const fraction = (h - h1) / (h2 - h1);
                                return NHC_RADII_KM[h1] + fraction * (NHC_RADII_KM[h2] - NHC_RADII_KM[h1]);
                            }
                        }
                        return 0.1;
                    };

                    // Generate Cone of Uncertainty using 67th percentile radius (NHC method)
                    const circles = [];
                    for (let i = 0; i < meanPts.length; i++) {
                        const pt = meanPts[i];
                        let R_km = Math.max(10, pt.r67km); // Minimum 10km radius

                        if (i === 0 || pt.h === 0) {
                            // Force Hour 0 to originate as a point to match NHC convention
                            R_km = 0.1;
                        } else {
                            // Prevent the cone from exploding instantly if ensemble members are scattered at formation.
                            // Cap the uncertainty growth using the interpolated official NHC historical error radii.
                            const hoursSinceOrigin = pt.h - meanPts[0].h;
                            const maxRadius = getNhcRadius(hoursSinceOrigin);
                            R_km = Math.min(R_km, maxRadius);
                        }

                        const c = turf.circle([pt.lon, pt.lat], R_km, { steps: 36, units: 'kilometers' });
                        circles.push(c);
                    }

                    let coneGeom = null;
                    if (circles.length > 0) {
                        const capsules = [];
                        if (circles.length === 1) {
                            capsules.push(circles[0]);
                        } else {
                            // Convex hull of adjacent circles to form smooth capsule segments
                            for (let i = 0; i < circles.length - 1; i++) {
                                const fc = turf.featureCollection([circles[i], circles[i + 1]]);
                                const capsule = turf.convex(fc);
                                if (capsule) capsules.push(capsule);
                            }
                        }

                        // Union all capsules together into a single continuous polygon
                        try {
                            // For modern Turf.js (v7+), union takes a FeatureCollection
                            coneGeom = turf.union(turf.featureCollection(capsules));
                        } catch (e) {
                            try {
                                // Fallback for older Turf.js (v6)
                                coneGeom = capsules.reduce((acc, curr) => turf.union(acc, curr));
                            } catch (e2) {
                                console.warn("Turf union failed, skipping cone for disturbance", dist.id);
                                coneGeom = null;
                            }
                        }
                    }

                    if (coneGeom) {
                        // Render the resulting geometry using L.geoJSON
                        const envGroup = L.geoJSON(coneGeom, {
                            style: {
                                color: "rgba(255, 255, 255, 0.6)",
                                weight: 1,
                                dashArray: "5 5",
                                fillColor: "rgba(255, 255, 255, 0.15)",
                                fillOpacity: 1,
                                lineCap: "round",
                                lineJoin: "round",
                                interactive: false,
                            }
                        });

                        // Add each sub-layer to the map with our custom properties
                        envGroup.eachLayer(layer => {
                            layer.distId = dist.id;
                            layer.isEnvelope = true;
                            layer.addTo(meanLayerGroupRef.current);
                        });
                    }

                    // White outline for contrast
                    const outline = L.polyline(meanLL, {
                        color: "#ffffff", weight: 6, opacity: 0.3,
                        lineCap: "round", lineJoin: "round", noClip: true,
                    });
                    outline.distId = dist.id;
                    outline.addTo(meanLayerGroupRef.current);

                    // Black mean track line
                    const meanLine = L.polyline(meanLL, {
                        color: "#000000", weight: 4, opacity: 0.95,
                        lineCap: "round", lineJoin: "round", noClip: true,
                    });
                    meanLine.distId = dist.id;
                    meanLine.addTo(meanLayerGroupRef.current);

                    // Mean position dots colored by wind speed
                    for (const pt of meanPts) {
                        const mk = L.circleMarker([pt.lat, pt.lon], {
                            radius: 5, color: "#000000", weight: 2,
                            fillColor: windColor(pt.windKt), fillOpacity: 1, opacity: 1
                        });
                        mk.distId = dist.id;

                        const survRate = Math.round((pt.activeMembers / pt.totalMembers) * 100);
                        const tooltipHtml = `
                            <div style="text-align: center; font-weight: bold; margin-bottom: 4px; border-bottom: 1px solid #ccc; padding-bottom: 4px;">
                                Hour ${pt.h}
                            </div>
                            <div style="font-size: 11px;">
                                Wind: ${isNaN(pt.windKt) ? 'N/A' : pt.windKt.toFixed(0) + ' kt'}<br/>
                                Survivorship: ${pt.activeMembers}/${pt.totalMembers} members (${survRate}%)
                            </div>
                        `;
                        mk.bindTooltip(tooltipHtml, { direction: 'top', offset: [0, -5] });

                        mk.addTo(meanLayerGroupRef.current);
                    }
                }
            }

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

        } catch (err) {
            setStatus("error");
            setStatusMsg(`Processing error: ${err.message}`);
            console.error(err);
        } finally {
            // Re-attach the layer group to the map now that bulk adds are done
            if (map && layerGroupRef.current) {
                layerGroupRef.current.addTo(map);
            }
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
            const isMeanOnly = layer.distId != null && meanOnlyIds.has(layer.distId);

            if (layer instanceof L.Polyline && !(layer instanceof L.CircleMarker)) {
                layer.setStyle({ opacity: isMeanOnly ? 0.03 : (isSelected ? layer.defaultOpacity : 0.05) });
            } else if (layer instanceof L.CircleMarker) {
                layer.setStyle({
                    fillOpacity: isMeanOnly ? 0.03 : (isSelected ? layer.defaultFillOpacity : 0.05),
                    opacity: isMeanOnly ? 0.03 : (isSelected ? layer.defaultStrokeOpacity : 0.05)
                });
            }
        });

        // Also filter ensemble mean layer (lines, dots, envelopes)
        if (meanLayerGroupRef.current) {
            meanLayerGroupRef.current.eachLayer(layer => {
                const isSelected = activeDisturbanceId === null || layer.distId === activeDisturbanceId;
                if (layer.isEnvelope) {
                    // Polygon envelope
                    layer.setStyle({ fillOpacity: isSelected ? 1 : 0, opacity: isSelected ? 1 : 0 });
                } else if (layer instanceof L.Polyline && !(layer instanceof L.CircleMarker)) {
                    layer.setStyle({ opacity: isSelected ? 0.95 : 0.05 });
                } else if (layer instanceof L.CircleMarker) {
                    layer.setStyle({ fillOpacity: isSelected ? 1 : 0.05, opacity: isSelected ? 1 : 0.05 });
                }
            });
        }

        // Fly to disturbance center if selected
        if (activeDisturbanceId !== null && mapInstanceRef.current) {
            const dist = disturbances.find(d => d.id === activeDisturbanceId);
            if (dist) {
                mapInstanceRef.current.flyTo([dist.lat, dist.lon], 5, { duration: 1.5 });
            }
        }
    }, [activeDisturbanceId, disturbances, meanOnlyIds]);

    // Toggle ensemble mean layer visibility
    useEffect(() => {
        if (!meanLayerGroupRef.current || !mapInstanceRef.current) return;
        const map = mapInstanceRef.current;
        if (showEnsembleMean) {
            meanLayerGroupRef.current.addTo(map);
        } else {
            map.removeLayer(meanLayerGroupRef.current);
        }
    }, [showEnsembleMean]);

    // ── Sidebar panel ─────────────────────────────────────────────────────
    const sidebarContent = (
        <div className="spaghetti-sidebar">

            {/* Back to Forecast */}
            <a href="/" className="back-to-forecast">
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                Back to Forecast
            </a>

            {/* Header */}
            <div className="spaghetti-header">
                <div className="spaghetti-header-top">
                    <h1 className="spaghetti-title">
                        Ensemble Tracker
                    </h1>
                    <span className={`spaghetti-status-badge ${status === "ok" ? "status-ok" :
                        status === "loading" ? "status-loading" :
                            status === "none" ? "status-none" :
                                status === "error" ? "status-error" :
                                    "status-none"
                        }`}>
                        {status === "ok" ? "Live" : status === "loading" ? "…" : status === "none" ? "Quiet" : status === "error" ? "Err" : "–"}
                    </span>
                </div>
                <p className="spaghetti-subtitle">
                    {status === "loading" ? statusMsg :
                        status === "error" ? statusMsg :
                            status === "none" ? statusMsg :
                                status === "ok" ? `Init: ${runLabel.split('·')[1]?.trim() || runLabel}` :
                                    "Select a horizon to load."}
                </p>
            </div>

            {/* Basin selector */}
            <div>
                <h2 className="spaghetti-section-title">
                    <svg className="spaghetti-section-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    Region
                </h2>
                <div className="spaghetti-region-grid">
                    {BASINS.map(opt => (
                        <button
                            key={opt.id}
                            onClick={() => {
                                setBasin(opt.id);
                                setSidebarOpen(false);
                            }}
                            className={`region-btn ${basin === opt.id ? "active" : ""}`}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Dataset selector */}
            <div>
                <h2 className="spaghetti-section-title">
                    <svg className="spaghetti-section-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>
                    Dataset
                </h2>
                <div className="segmented-control">
                    {[{ id: "base", label: "Base" },
                    { id: "large", label: "Large Ens" }]
                        .map(opt => (
                            <button
                                key={opt.id}
                                onClick={() => setDataset(opt.id)}
                                className={`segment-btn ${dataset === opt.id ? "active" : ""}`}
                            >
                                <span className="segment-label">{opt.label}</span>
                            </button>
                        ))}
                </div>
            </div>

            {/* Horizon selector */}
            <div>
                <h2 className="spaghetti-section-title">
                    <svg className="spaghetti-section-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    Forecast Horizon
                </h2>
                <div className="segmented-control">
                    {[{ id: "5day", label: "5-Day" },
                    { id: "15day", label: "15-Day" }]
                        .map(opt => (
                            <button
                                key={opt.id}
                                onClick={() => setHorizon(opt.id)}
                                className={`segment-btn ${horizon === opt.id ? "active primary" : ""}`}
                            >
                                <span className="segment-label">{opt.label}</span>
                            </button>
                        ))}
                </div>
            </div>

            {/* Refresh */}
            <button
                onClick={loadData}
                disabled={status === "loading"}
                className="refresh-btn"
            >
                {status === "loading" ? (
                    <div className="spinner" />
                ) : (
                    <svg className="spaghetti-section-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                )}
                {status === "loading" ? "Fetching..." : "Refresh Data"}
            </button>

            {/* Ensemble Mean Toggle */}
            {disturbances.some(d => d.hasEnsembleMean) && (
                <div>
                    <h2 className="spaghetti-section-title">
                        <svg className="spaghetti-section-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                        Ensemble Mean
                    </h2>
                    <button
                        onClick={() => setShowEnsembleMean(!showEnsembleMean)}
                        className={`ensemble-mean-toggle ${showEnsembleMean ? 'active' : ''}`}
                    >
                        <span className="ensemble-mean-indicator" />
                        <span className="ensemble-mean-label">
                            {showEnsembleMean ? "Mean Track Visible" : "Mean Track Hidden"}
                        </span>
                        <span className="ensemble-mean-status">
                            {showEnsembleMean ? "ON" : "OFF"}
                        </span>
                    </button>
                </div>
            )}

            {/* Detected disturbances */}
            {disturbances.length > 0 && (
                <div>
                    <h2 className="spaghetti-section-title">
                        <svg className="spaghetti-section-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                        Systems ({disturbances.length})
                    </h2>
                    <div className="systems-list">
                        {disturbances.map(d => (
                            <div
                                key={d.id}
                                onClick={() => {
                                    setActiveDisturbanceId(activeDisturbanceId === d.id ? null : d.id);
                                    setSidebarOpen(false);
                                }}
                                className={`system-card ${activeDisturbanceId === d.id ? 'active' : ''}`}
                            >
                                <div className="system-card-header">
                                    <div className="system-card-title-wrap">
                                        <div className="system-dot-wrap">
                                            <span className="system-dot-ping" style={{ background: d.peakColor }} />
                                            <span className="system-dot" style={{ background: d.peakColor }} />
                                        </div>
                                        <span className="system-title">Disturbance {d.id}</span>
                                    </div>
                                    <span className="system-track-count">{d.trackCount} trks</span>
                                    {d.hasEnsembleMean && (
                                        <button
                                            className={`system-view-toggle ${meanOnlyIds.has(d.id) ? 'mean-only' : ''}`}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setMeanOnlyIds(prev => {
                                                    const next = new Set(prev);
                                                    if (next.has(d.id)) { next.delete(d.id); } else { next.add(d.id); }
                                                    return next;
                                                });
                                            }}
                                            title={meanOnlyIds.has(d.id) ? 'Show spaghetti tracks' : 'Show mean only'}
                                        >
                                            {meanOnlyIds.has(d.id) ? 'MEAN' : 'ALL'}
                                        </button>
                                    )}
                                </div>
                                <div className="system-details">
                                    <div className="system-detail-row">
                                        <span>First Expected:</span>
                                        <span className="system-detail-value">{d.formationDateStr}</span>
                                    </div>
                                    <div className="system-detail-row">
                                        <span>{d.region}</span>
                                        <span className="system-detail-value">{d.lat.toFixed(1)}°N, {d.lon.toFixed(1)}°E</span>
                                    </div>
                                    <div className="system-detail-row system-detail-divider">
                                        <span>Peak Wind:</span>
                                        <span className="system-peak-value" style={{ color: d.peakColor }}>{d.peakW > 0 ? `${d.peakW.toFixed(0)} kt` : "N/A"}</span>
                                    </div>
                                    {d.highIntensityUncertainty && (
                                        <div style={{
                                            fontSize: "10px",
                                            color: "#facc15",
                                            fontWeight: "bold",
                                            border: "1px solid rgba(250, 204, 21, 0.3)",
                                            backgroundColor: "rgba(250, 204, 21, 0.1)",
                                            padding: "2px 4px",
                                            borderRadius: "4px",
                                            textAlign: "center",
                                            marginBottom: "4px",
                                            boxShadow: "0 0 5px rgba(250, 204, 21, 0.2)"
                                        }}>
                                            ⚠️ High Intensity Uncertainty (RI Risk)
                                        </div>
                                    )}
                                    {d.hasEnsembleMean && (
                                        <>

                                            <div className="system-detail-row">
                                                <span>Confidence:</span>
                                                <span className="system-detail-value" style={{
                                                    color: d.agreement >= 70 ? '#10b981' : d.agreement >= 40 ? '#f59e0b' : '#ef4444',
                                                    fontWeight: 'bold',
                                                    textTransform: 'uppercase',
                                                    fontSize: '0.85em',
                                                    letterSpacing: '0.05em'
                                                }}>{d.agreement >= 70 ? 'High' : d.agreement >= 40 ? 'Medium' : 'Low'}</span>
                                            </div>
                                            <div className="system-detail-row">
                                                <span>Agreement:</span>
                                                <span className="system-detail-value">{d.agreement}%</span>
                                            </div>
                                            <div className="system-detail-row">
                                                <span>Spread (1σ):</span>
                                                <span className="system-detail-value">{d.spreadKm} km</span>
                                            </div>
                                        </>
                                    )}
                                    {/* Intensity breakdown per category */}
                                    {Object.keys(d.catCounts).length > 0 && (
                                        <div className="system-intensity-breakdown">
                                            {WIND_LEGEND.map(({ label, color }) => {
                                                const cat = windCategory(
                                                    label.includes("≥ 100") ? 100 :
                                                        label.includes("64") ? 64 :
                                                            label.includes("48") ? 48 :
                                                                label.includes("34") ? 34 :
                                                                    label.includes("22–33") ? 22 : 10
                                                );
                                                const count = d.catCounts[cat] || 0;
                                                if (count === 0) return null;
                                                return (
                                                    <div key={label} className="intensity-row">
                                                        <span className="intensity-dot" style={{ background: color, boxShadow: `0 0 6px ${color}60` }} />
                                                        <span className="intensity-cat">{cat}</span>
                                                        <span className="intensity-bar-wrap">
                                                            <span className="intensity-bar" style={{ width: `${Math.min(100, (count / d.trackCount) * 100)}%`, background: color }} />
                                                        </span>
                                                        <span className="intensity-count">{count}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Global Intensity Legend */}
            <div className="spaghetti-legend">
                <div className="spaghetti-legend-title">Wind Intensity Scale (kt)</div>
                <div className="spaghetti-legend-grid">
                    {WIND_LEGEND.map(({ label, color }) => (
                        <div key={label} className="spaghetti-legend-item">
                            <span className="spaghetti-legend-color" style={{ background: color, boxShadow: `0 0 6px ${color}60` }} />
                            <span className="spaghetti-legend-label">{label}</span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="spaghetti-footer">
                <p className="spaghetti-footer-text">
                    Powered by <strong className="spaghetti-footer-highlight">Philippine Typhoon/Weather</strong><br />
                    Data: GDM FNV3 Ensemble<br />
                    Consult official agencies for guidance.
                </p>
            </div>
        </div>
    );

    return (
        <div className="spaghetti-layout">
            {/* Mobile overlay */}
            <div className={`mobile-overlay ${sidebarOpen ? 'open' : ''}`} onClick={() => setSidebarOpen(false)} />

            {/* Sidebar */}
            <aside className={`spaghetti-sidebar-container ${sidebarOpen ? 'open' : ''}`}>
                <div className="mobile-close-header">
                    <span className="mobile-close-title">Controls</span>
                    <button onClick={() => setSidebarOpen(false)} className="mobile-close-btn">
                        <svg className="spaghetti-section-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                {sidebarContent}
            </aside>

            {/* Map */}
            <main className="spaghetti-main">
                {/* Mobile top bar */}
                <div className="mobile-topbar">
                    <button onClick={() => setSidebarOpen(true)} className="mobile-menu-btn">
                        <svg className="spaghetti-section-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                    </button>
                    <span className="mobile-title">
                        GDM FNV3 · {horizon === "5day" ? "5-Day" : "15-Day"} Spaghetti
                    </span>
                </div>

                {/* Loading overlay on the map */}
                {status === "loading" && (
                    <div className="map-loading-overlay">
                        <div className="map-spinner" />
                        <span className="map-loading-text">{statusMsg}</span>
                    </div>
                )}

                <div ref={mapRef} className="map-container" style={{ width: '100%', height: '100%', minHeight: '400px' }} />
            </main>
        </div>
    );
}
