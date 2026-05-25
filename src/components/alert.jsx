import React, { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Polygon, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { CloudRain, Zap, AlertTriangle, Wind, Info, MapPin, Maximize2, Search, X, ChevronRight, CheckCircle2, ChevronDown } from "lucide-react";

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

    const toLatLng = (pair) => {
      if (!Array.isArray(pair) || pair.length < 2) return null;
      const [v1, v2] = pair;
      if (typeof v1 !== "number" || typeof v2 !== "number") return null;

      if (v1 > 50 && v2 < 50) return [v2, v1];
      if (v1 < 50 && v2 > 50) return [v1, v2];
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
      return [convertRing(raw)];
    }

    if (
      raw.length &&
      Array.isArray(raw[0]) &&
      raw[0].length &&
      Array.isArray(raw[0][0])
    ) {
      if (typeof raw[0][0][0] === "number") {
        return raw.map(convertRing);
      }

      const rings = [];
      raw.forEach((poly) => {
        if (!Array.isArray(poly)) return;
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
  const categories = {
    red: {},
    orange: {},
    yellow: {},
    severe: {},
    moderate: {},
    expected: {},
  };

  const addToCategory = (cat, province, municipality) => {
    const provKey = province || "General Area";
    if (!categories[cat][provKey]) {
      categories[cat][provKey] = new Set();
    }
    if (municipality && municipality !== province) {
      categories[cat][provKey].add(municipality);
    }
  };

  alerts.forEach((alert) => {
    const severityText = String(alert.subtype || "");
    let severity = severityText.toLowerCase();

    if (severity.includes("final")) {
      return;
    }

    const provinces = normalizeProvinces(alert.provinces);
    provinces.forEach((prov) => {
      const provinceName = prov.province || prov.areaDesc || "Unknown Province";
      const municipalityName = prov.municipality || "";
      const pType = String(prov.type || "").toLowerCase();

      if (pType === "expecting") {
        addToCategory("expected", provinceName, municipalityName);
        return;
      }

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

      if (severity.includes("severe") || severity.includes("extreme")) {
        addToCategory("severe", provinceName, municipalityName);
      } else if (severity.includes("moderate")) {
        addToCategory("moderate", provinceName, municipalityName);
      } else {
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

      if (pType === "expecting") {
        expected.add(name);
        return;
      }
      if (pType === "affecting") {
        affecting.add(name);
        return;
      }

      if (headline.includes("watch") || subtype.includes("watch")) {
        expected.add(name);
        return;
      }
      if (headline.includes("advisory") || subtype.includes("advisory")) {
        affecting.add(name);
        return;
      }

      if (/expected to develop/i.test(msg) || /estimated to arrive/i.test(msg)) {
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

// React Leaflet subcomponent to dynamically control map viewport
function MapBoundsController({ activePolygons, fitTrigger }) {
  const map = useMap();
  useEffect(() => {
    if (activePolygons && activePolygons.length > 0 && fitTrigger > 0) {
      let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
      let hasPoints = false;
      activePolygons.forEach((p) => {
        p.latlngs.forEach((ring) => {
          ring.forEach(([lat, lng]) => {
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
            hasPoints = true;
          });
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

const Alert = () => {
  const [mode, setMode] = useState("rainfall");
  const [mobileTab, setMobileTab] = useState("map"); // "map" or "list"
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [modalContent, setModalContent] = useState(null);
  
  // Interactive UI improvements states
  const [hoveredProvince, setHoveredProvince] = useState(null);
  const [selectedProvince, setSelectedProvince] = useState(null);
  const [fitTrigger, setFitTrigger] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    let intervalId;

    async function fetchAlerts() {
      try {
        setLoading(true);
        setError(null);
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

          if (headlineLower.includes("general flood advisory") || subtypeLower.includes("general flood advisory") || eventLower.includes("general flood advisory")) {
            return false;
          }
          if (headlineLower.includes("thunderstorm information") || subtypeLower.includes("thunderstorm information") || eventLower.includes("thunderstorm information")) {
            return false;
          }
          if (headlineLower.includes("thunderstorm watch") || subtypeLower.includes("thunderstorm watch") || eventLower.includes("thunderstorm watch")) {
            return false;
          }

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
        const cutoffMs = 3 * 60 * 60 * 1000;

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
    intervalId = window.setInterval(fetchAlerts, 60 * 1000);

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

  const getCurrentWeatherSystem = (alertList) => {
    if (mode === "thunderstorm") return "Localized Thunderstorms";
    if (!alertList || alertList.length === 0) return "No Active Weather System";

    const firstAlert = alertList[0];
    if (firstAlert.weather_systems) {
      if (Array.isArray(firstAlert.weather_systems)) {
        return firstAlert.weather_systems.join(" / ");
      }
      return firstAlert.weather_systems;
    }
    return "Monitored Weather Disturbance";
  };

  const dynamicWeatherSystem = mode === "rainfall" ? getCurrentWeatherSystem(rainfallAlerts) : getCurrentWeatherSystem(thunderAlerts);
  const activePolygons = mode === "rainfall" ? rainfallPolygons : thunderPolygons;

  // Custom function to handle zooming map dynamically
  const triggerMapFocus = () => {
    setFitTrigger(prev => prev + 1);
  };

  // Helper renderer for location buttons with hover/sync capability
  const renderAreaListDict = (obj, colorClasses, borderTheme, severityTitle, modalIcon) => {
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
            const correspondingPolygon = activePolygons.find(p => p.name === prov);
            setSelectedProvince({
              province: prov,
              severity: severityTitle,
              municipalities: Array.from(obj[prov]).sort(),
              alertDetails: correspondingPolygon?.alert || activePolygons[0]?.alert
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
            onClick={() => setModalContent({ title: severityTitle, icon: modalIcon, list: obj })}
            className={`px-3 py-1.5 bg-slate-950/80 border border-dashed border-slate-700 hover:border-slate-500 text-slate-400 hover:text-white text-xs font-black rounded-xl cursor-pointer transition-all hover:scale-105 active:scale-95`}
          >
            + {hiddenCount} More
          </button>
        )}
      </div>
    );
  };

  const renderAreaListArray = (arr, colorClasses, borderTheme, severityTitle, modalIcon) => {
    if (!arr || arr.length === 0) return null;
    
    const maxVisible = 6;
    const visibleItems = arr.slice(0, maxVisible);
    const hiddenCount = arr.length - maxVisible;

    const renderItem = (loc) => {
      const isHovered = hoveredProvince === loc;
      const isSelected = selectedProvince?.province === loc;

      return (
        <button
          key={loc}
          onMouseEnter={() => setHoveredProvince(loc)}
          onMouseLeave={() => setHoveredProvince(null)}
          onClick={() => {
            const correspondingPolygon = activePolygons.find(p => p.name === loc);
            setSelectedProvince({
              province: loc,
              severity: severityTitle,
              municipalities: [],
              alertDetails: correspondingPolygon?.alert || activePolygons[0]?.alert
            });
          }}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border flex items-center gap-1.5 cursor-pointer text-left ${
            isHovered || isSelected
              ? `${colorClasses} scale-105 shadow-lg shadow-black/35 ring-1 ring-white/20`
              : "bg-slate-900/60 border-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-800/60"
          }`}
        >
          <MapPin className="w-3.5 h-3.5 opacity-80" />
          <span>{loc}</span>
        </button>
      );
    };

    return (
      <div className="flex flex-wrap gap-2 items-center">
        {visibleItems.map(renderItem)}
        {hiddenCount > 0 && (
          // Transform array list to the same format as Dict for See More modal compat
          <button 
            onClick={() => {
              const formattedList = {};
              arr.forEach(item => { formattedList[item] = new Set(); });
              setModalContent({ title: severityTitle, icon: modalIcon, list: formattedList });
            }}
            className={`px-3 py-1.5 bg-slate-950/80 border border-dashed border-slate-700 hover:border-slate-500 text-slate-400 hover:text-white text-xs font-black rounded-xl cursor-pointer transition-all hover:scale-105 active:scale-95`}
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
    <div className="bg-slate-950 text-slate-200 font-sans min-h-screen relative overflow-x-hidden p-4 md:p-8 flex justify-center items-start selection:bg-sky-500 selection:text-white">
      <style>{`
        .bg-grid-pattern {
            background-image: linear-gradient(to right, rgba(255,255,255,0.015) 1px, transparent 1px),
                              linear-gradient(to bottom, rgba(255,255,255,0.015) 1px, transparent 1px);
            background-size: 32px 32px;
        }
        @keyframes pulseGlow {
            0%, 100% { filter: drop-shadow(0 0 10px rgba(56, 189, 248, 0.4)); opacity: 0.9; }
            50% { filter: drop-shadow(0 0 20px rgba(56, 189, 248, 0.8)); opacity: 1; }
        }
        @keyframes pulseWarning {
            0%, 100% { filter: drop-shadow(0 0 12px rgba(239, 68, 68, 0.4)); }
            50% { filter: drop-shadow(0 0 24px rgba(239, 68, 68, 0.8)); }
        }
        @keyframes ripple {
          0% { transform: scale(0.95); opacity: 0.5; }
          50% { transform: scale(1.05); opacity: 0.8; }
          100% { transform: scale(0.95); opacity: 0.5; }
        }
        .animate-ripple {
          animation: ripple 4s infinite ease-in-out;
        }
        .glow-active-sky {
          animation: pulseGlow 3s infinite ease-in-out;
        }
        .glow-active-red {
          animation: pulseWarning 2.5s infinite ease-in-out;
        }
        .custom-glass {
          background: rgba(15, 23, 42, 0.6);
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

      {/* Grid Pattern Background */}
      <div className="absolute inset-0 bg-grid-pattern pointer-events-none z-0"></div>

      <div className="relative z-10 max-w-7xl w-full flex flex-col gap-6 md:gap-8">

        {/* Unified Premium Header */}
        <header className="custom-glass rounded-3xl p-5 md:p-7 shadow-2xl flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 border-b border-white/5 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-80 h-80 bg-gradient-to-br from-sky-500/10 to-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>
          
          <div className="flex flex-col md:flex-row md:items-center gap-5 w-full lg:w-auto">
            <div className="flex items-center gap-4">
              <div className="relative flex h-14 w-14 items-center justify-center shrink-0">
                {mode === "rainfall" ? (
                  <>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-2xl bg-sky-500 opacity-20"></span>
                    <div className="relative h-12 w-12 bg-slate-900 border border-sky-500/50 rounded-2xl flex items-center justify-center text-2xl shadow-lg shadow-sky-950/50">
                      🌧️
                    </div>
                  </>
                ) : (
                  <>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-2xl bg-amber-500 opacity-25"></span>
                    <div className="relative h-12 w-12 bg-slate-900 border border-amber-500/50 rounded-2xl flex items-center justify-center text-2xl shadow-lg shadow-amber-950/50">
                      ⚡
                    </div>
                  </>
                )}
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-black tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent">
                  {mode === "rainfall" ? "Heavy Rainfall Warning" : "Thunderstorm Advisory"}
                </h1>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  <p className="text-xs md:text-sm font-semibold text-slate-400">
                    System: <span className="text-slate-200">{dynamicWeatherSystem}</span>
                  </p>
                </div>
              </div>
            </div>

            {/* Premium Sliding Segmented Controls */}
            <div className="flex rounded-xl border border-white/5 bg-slate-950/80 p-1.5 shadow-inner mt-2 md:mt-0">
              <button
                type="button"
                onClick={() => { setMode("rainfall"); setSelectedProvince(null); }}
                className={`flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs font-black tracking-wide transition-all duration-300 cursor-pointer ${
                  mode === "rainfall"
                    ? "bg-slate-800 text-sky-400 shadow-lg shadow-black/40 border border-white/5"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <CloudRain className="h-4 w-4" />
                <span>RAINFALL</span>
              </button>
              <button
                type="button"
                onClick={() => { setMode("thunderstorm"); setSelectedProvince(null); }}
                className={`flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs font-black tracking-wide transition-all duration-300 cursor-pointer ${
                  mode === "thunderstorm"
                    ? "bg-slate-800 text-amber-400 shadow-lg shadow-black/40 border border-white/5"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Zap className="h-4 w-4" />
                <span>THUNDERSTORM</span>
              </button>
            </div>
          </div>

          <div className="bg-slate-950/60 border border-white/5 p-3 rounded-2xl text-left lg:text-right min-w-[210px] w-full lg:w-auto flex lg:flex-col justify-between items-center lg:items-end gap-3 shadow-inner">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-0.5">PAGASA Issue Time</p>
              <p className="text-xs font-bold text-slate-200">
                {lastUpdated ? lastUpdated.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "---"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs font-bold text-sky-400">
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
            📋 Warnings List {activePolygons.length > 0 && `(${activePolygons.length})`}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 md:gap-8">
          
          {/* Left Column (Map & Legend) - Hidden/Visible based on mobileTab on smaller viewports */}
          <div className={`lg:col-span-7 flex flex-col gap-6 ${mobileTab !== "map" ? "hidden lg:flex" : "flex"}`}>
            <div className="custom-glass rounded-3xl p-3 shadow-2xl relative group h-[480px] md:h-[540px] flex flex-col">
              
              {/* Map Float Controls */}
              <div className="absolute top-6 left-6 z-[1000] flex flex-col gap-2.5 pointer-events-none">
                <div className="bg-slate-950/90 backdrop-blur-md border border-white/10 px-4 py-2.5 rounded-2xl shadow-2xl flex items-center gap-2.5">
                  <span className={`w-2.5 h-2.5 rounded-full ${mode === 'rainfall' ? 'bg-sky-400 animate-pulse glow-active-sky' : 'bg-amber-400 animate-pulse glow-active-sky'}`}></span>
                  <h2 className="text-xs font-black uppercase tracking-wider text-slate-200">
                    {mode === "rainfall" ? "Precipitation Satellite Area" : "Active Lightning Coverage"}
                  </h2>
                </div>

                {activePolygons.length > 0 && (
                  <button
                    onClick={triggerMapFocus}
                    className="bg-slate-950/90 hover:bg-slate-900 border border-white/10 hover:border-slate-500 p-2.5 rounded-2xl shadow-2xl flex items-center gap-2 text-xs font-bold text-sky-400 pointer-events-auto transition-all cursor-pointer hover:scale-105 active:scale-95 w-fit"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                    <span>Fit Warnings Bounds</span>
                  </button>
                )}
              </div>

              <div className="w-full h-full rounded-2xl overflow-hidden relative border border-white/5" style={{ isolation: "isolate" }}>
                <MapContainer
                  center={[12.8797, 121.774]}
                  zoom={5.5}
                  minZoom={4.5}
                  maxZoom={11}
                  scrollWheelZoom
                  zoomControl={false}
                  className="w-full h-full bg-[#030712]"
                  maxBounds={PH_BOUNDS}
                  maxBoundsViscosity={0.9}
                >
                  <TileLayer
                    url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                    attribution='&copy; OpenStreetMap &copy; CARTO'
                  />
                  
                  <MapBoundsController activePolygons={activePolygons} fitTrigger={fitTrigger} />

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

                      const isSyncHovered = hoveredProvince === prov.name;
                      const baseStyle = {
                        weight: isSyncHovered ? 3.5 : 1.5,
                        color: isSyncHovered ? "#ffffff" : borderColor,
                        fillColor,
                        fillOpacity: isSyncHovered ? 0.75 : 0.45,
                        dashArray: isSyncHovered ? "4" : undefined,
                      };

                      return (
                        <Polygon
                          key={`${prov.id}-${mode}`}
                          positions={prov.latlngs}
                          pathOptions={baseStyle}
                          eventHandlers={{
                            mouseover: () => setHoveredProvince(prov.name),
                            mouseout: () => setHoveredProvince(null),
                            click: () => {
                              setSelectedProvince({
                                province: prov.name,
                                severity: prov.warningLevel || prov.areaType || "Active Alert",
                                municipalities: prov.provinceMeta?.municipality ? [prov.provinceMeta.municipality] : [],
                                alertDetails: prov.alert
                              });
                            }
                          }}
                        >
                          <Tooltip sticky className="custom-leaflet-tooltip">
                            <div className="p-1.5 text-xs text-slate-800">
                              <p className="font-black text-slate-900 border-b border-slate-200 pb-1 mb-1">{prov.name}</p>
                              <p className="text-[10px] text-slate-600 font-medium capitalize">
                                Status: {prov.warningLevel || prov.areaType || "Active Advisory"}
                              </p>
                            </div>
                          </Tooltip>
                        </Polygon>
                      );
                    })}
                </MapContainer>

                {/* Decorative Atmosphere Glow Filters for Premium Feel */}
                {mode === 'rainfall' ? (
                  <>
                    <div className="absolute top-1/4 left-1/2 w-48 h-48 bg-sky-500/10 blur-3xl rounded-full pointer-events-none z-10 animate-ripple"></div>
                    <div className="absolute bottom-1/3 left-1/3 w-64 h-48 bg-blue-500/10 blur-3xl rounded-full pointer-events-none z-10 animate-ripple" style={{ animationDelay: "1.5s" }}></div>
                  </>
                ) : (
                  <>
                    <div className="absolute top-1/4 left-[55%] w-48 h-48 bg-amber-500/10 blur-3xl rounded-full pointer-events-none z-10 animate-ripple"></div>
                    <div className="absolute top-[35%] left-[52%] text-amber-400 text-lg drop-shadow-[0_0_8px_rgba(245,158,11,1)] pointer-events-none z-10 animate-pulse">⚡</div>
                    <div className="absolute bottom-[35%] left-[36%] text-amber-400 text-lg drop-shadow-[0_0_8px_rgba(245,158,11,1)] pointer-events-none z-10 animate-pulse" style={{ animationDelay: '0.8s' }}>⚡</div>
                  </>
                )}
              </div>
            </div>

            {/* Legend Section */}
            {mode === "rainfall" ? (
              <div className="custom-glass rounded-3xl p-6 shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-sky-500/5 blur-2xl rounded-full pointer-events-none"></div>
                <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <Info className="w-4 h-4" />
                  <span>Rainfall Hazard Level Guide</span>
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="flex flex-col items-center text-center gap-2 bg-slate-900/30 p-2.5 rounded-2xl border border-white/5">
                    <div className="w-full h-2.5 rounded-full bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.8)] glow-active-red"></div>
                    <span className="text-xs font-black text-red-400 mt-1 uppercase">RED WARNING</span>
                    <span className="text-[10px] text-slate-400 leading-tight">Serious Flooding Expected</span>
                  </div>
                  <div className="flex flex-col items-center text-center gap-2 bg-slate-900/30 p-2.5 rounded-2xl border border-white/5">
                    <div className="w-full h-2.5 rounded-full bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.8)]"></div>
                    <span className="text-xs font-black text-orange-400 mt-1 uppercase">ORANGE</span>
                    <span className="text-[10px] text-slate-400 leading-tight">Flooding Threatening</span>
                  </div>
                  <div className="flex flex-col items-center text-center gap-2 bg-slate-900/30 p-2.5 rounded-2xl border border-white/5">
                    <div className="w-full h-2.5 rounded-full bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.8)]"></div>
                    <span className="text-xs font-black text-yellow-400 mt-1 uppercase">YELLOW</span>
                    <span className="text-[10px] text-slate-400 leading-tight">Flooding is Possible</span>
                  </div>
                  <div className="flex flex-col items-center text-center gap-2 bg-slate-900/30 p-2.5 rounded-2xl border border-white/5">
                    <div className="w-full h-2.5 rounded-full bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.7)]"></div>
                    <span className="text-xs font-black text-cyan-400 mt-1 uppercase">LIGHT-MOD</span>
                    <span className="text-[10px] text-slate-400 leading-tight">Rain Observed / Monitor</span>
                  </div>
                  <div className="flex flex-col items-center text-center gap-2 bg-slate-900/30 p-2.5 rounded-2xl border border-white/5">
                    <div className="w-full h-2.5 rounded-full bg-slate-600"></div>
                    <span className="text-xs font-black text-slate-300 mt-1 uppercase">EXPECTING</span>
                    <span className="text-[10px] text-slate-400 leading-tight">Expected within 1-2 hrs</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="custom-glass rounded-3xl p-6 shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 blur-2xl rounded-full pointer-events-none"></div>
                <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <Info className="w-4 h-4" />
                  <span>Advisory Status Levels</span>
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-start gap-3.5 bg-slate-900/40 p-4 rounded-2xl border border-white/5">
                    <div className="mt-1 w-3.5 h-3.5 rounded-full bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.8)] flex-shrink-0 animate-pulse"></div>
                    <div>
                      <span className="text-sm font-black text-amber-400 tracking-wider">AFFECTING</span>
                      <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">Lightning, strong winds and moderate to heavy rainfall are currently actively experienced.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3.5 bg-slate-900/40 p-4 rounded-2xl border border-white/5">
                    <div className="mt-1 w-3.5 h-3.5 rounded-full bg-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.8)] border border-cyan-300 flex-shrink-0"></div>
                    <div>
                      <span className="text-sm font-black text-cyan-400 tracking-wider">EXPECTING</span>
                      <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">Favorable conditions are likely to develop or progress into the area in the next 1-2 hours.</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Column (Affected Areas / Summaries) */}
          <div className={`lg:col-span-5 flex flex-col gap-5 ${mobileTab !== "list" ? "hidden lg:flex" : "flex"}`}>
            
            {/* selectedProvince Inspector Drawer/Expandable details */}
            {selectedProvince && (
              <div className="bg-gradient-to-r from-slate-900 to-indigo-950/80 border border-sky-500/40 rounded-3xl p-5 shadow-[0_0_30px_rgba(56,189,248,0.15)] relative overflow-hidden transition-all duration-300">
                <div className="absolute top-2 right-2 z-20">
                  <button 
                    onClick={() => setSelectedProvince(null)} 
                    className="p-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-white transition-all cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="absolute top-0 left-0 w-1 h-full bg-sky-500"></div>

                <div className="flex items-center gap-2 mb-3">
                  <div className="px-2 py-0.5 rounded-md bg-sky-500/20 text-sky-400 text-[10px] font-black uppercase tracking-wider">
                    {selectedProvince.severity}
                  </div>
                  <h4 className="text-lg font-black text-white">{selectedProvince.province}</h4>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed mb-4">
                  {selectedProvince.alertDetails?.message || selectedProvince.alertDetails?.headline || "Monitoring active PAGASA weather system alerts."}
                </p>

                {selectedProvince.municipalities.length > 0 && (
                  <div>
                    <h5 className="text-[10px] uppercase font-black tracking-widest text-slate-400 mb-2">Affected Municipalities:</h5>
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
                  <span className="w-4 h-4 border-2 border-sky-500 border-t-transparent rounded-full animate-spin"></span>
                ) : (
                  <CheckCircle2 className="w-4.5 h-4.5 text-slate-500 animate-pulse" />
                )}
                <span>Active Warning Areas ({activePolygons.length})</span>
              </h3>
            </div>

            {error && (
              <div className="flex items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3.5 text-red-300">
                <AlertTriangle className="h-4.5 w-4.5 mt-0.5 shrink-0" />
                <p className="text-xs">{error}</p>
              </div>
            )}

            {!loading && !error && mode === "rainfall" && (
              <div className="flex flex-col gap-4">
                
                {/* Red Warning Card */}
                {Object.keys(rainfallSummary.red).length > 0 && (
                  <div className="custom-glass rounded-3xl p-5 shadow-2xl relative overflow-hidden group">
                    <div className="absolute top-0 left-0 w-1.5 h-full bg-red-500 glow-active-red"></div>
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"></div>
                      <h4 className="text-base font-black text-red-400 uppercase tracking-wider">Red Warning Area</h4>
                    </div>
                    <p className="text-xs text-slate-400 mb-4">Serious flooding is expected. Take immediate actions.</p>
                    {renderAreaListDict(rainfallSummary.red, "bg-red-500/10 border-red-500/35 text-red-300", "border-red-500/50", "Red Warning", "🔴")}
                  </div>
                )}

                {/* Orange Warning Card */}
                {Object.keys(rainfallSummary.orange).length > 0 && (
                  <div className="custom-glass rounded-3xl p-5 shadow-2xl relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1.5 h-full bg-orange-500"></div>
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-orange-500"></div>
                      <h4 className="text-base font-black text-orange-400 uppercase tracking-wider">Orange Warning Area</h4>
                    </div>
                    <p className="text-xs text-slate-400 mb-4">Flooding is threatening. Be fully prepared.</p>
                    {renderAreaListDict(rainfallSummary.orange, "bg-orange-500/10 border-orange-500/30 text-orange-300", "border-orange-500/40", "Orange Warning", "🟠")}
                  </div>
                )}

                {/* Yellow Warning Card */}
                {Object.keys(rainfallSummary.yellow).length > 0 && (
                  <div className="custom-glass rounded-3xl p-5 shadow-2xl relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1.5 h-full bg-yellow-500"></div>
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-yellow-500"></div>
                      <h4 className="text-base font-black text-yellow-400 uppercase tracking-wider">Yellow Warning Area</h4>
                    </div>
                    <p className="text-xs text-slate-400 mb-4">Flooding is possible. Keep monitoring.</p>
                    {renderAreaListDict(rainfallSummary.yellow, "bg-yellow-500/10 border-yellow-500/30 text-yellow-300", "border-yellow-500/30", "Yellow Warning", "🟡")}
                  </div>
                )}

                {/* Light-Moderate Rain Card */}
                {(Object.keys(rainfallSummary.moderate).length > 0 || Object.keys(rainfallSummary.severe).length > 0) && (
                  <div className="custom-glass rounded-3xl p-5 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1.5 h-full bg-cyan-500"></div>
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-cyan-500"></div>
                      <h4 className="text-base font-black text-cyan-400 uppercase tracking-wider">Light to Moderate Rainfall</h4>
                    </div>
                    <p className="text-xs text-slate-400 mb-4">Light showers observed. Keep safe.</p>
                    {renderAreaListDict({ ...rainfallSummary.severe, ...rainfallSummary.moderate }, "bg-cyan-500/10 border-cyan-500/30 text-cyan-300", "border-cyan-500/30", "Light-Moderate Rain", "💧")}
                  </div>
                )}

                {/* Expecting Rainfall Card */}
                {Object.keys(rainfallSummary.expected).length > 0 && (
                  <div className="custom-glass rounded-3xl p-5 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1.5 h-full bg-slate-500"></div>
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-slate-500"></div>
                      <h4 className="text-base font-black text-slate-300 uppercase tracking-wider">Expecting Rain</h4>
                    </div>
                    <p className="text-xs text-slate-400 mb-4">Rain likely to develop or occur within 1-2 hours.</p>
                    {renderAreaListDict(rainfallSummary.expected, "bg-slate-800 text-slate-300 border-slate-700", "border-slate-700", "Expecting Rain", "☁️")}
                  </div>
                )}

                {Object.keys(rainfallSummary.red).length === 0 && 
                 Object.keys(rainfallSummary.orange).length === 0 && 
                 Object.keys(rainfallSummary.yellow).length === 0 && 
                 Object.keys(rainfallSummary.moderate).length === 0 && 
                 Object.keys(rainfallSummary.severe).length === 0 && 
                 Object.keys(rainfallSummary.expected).length === 0 && (
                  <div className="p-8 text-center custom-glass rounded-3xl border border-dashed border-white/10">
                    <CloudRain className="w-10 h-10 text-slate-600 mx-auto mb-2 opacity-50" />
                    <p className="text-sm text-slate-500 italic">No active rainfall warning coordinates found.</p>
                  </div>
                )}
              </div>
            )}

            {!loading && !error && mode === "thunderstorm" && (
              <div className="flex flex-col gap-4">
                
                {/* Affecting Thunderstorm */}
                {thunderSummary.affecting.length > 0 && (
                  <div className="custom-glass rounded-3xl p-5 shadow-2xl relative overflow-hidden group">
                    <div className="absolute top-0 left-0 w-1.5 h-full bg-amber-500 glow-active-sky"></div>
                    <div className="flex justify-between items-center mb-3">
                      <div className="flex items-center gap-3">
                        <div className="relative flex h-2.5 w-2.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
                        </div>
                        <h4 className="text-base font-black text-amber-400 uppercase tracking-wider">Affecting Areas</h4>
                      </div>
                      <span className="bg-red-500/10 text-red-400 text-[10px] font-black px-2 py-0.5 rounded border border-red-500/20 uppercase tracking-wider animate-pulse">LIVE IMPACT</span>
                    </div>
                    <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                      Moderate to heavy rain showers with lightning and strong winds are actively occurring in these sectors.
                    </p>
                    {renderAreaListArray(thunderSummary.affecting, "bg-amber-500/10 border-amber-500/35 text-amber-300", "border-amber-500/40", "Advisory Affecting", "⚡")}
                  </div>
                )}

                {/* Expecting Thunderstorm */}
                {thunderSummary.expected.length > 0 && (
                  <div className="custom-glass rounded-3xl p-5 shadow-2xl relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1.5 h-full bg-cyan-500"></div>
                    <div className="flex justify-between items-center mb-3">
                      <div className="flex items-center gap-3">
                        <div className="h-2.5 w-2.5 rounded-full bg-cyan-500"></div>
                        <h4 className="text-base font-black text-cyan-400 uppercase tracking-wider">Expecting Areas</h4>
                      </div>
                      <span className="bg-slate-800 text-slate-400 text-[9px] font-black px-2 py-0.5 rounded border border-white/5 uppercase tracking-wider">Within 2 hrs</span>
                    </div>
                    <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                      Favorable conditions for thunderstorm cells to develop or drift inside these zones shortly.
                    </p>
                    {renderAreaListArray(thunderSummary.expected, "bg-cyan-500/10 border-cyan-500/30 text-cyan-300", "border-cyan-500/30", "Advisory Expecting", "⛈️")}
                  </div>
                )}

                {thunderSummary.affecting.length === 0 && thunderSummary.expected.length === 0 && (
                  <div className="p-8 text-center custom-glass rounded-3xl border border-dashed border-white/10">
                    <Zap className="w-10 h-10 text-slate-600 mx-auto mb-2 opacity-50" />
                    <p className="text-sm text-slate-500 italic">No active thunderstorm coordinates found.</p>
                  </div>
                )}
              </div>
            )}

            {/* Public Safety Precaution Bar */}
            <div className="bg-slate-900/30 border border-white/5 rounded-3xl p-4.5 mt-auto flex items-start gap-4">
              <div className="text-xl shrink-0">⚠️</div>
              <div>
                <h5 className="text-slate-200 font-bold text-xs mb-1">Public Safety Advisory</h5>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Citizens residing in warning/advisory regions are instructed to keep alert, monitor official updates, and take precautions against possible hazards such as landslides or sudden flooding.
                </p>
              </div>
            </div>

          </div>
        </div>

        {/* Modal for See More (Clean grouped accordions with Search feature) */}
        {modalContent && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
            <div className="bg-slate-900 border border-white/10 rounded-3xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl relative overflow-hidden transition-all duration-300">
              
              {/* Modal Header */}
              <div className="flex justify-between items-center p-5 border-b border-white/5 bg-slate-900/90 z-10 sticky top-0">
                <div className="flex items-center gap-3">
                  {modalContent.icon && <span className="text-2xl">{modalContent.icon}</span>}
                  <div>
                    <h3 className="text-lg font-black text-white tracking-tight">{modalContent.title}</h3>
                    <p className="text-[10px] text-slate-400">Search and browse affected locations.</p>
                  </div>
                </div>
                <button 
                  onClick={() => { setModalContent(null); setSearchQuery(""); }}
                  className="text-slate-400 hover:text-white transition-colors p-2 rounded-xl hover:bg-slate-800 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Search Bar */}
              <div className="px-5 py-3.5 border-b border-white/5 bg-slate-950/40 flex items-center gap-2">
                <Search className="w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="Filter by Province or Municipality name..."
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

              {/* List Contents (Grouped by Province in Accordions) */}
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
                            <MapPin className="w-4 h-4 text-sky-400" />
                            {key}
                          </span>
                          <span className="text-[10px] text-slate-500 font-bold bg-slate-900 px-2 py-0.5 rounded-lg">
                            {municipalities.length > 0 ? `${municipalities.length} Areas` : "Province Boundary"}
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

export default Alert;
