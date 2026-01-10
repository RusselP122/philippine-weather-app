import React, { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Polygon, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { CloudRain, Zap, AlertTriangle, Wind } from "lucide-react";

// Robustly handle API URL - fallback to known working endpoint patterns if needed
const ALERTS_URL = "https://data.garbinwx.cloud/api/cap-alerts.json";

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
  const heavy = new Set();
  const moderate = new Set();
  const expected = new Set();

  alerts.forEach((alert) => {
    const severityText = String(alert.subtype || "");
    const severity = severityText.toLowerCase();
    if (severity.includes("final")) {
      return;
    }
    const provinces = normalizeProvinces(alert.provinces);
    provinces.forEach((prov) => {
      const name = prov.province || prov.areaDesc;
      if (!name) return;
      const pType = String(prov.type || "").toLowerCase();

      if (pType === "expecting") {
        expected.add(name);
        return;
      }

      if (severity.includes("severe") || severity.includes("extreme")) {
        heavy.add(name);
      } else if (severity.includes("moderate")) {
        moderate.add(name);
      } else {
        if (!heavy.has(name) && !moderate.has(name)) {
          moderate.add(name);
        }
      }
    });
  });

  return {
    heavy: Array.from(heavy).sort(),
    moderate: Array.from(moderate).sort(),
    expected: Array.from(expected).sort(),
  };
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
      if (pType === "expecting" || /expected/i.test(msg)) {
        expected.add(name);
      } else {
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

  const activePolygons = mode === "rainfall" ? rainfallPolygons : thunderPolygons;
  const hasThunder = thunderAlerts.length > 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col">
      <div className="max-w-6xl mx-auto w-full px-6 py-12 md:px-8">
        <header className="mb-10 flex flex-col gap-6 rounded-2xl border border-slate-800/70 bg-slate-900/50 px-6 py-6 shadow-[0_20px_70px_-40px_rgba(234,179,8,0.5)] md:flex-row md:items-center md:justify-between">
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-300">
                <AlertTriangle className="h-5 w-5" />
              </span>

              <div>
                <p className="text-[10px] uppercase tracking-[0.35em] text-slate-500">Hazard Monitoring</p>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-50 md:text-3xl">
                  Rainfall & Thunderstorm
                </h1>
              </div>
            </div>
            <div>
              <p className="text-sm leading-relaxed text-slate-400">
                Real-time official advisory polygons from local hydrometeorological agencies.
              </p>
              <div className="mt-3 h-px w-28 bg-gradient-to-r from-amber-400/70 via-orange-300/60 to-transparent" />
            </div>
          </div>

          <div className="flex rounded-full border border-slate-700/80 bg-slate-900/40 p-1.5 shadow-inner shadow-slate-950">
            <button
              type="button"
              onClick={() => setMode("rainfall")}
              className={`flex items-center gap-2 rounded-full px-5 py-2 text-xs font-medium transition-all ${mode === "rainfall"
                ? "bg-slate-800 text-sky-400 shadow-sm shadow-slate-950 ring-1 ring-slate-700"
                : "text-slate-400 hover:text-slate-200"
                }`}
            >
              <CloudRain className="h-3.5 w-3.5" />
              <span>Rainfall</span>
            </button>
            <button
              type="button"
              onClick={() => setMode("thunderstorm")}
              className={`flex items-center gap-2 rounded-full px-5 py-2 text-xs font-medium transition-all ${mode === "thunderstorm"
                ? "bg-slate-800 text-amber-400 shadow-sm shadow-slate-950 ring-1 ring-slate-700"
                : "text-slate-400 hover:text-slate-200"
                }`}
            >
              <Zap className="h-3.5 w-3.5" />
              <span>Thunderstorm</span>
            </button>
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
            >
              {/* CartoDB Dark Matter - Free, cleaner dark theme */}
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
              />

              {activePolygons
                .filter((prov) => {
                  if (mode !== "rainfall") return true;
                  const areaType = String(prov.areaType || "").toLowerCase();
                  const levelKey =
                    areaType === "yellow" || areaType === "orange" || areaType === "red"
                      ? areaType
                      : prov.warningLevel;

                  if (!areaType && !levelKey) {
                    return true;
                  }

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
                      // Fallback for thunderstorm areas without explicit level
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
                          <p className="text-[10px] text-slate-600">
                            {prov.alert.headline ||
                              prov.alert.subtype ||
                              prov.alert.event}
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
              <h2 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                {mode === "rainfall" ? "Rainfall Summary" : "Thunderstorm Status"}
              </h2>
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
                  <span className="text-xs font-medium">Fetching active alerts...</span>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-red-300">
                  <AlertTriangle className="h-4 w-4 mt-0.5" />
                  <p className="text-xs">{error}</p>
                </div>
              )}

              {!loading && !error && mode === "rainfall" && (
                <div className="divide-y divide-slate-800/50">
                  <div className="pb-4">
                    <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-yellow-200">
                      <span className="h-1.5 w-1.5 rounded-full bg-yellow-400"></span>
                      Heaviest Rainfall
                    </p>
                    <p className="text-[11px] leading-relaxed text-slate-400 pl-3.5">
                      {formatList(rainfallSummary.heavy)}
                    </p>
                  </div>
                  <div className="py-4">
                    <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-sky-200">
                      <span className="h-1.5 w-1.5 rounded-full bg-sky-400"></span>
                      Light-Moderate Rain
                    </p>
                    <p className="text-[11px] leading-relaxed text-slate-400 pl-3.5">
                      {formatList(rainfallSummary.moderate)}
                    </p>
                  </div>
                  <div className="pt-4">
                    <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-slate-500"></span>
                      Expecting Rain
                    </p>
                    <p className="text-[11px] leading-relaxed text-slate-400 pl-3.5">
                      {formatList(rainfallSummary.expected)}
                    </p>
                  </div>
                </div>
              )}

              {!loading && !error && mode === "thunderstorm" && (
                <div className="divide-y divide-slate-800/50">
                  {hasThunder ? (
                    <>
                      <div className="pb-4">
                        <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-amber-200">
                          <Zap className="h-3 w-3 text-amber-400" />
                          Currently Affecting
                        </p>
                        <p className="text-[11px] leading-relaxed text-slate-400 pl-3.5">
                          {formatList(thunderSummary.affecting)}
                        </p>
                      </div>
                      <div className="pt-4">
                        <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-amber-200">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-400"></span>
                          Thunderstorms Expected
                        </p>
                        <p className="text-[11px] leading-relaxed text-slate-400 pl-3.5">
                          {formatList(thunderSummary.expected)}
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <div className="mb-3 rounded-full bg-slate-800/50 p-3">
                        <Zap className="h-5 w-5 text-slate-600" />
                      </div>
                      <p className="text-xs font-medium text-slate-400">No Active Thunderstorms</p>
                      <p className="text-[10px] text-slate-600 mt-1">None of the monitored areas are currently under advisory.</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="mt-8 rounded-xl bg-slate-900/40 p-3 text-[10px] text-slate-500 border border-slate-800/50">
              <p>
                <strong>Note:</strong> Polygons are approximate representations of covered areas.
                Always rely on official text advisories from PAGASA and your local DRRMO for critical decision making.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default Alert;
