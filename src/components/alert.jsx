import React, { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Polygon, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { CloudRain, Zap, AlertTriangle, Wind } from "lucide-react";

// Robustly handle API URL - fallback to known working endpoint patterns if needed
const ALERTS_URL = "/api/cap-alerts";

const PH_BOUNDS = [
  [4, 116],
  [22.5, 127.5],
];

const ADVISORY_AFFECTING_COLOR = "#2e86c1";
const ADVISORY_AFFECTING_EDGE = "#1b4f72";
const ADVISORY_EXPECTING_COLOR = "#85c1e9";
const ADVISORY_EXPECTING_EDGE = "#2e86c1";

const THUNDER_AFFECTING_COLOR = "#d35400";
const THUNDER_AFFECTING_EDGE = "#a04000";
const THUNDER_EXPECTING_COLOR = "#f39c12";
const THUNDER_EXPECTING_EDGE = "#d68910";

const WARNING_LEVEL_COLORS = {
  yellow: { fill: "#f9e79f", edge: "#d4ac0d" },
  orange: { fill: "#f5b041", edge: "#cc8400" },
  red: { fill: "#cb4335", edge: "#922b21" },
};


function parseWarningLevel(text) {
  const t = String(text || "").toLowerCase();
  if (t.includes("red")) return "red";
  if (t.includes("orange")) return "orange";
  if (t.includes("yellow")) return "yellow";
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
    if (!Array.isArray(raw)) return null;

    // Helper to standardise to [Lat, Lng]
    // Heuristic: PH Lat is approx 4-22, Lon is 116-127.
    // If val1 > 50, it's likely Lon. If val1 < 50, it's Likely Lat.
    const toLatLng = (pair) => {
      if (!Array.isArray(pair) || pair.length < 2) return null;
      const [v1, v2] = pair;
      if (typeof v1 !== "number" || typeof v2 !== "number") return null;

      // If first value looks like longitude (>90), swap distinctively.
      // Otherwise assume it is [Lat, Lon] or already correct?
      // Actually standard GeoJSON is [Lon, Lat].
      // Leaflet wants [Lat, Lon].

      // Case A: [125.4, 12.2] -> v1 is Lon, v2 is Lat -> Return [12.2, 125.4]
      if (v1 > 50 && v2 < 50) return [v2, v1];

      // Case B: [12.2, 125.4] -> v1 is Lat, v2 is Lon -> Return [12.2, 125.4]
      if (v1 < 50 && v2 > 50) return [v1, v2];

      // Fallback/Ambiguous (e.g. 0,0), just return as is (Lat first usually for Leaflet logic if unclear, but usually [Lat,Lon])
      return [v1, v2];
    };

    const convertRing = (ring) =>
      ring
        .map(toLatLng)
        .filter((p) => p !== null);

    if (
      raw.length &&
      Array.isArray(raw[0]) &&
      raw[0].length &&
      typeof raw[0][0] === "number"
    ) {
      // Single ring: [[1,2],[3,4]]
      return [convertRing(raw)];
    }

    if (
      raw.length &&
      Array.isArray(raw[0]) &&
      raw[0].length &&
      Array.isArray(raw[0][0])
    ) {
      if (typeof raw[0][0][0] === "number") {
        // Array of rings (Polygon): [[[1,2],[3,4]], [[5,6]]]
        // Wait, standard geojson polygon is array of rings.
        // If raw[0][0] is a number, then raw[0] is a ring.
        // So raw is [Ring1, Ring2]
        return raw.map(convertRing);
      }

      // MultiPolygon deep nesting?
      // If raw[0][0] is Array, then raw[0] is a Polygon (Array of Rings)
      // raw is [Polygon1, Polygon2]
      const rings = [];
      raw.forEach((poly) => {
        if (!Array.isArray(poly)) return;
        // check if poly[0] is ring or point?
        // If poly is array of rings
        poly.forEach(ring => {
          if (Array.isArray(ring)) {
            const r = convertRing(ring);
            if (r.length) rings.push(r);
          }
        })
      });
      return rings.length ? rings : null;
    }

    return null;
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

function collectProvincePolygons(alerts) {
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

      const areaType = String(prov.type || "").toLowerCase();
      let warningLevel = null;
      if (areaType === "yellow" || areaType === "orange" || areaType === "red") {
        warningLevel = areaType;
      } else {
        const levelText = `${prov.headline || ""} ${prov.description || ""} ${alert.headline || ""
          } ${alert.description || ""} ${alert.subtype || ""}`;
        warningLevel = parseWarningLevel(levelText);
      }

      results.push({
        id: `${alert.identifier || alert.headline || "alert"}-${name}-${index}`,
        name,
        latlngs,
        alert,
        provinceMeta: prov,
        areaType,
        warningLevel,
      });
    });
  });
  return results;
}

function buildRainfallSummary(alerts) {
  // Structure: { red: { "Cebu": Set("Bogo", "San Remigio") }, ... }
  const categories = {
    red: {},
    orange: {},
    yellow: {},
    severe: {},
    moderate: {},
    expected: {},
  };

  const addToCategory = (cat, province, municipality) => {
    // If no province name, try to use municipality as main, or skip?
    // Using a fallback "Unspecified Area" if absolutely nothing
    const provKey = province || "General Area";

    if (!categories[cat][provKey]) {
      categories[cat][provKey] = new Set();
    }

    // Only add municipality if it exists and is different from province/generic
    if (municipality && municipality !== province) {
      categories[cat][provKey].add(municipality);
    }
  };

  alerts.forEach((alert) => {
    const severityText = String(alert.subtype || "");
    let severity = severityText.toLowerCase();

    // Sometimes severity is in the type or note, but we stick to existing logic
    if (severity.includes("final")) {
      return;
    }

    const provinces = normalizeProvinces(alert.provinces);
    provinces.forEach((prov) => {
      // Extract province and potential municipality
      // Fallback: existing code used 'prov.province || prov.areaDesc'
      // We prioritize exact 'province' field for grouping.
      const provinceName = prov.province || prov.areaDesc || "Unknown Province";
      const municipalityName = prov.municipality || "";

      const pType = String(prov.type || "").toLowerCase();

      if (pType === "expecting") {
        addToCategory("expected", provinceName, municipalityName);
        return;
      }

      // Explicitly check for color-coded warning levels
      if (pType === "red") {
        addToCategory("red", provinceName, municipalityName);
        return;
      }
      if (pType === "orange") {
        addToCategory("orange", provinceName, municipalityName);
        return;
      }
      if (pType === "yellow") {
        addToCategory("yellow", provinceName, municipalityName);
        return;
      }

      // Semantic checks if color is missing
      if (severity.includes("severe") || severity.includes("extreme")) {
        addToCategory("severe", provinceName, municipalityName);
      } else if (severity.includes("moderate")) {
        addToCategory("moderate", provinceName, municipalityName);
      } else {
        // Default to moderate if not caught elsewhere? 
        // Logic from before: "if not heavy and not moderate -> moderate"
        // We'll check if it exists in heavy categories first? 
        // Existing logic was simple else -> moderate.
        // We will just simplify: if unknown severity but active -> moderate
        addToCategory("moderate", provinceName, municipalityName);
      }
    });
  });

  return categories;
}

function buildThunderstormSummary(alerts) {
  const affecting = new Set();
  const expected = new Set();

  alerts.forEach((alert) => {
    const provinces = normalizeProvinces(alert.provinces);
    const msg = String(alert.message || "");
    provinces.forEach((prov) => {
      const name = prov.province || prov.areaDesc;
      if (!name) return;
      const pType = String(prov.type || "").toLowerCase();
      const headline = String(alert.headline || "").toLowerCase();
      const subtype = String(alert.subtype || "").toLowerCase();

      // Prioritize explicit type from API
      if (pType === "expecting") {
        expected.add(name);
        return;
      }
      if (pType === "affecting") {
        affecting.add(name);
        return;
      }

      // Check Headline/Subtype keywords
      if (headline.includes("watch") || subtype.includes("watch")) {
        expected.add(name);
        return;
      }
      if (headline.includes("advisory") || subtype.includes("advisory")) {
        affecting.add(name);
        return;
      }

      // Dangerous fallback: "expected" is common in "expected to persist" (Affecting)
      // Only use if we really have no other signal.
      if (/expected to develop/i.test(msg) || /estimated to arrive/i.test(msg)) {
        expected.add(name);
      } else {
        // Default to affecting for Thunderstorms if active and not explicitly a Watch
        affecting.add(name);
      }
    });
  });

  return {
    affecting: Array.from(affecting).sort(),
    expected: Array.from(expected).sort(),
  };
}

function formatList(items) {
  if (!items || !items.length) return "None indicated.";
  return items.join(", ");
}

function renderAlertList(categoryData) {
  if (!categoryData) return null;
  const provinces = Object.keys(categoryData).sort();
  if (provinces.length === 0) return null;

  return (
    <div className="pl-4 text-[11px] text-slate-400 leading-relaxed">
      {provinces.map((prov) => {
        const municipalities = Array.from(categoryData[prov]).sort();
        return (
          <div key={prov} className="mb-2 last:mb-0">
            <span className="font-medium text-slate-300 block">{prov}</span>
            {municipalities.length > 0 && (
              <p className="pl-3 mt-0.5 text-slate-500 border-l border-slate-700/50">
                {municipalities.join(", ")}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

const Alert = () => {
  const [mode, setMode] = useState("rainfall");
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let intervalId;

    async function fetchAlerts() {
      try {
        setLoading(true);
        setError(null);
        // Add robust cache busting and ensure valid URL
        const cacheBust = `t=${Date.now()}`;
        const url = ALERTS_URL.includes("?")
          ? `${ALERTS_URL}&${cacheBust}`
          : `${ALERTS_URL}?${cacheBust}`;

        const resp = await fetch(url);
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const json = await resp.json();
        if (cancelled) return;

        // Safety check for data structure
        const data =
          json && json.data && Array.isArray(json.data.alert_data)
            ? json.data.alert_data
            : [];

        const filtered = data.filter((a) => {
          if (!a) return false;

          const event = String(a.event || "").toUpperCase();
          const type = String(a.type || "").toUpperCase();
          const headline = String(a.headline || "");

          const eventLower = String(a.event || "").toLowerCase();
          const subtypeLower = String(a.subtype || "").toLowerCase();
          const messageLower = String(a.message || "").toLowerCase();
          const headlineLower = headline.toLowerCase();

          // User requested exclusions
          if (headlineLower.includes("general flood advisory") || subtypeLower.includes("general flood advisory") || eventLower.includes("general flood advisory")) {
            return false;
          }
          if (headlineLower.includes("thunderstorm information") || subtypeLower.includes("thunderstorm information") || eventLower.includes("thunderstorm information")) {
            return false;
          }
          if (headlineLower.includes("thunderstorm watch") || subtypeLower.includes("thunderstorm watch") || eventLower.includes("thunderstorm watch")) {
            return false;
          }

          // EXCLUDE Tropical Cyclone / Signals (Handled in Warning.jsx)
          if (
            headlineLower.includes("tropical cyclone") ||
            eventLower.includes("tropical cyclone") ||
            subtypeLower.includes("tropical cyclone") ||
            headlineLower.includes("signal no.") ||
            messageLower.includes("signal no.") ||
            headlineLower.includes("tcws")
          ) {
            return false;
          }

          const isRainAdvisory = event === "RAINFALL";

          const isRainWarning =
            (headlineLower.includes("rainfall") && headlineLower.includes("warning")) ||
            (subtypeLower.includes("rainfall") && subtypeLower.includes("warning")) ||
            (eventLower.includes("rainfall") && eventLower.includes("warning"));

          const isFloodRelated =
            event === "FLOOD" ||
            subtypeLower.includes("flood") ||
            headlineLower.includes("flood") ||
            messageLower.includes("flood") ||
            messageLower.includes("rain");

          const isRainHazard = isRainAdvisory || isRainWarning || isFloodRelated;

          const isThunderstorm =
            event === "THUNDERSTORM" || type === "THUNDERSTORM";

          return isRainHazard || isThunderstorm;
        });

        const now = new Date();
        // User requested strict 3-hour window
        const cutoffMs = 3 * 60 * 60 * 1000;

        const recent = filtered.filter((a) => {
          // Respect explicit expiration if present
          if (a.expires) {
            const expires = parseAlertDate(a.expires);
            if (expires && expires.getTime() <= now.getTime()) {
              return false;
            }
          }

          const issued = parseAlertDate(a.issued_date);
          if (!issued) return false;
          const diff = now.getTime() - issued.getTime();
          // Allow alerts up to 24h old, discard future dated > 5min (clock skew)
          return diff >= -300000 && diff <= cutoffMs;
        });

        recent.sort((a, b) => {
          const da = parseAlertDate(a.issued_date);
          const db = parseAlertDate(b.issued_date);
          if (!da && !db) return 0;
          if (!da) return 1;
          if (!db) return -1;
          return db.getTime() - da.getTime();
        });

        setAlerts(recent);
        setLastUpdated(new Date());
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to fetch alerts:", err);
          setError("Unable to load latest alerts right now.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchAlerts();
    intervalId = window.setInterval(fetchAlerts, 60 * 1000); // Poll every minute

    return () => {
      cancelled = true;
      if (intervalId) {
        window.clearInterval(intervalId);
      }
    };
  }, []);

  const rainfallAlerts = useMemo(
    () =>
      alerts.filter((a) => {
        const event = String(a.event || "").toUpperCase();
        const subtypeLower = String(a.subtype || "").toLowerCase();
        const message = String(a.message || "");

        if (subtypeLower.includes("final")) {
          return false;
        }

        // Explicitly exclude Thunderstorm events from Rainfall view to prevent overlap
        if (event === "THUNDERSTORM" || a.type === "THUNDERSTORM") {
          return false;
        }

        return (
          event === "RAINFALL" ||
          event === "FLOOD" ||
          subtypeLower.includes("flood") ||
          /rain/i.test(message)
        );
      }),
    [alerts]
  );

  const thunderAlerts = useMemo(
    () =>
      alerts.filter((a) => {
        const e = String(a.event || "").toUpperCase();
        const t = String(a.type || "").toUpperCase();
        const subtypeLower = String(a.subtype || "").toLowerCase();

        if (subtypeLower.includes("final")) {
          return false;
        }

        return e === "THUNDERSTORM" || t === "THUNDERSTORM";
      }),
    [alerts]
  );

  const rainfallPolygons = useMemo(
    () => collectProvincePolygons(rainfallAlerts),
    [rainfallAlerts]
  );

  const thunderPolygons = useMemo(
    () => collectProvincePolygons(thunderAlerts),
    [thunderAlerts]
  );

  const rainfallSummary = useMemo(
    () => buildRainfallSummary(rainfallAlerts),
    [rainfallAlerts]
  );
  const thunderSummary = useMemo(
    () => buildThunderstormSummary(thunderAlerts),
    [thunderAlerts]
  );


  // Extract dynamic weather system name from active alerts
  const getCurrentWeatherSystem = (alertList) => {
    if (mode === "thunderstorm") return "Localized Thunderstorms";
    if (!alertList || alertList.length === 0) return "No Active Weather System";

    // Attempt to extract the primary weather system directly from the API property
    const firstAlert = alertList[0];
    if (firstAlert.weather_systems) {
      if (Array.isArray(firstAlert.weather_systems)) {
        // Many alerts provide this as an array (e.g., ["Southwest Monsoon", "LPA"])
        return firstAlert.weather_systems.join(" / ");
      }
      return firstAlert.weather_systems;
    }

    // Fallback if the PAGASA payload omitted it for this specific warning
    return "Waiting to Fix";
  };

  const dynamicWeatherSystem = mode === "rainfall" ? getCurrentWeatherSystem(rainfallAlerts) : getCurrentWeatherSystem(thunderAlerts);

  const activePolygons = mode === "rainfall" ? rainfallPolygons : thunderPolygons;

  const hasThunder = thunderAlerts.length > 0;

  return (
    <div className="bg-slate-950 text-slate-200 font-sans min-h-screen relative overflow-x-hidden p-4 md:p-8 flex justify-center items-start">
      <style>{`
        .bg-grid-pattern {
            background-image: linear-gradient(to right, rgba(255,255,255,0.02) 1px, transparent 1px),
                              linear-gradient(to bottom, rgba(255,255,255,0.02) 1px, transparent 1px);
            background-size: 40px 40px;
        }
        @keyframes flash {
            0%, 50%, 100% { opacity: 1; }
            25%, 75% { opacity: 0.4; }
        }
        .animate-flash {
            animation: flash 2s infinite;
        }
      `}</style>

      <div className="absolute inset-0 bg-grid-pattern pointer-events-none z-0"></div>

      <div className="relative z-10 max-w-7xl w-full flex flex-col gap-8">

        {/* Unified Header */}
        <header className="bg-slate-900/60 backdrop-blur-md border border-slate-800 rounded-3xl p-6 md:p-8 shadow-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="flex flex-col md:flex-row md:items-center gap-6 w-full md:w-auto">
            <div className="flex items-center gap-4">
              <div className="relative flex h-14 w-14 items-center justify-center">
                {mode === "rainfall" ? (
                  <>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-20"></span>
                    <div className="relative h-12 w-12 bg-slate-800 border-2 border-red-500 rounded-full flex items-center justify-center text-2xl">
                      🌧️
                    </div>
                  </>
                ) : (
                  <>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-30"></span>
                    <div className="relative h-12 w-12 bg-slate-800 border-2 border-amber-500 rounded-full flex items-center justify-center text-2xl shadow-[0_0_15px_rgba(245,158,11,0.6)]">
                      ⚡
                    </div>
                  </>
                )}
              </div>
              <div>
                <h1 className="text-3xl font-black text-white tracking-tight">
                  {mode === "rainfall" ? "Heavy Rainfall Warning" : "Thunderstorm Advisory"}
                </h1>
                <p className="text-slate-400 font-medium mt-1">
                  Weather System: {dynamicWeatherSystem}
                </p>
              </div>
            </div>

            {/* Toggle Buttons */}
            <div className="flex rounded-full border border-slate-700/80 bg-slate-900/80 p-1.5 shadow-inner shadow-slate-950 mt-4 md:mt-0 md:ml-4">
              <button
                type="button"
                onClick={() => setMode("rainfall")}
                className={`flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-xs font-bold transition-all ${mode === "rainfall"
                  ? "bg-slate-800 text-sky-400 shadow-md shadow-slate-950 ring-1 ring-slate-600"
                  : "text-slate-400 hover:text-slate-200"
                  }`}
              >
                <CloudRain className="h-4 w-4" />
                <span>Rainfall</span>
              </button>
              <button
                type="button"
                onClick={() => setMode("thunderstorm")}
                className={`flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-xs font-bold transition-all ${mode === "thunderstorm"
                  ? "bg-slate-800 text-amber-400 shadow-md shadow-slate-950 ring-1 ring-slate-600"
                  : "text-slate-400 hover:text-slate-200"
                  }`}
              >
                <Zap className="h-4 w-4" />
                <span>Thunderstorm</span>
              </button>
            </div>
          </div>

          <div className="bg-slate-950/80 border border-slate-700 p-3 rounded-xl text-right min-w-[200px]">
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">Issued At</p>
            <p className="text-sm font-bold text-slate-200">
              {lastUpdated ? lastUpdated.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "---"}
            </p>
            <p className="text-sm text-slate-400">
              {lastUpdated ? lastUpdated.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }) + " PST" : "---"}
            </p>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Column (Map & Legend) */}
          <div className="lg:col-span-7 flex flex-col gap-6">
            <div className="bg-slate-900/60 backdrop-blur-md border border-slate-800 rounded-3xl p-4 shadow-2xl relative group h-[500px]">
              <div className="absolute top-8 left-8 z-[1000] bg-slate-950/80 backdrop-blur-sm border border-slate-700 px-4 py-2 rounded-lg shadow-lg pointer-events-none">
                <h2 className="font-bold text-white flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${mode === 'rainfall' ? 'bg-blue-400' : 'bg-amber-400'} animate-pulse`}></span>
                  {mode === "rainfall" ? "Philippine  Satellite" : "Lightning & Storm Radar"}
                </h2>
              </div>

              <div className="w-full h-full rounded-2xl overflow-hidden relative border border-slate-700/50" style={{ isolation: "isolate" }}>
                <MapContainer
                  center={[12.8797, 121.774]}
                  zoom={6}
                  minZoom={4.5}
                  maxZoom={11}
                  scrollWheelZoom
                  zoomControl={false}
                  className="w-full h-full bg-[#0f172a]"
                  maxBounds={PH_BOUNDS}
                  maxBoundsViscosity={0.8}
                >
                  <TileLayer
                    url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                    attribution='&copy; OpenStreetMap contributors &copy; CARTO'
                  />
                  {activePolygons
                    .filter((prov) => {
                      if (mode !== "rainfall") return true;
                      const areaType = String(prov.areaType || "").toLowerCase();
                      const levelKey =
                        areaType === "yellow" || areaType === "orange" || areaType === "red"
                          ? areaType
                          : prov.warningLevel;
                      if (!areaType && !levelKey) return true;
                      return (
                        areaType === "affecting" ||
                        areaType === "expecting" ||
                        (levelKey && WARNING_LEVEL_COLORS[levelKey])
                      );
                    })
                    .map((prov) => {
                      let fillColor;
                      let borderColor;

                      const areaType = String(prov.areaType || "").toLowerCase();
                      const levelKey =
                        areaType === "yellow" || areaType === "orange" || areaType === "red"
                          ? areaType
                          : prov.warningLevel;

                      if (mode === "rainfall") {
                        if (areaType === "affecting") {
                          fillColor = ADVISORY_AFFECTING_COLOR;
                          borderColor = ADVISORY_AFFECTING_EDGE;
                        } else if (areaType === "expecting") {
                          fillColor = ADVISORY_EXPECTING_COLOR;
                          borderColor = ADVISORY_EXPECTING_EDGE;
                        } else if (levelKey && WARNING_LEVEL_COLORS[levelKey]) {
                          fillColor = WARNING_LEVEL_COLORS[levelKey].fill;
                          borderColor = WARNING_LEVEL_COLORS[levelKey].edge;
                        } else {
                          fillColor = "rgba(56, 189, 248, 0.5)";
                          borderColor = "#38bdf8";
                        }
                      } else {
                        if (areaType === "affecting") {
                          fillColor = THUNDER_AFFECTING_COLOR;
                          borderColor = THUNDER_AFFECTING_EDGE;
                        } else if (areaType === "expecting") {
                          fillColor = THUNDER_EXPECTING_COLOR;
                          borderColor = THUNDER_EXPECTING_EDGE;
                        } else if (levelKey && WARNING_LEVEL_COLORS[levelKey]) {
                          fillColor = WARNING_LEVEL_COLORS[levelKey].fill;
                          borderColor = WARNING_LEVEL_COLORS[levelKey].edge;
                        } else {
                          fillColor = "rgba(251, 191, 36, 0.5)";
                          borderColor = "#fbbf24";
                        }
                      }

                      const baseStyle = {
                        weight: 1,
                        color: borderColor,
                        fillColor,
                        fillOpacity: 0.5,
                      };
                      const highlightStyle = {
                        ...baseStyle,
                        weight: 2,
                        fillOpacity: 0.7,
                      };

                      return (
                        <Polygon
                          key={`${prov.id}-${mode}`}
                          positions={prov.latlngs}
                          pathOptions={baseStyle}
                          eventHandlers={{
                            mouseover: (e) => e.target.setStyle(highlightStyle),
                            mouseout: (e) => e.target.setStyle(baseStyle),
                          }}
                        >
                          <Tooltip sticky className="custom-leaflet-tooltip">
                            <div className="text-xs">
                              <p className="font-semibold text-slate-800">{prov.name}</p>
                              <p className="text-[10px] text-slate-600">
                                {prov.alert.headline || prov.alert.subtype || prov.alert.event}
                              </p>
                            </div>
                          </Tooltip>
                        </Polygon>
                      );
                    })}
                </MapContainer>
                {mode === 'rainfall' ? (
                  <>
                    <div className="absolute top-1/3 left-1/2 w-32 h-32 bg-red-500/30 blur-2xl rounded-full pointer-events-none z-10"></div>
                    <div className="absolute top-1/2 left-1/3 w-40 h-24 bg-orange-500/20 blur-xl rounded-full pointer-events-none z-10"></div>
                    <div className="absolute bottom-1/3 right-1/3 w-48 h-32 bg-yellow-500/20 blur-xl rounded-full pointer-events-none z-10"></div>
                  </>
                ) : (
                  <>
                    <div className="absolute top-1/3 left-1/2 w-24 h-24 bg-amber-500/30 blur-xl rounded-full pointer-events-none z-10"></div>
                    <div className="absolute top-[35%] left-[52%] text-amber-400 text-lg drop-shadow-[0_0_5px_rgba(245,158,11,1)] animate-flash pointer-events-none z-10" style={{ animationDelay: '0s' }}>⚡</div>

                    <div className="absolute bottom-1/3 left-1/3 w-32 h-32 bg-amber-500/20 blur-xl rounded-full pointer-events-none z-10"></div>
                    <div className="absolute bottom-[35%] left-[36%] text-amber-400 text-lg drop-shadow-[0_0_5px_rgba(245,158,11,1)] animate-flash pointer-events-none z-10" style={{ animationDelay: '0.5s' }}>⚡</div>

                    <div className="absolute top-1/3 left-[60%] w-40 h-32 border border-dashed border-cyan-400/50 bg-cyan-500/10 rounded-full animate-pulse pointer-events-none z-10"></div>
                  </>
                )}
              </div>
            </div>

            {/* Legend Section */}
            {mode === "rainfall" ? (
              <div className="bg-slate-900/60 backdrop-blur-md border border-slate-800 rounded-3xl p-6 shadow-xl">
                <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">Warning Levels & Impacts</h3>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="flex flex-col items-center text-center gap-2">
                    <div className="w-full h-2 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]"></div>
                    <span className="text-xs font-bold text-slate-200 mt-1">RED</span>
                    <span className="text-[10px] text-slate-400 leading-tight">Serious Flooding<br />Expected</span>
                  </div>
                  <div className="flex flex-col items-center text-center gap-2">
                    <div className="w-full h-2 rounded-full bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.8)]"></div>
                    <span className="text-xs font-bold text-slate-200 mt-1">ORANGE</span>
                    <span className="text-[10px] text-slate-400 leading-tight">Flooding is<br />Threatening</span>
                  </div>
                  <div className="flex flex-col items-center text-center gap-2">
                    <div className="w-full h-2 rounded-full bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.8)]"></div>
                    <span className="text-xs font-bold text-slate-200 mt-1">YELLOW</span>
                    <span className="text-[10px] text-slate-400 leading-tight">Flooding is<br />Possible</span>
                  </div>
                  <div className="flex flex-col items-center text-center gap-2">
                    <div className="w-full h-2 rounded-full bg-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.8)]"></div>
                    <span className="text-xs font-bold text-slate-200 mt-1">LIGHT-MOD</span>
                    <span className="text-[10px] text-slate-400 leading-tight">Monitor Weather<br />Conditions</span>
                  </div>
                  <div className="flex flex-col items-center text-center gap-2">
                    <div className="w-full h-2 rounded-full bg-slate-500 border border-slate-400"></div>
                    <span className="text-xs font-bold text-slate-200 mt-1">EXPECTING</span>
                    <span className="text-[10px] text-slate-400 leading-tight">Rain Likely<br />Within 2 Hrs</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-slate-900/60 backdrop-blur-md border border-slate-800 rounded-3xl p-6 shadow-xl">
                <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">Advisory Status Guide</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="flex items-start gap-3 bg-slate-950/50 p-4 rounded-xl border border-slate-800">
                    <div className="mt-1 w-4 h-4 rounded-full bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.8)] flex-shrink-0 animate-pulse"></div>
                    <div>
                      <span className="text-sm font-black text-amber-400 tracking-wide">AFFECTING</span>
                      <p className="text-xs text-slate-400 mt-1 leading-relaxed">Moderate to heavy rain showers with lightning and strong winds are currently being experienced in this area.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 bg-slate-950/50 p-4 rounded-xl border border-slate-800">
                    <div className="mt-1 w-4 h-4 rounded-full bg-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.8)] border-2 border-cyan-300 flex-shrink-0"></div>
                    <div>
                      <span className="text-sm font-black text-cyan-400 tracking-wide">EXPECTING</span>
                      <p className="text-xs text-slate-400 mt-1 leading-relaxed">Thunderstorm conditions are likely to develop or move into this area within the next 1 to 2 hours.</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Column (Affected Areas / Summaries) */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
              {loading && <span className="w-4 h-4 border-2 border-sky-500 border-t-transparent rounded-full animate-spin"></span>}
              {!loading && (
                <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
              )}
              {mode === "rainfall" ? "Affected Areas" : "Locations Monitored"}
            </h3>

            {error && (
              <div className="flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-red-300">
                <AlertTriangle className="h-4 w-4 mt-0.5" />
                <p className="text-xs">{error}</p>
              </div>
            )}

            {!loading && !error && mode === "rainfall" && (
              <>
                {Object.keys(rainfallSummary.red).length > 0 && (
                  <div className="bg-red-950/20 backdrop-blur-sm border border-red-500/50 rounded-2xl p-5 shadow-[0_0_20px_rgba(239,68,68,0.1)] relative overflow-hidden group">
                    <div className="absolute top-0 left-0 w-1.5 h-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,1)]"></div>
                    <div className="flex items-center gap-3 mb-3 pl-3">
                      <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse"></div>
                      <h4 className="text-lg font-black text-red-400 tracking-wide uppercase">Red Warning</h4>
                    </div>
                    <p className="text-sm text-red-200/70 mb-4 pl-3">Take Action: Severe flooding expected in low-lying areas and near river channels.</p>
                    <div className="pl-3 flex flex-wrap gap-2">
                      {Object.keys(rainfallSummary.red).map((prov) => (
                        <span key={prov} className="px-3 py-1 bg-red-500/10 border border-red-500/30 text-red-300 text-sm font-semibold rounded-lg">
                          {prov} {rainfallSummary.red[prov].size > 0 ? `(${Array.from(rainfallSummary.red[prov]).join(", ")})` : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {Object.keys(rainfallSummary.orange).length > 0 && (
                  <div className="bg-orange-950/20 backdrop-blur-sm border border-orange-500/50 rounded-2xl p-5 shadow-[0_0_20px_rgba(249,115,22,0.05)] relative overflow-hidden mt-2">
                    <div className="absolute top-0 left-0 w-1.5 h-full bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.8)]"></div>
                    <div className="flex items-center gap-3 mb-3 pl-3">
                      <div className="w-3 h-3 rounded-full bg-orange-500"></div>
                      <h4 className="text-lg font-black text-orange-400 tracking-wide uppercase">Orange Warning</h4>
                    </div>
                    <p className="text-sm text-orange-200/70 mb-4 pl-3">Be Prepared: Flooding is threatening in low-lying areas.</p>
                    <div className="pl-3 flex flex-wrap gap-2">
                      {Object.keys(rainfallSummary.orange).map((prov) => (
                        <span key={prov} className="px-3 py-1 bg-orange-500/10 border border-orange-500/30 text-orange-300 text-sm font-semibold rounded-lg">
                          {prov} {rainfallSummary.orange[prov].size > 0 ? `(${Array.from(rainfallSummary.orange[prov]).join(", ")})` : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {Object.keys(rainfallSummary.yellow).length > 0 && (
                  <div className="bg-yellow-950/20 backdrop-blur-sm border border-yellow-500/40 rounded-2xl p-5 relative overflow-hidden mt-2">
                    <div className="absolute top-0 left-0 w-1.5 h-full bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.5)]"></div>
                    <div className="flex items-center gap-3 mb-3 pl-3">
                      <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                      <h4 className="text-lg font-black text-yellow-400 tracking-wide uppercase">Yellow Warning</h4>
                    </div>
                    <p className="text-sm text-yellow-200/70 mb-4 pl-3">Be Aware: Flooding is possible in low-lying areas.</p>
                    <div className="pl-3 flex flex-wrap gap-2">
                      {Object.keys(rainfallSummary.yellow).map((prov) => (
                        <span key={prov} className="px-3 py-1 bg-yellow-500/10 border border-yellow-500/30 text-yellow-300 text-sm font-semibold rounded-lg">
                          {prov} {rainfallSummary.yellow[prov].size > 0 ? `(${Array.from(rainfallSummary.yellow[prov]).join(", ")})` : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {(Object.keys(rainfallSummary.moderate).length > 0 || Object.keys(rainfallSummary.severe).length > 0) && (
                  <div className="bg-cyan-950/20 backdrop-blur-sm border border-cyan-500/30 rounded-2xl p-5 relative overflow-hidden mt-2">
                    <div className="absolute top-0 left-0 w-1.5 h-full bg-cyan-500"></div>
                    <div className="flex items-center gap-3 mb-3 pl-3">
                      <div className="w-3 h-3 rounded-full bg-cyan-500"></div>
                      <h4 className="text-lg font-black text-cyan-400 tracking-wide uppercase">Light-Moderate Rain</h4>
                    </div>
                    <div className="pl-3 flex flex-wrap gap-2">
                      {Object.keys(rainfallSummary.severe).map((prov) => (
                        <span key={`sev-${prov}`} className="px-3 py-1 bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-sm font-semibold rounded-lg">
                          {prov} {rainfallSummary.severe[prov].size > 0 ? `(${Array.from(rainfallSummary.severe[prov]).join(", ")})` : ""}
                        </span>
                      ))}
                      {Object.keys(rainfallSummary.moderate).map((prov) => (
                        <span key={`mod-${prov}`} className="px-3 py-1 bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-sm font-semibold rounded-lg">
                          {prov} {rainfallSummary.moderate[prov].size > 0 ? `(${Array.from(rainfallSummary.moderate[prov]).join(", ")})` : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {Object.keys(rainfallSummary.expected).length > 0 && (
                  <div className="bg-slate-900/40 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-5 relative overflow-hidden mt-2">
                    <div className="absolute top-0 left-0 w-1.5 h-full bg-slate-500"></div>
                    <div className="flex items-center gap-3 mb-3 pl-3">
                      <div className="w-3 h-3 rounded-full bg-slate-500"></div>
                      <h4 className="text-lg font-black text-slate-300 tracking-wide uppercase">Expecting</h4>
                    </div>
                    <p className="text-xs text-slate-500 mb-3 pl-3">Precipitation likely within 1-2 hours.</p>
                    <div className="pl-3 flex flex-wrap gap-2">
                      {Object.keys(rainfallSummary.expected).map((prov) => (
                        <span key={prov} className="px-3 py-1 bg-slate-800 border border-slate-700 text-slate-400 text-sm font-semibold rounded-lg">
                          {prov} {rainfallSummary.expected[prov].size > 0 ? `(${Array.from(rainfallSummary.expected[prov]).join(", ")})` : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {Object.keys(rainfallSummary.red).length === 0 && Object.keys(rainfallSummary.orange).length === 0 && Object.keys(rainfallSummary.yellow).length === 0 && Object.keys(rainfallSummary.moderate).length === 0 && Object.keys(rainfallSummary.severe).length === 0 && Object.keys(rainfallSummary.expected).length === 0 && (
                  <p className="text-slate-500 italic mt-4 pl-2">No active rainfall warnings at this time.</p>
                )}
              </>
            )}

            {!loading && !error && mode === "thunderstorm" && (
              <>
                {thunderSummary.affecting.length > 0 && (
                  <div className="bg-amber-950/20 backdrop-blur-sm border border-amber-500/50 rounded-2xl p-6 shadow-[0_0_20px_rgba(245,158,11,0.1)] relative overflow-hidden group">
                    <div className="absolute top-0 left-0 w-1.5 h-full bg-amber-500 shadow-[0_0_15px_rgba(245,158,11,1)]"></div>

                    <div className="flex justify-between items-start mb-4 pl-3">
                      <div className="flex items-center gap-3">
                        <div className="relative flex h-4 w-4">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-4 w-4 bg-amber-500"></span>
                        </div>
                        <h4 className="text-xl font-black text-amber-400 tracking-wide uppercase">Affecting</h4>
                      </div>
                      <span className="bg-red-500/20 text-red-400 text-[10px] font-bold px-2 py-1 rounded border border-red-500/30 uppercase tracking-widest animate-pulse">Live</span>
                    </div>

                    <p className="text-sm text-amber-200/70 mb-5 pl-3">
                      Heavy rain showers with lightning and strong winds are currently occurring.
                      <strong>Impact:</strong> Possible flash floods and landslides.
                    </p>

                    <div className="pl-3 flex flex-wrap gap-2.5">
                      {thunderSummary.affecting.map((loc) => (
                        <span key={loc} className="px-3 py-1.5 bg-amber-500/10 border border-amber-500/40 text-amber-300 text-sm font-semibold rounded-lg shadow-sm">{loc}</span>
                      ))}
                    </div>
                  </div>
                )}

                {thunderSummary.expected.length > 0 && (
                  <div className="bg-cyan-950/20 backdrop-blur-sm border border-cyan-500/40 rounded-2xl p-6 shadow-[0_0_20px_rgba(6,182,212,0.05)] relative overflow-hidden mt-2">
                    <div className="absolute top-0 left-0 w-1.5 h-full bg-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.5)]"></div>

                    <div className="flex justify-between items-start mb-4 pl-3">
                      <div className="flex items-center gap-3">
                        <div className="h-4 w-4 rounded-full bg-cyan-500 border-2 border-cyan-300"></div>
                        <h4 className="text-xl font-black text-cyan-400 tracking-wide uppercase">Expecting</h4>
                      </div>
                      <span className="bg-slate-800 text-slate-400 text-[10px] font-bold px-2 py-1 rounded border border-slate-700 uppercase tracking-widest">Within 2 Hrs</span>
                    </div>

                    <p className="text-sm text-cyan-200/70 mb-5 pl-3">
                      Conditions are favorable for thunderstorm development or nearby storms may drift into these areas shortly.
                    </p>

                    <div className="pl-3 flex flex-wrap gap-2.5">
                      {thunderSummary.expected.map((loc) => (
                        <span key={loc} className="px-3 py-1.5 bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-sm font-semibold rounded-lg">{loc}</span>
                      ))}
                    </div>
                  </div>
                )}

                {thunderSummary.affecting.length === 0 && thunderSummary.expected.length === 0 && (
                  <p className="text-slate-500 italic mt-4 pl-2">No active thunderstorm advisories at this time.</p>
                )}
              </>
            )}

            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 mt-auto flex items-start gap-4">
              <div className="text-slate-400 text-2xl mt-1">⚠️</div>
              <div>
                <h5 className="text-slate-200 font-bold text-sm mb-1">Public Safety Precaution</h5>
                <p className="text-xs text-slate-500 leading-relaxed">
                  All are advised to take precautionary measures against the impacts associated with these hazards which include flash floods and landslides. Keep monitoring for updates.
                </p>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );

};

export default Alert;
