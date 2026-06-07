import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import html2canvas from "html2canvas";
import GIF from "gif.js";
import gifWorkerUrl from "gif.js/dist/gif.worker.js?url";
import EnsembleFilter from "./EnsembleFilter";
import {
    ResponsiveContainer,
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip as ChartTooltip,
    AreaChart,
    Area
} from "recharts";
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

// ── Wind → colour (PAGASA Scale in km/h) ────────────────────
function windColor(w) {
    if (isNaN(w)) return "#3498DB";
    if (w >= 185) return "#FF007F";   // Super Typhoon
    if (w >= 118) return "#A83232";   // Typhoon
    if (w >= 89) return "#E67E22";    // Severe Tropical Storm
    if (w >= 62) return "#F1C40F";    // Tropical Storm
    if (w >= 39) return "#2ECC71";    // Tropical Depression
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
// Forcast.py  → public/data/fnv3_base_latest.dat       (base ensemble members)
// Forcast3.py → public/data/fnv3_large_latest.dat       (large ensemble members)
// FNV3 paired CSVs → official ensemble mean tracks (sample=-1) per dataset
const LOCAL_CSV = {
    base: "/data/fnv3_base_latest.dat",
    large: "/data/fnv3_large_latest.dat",
    basePaired: "/data/fnv3_paired_latest.dat",
    largePaired: "/data/fnv3_large_paired_latest.dat",
    ifs: "/data/ifs_tc_latest.dat",
    aifs: "/data/aifs_tc_latest.dat",
    aigefs: "/data/aigefs_tc_latest.dat",
};

// Helper to resolve asset URLs relative to the base path in both local development and deployed production (subfolder) environments
const getAssetUrl = (path) => {
    const base = import.meta.env.BASE_URL || "/";
    const cleanPath = path.startsWith("/") ? path.slice(1) : path;
    return `${base}${cleanPath}`;
};

// ── Base64 + XOR Decryptor ──────────────────────────────────────────────
function decodeObfuscatedData(base64Str) {
    const binaryStr = atob(base64Str);
    const decryptedBytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
        decryptedBytes[i] = binaryStr.charCodeAt(i) ^ 0xAA;
    }
    return new TextDecoder().decode(decryptedBytes);
}

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

// ── Wind legend entries (PAGASA Scale in km/h) ───────────────────────────────
const WIND_LEGEND = [
    { label: "≥ 185 km/h", color: "#FF007F" },
    { label: "118–184 km/h", color: "#A83232" },
    { label: "89–117 km/h", color: "#E67E22" },
    { label: "62–88 km/h", color: "#F1C40F" },
    { label: "39–61 km/h", color: "#2ECC71" },
    { label: "< 39 km/h", color: "#3498DB" },
];

// ── Wind → category name (in km/h) ──────────────────────────────────────────────
function windCategory(w) {
    if (isNaN(w)) return "Unknown";
    if (w >= 185) return "Super Typhoon";
    if (w >= 118) return "Typhoon";
    if (w >= 89) return "Sev. Tropical Storm";
    if (w >= 62) return "Tropical Storm";
    if (w >= 39) return "Tropical Depression";
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

// ── Parse Cycle Statistics (without leaflet mapping) ──────────────────────
function parseCycleStats(csvText, pairedCsvText, datasetName, basinName, horizonName) {
    const { rows } = parseCSV(csvText);
    const rawRows = rows.filter(r => (r.lead_time_hours !== undefined || r.lead_time !== undefined) && r.lat !== undefined);

    const maxHours = horizonName === "5day" ? 120 : 312;
    const b = BASINS.find(opt => opt.id === basinName) || BASINS[0];

    // Group by track_id -> sample
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
        const windKmh = isNaN(windKt) ? NaN : Math.round(windKt * 1.852);
        if (isNaN(lat) || isNaN(lon)) continue;
        const llon = lon > 180 ? lon - 360 : lon;
        const initTime = row.init_time || "latest";
        const key = `${initTime}__${row.track_id}__${row.sample}`;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push({ lat, lon: llon, p: pres, windKmh, h: leadH, initTime });
    }

    // Basin filter
    const basinFiltered = Object.values(grouped).filter(points => {
        const origin = points.find(p => p.h === 0) || points[0];
        if (!origin) return false;
        return origin.lat >= b.latMin && origin.lat <= b.latMax &&
            origin.lon >= b.lonMin && origin.lon <= b.lonMax;
    });

    // Gather origins
    const allOrigins = [];
    const uniqueOrigins = new Set();
    for (const points of basinFiltered) {
        if (points.length < 2) continue;
        const origin = points.find(pt => pt.h === 0) || points.reduce((prev, curr) => curr.h < prev.h ? curr : prev, points[0]);
        if (!origin) continue;
        const oKey = `${origin.lat.toFixed(1)},${origin.lon.toFixed(1)}`;
        if (!uniqueOrigins.has(oKey)) {
            uniqueOrigins.add(oKey);
            allOrigins.push({ lat: origin.lat, lon: origin.lon, h: origin.h || 0, oKey });
        }
    }

    // Cluster
    const clusters = clusterOriginsGreedy(allOrigins, 300);
    clusters.forEach((c, idx) => c.distId = idx + 1);

    const tracksByDist = {};

    for (const points of basinFiltered) {
        if (points.length < 2) continue;
        points.sort((a, b) => a.h - b.h);

        let bad = false;
        for (let i = 1; i < points.length; i++) {
            if (Math.abs(points[i].lat - points[i - 1].lat) > 10 ||
                Math.abs(points[i].lon - points[i - 1].lon) > 10) { bad = true; break; }
        }
        if (bad) continue;

        const origin = points.find(pt => pt.h === 0) || points[0];
        let distId = null;
        let bestDistKm = Infinity;
        for (const c of clusters) {
            const dd = haversineKm(c.center, origin);
            if (dd < bestDistKm) {
                bestDistKm = dd;
                distId = c.distId;
            }
        }
        if (bestDistKm > 666) distId = null;

        if (distId !== null) {
            if (!tracksByDist[distId]) tracksByDist[distId] = [];
            tracksByDist[distId].push(points);
        }
    }

    // Process paired track CSV
    const pairedMeanByTrackId = {};
    if (pairedCsvText) {
        const { rows: pairedRows } = parseCSV(pairedCsvText);
        for (const row of pairedRows) {
            const trackId = (row.track_id || "").trim();
            const sampleVal = (row.sample || "").trim();
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
            const windKmh = isNaN(windKt) ? NaN : Math.round(windKt * 1.852);
            if (isNaN(lat) || isNaN(lon)) continue;

            if (!pairedMeanByTrackId[trackId]) pairedMeanByTrackId[trackId] = { points: [], trackId };
            pairedMeanByTrackId[trackId].points.push({
                lat, lon: lon > 180 ? lon - 360 : lon,
                p: pres, windKmh, h: leadH
            });
        }
        for (const key of Object.keys(pairedMeanByTrackId)) {
            pairedMeanByTrackId[key].points.sort((a, b) => a.h - b.h);
        }
    }

    let initDate = null;
    const firstPointWithInit = Object.values(grouped)[0]?.[0];
    if (firstPointWithInit && firstPointWithInit.initTime && firstPointWithInit.initTime !== "latest") {
        let timeStr = firstPointWithInit.initTime;
        if (!timeStr.includes('Z') && !timeStr.includes('+')) {
            timeStr = timeStr.trim().replace(' ', 'T') + 'Z';
        } else {
            timeStr = timeStr.includes('Z') ? timeStr : timeStr.replace(/-/g, '/');
        }
        initDate = new Date(timeStr);
    }

    // Disturbance metadata list
    const disturbanceList = clusters.map(cluster => {
        const distTracks = tracksByDist[cluster.distId] || [];
        const allMaxW = distTracks.map(pts => {
            const winds = pts.map(pt => isNaN(pt.windKmh) ? 0 : pt.windKmh);
            return winds.length > 0 ? Math.max(...winds) : 0;
        });
        const peakW = allMaxW.length > 0 ? Math.max(...allMaxW) : 0;
        const region = regionName(cluster.center.lat, cluster.center.lon);

        let formationDateStr = "Unknown";
        if (initDate && !isNaN(initDate.getTime())) {
            const minH = cluster.minH || 0;
            const d = new Date(initDate.getTime() + minH * 3600000);
            formationDateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" });
        }

        return {
            id: cluster.distId,
            lat: cluster.center.lat,
            lon: cluster.center.lon,
            region,
            trackCount: distTracks.length,
            peakW,
            pairedTrackName: null,
            agreement: 0,
            meanPoints: null,
            formationDateStr
        };
    });

    // Sort & Renumber
    disturbanceList.sort((a, b) => b.trackCount - a.trackCount);
    const oldToNew = {};
    disturbanceList.forEach((d, idx) => {
        const newId = idx + 1;
        oldToNew[d.id] = newId;
        d.id = newId;
    });

    const updatedTracksByDist = {};
    for (const [oldId, trks] of Object.entries(tracksByDist)) {
        const newId = oldToNew[parseInt(oldId)] || oldId;
        updatedTracksByDist[newId] = trks;
    }

    // Pair assignment
    const pairedAssignment = {};
    const usedPairedTracks = new Set();
    const usedDisturbances = new Set();
    const candidates = [];
    for (const [tId, paired] of Object.entries(pairedMeanByTrackId)) {
        if (paired.points.length < 2) continue;
        const pOrigin = paired.points[0];
        for (const dist of disturbanceList) {
            const tracks = updatedTracksByDist[dist.id] || [];
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

    // Final stats calculations (mean track, agreement)
    for (const dist of disturbanceList) {
        const tracks = updatedTracksByDist[dist.id] || [];
        const minRequiredMembers = datasetName === "large" ? 100 : 25;
        if (tracks.length < minRequiredMembers) {
            continue;
        }

        const assignment = pairedAssignment[dist.id];
        let matchedPaired = null;
        if (assignment) {
            matchedPaired = assignment.paired;
            dist.pairedTrackName = assignment.trackName;
        }

        // Group by hour
        const byHour = {};
        for (let tIdx = 0; tIdx < tracks.length; tIdx++) {
            const track = tracks[tIdx];
            for (const pt of track) {
                if (!byHour[pt.h]) byHour[pt.h] = { lats: [], lons: [], ps: [], winds: [], trackIndices: [] };
                byHour[pt.h].lats.push(pt.lat);
                byHour[pt.h].lons.push(pt.lon);
                byHour[pt.h].ps.push(pt.p);
                byHour[pt.h].winds.push(pt.windKmh);
                byHour[pt.h].trackIndices.push(tIdx);
            }
        }

        const hours = Object.keys(byHour).map(Number).sort((a, b) => a - b);
        const meanPts = [];
        let totalAgreement = 0;
        let agreementSteps = 0;

        const median = arr => {
            const s = [...arr].sort((a, b) => a - b);
            const mid = Math.floor(s.length / 2);
            return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
        };

        for (const h of hours) {
            const d = byHour[h];
            if (!d) continue;
            const n = d.lats.length;
            if (n === 0) continue;

            let mLat, mLon, mW, mP;
            const usePaired = matchedPaired !== null;
            if (usePaired) {
                const pairedPt = matchedPaired.points.reduce((best, pt) => {
                    return Math.abs(pt.h - h) < Math.abs(best.h - h) ? pt : best;
                }, matchedPaired.points[0]);
                if (Math.abs(pairedPt.h - h) <= 3) {
                    mLat = pairedPt.lat;
                    mLon = pairedPt.lon;
                    mW = pairedPt.windKmh;
                    mP = pairedPt.p;
                } else {
                    continue;
                }
            } else {
                mLat = median(d.lats);
                mLon = median(d.lons);
                mW = median(d.winds.filter(w => !isNaN(w)));
                mP = median(d.ps.filter(p => !isNaN(p)));
            }

            const distsKm = d.lats.map((lat, i) => haversineKm({ lat, lon: d.lons[i] }, { lat: mLat, lon: mLon }));
            let inside = 0;
            for (let i = 0; i < n; i++) {
                if (distsKm[i] <= (2 * 111.32)) inside++; // 2 degrees matching AGREEMENT_RADIUS
            }
            totalAgreement += inside / n;
            agreementSteps++;

            meanPts.push({ lat: mLat, lon: mLon, windKmh: mW, p: mP, h });
        }

        dist.agreement = agreementSteps > 0 ? Math.round((totalAgreement / agreementSteps) * 100) : 0;
        dist.meanPoints = meanPts;
    }

    return {
        disturbances: disturbanceList,
        tracksByDisturbance: updatedTracksByDist
    };
}

// ── Component ─────────────────────────────────────────────────────────────
export default function SpaghettiPlot() {
    const mapRef = useRef(null);
    const mapInstanceRef = useRef(null);
    const layerGroupRef = useRef(null);
    const meanLayerGroupRef = useRef(null);
    const animLayerGroupRef = useRef(null);
    const trendLayerGroupRef = useRef(null);
    const animObjectsRef = useRef([]);
    const selectedMarkerRef = useRef(null);
    const selectedBadgeRef = useRef(null);
    const tileLayerRef = useRef(null);
    const geoJsonLayerRef = useRef(null);
    const parLayerRef = useRef(null);
    const gridlinesLayerRef = useRef(null);
    const [selectedMeanPoint, setSelectedMeanPoint] = useState(null);

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
    const [showPlotPoints, setShowPlotPoints] = useState(true);

    const [viewModeState, setViewModeState] = useState("tracker");
    const viewModeRef = useRef("tracker");
    const setViewMode = (mode) => {
        viewModeRef.current = mode;
        setViewModeState(mode);
    };
    const viewMode = viewModeState;

    const [animHour, setAnimHour] = useState(0);
    const [maxAnimHour, setMaxAnimHour] = useState(120);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [exportProgress, setExportProgress] = useState(0);
    const [exportStatusText, setExportStatusText] = useState("");
    const [runInitDate, setRunInitDate] = useState(null);
    const [showAnimControls, setShowAnimControls] = useState(true);
    const [showAllSystems, setShowAllSystems] = useState(false);
    const [isAigefsOutdated, setIsAigefsOutdated] = useState(false);
    const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
    const exportWrapperRef = useRef(null);

    // ── Multi-Cycle Trends State ──────────────────────────────────────────────
    const [cyclesManifest, setCyclesManifest] = useState(null);
    const [allCyclesData, setAllCyclesData] = useState([]);
    const [loadingTrends, setLoadingTrends] = useState(false);
    const [selectedTrendSystem, setSelectedTrendSystem] = useState(null);
    const [isTrendsCollapsed, setIsTrendsCollapsed] = useState(false);

    const selectedTrendSystemRef = useRef(null);
    useEffect(() => {
        selectedTrendSystemRef.current = selectedTrendSystem;
    }, [selectedTrendSystem]);

    // Memoized trend data prepared for Recharts
    const chartData = useMemo(() => {
        if (!selectedTrendSystem) return [];

        const totalEnsembleMembers = dataset === "large" ? 1000 : 50;

        return [...selectedTrendSystem]
            .reverse() // from oldest to newest cycle
            .map(item => {
                let label = item.cycleTime;
                const matchTime = item.cycleTime.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):00/);
                if (matchTime) {
                    const [_, yr, mo, dy, hr] = matchTime;
                    label = `${mo}/${dy} ${hr}Z`;
                }

                const dist = item.disturbance;
                if (!dist) {
                    return {
                        name: label,
                        cycleTime: item.cycleTime,
                        probability: 0,
                        memberCount: 0,
                        totalMembers: totalEnsembleMembers,
                        minWind: null,
                        maxWind: null,
                        medianWind: null,
                        computedMeanWind: null,
                        pairedWind: null,
                        windRange: null,
                        detected: false,
                        formationDateStr: null
                    };
                }

                const cycleData = allCyclesData[item.cycleIndex];
                let distTracks = [];
                if (cycleData && cycleData.tracksByDisturbance) {
                    distTracks = cycleData.tracksByDisturbance[dist.id] || [];
                }

                const peakWinds = distTracks.map(track => {
                    const winds = track.map(pt => isNaN(pt.windKmh) ? 0 : pt.windKmh);
                    return winds.length > 0 ? Math.max(...winds) : 0;
                }).filter(w => w > 0);

                let minWind = null;
                let maxWind = null;
                let medianWind = null;
                let windRange = null;

                if (peakWinds.length > 0) {
                    minWind = Math.min(...peakWinds);
                    maxWind = Math.max(...peakWinds);

                    const sorted = [...peakWinds].sort((a, b) => a - b);
                    const mid = Math.floor(sorted.length / 2);
                    medianWind = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

                    windRange = [minWind, maxWind];
                } else if (dist.peakW > 0) {
                    minWind = dist.peakW;
                    maxWind = dist.peakW;
                    medianWind = dist.peakW;
                    windRange = [dist.peakW, dist.peakW];
                }

                // Peak wind speed along the computed ensemble mean track (median at each lead time)
                const windsByHour = {};
                for (const track of distTracks) {
                    for (const pt of track) {
                        if (!isNaN(pt.windKmh)) {
                            if (!windsByHour[pt.h]) windsByHour[pt.h] = [];
                            windsByHour[pt.h].push(pt.windKmh);
                        }
                    }
                }
                const hourlyMedians = Object.values(windsByHour).map(winds => {
                    if (winds.length === 0) return 0;
                    const sorted = [...winds].sort((a, b) => a - b);
                    const mid = Math.floor(sorted.length / 2);
                    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
                });
                const computedMeanWind = hourlyMedians.length > 0 ? Math.max(...hourlyMedians) : (medianWind || null);

                let pairedWind = null;
                if (dist.pairedTrackName && dist.meanPoints) {
                    const winds = dist.meanPoints.map(pt => pt.windKmh).filter(w => !isNaN(w));
                    if (winds.length > 0) {
                        pairedWind = Math.max(...winds);
                    }
                }

                return {
                    name: label,
                    cycleTime: item.cycleTime,
                    probability: Math.min(100, Math.round((dist.trackCount / totalEnsembleMembers) * 100)),
                    memberCount: dist.trackCount,
                    totalMembers: totalEnsembleMembers,
                    minWind,
                    maxWind,
                    medianWind,
                    computedMeanWind,
                    pairedWind,
                    windRange,
                    detected: true,
                    formationDateStr: dist.formationDateStr || null
                };
            });
    }, [selectedTrendSystem, allCyclesData, dataset]);

    const [allTracks, setAllTracks] = useState([]);
    const [filteredTrackIds, setFilteredTrackIds] = useState(null);
    const [filterStats, setFilterStats] = useState(null);

    const handleMeanPointClick = useCallback((pt, distId, distRegion) => {
        const map = mapInstanceRef.current;
        if (!map) return;

        // Clear existing pulsing marker and badge if any
        if (selectedMarkerRef.current) {
            map.removeLayer(selectedMarkerRef.current);
            selectedMarkerRef.current = null;
        }
        if (selectedBadgeRef.current) {
            map.removeLayer(selectedBadgeRef.current);
            selectedBadgeRef.current = null;
        }

        // Determine model label
        let modelLabel = "GDM FNV3";
        if (dataset === "large") modelLabel = "FNV3 Large Ens";
        else if (dataset === "ifs") modelLabel = "ECMWF IFS Ens";
        else if (dataset === "aifs") modelLabel = "ECMWF AIFS Ens";
        else if (dataset === "aigefs") modelLabel = "NOAA AI-GEFS Ens";

        // Determine dynamic displayName matching storm naming standards (Invest vs TC)
        const distObj = disturbances.find(d => d.id === distId);
        let displayName = `Disturbance ${distId}`;
        if (distObj && distObj.pairedTrackName) {
            const isInvest = parseInt(distObj.pairedTrackName) >= 90;
            displayName = isInvest ? `Invest ${distObj.pairedTrackName}` : `TC ${distObj.pairedTrackName}`;
        }

        setSelectedMeanPoint({
            distId,
            displayName,
            h: pt.h,
            lat: pt.lat,
            lon: pt.lon,
            windKmh: pt.windKmh,
            p: pt.p || NaN,
            activeMembers: pt.activeMembers,
            totalMembers: pt.totalMembers,
            region: distRegion,
            modelLabel
        });

        // Add a pulsing lock-on marker
        const L = window.L;
        const marker = L.circleMarker([pt.lat, pt.lon], {
            radius: 9,
            color: "#00f0ff",
            weight: 2,
            fillColor: "#00f0ff",
            fillOpacity: 0.15,
            className: "mean-selected-pulse"
        }).addTo(map);

        selectedMarkerRef.current = marker;

        // (Removed custom purple badge as requested)

        // Smoothly center and pan map to the coordinate
        map.panTo([pt.lat, pt.lon]);
    }, [dataset, disturbances]);

    // Clear selection state on view changes
    useEffect(() => {
        setSelectedMeanPoint(null);
        if (selectedMarkerRef.current && mapInstanceRef.current) {
            mapInstanceRef.current.removeLayer(selectedMarkerRef.current);
            selectedMarkerRef.current = null;
        }
        if (selectedBadgeRef.current && mapInstanceRef.current) {
            mapInstanceRef.current.removeLayer(selectedBadgeRef.current);
            selectedBadgeRef.current = null;
        }
    }, [dataset, activeDisturbanceId, horizon, basin]);

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

            tileLayerRef.current = L.tileLayer(
                "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png",
                { attribution: "© CARTO", subdomains: "abcd", maxZoom: 19, noWrap: true }
            ).addTo(map);

            // PAR boundary (solid red)
            parLayerRef.current = L.polyline(PAR, { color: "#ef4444", weight: 2 }).addTo(map);

            // Country boundaries (matches Python BORDERS styling)
            fetch(getAssetUrl("/assets/country.0.1_small.json"))
                .then(r => r.ok ? r.json() : null)
                .then(geo => {
                    if (geo && map) {
                        geoJsonLayerRef.current = L.geoJSON(geo, {
                            style: { color: "#facc15", weight: 1, opacity: 0.7, fillOpacity: 0 }
                        }).addTo(map);
                    }
                })
                .catch(() => { /* silently skip if unavailable */ });

            gridlinesLayerRef.current = L.layerGroup().addTo(map);

            layerGroupRef.current = L.layerGroup().addTo(map);
            meanLayerGroupRef.current = L.layerGroup(); // not added to map — default OFF
            animLayerGroupRef.current = L.layerGroup(); // not added to map — default OFF
            trendLayerGroupRef.current = L.layerGroup(); // not added to map — default OFF
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

    // Handle map resize when sidebar toggles
    useEffect(() => {
        if (!mapInstanceRef.current) return;

        // Invalidate immediately in case it's a fast jump
        mapInstanceRef.current.invalidateSize();

        // And invalidate after the CSS transition (0.3s) finishes
        const timeoutId = setTimeout(() => {
            if (mapInstanceRef.current) {
                mapInstanceRef.current.invalidateSize({ animate: true });
            }
        }, 300);

        return () => clearTimeout(timeoutId);
    }, [desktopSidebarOpen, sidebarOpen]);

    // ── Multi-Cycle Trends Logic & Hooks ─────────────────────────────────────

    // Heuristic tracker to match a system across cycles
    const matchDisturbancesAcrossCycles = useCallback((selectedDist, cyclesData) => {
        if (!selectedDist || !cyclesData || cyclesData.length === 0) return [];

        const matchedChain = [];
        let currentCenter = { lat: selectedDist.lat, lon: selectedDist.lon };
        let currentPairedName = selectedDist.pairedTrackName;

        for (let i = 0; i < cyclesData.length; i++) {
            const cycle = cyclesData[i];
            let match = null;

            // 1. Try matching by paired storm ID first
            if (currentPairedName) {
                match = cycle.disturbances.find(d => d.pairedTrackName === currentPairedName);
            }

            // 2. Try spatial matching
            if (!match) {
                let bestDist = Infinity;
                for (const d of cycle.disturbances) {
                    const dist = haversineKm(currentCenter, { lat: d.lat, lon: d.lon });
                    if (dist < 450 && dist < bestDist) {
                        bestDist = dist;
                        match = d;
                    }
                }
            }

            if (match) {
                matchedChain.push({
                    cycleIndex: i,
                    cycleTime: cycle.cycleTime,
                    disturbance: match
                });
                // Update track position and name for next cycle comparison
                currentCenter = { lat: match.lat, lon: match.lon };
                if (match.pairedTrackName) {
                    currentPairedName = match.pairedTrackName;
                }
            } else {
                matchedChain.push({
                    cycleIndex: i,
                    cycleTime: cycle.cycleTime,
                    disturbance: null
                });
            }
        }

        return matchedChain;
    }, []);

    const handleSelectTrendSystem = useCallback((dist) => {
        if (allCyclesData.length === 0) return;
        const chain = matchDisturbancesAcrossCycles(dist, allCyclesData);
        setSelectedTrendSystem(chain);
        setActiveDisturbanceId(dist.id); // pulse/highlight it on map
    }, [allCyclesData, matchDisturbancesAcrossCycles]);

    // Load trends cycles data dynamically when viewMode changes to 'trends'
    useEffect(() => {
        if (viewMode !== "trends") {
            setSelectedTrendSystem(null);
            setIsTrendsCollapsed(false);
            return;
        }

        let cancelled = false;

        const loadAllCycles = async () => {
            setLoadingTrends(true);
            try {
                let manifest = cyclesManifest;
                if (!manifest) {
                    const res = await fetch(getAssetUrl("/data/cycles_manifest.json"));
                    if (!res.ok) throw new Error("Manifest not found");
                    manifest = await res.json();
                    if (!cancelled) setCyclesManifest(manifest);
                }

                const activeCycles = dataset === "large" ? manifest.large : manifest.base;
                if (!activeCycles || activeCycles.length === 0) {
                    throw new Error("No active cycles found for selected dataset");
                }

                const parsedCycles = [];

                for (const c of activeCycles) {
                    if (cancelled) return;

                    // Fetch tracks
                    const tracksRes = await fetch(getAssetUrl(`/data/${c.tracks}`));
                    if (!tracksRes.ok) continue;
                    const encTracks = await tracksRes.text();
                    const csvText = decodeObfuscatedData(encTracks);

                    // Fetch paired
                    let pairedCsvText = null;
                    if (c.paired) {
                        try {
                            const pairedRes = await fetch(getAssetUrl(`/data/${c.paired}`));
                            if (pairedRes.ok) {
                                const encPaired = await pairedRes.text();
                                pairedCsvText = decodeObfuscatedData(encPaired);
                            }
                        } catch (_) { }
                    }

                    // Parse cycle stats without map layers rendering
                    const parsed = parseCycleStats(csvText, pairedCsvText, dataset, basin, horizon);
                    parsedCycles.push({
                        cycleTime: c.cycle,
                        disturbances: parsed.disturbances,
                        tracksByDisturbance: parsed.tracksByDisturbance
                    });
                }

                if (!cancelled) {
                    setAllCyclesData(parsedCycles);

                    const prevSelected = selectedTrendSystemRef.current;
                    let reselected = false;
                    if (prevSelected && prevSelected.length > 0 && parsedCycles.length > 0) {
                        const prevDist = prevSelected[0].disturbance;
                        if (prevDist) {
                            const latestCycle = parsedCycles[0];
                            let bestMatch = null;
                            if (prevDist.pairedTrackName) {
                                bestMatch = latestCycle.disturbances.find(d => d.pairedTrackName === prevDist.pairedTrackName);
                            }
                            if (!bestMatch) {
                                let minD = Infinity;
                                for (const d of latestCycle.disturbances) {
                                    const dd = haversineKm(prevDist, d);
                                    if (dd < 300 && dd < minD) {
                                        minD = dd;
                                        bestMatch = d;
                                    }
                                }
                            }
                            if (bestMatch) {
                                const chain = matchDisturbancesAcrossCycles(bestMatch, parsedCycles);
                                setSelectedTrendSystem(chain);
                                setActiveDisturbanceId(bestMatch.id);
                                reselected = true;
                            }
                        }
                    }
                    if (!reselected) {
                        setSelectedTrendSystem(null);
                        setActiveDisturbanceId(null);
                    }
                }
            } catch (err) {
                console.error("Error loading trends data:", err);
            } finally {
                if (!cancelled) setLoadingTrends(false);
            }
        };

        loadAllCycles();

        return () => {
            cancelled = true;
        };
    }, [viewMode, dataset, basin, horizon, cyclesManifest]);

    // Render multi-cycle trend tracks on the Leaflet map when a trend system is selected
    useEffect(() => {
        const map = mapInstanceRef.current;
        if (!map || !trendLayerGroupRef.current || viewMode !== "trends") return;

        // Clear existing trend layers
        trendLayerGroupRef.current.clearLayers();
        map.removeLayer(trendLayerGroupRef.current);

        if (!selectedTrendSystem || selectedTrendSystem.length === 0) return;

        const L = window.L;
        // Colors corresponding to the 4 cycles (Latest down to oldest)
        const cycleColors = ["#38bdf8", "#34d399", "#fbbf24", "#f87171"];

        // Check if the storm has an official paired track in any of the cycles
        const hasAnyPaired = selectedTrendSystem.some(item => item.disturbance && item.disturbance.pairedTrackName);

        // Add trend layer group to map
        trendLayerGroupRef.current.addTo(map);

        // Draw oldest cycles first so newer cycles are rendered on top
        for (let i = selectedTrendSystem.length - 1; i >= 0; i--) {
            const item = selectedTrendSystem[i];
            const dist = item.disturbance;
            if (!dist || !dist.meanPoints || dist.meanPoints.length < 2) continue;

            // If the storm has an official paired track in any cycle, do not draw computed ensemble mean fallback for cycles that don't have it
            if (hasAnyPaired && !dist.pairedTrackName) {
                continue;
            }

            const color = cycleColors[item.cycleIndex] || "#cbd5e1";
            const pts = dist.meanPoints;
            const latlngs = pts.map(p => [p.lat, p.lon]);

            // Draw outline for contrast
            L.polyline(latlngs, {
                color: "#0f172a",
                weight: 6,
                opacity: 0.5,
                lineCap: "round",
                lineJoin: "round"
            }).addTo(trendLayerGroupRef.current);

            // Draw the main track polyline
            const poly = L.polyline(latlngs, {
                color: color,
                weight: 3.5,
                opacity: 0.95,
                lineCap: "round",
                lineJoin: "round"
            });

            // Format cycle label for tooltip/popup
            let cycleLabel = item.cycleTime;
            const matchTime = item.cycleTime.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):00/);
            if (matchTime) {
                const [_, yr, mo, dy, hr] = matchTime;
                cycleLabel = `${mo}/${dy} ${hr}Z Run`;
            }

            poly.bindTooltip(`
                <div style="font-family: 'Inter', sans-serif; font-size: 11px; font-weight: 700; color: ${color}; padding: 2px 4px;">
                    ${cycleLabel} (${dist.pairedTrackName ? "Official Paired" : "Ensemble Mean"})
                </div>
            `, { sticky: true });

            poly.addTo(trendLayerGroupRef.current);

            // Draw markers for final and start positions
            const startPt = pts[0];
            const endPt = pts[pts.length - 1];

            // Start position dot
            L.circleMarker([startPt.lat, startPt.lon], {
                radius: 4,
                color: color,
                weight: 1.5,
                fillColor: "#0f172a",
                fillOpacity: 1
            }).bindTooltip(`Formation: ${cycleLabel}`, { direction: "top" })
                .addTo(trendLayerGroupRef.current);

            // Peak/Latest position marker
            L.circleMarker([endPt.lat, endPt.lon], {
                radius: 6,
                color: color,
                weight: 2,
                fillColor: color,
                fillOpacity: 0.8
            }).bindTooltip(`End position: ${cycleLabel}`, { direction: "top" })
                .addTo(trendLayerGroupRef.current);
        }

        // Auto-fit bounds of the trend tracks so the user sees the shifts immediately
        const allLatLngs = [];
        for (const item of selectedTrendSystem) {
            if (item.disturbance && item.disturbance.meanPoints) {
                item.disturbance.meanPoints.forEach(p => {
                    allLatLngs.push([p.lat, p.lon]);
                });
            }
        }
        if (allLatLngs.length > 0) {
            const bounds = L.latLngBounds(allLatLngs);
            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 6, animate: true });
        }

    }, [selectedTrendSystem, viewMode]);

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
        if (animLayerGroupRef.current) {
            animLayerGroupRef.current.clearLayers();
        }
        animObjectsRef.current = [];
        setIsPlaying(false);
        setAnimHour(0);

        setShowEnsembleMean(false);
        setMeanOnlyIds(new Set());
        setFilteredTrackIds(null);
        setFilterStats(null);
        setAllTracks([]);
        setStatus("loading");
        setStatusMsg("Loading latest FNV3 CSV\u2026");
        setTrackCount(0);
        setRunLabel("");

        const isLarge = dataset === "large";
        const csvUrl = LOCAL_CSV[dataset];
        let csvText = null;
        let pairedCsvText = null;

        try {
            const res = await fetch(getAssetUrl(csvUrl));
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const encryptedText = await res.text();
            csvText = decodeObfuscatedData(encryptedText);
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
            const pairedRes = await fetch(getAssetUrl(pairedUrl));
            if (pairedRes.ok) {
                const encPairedText = await pairedRes.text();
                pairedCsvText = decodeObfuscatedData(encPairedText);
            }
        } catch (_) {
            // Silently skip — we fall back to computed median
        }

        const { rows, cols } = parseCSV(csvText);

        // Determine init time from first available row
        let runInitTime = "latest";
        if (rows.length > 0 && rows[0].init_time) {
            runInitTime = rows[0].init_time;
        }

        let isOutdated = false;
        if (dataset === "aigefs" && runInitTime !== "latest") {
            try {
                const dt = new Date(runInitTime.replace(" ", "T") + "Z");
                const now = new Date();
                const diffHours = (now - dt) / (1000 * 60 * 60);
                if (diffHours > 24) isOutdated = true;
            } catch (e) { }
        }
        setIsAigefsOutdated(isOutdated);

        let labelStr = "FNV3 Base";
        if (isLarge) labelStr = "FNV3 Large Ens";
        if (dataset === "ifs") labelStr = "ECMWF IFS Ens";
        if (dataset === "aifs") labelStr = "ECMWF AIFS Ens";
        if (dataset === "aigefs") labelStr = "AI-GEFS Ens";
        setRunLabel(`${labelStr} \u00b7 ${runInitTime}`);
        setStatusMsg("Parsing tracks…");
        const rawRows = rows.filter(r => (r.lead_time_hours !== undefined || r.lead_time !== undefined) && r.lat !== undefined);
        setRawRowCount(rawRows.length);
        const maxHours = horizon === "5day" ? 120 : 312;
        setMaxAnimHour(maxHours);

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
                const windKmh = isNaN(windKt) ? NaN : Math.round(windKt * 1.852);
                if (isNaN(lat) || isNaN(lon)) continue;
                const llon = lon > 180 ? lon - 360 : lon;
                const initTime = row.init_time || "latest";
                const key = `${initTime}__${row.track_id}__${row.sample}`;
                if (!grouped[key]) grouped[key] = [];
                grouped[key].push({ lat, lon: llon, p: pres, windKmh, h: leadH, initTime });
            }

            // Keep only tracks whose origin point falls inside the selected basin
            const basinFiltered = Object.values(grouped).filter(points => {
                const origin = points.find(p => p.h === 0) || points[0];
                if (!origin) return false;
                return origin.lat >= b.latMin && origin.lat <= b.latMax &&
                    origin.lon >= b.lonMin && origin.lon <= b.lonMax;
            });

            setAllTracks(basinFiltered);

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
            for (let trackIndex = 0; trackIndex < basinFiltered.length; trackIndex++) {
                const points = basinFiltered[trackIndex];
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

                // Animation objects
                // Animation objects - use a layer group for multi-colored animated segments
                const animGroup = L.layerGroup().addTo(animLayerGroupRef.current);

                const animMarker = L.circleMarker([0, 0], {
                    radius: 5, color: "#38bdf8", weight: 2,
                    fillColor: 'transparent', fillOpacity: 0, opacity: 0
                }).addTo(animLayerGroupRef.current);

                animObjectsRef.current.push({
                    distId,
                    trackIndex,
                    group: animGroup,
                    marker: animMarker,
                    points: points
                });

                // Draw line segment-by-segment to color by wind speed
                for (let i = 1; i < points.length; i++) {
                    const p1 = points[i - 1];
                    const p2 = points[i];
                    const segment = L.polyline([[p1.lat, p1.lon], [p2.lat, p2.lon]], {
                        color: windColor(p2.windKmh),
                        weight: 2.5,
                        opacity: 0.5,
                        lineCap: "round",
                        lineJoin: "round",
                        noClip: true,
                    });
                    segment.distId = distId;
                    segment.trackIndex = trackIndex;
                    segment.defaultOpacity = 0.5;
                    segment.addTo(layerGroupRef.current);
                }

                for (const pt of points) {
                    const mark = L.circleMarker([pt.lat, pt.lon], {
                        radius: 4, color: windColor(pt.windKmh), weight: 2,
                        fillColor: 'transparent', fillOpacity: 0, opacity: 0.9
                    });
                    mark.distId = distId;
                    mark.trackIndex = trackIndex;
                    mark.defaultFillOpacity = 0.9;
                    mark.defaultStrokeOpacity = 1;
                    mark.addTo(layerGroupRef.current);
                }

                if (!originSetDone.has(oKey)) {
                    originSetDone.add(oKey);
                    tracksByOriginKey[oKey] = [];
                }
                // Store the max wind across all points in this track
                const maxW = Math.max(...points.map(pt => isNaN(pt.windKmh) ? 0 : pt.windKmh));
                if (tracksByOriginKey[oKey]) {
                    tracksByOriginKey[oKey].push(maxW);
                }
                drawn++;
            }

            let initDate = null;
            if (runInitTime && runInitTime !== "latest") {
                // FNV3 init_time is strictly UTC. Ensure it's parsed as UTC.
                let timeStr = runInitTime;
                if (!timeStr.includes('Z') && !timeStr.includes('+')) {
                    timeStr = timeStr.trim().replace(' ', 'T') + 'Z';
                } else {
                    timeStr = timeStr.includes('Z') ? timeStr : timeStr.replace(/-/g, '/');
                }
                initDate = new Date(timeStr);
            }
            setRunInitDate(initDate);

            // Build disturbance metadata using tracksByDisturbance as single source of truth
            const disturbanceList = clusters.map(cluster => {
                const distTracks = tracksByDisturbance[cluster.distId] || [];

                // Compute peak wind from actual tracks assigned to this disturbance
                const allMaxW = distTracks.map(pts => {
                    const winds = pts.map(pt => isNaN(pt.windKmh) ? 0 : pt.windKmh);
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
                    const windKmh = isNaN(windKt) ? NaN : Math.round(windKt * 1.852);
                    if (isNaN(lat) || isNaN(lon)) continue;

                    if (!pairedMeanByTrackId[trackId]) pairedMeanByTrackId[trackId] = { points: [], trackId };
                    pairedMeanByTrackId[trackId].points.push({
                        lat, lon: lon > 180 ? lon - 360 : lon,
                        p: pres, windKmh, h: leadH
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
                    const minRequiredMembers = dataset === "large" ? 100 : 25;

                    if (tracks.length < minRequiredMembers) {
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
                            byHour[pt.h].winds.push(!isNaN(pt.windKmh) ? pt.windKmh : NaN);
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
                        let mLat, mLon, mW, mP;
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
                                mW = pairedPt.windKmh;
                                mP = pairedPt.p;
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

                            // Dead members (Decay Curve in km/h)
                            const activeCount = windVals.length;
                            const deadCount = tracks.length - activeCount;
                            for (let i = 0; i < deadCount; i++) {
                                // Spread dead values from 19 to 37 km/h (Decay "Smear")
                                const decayVal = deadCount > 1 ? 19 + (i / (deadCount - 1)) * 18 : 28;
                                windVals.push(decayVal);
                                windWeights.push(1.0); // Full weight for penalty
                            }

                            mW = weightedMedian(windVals, windWeights);

                            // Median central pressure
                            const validPs = d.ps.filter(p => !isNaN(p));
                            mP = validPs.length > 0 ? median(validPs) : NaN;

                            // Integrated "RI" Check (Secondary High-End Mean)
                            if (activeCount > 0) {
                                const sortedActive = [...windVals.slice(0, activeCount)].sort((a, b) => b - a);
                                const top10Count = Math.max(1, Math.floor(sortedActive.length * 0.1));
                                const top10Mean = sortedActive.slice(0, top10Count).reduce((a, b) => a + b, 0) / top10Count;

                                if (top10Mean - mW > 74) {
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

                        meanPts.push({ lat: mLat, lon: mLon, windKmh: mW, p: mP, h, sdKm, r67km, activeMembers, totalMembers });
                    }

                    // Tag disturbance with source info
                    dist.meanSource = matchedPaired ? "paired" : "computed";

                    dist.agreement = agreementSteps > 0 ? Math.round((totalAgreement / agreementSteps) * 100) : 0;
                    const avgSdKm = meanPts.reduce((s, p) => s + p.sdKm, 0) / (meanPts.length || 1);
                    dist.spreadKm = Math.round(avgSdKm);
                    dist.meanPoints = meanPts;

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

                    // Colored ensemble mean track segments
                    for (let i = 1; i < meanPts.length; i++) {
                        const p1 = meanPts[i - 1];
                        const p2 = meanPts[i];

                        // White outline for contrast (slightly wider than the colored line)
                        L.polyline([[p1.lat, p1.lon], [p2.lat, p2.lon]], {
                            color: "#ffffff", weight: 6, opacity: 0.3,
                            lineCap: "round", lineJoin: "round", noClip: true,
                        }).addTo(meanLayerGroupRef.current);

                        // Colored segment
                        const meanSeg = L.polyline([[p1.lat, p1.lon], [p2.lat, p2.lon]], {
                            color: windColor(p2.windKmh),
                            weight: 4,
                            opacity: 0.95,
                            lineCap: "round",
                            lineJoin: "round",
                            noClip: true,
                        });
                        meanSeg.distId = dist.id;
                        meanSeg.on('click', () => {
                            handleMeanPointClick(p2, dist.id, dist.region);
                        });
                        meanSeg.addTo(meanLayerGroupRef.current);
                    }

                    // Mean position dots colored by wind speed
                    for (const pt of meanPts) {
                        const mk = L.circleMarker([pt.lat, pt.lon], {
                            radius: 5, color: windColor(pt.windKmh), weight: 2.5,
                            fillColor: 'transparent', fillOpacity: 0, opacity: 1
                        });
                        mk.distId = dist.id;

                        // Calculate localized date and time for the premium hover tooltip
                        const d = initDate ? new Date(initDate.getTime() + pt.h * 3600000) : null;
                        const dateStr = d ? d.toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "Asia/Manila" }) : "N/A";
                        let hr = d ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Manila" }) : "N/A";

                        const windVal = isNaN(pt.windKmh) ? 'N/A' : `${pt.windKmh.toFixed(0)} km/h`;
                        const windColorVal = windColor(pt.windKmh);

                        const tooltipHtml = `
                            <div style="display: flex; flex-direction: column; gap: 4px; font-family: 'Inter', sans-serif;">
                                <div style="font-size: 11px; font-weight: 800; color: #ffffff; display: flex; align-items: center; gap: 6px; line-height: 1.2;">
                                    <span>${dateStr}</span>
                                    <span style="color: rgba(255, 255, 255, 0.35); font-weight: 400;">|</span>
                                    <span>${hr}</span>
                                </div>
                                <div style="display: flex; align-items: center; gap: 6px; margin-top: 2px; line-height: 1.2;">
                                    <span style="width: 8px; height: 8px; border-radius: 50%; background-color: ${windColorVal}; box-shadow: 0 0 6px ${windColorVal}80; display: inline-block;"></span>
                                    <span style="font-size: 11px; font-weight: 700; color: ${windColorVal};">
                                        ${windVal}
                                    </span>
                                    <span style="font-size: 9px; color: rgba(255, 255, 255, 0.4); font-family: monospace;">(+${pt.h}h)</span>
                                </div>
                            </div>
                        `;

                        mk.bindTooltip(tooltipHtml, {
                            direction: 'top',
                            offset: [0, -8],
                            className: 'mean-dot-tooltip',
                            permanent: false,
                            sticky: false,
                            opacity: 0.95
                        });

                        mk.on('click', () => {
                            handleMeanPointClick(pt, dist.id, dist.region);
                        });

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
            // Re-attach the correct layer group based on the active view mode
            if (map) {
                if (viewModeRef.current === "tracker" || viewModeRef.current === "filter") {
                    if (layerGroupRef.current) layerGroupRef.current.addTo(map);
                    // The showEnsembleMean effect will handle re-attaching the mean layer if needed
                } else if (viewModeRef.current === "animation") {
                    if (animLayerGroupRef.current) animLayerGroupRef.current.addTo(map);
                }
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
            const isFiltered = filteredTrackIds === null || (layer.trackIndex != null && filteredTrackIds.has(layer.trackIndex));

            let polyOpacity = 0.05;
            let markFill = 0.05;
            let markStroke = 0.05;

            if (isMeanOnly) {
                polyOpacity = 0.03;
                markFill = showPlotPoints ? 0.03 : 0;
                markStroke = showPlotPoints ? 0.03 : 0;
            } else if (!isFiltered) {
                polyOpacity = 0; markFill = 0; markStroke = 0;
            } else if (isSelected) {
                polyOpacity = layer.defaultOpacity;
                markFill = showPlotPoints ? layer.defaultFillOpacity : 0;
                markStroke = showPlotPoints ? layer.defaultStrokeOpacity : 0;
            }

            if (layer instanceof L.Polyline && !(layer instanceof L.CircleMarker)) {
                layer.setStyle({ opacity: polyOpacity });
            } else if (layer instanceof L.CircleMarker) {
                layer.setStyle({ fillOpacity: markFill, opacity: markStroke });
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
                    const fill = showPlotPoints ? (isSelected ? 1 : 0.05) : 0;
                    const stroke = showPlotPoints ? (isSelected ? 1 : 0.05) : 0;
                    layer.setStyle({ fillOpacity: fill, opacity: stroke });
                }
            });
        }

        // Automatic zooming disabled as per user request
        // if (activeDisturbanceId !== null && mapInstanceRef.current) {
        //     const dist = disturbances.find(d => d.id === activeDisturbanceId);
        //     if (dist) {
        //         mapInstanceRef.current.flyTo([dist.lat, dist.lon], 5, { duration: 1.5 });
        //     }
        // }
    }, [activeDisturbanceId, disturbances, meanOnlyIds, filteredTrackIds, showPlotPoints]);

    // Toggle ensemble mean layer visibility
    useEffect(() => {
        if (!meanLayerGroupRef.current || !mapInstanceRef.current) return;
        const map = mapInstanceRef.current;
        if (showEnsembleMean && viewMode === "tracker") {
            meanLayerGroupRef.current.addTo(map);
        } else {
            map.removeLayer(meanLayerGroupRef.current);
        }
    }, [showEnsembleMean, viewMode]);

    // Toggle view mode (Tracker vs Animation vs Trends)
    useEffect(() => {
        const map = mapInstanceRef.current;
        if (!map || !layerGroupRef.current || !animLayerGroupRef.current || !meanLayerGroupRef.current || !trendLayerGroupRef.current) return;

        if (viewMode === "tracker" || viewMode === "filter") {
            map.removeLayer(animLayerGroupRef.current);
            map.removeLayer(trendLayerGroupRef.current);
            layerGroupRef.current.addTo(map);
            if (showEnsembleMean) meanLayerGroupRef.current.addTo(map);
        } else if (viewMode === "animation") {
            map.removeLayer(layerGroupRef.current);
            map.removeLayer(meanLayerGroupRef.current);
            map.removeLayer(trendLayerGroupRef.current);
            animLayerGroupRef.current.addTo(map);
            setAnimHour(prev => prev);
        } else if (viewMode === "trends") {
            map.removeLayer(layerGroupRef.current);
            map.removeLayer(meanLayerGroupRef.current);
            map.removeLayer(animLayerGroupRef.current);
            trendLayerGroupRef.current.addTo(map);
        }
    }, [viewMode, showEnsembleMean]);

    // Animation playback loop
    useEffect(() => {
        let interval;
        if (isPlaying) {
            interval = setInterval(() => {
                setAnimHour(prev => {
                    if (prev >= maxAnimHour) {
                        setIsPlaying(false);
                        return prev;
                    }
                    return prev + 6;
                });
            }, 200); // 200ms per 6h frame
        }
        return () => clearInterval(interval);
    }, [isPlaying, maxAnimHour]);

    // Update animation layers based on animHour
    useEffect(() => {
        if (viewMode !== "animation" || status !== "ok") return;

        for (const obj of animObjectsRef.current) {
            const isSelected = activeDisturbanceId === null || obj.distId === activeDisturbanceId;
            const isMeanOnly = obj.distId != null && meanOnlyIds.has(obj.distId);
            const isFiltered = filteredTrackIds === null || filteredTrackIds.has(obj.trackIndex);
            const hidden = isMeanOnly || !isSelected || !isFiltered;

            const maxTrackHour = obj.points[obj.points.length - 1].h;
            const hasEnded = animHour > maxTrackHour;

            const visiblePts = obj.points.filter(p => p.h <= animHour);

            // Clear existing segments in the group
            obj.group.clearLayers();

            if (visiblePts.length === 0 || hidden || hasEnded) {
                obj.marker.setStyle({ opacity: 0, fillOpacity: 0 });
                continue;
            }

            // Draw multi-colored segments for animation
            for (let i = 1; i < visiblePts.length; i++) {
                const p1 = visiblePts[i - 1];
                const p2 = visiblePts[i];
                L.polyline([[p1.lat, p1.lon], [p2.lat, p2.lon]], {
                    color: windColor(p2.windKmh),
                    weight: 2.5,
                    opacity: 0.5,
                    lineCap: "round",
                    lineJoin: "round",
                    noClip: true,
                }).addTo(obj.group);
            }

            const lastPt = visiblePts[visiblePts.length - 1];
            obj.marker.setLatLng([lastPt.lat, lastPt.lon]);
            obj.marker.setStyle({
                fillColor: windColor(lastPt.windKmh),
                opacity: 1,
                fillOpacity: 0.9
            });
        }
    }, [animHour, viewMode, activeDisturbanceId, status, meanOnlyIds, filteredTrackIds]);

    const exportScreenshot = async () => {
        if (!exportWrapperRef.current) return;
        setIsExporting(true);
        setExportStatusText("Capturing high-resolution map snapshot...");

        try {
            const mapEl = exportWrapperRef.current;
            const dpr = window.devicePixelRatio || 2;

            const canvas = await html2canvas(mapEl, {
                useCORS: true,
                allowTaint: false,
                scale: dpr,
                backgroundColor: "#0f172a",
                logging: false,
                ignoreElements: (node) => node.classList && (node.classList.contains('leaflet-control-container') || node.classList.contains('no-export'))
            });

            // Draw '@ Philippine Typoon/Weather' watermark
            const ctx = canvas.getContext('2d');

            // CRITICAL FIX: html2canvas leaves the context scaled by dpr.
            // Reset the transform matrix so our coordinates map 1:1 to canvas pixels!
            ctx.resetTransform();

            // Tasteful proportional size (1.5% of canvas width), clamped to sensible physical pixel limits
            const fontSize = Math.max(16, Math.min(32, canvas.width * 0.015));

            // CRITICAL: Canvas ctx.font does NOT support CSS var(). It must be a valid font string!
            ctx.font = `900 ${fontSize}px "Inter", system-ui, -apple-system, sans-serif`;
            ctx.fillStyle = "rgba(255, 255, 255, 1)";
            ctx.textAlign = "right";
            ctx.textBaseline = "bottom";

            // Add a thick black outline (stroke) and a strong drop shadow
            ctx.shadowColor = "rgba(0, 0, 0, 1)";
            ctx.shadowBlur = Math.max(2, fontSize * 0.2);
            ctx.shadowOffsetX = 1;
            ctx.shadowOffsetY = 1;

            const paddingX = Math.max(16, canvas.width * 0.015);
            const paddingY = Math.max(16, canvas.width * 0.015);

            // Draw the stroke first, then the fill on top
            ctx.lineWidth = Math.max(2, fontSize * 0.15);
            ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
            ctx.strokeText("@ Philippine Typoon/Weather", canvas.width - paddingX, canvas.height - paddingY);
            ctx.fillText("@ Philippine Typoon/Weather", canvas.width - paddingX, canvas.height - paddingY);

            // Reset shadow before continuing
            ctx.shadowColor = "transparent";

            const url = canvas.toDataURL("image/png");
            const a = document.createElement('a');
            a.href = url;
            const modelPrefix = dataset === 'ifs' ? 'ECMWF' : dataset === 'aifs' ? 'ECMWF-AIFS' : dataset === 'aigefs' ? 'NOAA-AIGEFS' : dataset === 'large' ? 'GDM-FNV3-Large' : 'GDM-FNV3';
            a.download = `${modelPrefix}-Snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
            a.click();
        } catch (err) {
            console.error("Screenshot failed:", err);
        } finally {
            setIsExporting(false);
        }
    };

    const exportTrendsScreenshot = async (isWide) => {
        if (activeDisturbanceId === null) return;
        setIsExporting(true);
        setExportStatusText("Saving trends map please wait...");

        try {
            const response = await fetch(`/api/generate-map?dataset=${dataset}&horizon=${horizon}&isWide=${isWide}&disturbanceId=${activeDisturbanceId}`);
            if (!response.ok) {
                const errText = await response.text();
                throw new Error(errText || `Failed to generate trends map: ${response.statusText}`);
            }
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const modelPrefix = dataset === 'large' ? 'GDM-FNV3-Large' : 'GDM-FNV3';
            const extentName = isWide ? 'Wide' : 'Standard';
            a.download = `${modelPrefix}-Trends-${extentName}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error("Trends export failed:", err);
            alert(`Trends export failed: ${err.message}`);
        } finally {
            setIsExporting(false);
        }
    };


    const exportGif = async () => {
        if (!mapInstanceRef.current || !exportWrapperRef.current) return;
        setIsExporting(true);
        setExportProgress(0);
        setExportStatusText("Initializing GIF capture...");
        setIsPlaying(false);

        const mapEl = exportWrapperRef.current;
        const rect = mapEl.getBoundingClientRect();

        // Use devicePixelRatio to ensure retina screens render sharp text
        const dpr = window.devicePixelRatio || 2;
        const renderScale = dpr;

        // Target GIF size (scale up for retina, but cap at 1600px width)
        let captureWidth = Math.floor(rect.width * dpr);
        let captureHeight = Math.floor(rect.height * dpr);
        const maxGifWidth = 1600;

        if (captureWidth > maxGifWidth) {
            const ratio = maxGifWidth / captureWidth;
            captureWidth = maxGifWidth;
            captureHeight = Math.floor(captureHeight * ratio);
        }

        const gif = new GIF({
            workers: 2,
            quality: 2, // 1 is best, 10 is default. 2 gives excellent color accuracy for maps
            workerScript: gifWorkerUrl,
            width: captureWidth,
            height: captureHeight
        });

        // Ensure we are at hour 0
        setAnimHour(0);
        await new Promise(r => setTimeout(r, 400));

        // Disable map controls to prevent user interaction during capture
        mapInstanceRef.current.dragging.disable();
        mapInstanceRef.current.scrollWheelZoom.disable();
        if (mapInstanceRef.current.keyboard) mapInstanceRef.current.keyboard.disable();

        try {
            if (!exportWrapperRef.current) throw new Error("No map wrapper found for capture.");

            const modelPrefix = dataset === 'ifs' ? 'ECMWF' : dataset === 'aifs' ? 'ECMWF-AIFS' : dataset === 'aigefs' ? 'NOAA-AIGEFS' : dataset === 'large' ? 'GDM-FNV3-Large' : 'GDM-FNV3';
            let exportFilename = `${modelPrefix}-Ensemble-${new Date().toISOString().replace(/[:.]/g, '-')}.gif`;
            for (let h = 0; h <= maxAnimHour; h += 6) {
                setAnimHour(h);
                setExportStatusText(`Capturing animation frame at hour +${h}h...`);
                // Wait for React to apply state, useEffect to run, and Leaflet to render
                await new Promise(r => setTimeout(r, 200));

                setExportProgress((h / maxAnimHour) * 0.5); // First 50% is capturing

                const canvas = await html2canvas(mapEl, {
                    useCORS: true,
                    allowTaint: false,
                    scale: renderScale,
                    backgroundColor: "#0f172a",
                    logging: false,
                    // Ignore Leaflet UI controls (zoom buttons, attributions)
                    ignoreElements: (node) => node.classList && node.classList.contains('leaflet-control-container')
                });

                if (canvas.width !== captureWidth || canvas.height !== captureHeight) {
                    // High-quality downsampling using Canvas 2D
                    const downscaledCanvas = document.createElement('canvas');
                    downscaledCanvas.width = captureWidth;
                    downscaledCanvas.height = captureHeight;
                    const ctx = downscaledCanvas.getContext('2d');
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = "high";
                    ctx.drawImage(canvas, 0, 0, captureWidth, captureHeight);
                    gif.addFrame(downscaledCanvas, { delay: 200 });
                } else {
                    gif.addFrame(canvas, { delay: 200 });
                }
            }

            gif.on('progress', p => {
                setExportProgress(0.5 + p * 0.5); // Second 50% is encoding
                setExportStatusText(`Encoding GIF animation (${Math.round(p * 100)}%)...`);
            });

            gif.on('finished', blob => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = exportFilename;
                a.click();
                URL.revokeObjectURL(url);

                setIsExporting(false);
                setExportProgress(0);

                // Re-enable controls
                mapInstanceRef.current.dragging.enable();
                mapInstanceRef.current.scrollWheelZoom.enable();
                if (mapInstanceRef.current.keyboard) mapInstanceRef.current.keyboard.enable();
            });

            gif.render();
        } catch (err) {
            console.error("GIF Export failed:", err);
            setIsExporting(false);
            setExportProgress(0);
            mapInstanceRef.current.dragging.enable();
            mapInstanceRef.current.scrollWheelZoom.enable();
            if (mapInstanceRef.current.keyboard) mapInstanceRef.current.keyboard.enable();
        }
    };

    const animationControlsNode = viewMode === "animation" && (
        <div className="animation-controls-card">
            <div className="flex justify-between items-center mb-3">
                <div className="flex flex-col">
                    <span className="text-sm font-bold text-cyan-400">Hour: +{animHour}</span>
                    <span className="text-[11px] text-slate-300 font-mono mt-0.5">
                        {runInitDate ? new Date(runInitDate.getTime() + animHour * 3600000).toISOString().replace('T', ' ').substring(0, 19) + ' UTC' : 'Loading...'}
                    </span>
                </div>
                <button
                    onClick={() => {
                        if (animHour >= maxAnimHour) setAnimHour(0);
                        setIsPlaying(!isPlaying);
                    }}
                    style={{
                        background: isPlaying ? "rgba(239, 68, 68, 0.2)" : "rgba(16, 185, 129, 0.2)",
                        border: `1px solid ${isPlaying ? "rgba(239, 68, 68, 0.5)" : "rgba(16, 185, 129, 0.5)"}`,
                        color: isPlaying ? "#fca5a5" : "#6ee7b7",
                        padding: "4px 12px",
                        borderRadius: "4px",
                        fontSize: "12px",
                        fontWeight: "bold",
                        cursor: "pointer",
                        transition: "all 0.2s"
                    }}
                >
                    {isPlaying ? "⏸ Pause" : (animHour >= maxAnimHour ? "🔄 Restart" : "▶ Play")}
                </button>
            </div>
            <input
                type="range"
                min="0"
                max={maxAnimHour}
                step="6"
                value={animHour}
                onChange={(e) => {
                    setAnimHour(parseInt(e.target.value));
                    if (isPlaying) setIsPlaying(false);
                }}
                style={{ width: "100%", accentColor: "#00d4ff", cursor: "pointer", marginBottom: "12px" }}
            />

            <button
                onClick={exportGif}
                disabled={isExporting}
                style={{
                    width: "100%",
                    background: isExporting ? "rgba(100, 116, 139, 0.5)" : "rgba(14, 165, 233, 0.2)",
                    border: `1px solid ${isExporting ? "rgba(100, 116, 139, 0.5)" : "rgba(14, 165, 233, 0.5)"}`,
                    color: isExporting ? "#cbd5e1" : "#7dd3fc",
                    padding: "8px",
                    borderRadius: "4px",
                    fontSize: "12px",
                    fontWeight: "bold",
                    cursor: isExporting ? "not-allowed" : "pointer",
                    transition: "all 0.2s",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px"
                }}
            >
                {isExporting ? (
                    <>
                        <div className="spinner" style={{ width: "12px", height: "12px", borderTopColor: "#fff" }} />
                        <span>Exporting... {Math.round(exportProgress * 100)}%</span>
                    </>
                ) : (
                    <>
                        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                        <span>Export as GIF</span>
                    </>
                )}
            </button>

            {isExporting && (
                <div style={{ marginTop: "8px", height: "4px", background: "rgba(0,0,0,0.5)", borderRadius: "2px", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${exportProgress * 100}%`, background: "#00d4ff", transition: "width 0.2s ease-out" }} />
                </div>
            )}
        </div>
    );

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
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <span className={`spaghetti-status-badge ${status === "ok" ? "status-ok" :
                            status === "loading" ? "status-loading" :
                                status === "none" ? "status-none" :
                                    status === "error" ? "status-error" :
                                        "status-none"
                            }`}>
                            {status === "ok" ? "Live" : status === "loading" ? "…" : status === "none" ? "Quiet" : status === "error" ? "Err" : "–"}
                        </span>
                        <button
                            className="desktop-sidebar-close-btn"
                            onClick={() => setDesktopSidebarOpen(false)}
                            title="Hide Sidebar"
                        >
                            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
                        </button>
                    </div>
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

            {/* Display Mode selector */}
            <div>
                <h2 className="spaghetti-section-title">
                    <svg className="spaghetti-section-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                    Display Mode
                </h2>
                <div className="segmented-control">
                    {[{ id: "tracker", label: "Tracker" },
                    { id: "animation", label: "Animation" },
                    { id: "filter", label: "Filter" },
                    { id: "trends", label: "Trends" }]
                        .map(opt => {
                            const isTrendsLocked = opt.id === "trends" && dataset !== "base" && dataset !== "large";
                            return (
                                <button
                                    key={opt.id}
                                    onClick={() => {
                                        if (isTrendsLocked) return;
                                        setViewMode(opt.id);
                                        setSelectedMeanPoint(null); // Clear active mean point detail cards
                                        if (opt.id === "animation" && !isPlaying && animHour === 0) setIsPlaying(true);
                                    }}
                                    className={`segment-btn ${viewMode === opt.id ? "active primary" : ""} ${isTrendsLocked ? "opacity-35 cursor-not-allowed" : ""}`}
                                    title={isTrendsLocked ? "Trends are only available for FNV3 Base and Large datasets" : ""}
                                    disabled={isTrendsLocked}
                                >
                                    <span className="segment-label">
                                        {opt.label} {isTrendsLocked && "🔒"}
                                    </span>
                                </button>
                            );
                        })}
                </div>
            </div>

            {/* Plot Style selector */}
            {viewMode !== "animation" && (
                <div>
                    <h2 className="spaghetti-section-title">
                        <svg className="spaghetti-section-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
                        Plot Style
                    </h2>
                    <div className="segmented-control">
                        <button
                            onClick={() => setShowPlotPoints(true)}
                            className={`segment-btn ${showPlotPoints ? "active primary" : ""}`}
                        >
                            <span className="segment-label">With Plot</span>
                        </button>
                        <button
                            onClick={() => setShowPlotPoints(false)}
                            className={`segment-btn ${!showPlotPoints ? "active primary" : ""}`}
                        >
                            <span className="segment-label">Line Only</span>
                        </button>
                    </div>
                </div>
            )}


            <EnsembleFilter
                isActive={viewMode === "filter"}
                isLocked={dataset !== "large"}
                tracks={allTracks}
                showPlotPoints={showPlotPoints}
                setShowPlotPoints={setShowPlotPoints}
                onFilterChange={(ids, stats) => {
                    setFilteredTrackIds(ids);
                    setFilterStats(stats);
                }}
            />

            {/* Animation Controls (Desktop) */}
            <div className="sidebar-animation-panel">
                {animationControlsNode}
            </div>
            {/* Dataset selector */}
            <div>
                <h2 className="spaghetti-section-title">
                    <svg className="spaghetti-section-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>
                    Dataset
                </h2>
                <div className="segmented-control">
                    {[{ id: "base", label: "FNV3 Base" },
                    { id: "large", label: "FNV3 Large" },
                    { id: "ifs", label: "ECMWF IFS" },
                    { id: "aifs", label: "ECMWF AIFS" },
                    { id: "aigefs", label: "AI-GEFS" }]
                        .map(opt => {
                            const isFilterLocked = viewMode === "filter" && opt.id !== "large";
                            const isTrendsLocked = viewMode === "trends" && opt.id !== "base" && opt.id !== "large";
                            const isLocked = isFilterLocked || isTrendsLocked;

                            let titleText = "";
                            if (isFilterLocked) {
                                titleText = "Only FNV3 Large dataset supports track filtering. Switch mode to Tracker to select other datasets.";
                            } else if (isTrendsLocked) {
                                titleText = "Trends are only available for FNV3 Base and Large datasets. Switch mode to Tracker to select other datasets.";
                            }

                            return (
                                <button
                                    key={opt.id}
                                    onClick={() => {
                                        if (!isLocked) {
                                            setDataset(opt.id);
                                        }
                                    }}
                                    className={`segment-btn ${dataset === opt.id ? "active" : ""} ${isLocked ? "opacity-30 cursor-not-allowed" : ""}`}
                                    title={titleText}
                                    disabled={isLocked}
                                >
                                    <span className="segment-label">
                                        {opt.label} {isLocked && "🔒"}
                                    </span>
                                </button>
                            );
                        })}
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
            {viewMode !== "filter" && disturbances.some(d => d.hasEnsembleMean) && (
                <div style={{ opacity: viewMode === "animation" ? 0.4 : 1, pointerEvents: viewMode === "animation" ? "none" : "auto", transition: "all 0.2s" }}>
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
            {viewMode !== "filter" && disturbances.length > 0 && (
                <div style={{ opacity: viewMode === "animation" ? 0.4 : 1, pointerEvents: viewMode === "animation" ? "none" : "auto", transition: "all 0.2s" }}>
                    <h2 className="spaghetti-section-title">
                        <svg className="spaghetti-section-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                        Systems ({disturbances.length})
                    </h2>
                    <div className="systems-list">
                        {(showAllSystems ? disturbances : disturbances.slice(0, 3)).map(d => (
                            <div
                                key={d.id}
                                onClick={() => {
                                    if (viewMode === "trends") {
                                        handleSelectTrendSystem(d);
                                    } else {
                                        setActiveDisturbanceId(activeDisturbanceId === d.id ? null : d.id);
                                    }
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
                                        <span className="system-peak-value" style={{ color: d.peakColor }}>{d.peakW > 0 ? `${d.peakW.toFixed(0)} km/h` : "N/A"}</span>
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
                                                    label.includes("≥ 185") ? 185 :
                                                        label.includes("118") ? 118 :
                                                            label.includes("89") ? 89 :
                                                                label.includes("62") ? 62 :
                                                                    label.includes("39–61") ? 39 : 10
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
                        {disturbances.length > 3 && (
                            <button
                                className="see-more-systems-btn"
                                onClick={() => setShowAllSystems(!showAllSystems)}
                            >
                                {showAllSystems ? "See Less" : `See More (${disturbances.length - 3} more)`}
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Export Panel for Trends View Mode */}
            {viewMode === "trends" && selectedTrendSystem && (
                <div style={{ marginTop: '16px' }} className="no-export">
                    <h2 className="spaghetti-section-title">
                        <svg className="spaghetti-section-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: '16px', height: '16px' }}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                        Export Forecast Image
                    </h2>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <button
                            onClick={() => exportTrendsScreenshot(false)}
                            disabled={isExporting}
                            className="trends-export-btn-std"
                        >
                            {isExporting ? (
                                <div className="spinner" style={{ width: '12px', height: '12px' }} />
                            ) : (
                                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ marginRight: '4px' }}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                            )}
                            Save Standard (105°E - 155°E)
                        </button>
                        <button
                            onClick={() => exportTrendsScreenshot(true)}
                            disabled={isExporting}
                            className="trends-export-btn-wide"
                        >
                            {isExporting ? (
                                <div className="spinner" style={{ width: '12px', height: '12px' }} />
                            ) : (
                                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ marginRight: '4px' }}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                            )}
                            Save Wide (105°E - 190°E)
                        </button>
                    </div>
                </div>
            )}

            {/* Global Intensity Legend */}
            <div className="spaghetti-legend">
                <div className="spaghetti-legend-title">Wind Intensity Scale (km/h)</div>
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
                    Powered by <strong className="spaghetti-footer-highlight">Philippine Typoon/Weather</strong><br />
                    Data: {dataset === "ifs" ? "ECMWF IFS Ensemble" : "GDM FNV3 Ensemble"}<br />
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
            <aside className={`spaghetti-sidebar-container ${sidebarOpen ? 'open' : ''} ${!desktopSidebarOpen ? 'desktop-collapsed' : ''}`}>
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
                {!desktopSidebarOpen && (
                    <button
                        className="desktop-sidebar-toggle-btn"
                        onClick={() => setDesktopSidebarOpen(true)}
                        title="Show Sidebar"
                    >
                        <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
                    </button>
                )}

                {/* Mobile top bar */}
                <div
                    className="mobile-topbar"
                    style={{
                        position: "fixed",
                        top: "56px",
                        left: 0,
                        right: 0,
                        width: "100%",
                        minHeight: "48px",
                        boxSizing: "border-box",
                        alignItems: "center",
                        gap: "0.75rem",
                        padding: "0.5rem 0.75rem",
                        background: "rgba(13, 24, 42, 0.95)",
                        backdropFilter: "blur(10px)",
                        WebkitBackdropFilter: "blur(10px)",
                        borderBottom: "2px solid #00d4ff",
                        zIndex: 99999
                    }}
                >
                    <button
                        onClick={() => setSidebarOpen(true)}
                        className="mobile-menu-btn"
                        style={{
                            padding: "0.5rem",
                            borderRadius: "8px",
                            backgroundColor: "rgba(30, 41, 59, 0.8)",
                            color: "#f8fafc",
                            border: "1px solid rgba(255, 255, 255, 0.1)",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center"
                        }}
                    >
                        <svg className="spaghetti-section-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: "14px", height: "14px" }}>
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                    </button>
                    <span
                        className="mobile-title"
                        style={{
                            fontSize: "0.75rem",
                            fontWeight: "600",
                            color: "#f8fafc",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis"
                        }}
                    >
                        {dataset === "ifs" ? "ECMWF IFS" : dataset === "aifs" ? "ECMWF AIFS" : dataset === "aigefs" ? "NOAA AI-GEFS" : "GDM FNV3"} · {horizon === "5day" ? "5-Day" : "15-Day"} Spaghetti
                    </span>
                </div>

                {/* Loading overlay on the map */}
                {status === "loading" && (
                    <div className="map-loading-overlay">
                        <div className="map-spinner" />
                        <span className="map-loading-text">{statusMsg}</span>
                    </div>
                )}

                <div ref={exportWrapperRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
                    <div ref={mapRef} className="map-container" style={{ width: '100%', height: '100%', minHeight: '400px' }} />

                    {/* Floating Ensemble Mean Details Card */}
                    {selectedMeanPoint && (
                        <div className="mean-details-card no-export">
                            <div className="mean-details-header">
                                <div>
                                    <h3 className="mean-details-title">
                                        {selectedMeanPoint.displayName}
                                    </h3>
                                    {runInitDate && (
                                        <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px' }}>
                                            Model Run: {runInitDate.toISOString().replace('T', ' ').substring(0, 16).replace(/-/g, '/')} UTC
                                            {` (${new Date(runInitDate.getTime() + 8 * 3600 * 1000).toISOString().replace('T', ' ').substring(11, 16)} PHT)`}
                                        </div>
                                    )}
                                </div>
                                <button
                                    className="mean-details-close-btn"
                                    onClick={() => {
                                        setSelectedMeanPoint(null);
                                        if (selectedMarkerRef.current && mapInstanceRef.current) {
                                            mapInstanceRef.current.removeLayer(selectedMarkerRef.current);
                                            selectedMarkerRef.current = null;
                                        }
                                        if (selectedBadgeRef.current && mapInstanceRef.current) {
                                            mapInstanceRef.current.removeLayer(selectedBadgeRef.current);
                                            selectedBadgeRef.current = null;
                                        }
                                    }}
                                    title="Close details"
                                >
                                    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                            </div>

                            {/* Chronological Table of Adjacent Track Points */}
                            {(() => {
                                const meanTrackObj = disturbances.find(m => m.id === selectedMeanPoint.distId);
                                if (!meanTrackObj) return null;

                                const pts = meanTrackObj.meanPoints || [];
                                const activeIndex = pts.findIndex(pt => pt.h === selectedMeanPoint.h);
                                if (activeIndex === -1) return null;

                                // Select up to 5 points centered around the activeIndex
                                let windowPts = [];
                                if (pts.length <= 5) {
                                    windowPts = [...pts];
                                } else {
                                    let start = activeIndex - 2;
                                    let end = activeIndex + 2;
                                    if (start < 0) {
                                        end -= start;
                                        start = 0;
                                    }
                                    if (end >= pts.length) {
                                        start -= (end - pts.length + 1);
                                        end = pts.length - 1;
                                    }
                                    start = Math.max(0, start);
                                    windowPts = pts.slice(start, end + 1);
                                }

                                // Reverse so newer/latest are at the top (descending by lead time)
                                const selectedPts = [...windowPts].reverse();

                                // Format date/time helper relative to runInitDate
                                const formatDateTime = (h) => {
                                    if (!runInitDate || isNaN(runInitDate.getTime())) return { date: "N/A", time: "N/A" };
                                    const d = new Date(runInitDate.getTime() + h * 3600000);
                                    const dateStr = d.toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "Asia/Manila" });
                                    const timeStr = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Manila" });
                                    return { date: dateStr, time: timeStr };
                                };

                                return (
                                    <div className="mean-details-table-wrap">
                                        <table className="mean-details-table">
                                            <thead>
                                                <tr>
                                                    <th>DATE <span className="sub-th">UTC+8</span></th>
                                                    <th>TIME</th>
                                                    <th>WIND <span className="sub-th">km/h</span></th>
                                                    <th>PRESSURE <span className="sub-th">hPa</span></th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {selectedPts.map(pt => {
                                                    const isActive = pt.h === selectedMeanPoint.h;
                                                    const { date, time } = formatDateTime(pt.h);
                                                    return (
                                                        <tr
                                                            key={pt.h}
                                                            className={isActive ? "active-row" : ""}
                                                            onClick={() => handleMeanPointClick(pt, selectedMeanPoint.distId, selectedMeanPoint.region)}
                                                            style={{ cursor: 'pointer' }}
                                                        >
                                                            <td>{date}</td>
                                                            <td>{time}</td>
                                                            <td style={{ color: windColor(pt.windKmh), fontWeight: 'bold' }}>
                                                                {pt.windKmh.toFixed(0)}
                                                            </td>
                                                            <td style={{ color: '#38bdf8' }}>
                                                                {isNaN(pt.p) ? '–' : pt.p.toFixed(0)}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                );
                            })()}

                            {/* Card Footer displaying agreement and zoom trigger */}
                            <div className="mean-details-footer">
                                {(() => {
                                    const pct = Math.round((selectedMeanPoint.activeMembers / selectedMeanPoint.totalMembers) * 100);
                                    const rating = pct >= 70 ? "HIGH" : pct >= 40 ? "MEDIUM" : "LOW";
                                    const ratingColor = pct >= 70 ? "#10b981" : pct >= 40 ? "#f59e0b" : "#ef4444";
                                    return (
                                        <div className="mean-details-chance-badge">
                                            <span className="badge-pill" style={{ backgroundColor: ratingColor }}>{rating}</span>
                                            <span className="badge-label">{pct}% member agreement</span>
                                        </div>
                                    );
                                })()}
                                <button
                                    className="mean-details-info-btn"
                                    onClick={() => {
                                        if (mapInstanceRef.current) {
                                            mapInstanceRef.current.flyTo([selectedMeanPoint.lat, selectedMeanPoint.lon], 6, { duration: 1 });
                                        }
                                    }}
                                    title="Center map on coordinates"
                                >
                                    Zoom &gt;
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Multi-Cycle Trends overlay panel */}
                    {viewMode === "trends" && (
                        <div className="trends-panel no-export">
                            {loadingTrends ? (
                                <div className="trends-loading-overlay">
                                    <div className="map-spinner" />
                                    <span className="map-loading-text">Loading multi-cycle trends...</span>
                                </div>
                            ) : selectedTrendSystem ? (
                                <>
                                    <div className="mean-details-header">
                                        <div>
                                            <h3 className="mean-details-title" style={{ fontSize: '14px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                {(() => {
                                                    const latestDetectedItem = [...selectedTrendSystem].find(item => item.disturbance !== null);
                                                    const latestDist = latestDetectedItem?.disturbance;
                                                    const totalEnsembleMembers = dataset === "large" ? 1000 : 50;
                                                    if (latestDist) {
                                                        let title = "";
                                                        if (latestDist.pairedTrackName) {
                                                            const isInvest = parseInt(latestDist.pairedTrackName) >= 90;
                                                            title = isInvest ? `Invest ${latestDist.pairedTrackName}` : `TC ${latestDist.pairedTrackName}`;
                                                        } else {
                                                            title = `Disturbance ${latestDist.id}`;
                                                        }
                                                        return (
                                                            <>
                                                                <span>{title}</span>
                                                                <span style={{ fontSize: '12px', fontWeight: 'normal', color: '#94a3b8' }}>
                                                                    ({latestDist.trackCount}/{totalEnsembleMembers})
                                                                </span>
                                                            </>
                                                        );
                                                    }
                                                    return "Selected Storm";
                                                })()}
                                            </h3>
                                            <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                                                Run-to-run forecast trends · Latest: {(() => {
                                                    const latestItem = selectedTrendSystem[0];
                                                    if (!latestItem) return "N/A";
                                                    const matchTime = latestItem.cycleTime.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):00/);
                                                    return matchTime ? `${matchTime[2]}/${matchTime[3]} ${matchTime[4]}Z` : latestItem.cycleTime;
                                                })()}
                                            </span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <button
                                                className="mean-details-close-btn no-export"
                                                onClick={() => exportTrendsScreenshot(false)}
                                                disabled={isExporting}
                                                title="Save Image (Standard 105°E-155°E)"
                                                style={{ padding: '4px', position: 'relative' }}
                                            >
                                                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                                <span style={{ position: 'absolute', fontSize: '7px', fontWeight: 'bold', bottom: '-2px', right: '-2px', backgroundColor: '#00d4ff', color: '#0f172a', padding: '0 2px', borderRadius: '3px', lineHeight: '1' }}>S</span>
                                            </button>
                                            <button
                                                className="mean-details-close-btn no-export"
                                                onClick={() => exportTrendsScreenshot(true)}
                                                disabled={isExporting}
                                                title="Save Image (Wide 105°E-190°E)"
                                                style={{ padding: '4px', position: 'relative' }}
                                            >
                                                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                                <span style={{ position: 'absolute', fontSize: '7px', fontWeight: 'bold', bottom: '-2px', right: '-2px', backgroundColor: '#f87171', color: '#0f172a', padding: '0 2px', borderRadius: '3px', lineHeight: '1' }}>W</span>
                                            </button>
                                            <button
                                                className="mean-details-close-btn"
                                                onClick={() => setIsTrendsCollapsed(!isTrendsCollapsed)}
                                                title={isTrendsCollapsed ? "Expand charts" : "Collapse charts"}
                                                style={{ padding: '4px' }}
                                            >
                                                {isTrendsCollapsed ? (
                                                    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                                ) : (
                                                    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                                                )}
                                            </button>
                                            <button
                                                className="mean-details-close-btn"
                                                onClick={() => {
                                                    setSelectedTrendSystem(null);
                                                    setActiveDisturbanceId(null);
                                                    setIsTrendsCollapsed(false);
                                                }}
                                                title="Close trends"
                                                style={{ padding: '4px' }}
                                            >
                                                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                            </button>
                                        </div>
                                    </div>

                                    {/* Color Legend for cycle tracks on the map */}
                                    <div style={{
                                        display: 'flex',
                                        flexWrap: 'wrap',
                                        gap: '12px',
                                        padding: '10px 14px',
                                        background: 'rgba(255, 255, 255, 0.03)',
                                        border: '1px solid rgba(255, 255, 255, 0.06)',
                                        borderRadius: '10px',
                                        fontSize: '11px',
                                        marginBottom: '6px'
                                    }}>
                                        {selectedTrendSystem.map((item, index) => {
                                            const cycleColors = ["#38bdf8", "#34d399", "#fbbf24", "#f87171"];
                                            const color = cycleColors[item.cycleIndex] || "#cbd5e1";
                                            let label = item.cycleTime;
                                            const matchTime = item.cycleTime.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):00/);
                                            if (matchTime) {
                                                const [_, yr, mo, dy, hr] = matchTime;
                                                label = `${mo}/${dy} ${hr}Z`;
                                            }
                                            return (
                                                <div key={item.cycleTime} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                                    <span style={{
                                                        width: '7px',
                                                        height: '7px',
                                                        borderRadius: '50%',
                                                        backgroundColor: color,
                                                        boxShadow: `0 0 4px ${color}`
                                                    }}></span>
                                                    <span style={{ color: item.disturbance ? '#f8fafc' : '#64748b', fontWeight: item.disturbance ? 600 : 400 }}>
                                                        {label} {item.disturbance ? `(${item.disturbance.trackCount}/${dataset === "large" ? 1000 : 50})` : "(N/A)"}
                                                        {index === 0 && <span style={{ color: '#38bdf8', fontSize: '9px', fontWeight: 'bold', marginLeft: '4px' }}>[CURRENT]</span>}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {!isTrendsCollapsed && (
                                        <>
                                            {/* Chart 1: Genesis Probability */}
                                            <div className="trend-chart-card">
                                                <h4 className="trend-chart-title">Genesis Probability</h4>
                                                <div style={{ width: '100%', height: '160px' }}>
                                                    <ResponsiveContainer width="100%" height="100%">
                                                        <LineChart data={chartData} margin={{ top: 10, right: 15, left: 0, bottom: 0 }}>
                                                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                                            <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} stroke="rgba(255,255,255,0.1)" />
                                                            <YAxis domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 10 }} stroke="rgba(255,255,255,0.1)" width={35} />
                                                            <ChartTooltip
                                                                content={({ active, payload }) => {
                                                                    if (active && payload && payload.length) {
                                                                        const data = payload[0].payload;
                                                                        return (
                                                                            <div style={{
                                                                                background: 'rgba(15, 23, 42, 0.95)',
                                                                                backdropFilter: 'blur(8px)',
                                                                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                                                                borderRadius: '8px',
                                                                                padding: '8px 12px',
                                                                                boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                                                                            }}>
                                                                                <div style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', marginBottom: '4px' }}>
                                                                                    {data.cycleTime}
                                                                                </div>
                                                                                {data.detected ? (
                                                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                                                        <div style={{ fontSize: '12px', fontWeight: 800, color: '#10b981' }}>
                                                                                            Genesis Prob: {data.probability}% ({data.memberCount}/{data.totalMembers} members)
                                                                                        </div>
                                                                                        {data.formationDateStr && (
                                                                                            <div style={{ color: '#fbbf24', fontSize: '11px', fontWeight: 600 }}>
                                                                                                Genesis Est: {data.formationDateStr}
                                                                                            </div>
                                                                                        )}
                                                                                    </div>
                                                                                ) : (
                                                                                    <div style={{ fontSize: '12px', color: '#ef4444', fontWeight: 600 }}>
                                                                                        System not detected
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        );
                                                                    }
                                                                    return null;
                                                                }}
                                                            />
                                                            <Line
                                                                type="monotone"
                                                                dataKey="probability"
                                                                stroke="#10b981"
                                                                strokeWidth={2.5}
                                                                dot={{ fill: '#10b981', r: 3 }}
                                                                activeDot={{ r: 5 }}
                                                            />
                                                        </LineChart>
                                                    </ResponsiveContainer>
                                                </div>
                                            </div>

                                            {/* Chart 2: Peak Wind Intensity (Spread) */}
                                            <div className="trend-chart-card">
                                                <h4 className="trend-chart-title">Peak Wind Intensity (Spread)</h4>
                                                <div style={{ width: '100%', height: '180px' }}>
                                                    <ResponsiveContainer width="100%" height="100%">
                                                        <AreaChart data={chartData} margin={{ top: 10, right: 15, left: 10, bottom: 0 }}>
                                                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                                            <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} stroke="rgba(255,255,255,0.1)" />
                                                            <YAxis
                                                                domain={['auto', 'auto']}
                                                                tick={{ fill: '#94a3b8', fontSize: 10 }}
                                                                stroke="rgba(255,255,255,0.1)"
                                                                unit=" km/h"
                                                                width={55}
                                                            />
                                                            <ChartTooltip
                                                                content={({ active, payload }) => {
                                                                    if (active && payload && payload.length) {
                                                                        const data = payload[0].payload;
                                                                        return (
                                                                            <div style={{
                                                                                background: 'rgba(15, 23, 42, 0.95)',
                                                                                backdropFilter: 'blur(8px)',
                                                                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                                                                borderRadius: '8px',
                                                                                padding: '8px 12px',
                                                                                boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                                                                            }}>
                                                                                <div style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', marginBottom: '4px' }}>
                                                                                    {data.cycleTime}
                                                                                </div>
                                                                                {data.detected ? (
                                                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}>
                                                                                        <div style={{ color: '#00d4ff', fontWeight: 700 }}>
                                                                                            Ensemble Mean: {data.computedMeanWind ? `${data.computedMeanWind.toFixed(0)} km/h` : 'N/A'}
                                                                                        </div>
                                                                                        {data.pairedWind && (
                                                                                            <div style={{ color: '#ffffff', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                                                <span style={{ width: '8px', height: '0px', borderTop: '2px dashed #ffffff', display: 'inline-block' }}></span>
                                                                                                Paired Track: {data.pairedWind.toFixed(0)} km/h
                                                                                            </div>
                                                                                        )}
                                                                                        <div style={{ color: '#94a3b8', fontSize: '11px' }}>
                                                                                            Median Peak: {data.medianWind ? `${data.medianWind.toFixed(0)} km/h` : 'N/A'}
                                                                                        </div>
                                                                                        <div style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '11px' }}>
                                                                                            Member Range: {data.minWind ? `${data.minWind.toFixed(0)} - ${data.maxWind.toFixed(0)} km/h` : 'N/A'}
                                                                                        </div>
                                                                                    </div>
                                                                                ) : (
                                                                                    <div style={{ fontSize: '12px', color: '#ef4444', fontWeight: 600 }}>
                                                                                        System not detected
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        );
                                                                    }
                                                                    return null;
                                                                }}
                                                            />
                                                            <Area
                                                                type="monotone"
                                                                dataKey="windRange"
                                                                stroke="none"
                                                                fill="rgba(0, 212, 255, 0.15)"
                                                            />
                                                            <Line
                                                                type="monotone"
                                                                dataKey="computedMeanWind"
                                                                stroke="#00d4ff"
                                                                name="Ensemble Mean"
                                                                strokeWidth={2.5}
                                                                dot={{ fill: '#00d4ff', r: 3 }}
                                                                activeDot={{ r: 5 }}
                                                            />
                                                            <Line
                                                                type="monotone"
                                                                dataKey="pairedWind"
                                                                stroke="#ffffff"
                                                                name="Paired Track"
                                                                strokeDasharray="4 4"
                                                                strokeWidth={1.5}
                                                                dot={{ fill: '#ffffff', r: 2 }}
                                                                activeDot={{ r: 4 }}
                                                            />
                                                        </AreaChart>
                                                    </ResponsiveContainer>
                                                </div>
                                            </div>

                                            {/* Export buttons at bottom of Trends Panel */}
                                            <div className="no-export" style={{
                                                display: 'flex',
                                                gap: '8px',
                                                marginTop: '4px',
                                                padding: '0 4px'
                                            }}>
                                                <button
                                                    onClick={() => exportTrendsScreenshot(false)}
                                                    disabled={isExporting}
                                                    className="trends-export-btn-std"
                                                >
                                                    {isExporting ? (
                                                        <div className="spinner" style={{ width: '10px', height: '10px' }} />
                                                    ) : (
                                                        <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ marginRight: '4px' }}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                                    )}
                                                    Save Standard (105°-155°E)
                                                </button>
                                                <button
                                                    onClick={() => exportTrendsScreenshot(true)}
                                                    disabled={isExporting}
                                                    className="trends-export-btn-wide"
                                                >
                                                    {isExporting ? (
                                                        <div className="spinner" style={{ width: '10px', height: '10px' }} />
                                                    ) : (
                                                        <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ marginRight: '4px' }}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                                    )}
                                                    Save Wide (105°-190°E)
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </>
                            ) : (
                                <div className="trends-empty-state">
                                    <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ marginBottom: '8px', opacity: 0.5, color: '#94a3b8' }}>
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                    </svg>
                                    <span>Select a system from the sidebar to view run-to-run trends</span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Screenshot Button */}
                    {(viewMode === "tracker" || viewMode === "filter") && (
                        <button
                            className="no-export"
                            onClick={exportScreenshot}
                            disabled={isExporting}
                            style={{
                                position: 'absolute',
                                bottom: '24px',
                                left: '24px',
                                zIndex: 1000,
                                backgroundColor: 'rgba(15, 23, 42, 0.85)',
                                backdropFilter: 'blur(4px)',
                                border: '1px solid rgba(0, 212, 255, 0.4)',
                                color: '#00d4ff',
                                padding: '10px',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                                transition: 'all 0.2s',
                            }}
                            title="Screenshot Map"
                        >
                            {isExporting ? (
                                <div className="map-spinner" style={{ width: '22px', height: '22px', borderWidth: '2px' }} />
                            ) : (
                                <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                            )}
                        </button>
                    )}

                    {/* GIF Watermark Overlay (Visible in Animation Mode) */}
                    {(viewMode === "animation" || (isExporting && viewMode !== "trends")) && (
                        <div className="gif-watermark">
                            <h3 className="gif-watermark-title">
                                {dataset === 'ifs' ? 'ECMWF IFS Ensemble Track' : dataset === 'aifs' ? 'ECMWF AIFS Ensemble Track' : dataset === 'aigefs' ? 'AI-GEFS Ensemble Track' : (dataset === 'large' ? 'Google Deepmind FNV3 1000 Ensemble Track' : 'Google Deepmind FNV3 50 Ensemble Track')}
                            </h3>
                            <div className="gif-watermark-row">
                                <strong>Init:</strong> {runInitDate ? runInitDate.toISOString().replace('T', ' ').substring(0, 19) + ' UTC' : 'Loading...'}
                            </div>
                            <div className="gif-watermark-valid">
                                <strong>Valid:</strong> {runInitDate ? new Date(runInitDate.getTime() + animHour * 3600000).toISOString().replace('T', ' ').substring(0, 19) + ' UTC' : 'Loading...'} <span style={{ color: '#38bdf8', marginLeft: '4px' }}>(+{animHour}h)</span>
                            </div>

                            <div className="gif-watermark-legend">
                                {WIND_LEGEND.map(({ label, color }, idx) => {
                                    const acronyms = ["STY", "TY", "STS", "TS", "TD", "LPA"];
                                    return (
                                        <div key={label} className="gif-watermark-legend-item">
                                            <div className="gif-watermark-legend-color" style={{ backgroundColor: color }} />
                                            <span>{acronyms[idx]}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Filter Stats Overlay (Visible in Filter Mode) */}
                    {viewMode === "filter" && dataset === "large" && filterStats && (
                        <div className="gif-watermark filter-watermark">
                            <h3 className="gif-watermark-title" style={{ color: '#d946ef' }}>
                                Filter Active
                            </h3>
                            <div className="gif-watermark-row" style={{ fontSize: '15px', marginBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                    <strong>Matched:</strong> <span style={{ color: '#00d4ff' }}>{filteredTrackIds ? filteredTrackIds.size : 0} / {allTracks.length}</span>
                                </div>
                                {allTracks.length > 0 && filteredTrackIds && (
                                    (() => {
                                        const pct = Math.round((filteredTrackIds.size / allTracks.length) * 100);
                                        const color = pct >= 70 ? '#10b981' : pct >= 40 ? '#f59e0b' : '#ef4444';
                                        const label = pct >= 70 ? 'HIGH' : pct >= 40 ? 'MEDIUM' : 'LOW';
                                        return (
                                            <div style={{ background: `${color}25`, border: `1px solid ${color}50`, color: color, padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold', marginLeft: '12px' }}>
                                                {pct}% {label}
                                            </div>
                                        );
                                    })()
                                )}
                            </div>
                            {filterStats.intensities && (
                                <div className="gif-watermark-valid" style={{ fontSize: '13px', marginTop: '6px' }}>
                                    <span style={{ color: '#94a3b8' }}>Intensity:</span> {filterStats.intensities}
                                </div>
                            )}
                            {filterStats.region && (
                                <div className="gif-watermark-valid" style={{ fontSize: '13px', marginTop: '4px' }}>
                                    <span style={{ color: '#94a3b8' }}>Landfall Region:</span> {filterStats.region}
                                </div>
                            )}
                            {filterStats.trajectory && (
                                <div className="gif-watermark-valid" style={{ fontSize: '13px', marginTop: '4px' }}>
                                    <span style={{ color: '#94a3b8' }}>Path:</span> {filterStats.trajectory}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Animation Controls (Mobile) */}
                <div className="map-animation-panel">
                    {animationControlsNode}
                </div>
            </main>

            {/* Fullscreen Exporting/Saving Loading UI */}
            {isExporting && (
                <div className="export-loading-overlay">
                    <div className="export-loading-card">
                        <div className="export-loading-spinner-container">
                            <div className="export-loading-spinner-outer"></div>
                            <div className="export-loading-spinner-inner"></div>
                            <div className="export-loading-icon">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                            </div>
                        </div>
                        <h3 className="export-loading-title">Exporting Trends</h3>
                        <p className="export-loading-status">{exportStatusText || "Generating image..."}</p>
                        {exportProgress > 0 && (
                            <div className="export-progress-container">
                                <div className="export-progress-bar-bg">
                                    <div className="export-progress-bar-fill" style={{ width: `${Math.round(exportProgress * 100)}%` }}></div>
                                </div>
                                <span className="export-progress-text">{Math.round(exportProgress * 100)}% Complete</span>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}