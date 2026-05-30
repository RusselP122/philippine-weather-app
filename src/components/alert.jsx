import React, { useEffect, useMemo, useState, useRef } from "react";
import { CloudRain, Zap, AlertTriangle, Wind, Info, MapPin, Maximize2, Search, X, ChevronRight, CheckCircle2, ChevronDown } from "lucide-react";

// Robustly handle API URL - fallback to known working endpoint patterns if needed
const ALERTS_URL = "/api/cap-alerts";

const PH_BOUNDS = [
  [4, 116],
  [22.5, 127.5],
];

const ADVISORY_AFFECTING_COLOR = "#0ea5e9";
const ADVISORY_AFFECTING_EDGE = "#0284c7";
const ADVISORY_EXPECTING_COLOR = "#38bdf8";
const ADVISORY_EXPECTING_EDGE = "#0ea5e9";

const THUNDER_AFFECTING_COLOR = "#f59e0b";
const THUNDER_AFFECTING_EDGE = "#d97706";
const THUNDER_EXPECTING_COLOR = "#fcd34d";
const THUNDER_EXPECTING_EDGE = "#f59e0b";

const WARNING_LEVEL_COLORS = {
  yellow: { fill: "#facc15", edge: "#eab308" },
  orange: { fill: "#fb923c", edge: "#f97316" },
  red: { fill: "#ef4444", edge: "#dc2626" },
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

const Alert = () => {
  const [mode, setMode] = useState("rainfall");
  const [activeRegion, setActiveRegion] = useState("All");
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

  const [geoData, setGeoData] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);
  const [hoveredAlertProv, setHoveredAlertProv] = useState(null);
  
  const mapContainerRef = useRef(null);

  // 1. Static bounds and projection mapping logic
  const minLon = 114.0;
  const maxLon = 128.0;
  const minLat = 4.0;
  const maxLat = 22.0;
  const canvasWidth = 1000;
  const canvasHeight = 1400;

  const project = (lon, lat) => {
    const x = ((lon - minLon) / (maxLon - minLon)) * canvasWidth;
    const y = ((maxLat - lat) / (maxLat - minLat)) * canvasHeight;
    return [x, y];
  };

  const getIslandGroup = (region) => {
    if (!region) return "Luzon";
    const r = region.toLowerCase();
    if (r.includes("visayas")) return "Visayas";
    if (
      r.includes("zamboanga") ||
      r.includes("mindanao") ||
      r.includes("davao") ||
      r.includes("soccsksargen") ||
      r.includes("caraga") ||
      r.includes("bangsamoro") ||
      r.includes("muslim")
    ) {
      return "Mindanao";
    }
    return "Luzon";
  };

  // 2. Base map layout shapes
  const mapData = useMemo(() => {
    if (!geoData) return null;

    const bounds = {
      All: { minX: 0, maxX: 1000, minY: 0, maxY: canvasHeight },
      Luzon: { minX: canvasWidth, maxX: 0, minY: canvasHeight, maxY: 0 },
      Visayas: { minX: canvasWidth, maxX: 0, minY: canvasHeight, maxY: 0 },
      Mindanao: { minX: canvasWidth, maxX: 0, minY: canvasHeight, maxY: 0 }
    };

    const projectedFeatures = geoData.features.map((f) => {
      const provName = f.properties.PROV_NAME || f.properties.PROVINCE || f.properties.NAME_1 || f.properties.name || "Unknown";
      const region = f.properties.REGION || "";
      const group = getIslandGroup(region);

      const generateD = (coords, type) => {
        if (type === "Polygon") {
          return coords.map(ring => {
            return ring.map((coord, index) => {
              const [x, y] = project(coord[0], coord[1]);
              return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
            }).join(' ') + ' Z';
          }).join(' ');
        } else if (type === "MultiPolygon") {
          return coords.map(poly => {
            return poly.map(ring => {
              return ring.map((coord, index) => {
                const [x, y] = project(coord[0], coord[1]);
                return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
              }).join(' ') + ' Z';
            }).join(' ');
          }).join(' ');
        }
        return "";
      };

      const d = generateD(f.geometry.coordinates, f.geometry.type);

      let sumX = 0, sumY = 0, count = 0;
      const getCentroid = (c) => {
        if (typeof c[0] === 'number') {
          const [lon, lat] = c;
          const [x, y] = project(lon, lat);
          sumX += x;
          sumY += y;
          count++;

          // Dynamically track bounds for each island group (exclude Palawan from Luzon bounds to focus zoom)
          if (group !== "Luzon" || provName !== "Palawan") {
            if (x < bounds[group].minX) bounds[group].minX = x;
            if (x > bounds[group].maxX) bounds[group].maxX = x;
            if (y < bounds[group].minY) bounds[group].minY = y;
            if (y > bounds[group].maxY) bounds[group].maxY = y;
          }
        } else {
          c.forEach(getCentroid);
        }
      };
      getCentroid(f.geometry.coordinates);

      return {
        id: f.properties.ID_1 || provName,
        name: provName,
        region,
        group,
        d,
        centroid: count > 0 ? [sumX / count, sumY / count] : [canvasWidth / 2, canvasHeight / 2]
      };
    });

    Object.keys(bounds).forEach((key) => {
      if (key === "All") return;
      const b = bounds[key];
      const w = b.maxX - b.minX;
      const h = b.maxY - b.minY;
      const padX = w * 0.08;
      const padY = h * 0.08;

      bounds[key] = {
        minX: Math.max(0, b.minX - padX),
        maxX: Math.min(canvasWidth, b.maxX + padX),
        minY: Math.max(0, b.minY - padY),
        maxY: Math.min(canvasHeight, b.maxY + padY)
      };
    });

    return {
      features: projectedFeatures,
      bounds,
      canvasWidth,
      canvasHeight
    };
  }, [geoData]);

  // 3. Dynamic alert area outline paths generator
  const generatePathFromLatLngs = (latlngs) => {
    if (!latlngs || !latlngs.length) return "";
    return latlngs.map(ring => {
      return ring.map((point, idx) => {
        const [lat, lon] = point;
        const [x, y] = project(lon, lat);
        return `${idx === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ') + ' Z';
    }).join(' ');
  };

  // 4. Base map load
  useEffect(() => {
    fetch("/data/ph_provinces.json")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load map data");
        return res.json();
      })
      .then((data) => setGeoData(data))
      .catch((err) => console.error("Error loading map shapes:", err));
  }, []);

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

  // 7. Interactive focus/zoom bounds logic for alerts
  useEffect(() => {
    if (activePolygons && activePolygons.length > 0) {
      let minX = 1000, maxX = 0, minY = 1400, maxY = 0;
      let hasPoints = false;
      
      activePolygons.forEach((p) => {
        p.latlngs.forEach((ring) => {
          ring.forEach(([lat, lng]) => {
            const [x, y] = project(lng, lat);
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            hasPoints = true;
          });
        });
      });
      
      if (hasPoints) {
        const w = maxX - minX;
        const h = maxY - minY;
        const centerX = minX + w / 2;
        const centerY = minY + h / 2;
        
        const scaleX = 1000 / (w || 1);
        const scaleY = 1400 / (h || 1);
        const targetZoom = Math.min(Math.min(scaleX, scaleY) * 0.75, 8);
        const finalZoom = Math.max(targetZoom, 1);
        
        setZoom(finalZoom);
        setPan({
          x: 500 - centerX * finalZoom,
          y: 700 - centerY * finalZoom
        });
      }
    } else {
      setZoom(1);
      setPan({ x: 0, y: 0 });
    }
  }, [fitTrigger, activePolygons]);

  // 8. Custom function to handle zooming map dynamically
  const triggerMapFocus = () => {
    setFitTrigger(prev => prev + 1);
  };

  // 9. Free Pan & Zoom Navigation Mouse & Wheel event handlers
  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const zoomIntensity = 0.08;
    const zoomFactor = e.deltaY < 0 ? (1 + zoomIntensity) : (1 - zoomIntensity);
    const newZoom = Math.min(Math.max(zoom * zoomFactor, 0.4), 15);
    
    const svgRect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - svgRect.left;
    const mouseY = e.clientY - svgRect.top;
    
    const dx = mouseX - pan.x;
    const dy = mouseY - pan.y;
    
    setZoom(newZoom);
    setPan({
      x: mouseX - dx * (newZoom / zoom),
      y: mouseY - dy * (newZoom / zoom)
    });
  };

  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev * 1.3, 15));
  };

  const handleZoomOut = () => {
    setZoom(prev => Math.max(prev / 1.3, 0.4));
  };

  const handleReset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleMouseMove = (e) => {
    // A. Handle active dragging/panning
    if (isDragging) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }

    // B. Handle high-performance dynamic floating tooltip tracking
    if (mapContainerRef.current) {
      const rect = mapContainerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const tooltipWidth = 240;
      const tooltipHeight = 120;

      let finalX = x + 15;
      let finalY = y + 15;

      // Prevent clipping on boundaries
      if (x + tooltipWidth > rect.width) {
        finalX = x - tooltipWidth - 15;
      }
      if (y + tooltipHeight > rect.height) {
        finalY = y - tooltipHeight - 15;
      }

      finalX = Math.max(10, finalX);
      finalY = Math.max(10, finalY);

      setTooltipPos({
        x: finalX,
        y: finalY
      });
    }
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
    <div className="relative h-[calc(100vh-64px)] w-full bg-slate-950 font-sans overflow-hidden flex flex-col md:flex-row selection:bg-sky-500 selection:text-white">
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
      `}</style>

      {/* Grid Pattern Background */}
      <div className="absolute inset-0 bg-grid-pattern pointer-events-none z-0"></div>

      {/* Mobile Viewport Toggle Button (Only visible on mobile screens at the top) */}
      <div className="md:hidden absolute top-4 left-4 right-4 z-[2000] flex rounded-xl border border-white/5 bg-slate-950/80 p-1 backdrop-blur-md shadow-2xl">
        <button
          onClick={() => setMobileTab("map")}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            mobileTab === "map" ? "bg-slate-800 text-white shadow-md" : "text-slate-400"
          }`}
        >
          🗺️ Interactive Map
        </button>
        <button
          onClick={() => setMobileTab("list")}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            mobileTab === "list" ? "bg-slate-800 text-white shadow-md" : "text-slate-400"
          }`}
        >
          📋 Warnings {activePolygons.length > 0 && `(${activePolygons.length})`}
        </button>
      </div>

      {/* ── INTERACTIVE DYNAMIC MAP CONTAINER (LEFT SIDE) ── */}
      <div
        ref={mapContainerRef}
        className={`relative w-full md:h-full md:flex-grow md:flex-1 bg-[#020617] overflow-hidden flex items-center justify-center border-b md:border-b-0 border-slate-800/80 ${
          mobileTab !== "map" ? "hidden md:flex" : "flex flex-1 h-full w-full"
        }`}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseUp}
      >
        {/* Radar-like background grid lines */}
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_center,rgba(15,23,42,0.6)_0%,rgba(2,6,23,1)_95%)]" />

        {/* Dynamic Zooming SVG Map Canvas */}
        {mapData && (
          <svg
            className="w-auto h-full max-h-full max-w-full aspect-[1000/1400] relative z-10 select-none cursor-crosshair transition-all duration-[1200ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]"
            viewBox="0 0 1000 1400"
            style={{
              filter: "drop-shadow(0 25px 50px rgba(0, 0, 0, 0.4))",
            }}
          >
            <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
              {/* Grid Pattern */}
              <defs>
                <pattern id="grid" width="100" height="100" patternUnits="userSpaceOnUse">
                  <path d="M 100 0 L 0 0 0 100" fill="none" stroke="rgba(51, 65, 85, 0.15)" strokeWidth="0.8" />
                </pattern>
              </defs>
              <rect width="1000" height="1400" fill="url(#grid)" />

              {/* Latitude/Longitude labels */}
              <g opacity="0.15" className="text-[11px] font-mono fill-slate-500 pointer-events-none">
                <text x="10" y="20">18.5°N</text>
                <text x="10" y="470">15.0°N</text>
                <text x="10" y="930">10.0°N</text>
                <text x="10" y="1380">5.5°N</text>
                <text x="920" y="1390" textAnchor="end">126.5°E</text>
                <text x="470" y="1390" textAnchor="end">121.5°E</text>
                <text x="50" y="1390" textAnchor="end">117.0°E</text>
              </g>

              {/* Vintage meteorological compass rose */}
              <g transform="translate(90, 135)" className="opacity-[0.25] pointer-events-none font-mono">
                <circle r="48" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
                <circle r="40" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="0.8" strokeDasharray="2 3" />
                <line x1="0" y1="-55" x2="0" y2="55" stroke="rgba(255,255,255,0.25)" strokeWidth="0.8" />
                <line x1="-55" y1="0" x2="55" y2="0" stroke="rgba(255,255,255,0.25)" strokeWidth="0.8" />

                {/* North Arrow Pointer */}
                <polygon points="0,-52 4,-12 0,0 -4,-12" fill="rgba(255,255,255,0.4)" />
                <polygon points="0,52 3,12 0,0 -3,12" fill="rgba(255,255,255,0.15)" />
                <polygon points="52,0 12,3 0,0 12,-3" fill="rgba(255,255,255,0.15)" />
                <polygon points="-52,0 -12,3 0,0 -12,-3" fill="rgba(255,255,255,0.15)" />

                <text x="0" y="-60" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="10" fontWeight="bold">N</text>
                <text x="64" y="3" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="8">E</text>
                <text x="0" y="69" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="8">S</text>
                <text x="-64" y="3" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="8">W</text>
              </g>

              {/* Base Provinces */}
              <g>
                {mapData.features.map((feature) => {
                  return (
                    <path
                      key={`base-${feature.id}`}
                      d={feature.d}
                      fill="#334155"
                      stroke="rgba(255, 255, 255, 0.1)"
                      strokeWidth={0.6}
                      className="transition-all duration-300"
                    />
                  );
                })}
              </g>

              {/* Warning polygons */}
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
                      fillColor = ADVISORY_AFFECTING_COLOR + "80";
                      borderColor = ADVISORY_AFFECTING_EDGE;
                    } else if (areaType === "expecting") {
                      fillColor = ADVISORY_EXPECTING_COLOR + "80";
                      borderColor = ADVISORY_EXPECTING_EDGE;
                    } else if (levelKey && WARNING_LEVEL_COLORS[levelKey]) {
                      fillColor = WARNING_LEVEL_COLORS[levelKey].fill + "80";
                      borderColor = WARNING_LEVEL_COLORS[levelKey].edge;
                    } else {
                      fillColor = "rgba(56, 189, 248, 0.5)";
                      borderColor = "#38bdf8";
                    }
                  } else {
                    if (areaType === "affecting") {
                      fillColor = THUNDER_AFFECTING_COLOR + "80";
                      borderColor = THUNDER_AFFECTING_EDGE;
                    } else if (areaType === "expecting") {
                      fillColor = THUNDER_EXPECTING_COLOR + "80";
                      borderColor = THUNDER_EXPECTING_EDGE;
                    } else if (levelKey && WARNING_LEVEL_COLORS[levelKey]) {
                      fillColor = WARNING_LEVEL_COLORS[levelKey].fill + "80";
                      borderColor = WARNING_LEVEL_COLORS[levelKey].edge;
                    } else {
                      fillColor = "rgba(251, 191, 36, 0.5)";
                      borderColor = "#fbbf24";
                    }
                  }

                  const pathD = generatePathFromLatLngs(prov.latlngs);
                  const isSyncHovered = hoveredProvince === prov.name;

                  return (
                    <path
                      key={`${prov.id}-${mode}-svg`}
                      d={pathD}
                      fill={fillColor}
                      stroke={isSyncHovered ? "#ffffff" : borderColor}
                      strokeWidth={isSyncHovered ? 2.5 : 1.5}
                      className="transition-all duration-300 cursor-pointer"
                      style={{
                        filter: isSyncHovered ? "drop-shadow(0 0 8px rgba(255,255,255,0.6))" : "none"
                      }}
                      onMouseEnter={() => {
                        setHoveredProvince(prov.name);
                        setHoveredAlertProv(prov);
                        setIsTooltipVisible(true);
                      }}
                      onMouseLeave={() => {
                        setHoveredProvince(null);
                        setHoveredAlertProv(null);
                        setIsTooltipVisible(false);
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedProvince({
                          province: prov.name,
                          severity: prov.warningLevel || prov.areaType || "Active Alert",
                          municipalities: prov.provinceMeta?.municipality ? [prov.provinceMeta.municipality] : [],
                          alertDetails: prov.alert
                        });
                      }}
                    />
                  );
                })}
            </g>
          </svg>
        )}

        {/* Map Float Controls (Top Left Overlay) */}
        <div className="absolute top-16 md:top-6 left-6 z-[1000] flex flex-col gap-2.5 pointer-events-none">
          <div className="bg-slate-950/90 backdrop-blur-md border border-slate-800/80 px-4 py-2.5 rounded-2xl shadow-2xl flex items-center gap-2.5">
            <span className={`w-2.5 h-2.5 rounded-full ${mode === 'rainfall' ? 'bg-sky-400 animate-pulse glow-active-sky' : 'bg-amber-400 animate-pulse glow-active-sky'}`}></span>
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-200">
              {mode === "rainfall" ? "Precipitation Satellite Area" : "Active Lightning Coverage"}
            </h2>
          </div>

          {/* Island Group Selector */}
          <div className="bg-slate-950/80 backdrop-blur-md p-1 rounded-lg border border-slate-800/80 shadow-xl flex gap-1 pointer-events-auto">
            {["All", "Luzon", "Visayas", "Mindanao"].map((region) => (
              <button
                key={region}
                onClick={() => {
                  setActiveRegion(region);
                  if (!mapData || !mapData.bounds) return;
                  const b = mapData.bounds[region];
                  if (!b) return;

                  if (region === "All") {
                    setZoom(1);
                    setPan({ x: 0, y: 0 });
                    return;
                  }

                  const w = b.maxX - b.minX;
                  const h = b.maxY - b.minY;
                  const centerX = b.minX + w / 2;
                  const centerY = b.minY + h / 2;

                  const scaleX = 1000 / (w || 1);
                  const scaleY = 1400 / (h || 1);
                  const targetZoom = Math.min(scaleX, scaleY) * 0.85;
                  const finalZoom = Math.min(Math.max(targetZoom, 1), 6);

                  setZoom(finalZoom);
                  setPan({
                    x: 500 - centerX * finalZoom,
                    y: 700 - centerY * finalZoom
                  });
                }}
                className={`px-2.5 py-1 rounded-md text-[10px] sm:text-xs font-bold tracking-wide uppercase cursor-pointer transition-all duration-300 ${
                  activeRegion === region
                    ? "bg-sky-500 text-white shadow-md shadow-sky-500/10 scale-105"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/50"
                }`}
              >
                {region}
              </button>
            ))}
          </div>

          {activePolygons.length > 0 && (
            <button
              onClick={triggerMapFocus}
              className="bg-slate-950/90 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 p-2.5 rounded-2xl shadow-2xl flex items-center gap-2 text-xs font-bold text-sky-400 pointer-events-auto transition-all cursor-pointer hover:scale-105 active:scale-95 w-fit"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span>Fit Warnings Bounds</span>
            </button>
          )}
        </div>

        {/* Custom Floating Tooltip */}
        {isTooltipVisible && hoveredAlertProv && (
          <div
            className="absolute z-50 pointer-events-none rounded-xl border border-slate-700/60 bg-slate-950/90 p-3 text-slate-200 shadow-2xl backdrop-blur-md flex flex-col gap-1"
            style={{
              left: tooltipPos.x,
              top: tooltipPos.y,
              transform: "translate3d(0, 0, 0)"
            }}
          >
            <h4 className="font-black text-slate-100 text-[11px] border-b border-slate-800 pb-1 mb-1">{hoveredAlertProv.name}</h4>
            <p className="text-[10px] text-slate-400 capitalize">
              Status: <span className="font-bold text-sky-400">{hoveredAlertProv.warningLevel || hoveredAlertProv.areaType || "Active Advisory"}</span>
            </p>
            {hoveredAlertProv.alert?.event && (
              <p className="text-[9px] text-slate-500 font-mono">Event: {hoveredAlertProv.alert.event}</p>
            )}
          </div>
        )}

        {/* Decorative Atmosphere Glow Filters for Premium Feel */}
        {mode === 'rainfall' ? (
          <>
            <div className="absolute top-1/4 left-1/2 w-48 h-48 bg-sky-500/5 blur-3xl rounded-full pointer-events-none z-10 animate-ripple"></div>
            <div className="absolute bottom-1/3 left-1/3 w-64 h-48 bg-blue-500/5 blur-3xl rounded-full pointer-events-none z-10 animate-ripple" style={{ animationDelay: "1.5s" }}></div>
          </>
        ) : (
          <>
            <div className="absolute top-1/4 left-[55%] w-48 h-48 bg-amber-500/5 blur-3xl rounded-full pointer-events-none z-10 animate-ripple"></div>
          </>
        )}
      </div>

      {/* ── SIDEBAR PANEL (PAGASA WEATHER ALERT DESK STYLE) (RIGHT SIDE) ── */}
      <div className={`w-full md:w-80 lg:w-96 flex-1 md:flex-none bg-[#090d16]/95 md:bg-[#050811]/90 backdrop-blur-xl border-t md:border-t-0 md:border-l border-slate-800/80 flex flex-col z-20 overflow-hidden shadow-[-15px_0_35px_rgba(0,0,0,0.6)] ${
        mobileTab !== "list" ? "hidden md:flex" : "flex flex-1 h-full w-full"
      }`}>

        {/* PAGASA Style Header */}
        <div className="bg-gradient-to-r from-sky-950/80 to-blue-950/80 p-5 pt-20 md:pt-5 border-b border-sky-850/60 text-center relative overflow-hidden flex-shrink-0">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(14,165,233,0.1)_0%,transparent_70%)] pointer-events-none" />
          <h1 className="text-lg font-black tracking-widest text-white uppercase flex items-center justify-center gap-2">
            <AlertTriangle className="w-5 h-5 text-sky-400 animate-pulse" />
            <span>Weather Advisory</span>
          </h1>
          <p className="text-xs font-semibold text-sky-300 uppercase tracking-widest mt-1">CAP Bulletins Desk</p>

          {/* Mode Sliding Controls */}
          <div className="flex rounded-xl border border-white/5 bg-slate-950/80 p-1 mt-3.5 shadow-inner w-full justify-center">
            <button
              type="button"
              onClick={() => { setMode("rainfall"); setSelectedProvince(null); }}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[10px] font-black tracking-wider transition-all duration-300 cursor-pointer ${
                mode === "rainfall"
                  ? "bg-slate-800 text-sky-400 shadow-md border border-white/5"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <CloudRain className="h-3.5 w-3.5" />
              <span>RAINFALL</span>
            </button>
            <button
              type="button"
              onClick={() => { setMode("thunderstorm"); setSelectedProvince(null); }}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[10px] font-black tracking-wider transition-all duration-300 cursor-pointer ${
                mode === "thunderstorm"
                  ? "bg-slate-800 text-amber-400 shadow-md border border-white/5"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Zap className="h-3.5 w-3.5" />
              <span>THUNDER</span>
            </button>
          </div>

          <div className="mt-3 flex flex-col gap-1 items-center font-mono">
            <span className="text-[9px] text-slate-300 bg-slate-950/70 py-0.5 px-2.5 rounded-full border border-slate-900 w-fit">
              System: {dynamicWeatherSystem}
            </span>
            <span className="text-[8px] text-slate-500 uppercase tracking-wider mt-1.5">
              Run: {lastUpdated ? lastUpdated.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }) + " PST" : "---"}
            </span>
          </div>
        </div>

        {/* Scrollable Alerts Body Section */}
        <div className="p-4 flex-1 overflow-y-auto space-y-4 scrollbar-none">
          
          {/* expandable selectedProvince drawer details */}
          {selectedProvince && (
            <div className="bg-gradient-to-r from-slate-900 to-indigo-950/80 border border-sky-500/40 rounded-2xl p-4.5 shadow-lg relative overflow-hidden transition-all duration-350 animate-in fade-in duration-250">
              <div className="absolute top-2.5 right-2.5 z-20">
                <button 
                  onClick={() => setSelectedProvince(null)} 
                  className="p-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-white transition-all cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="absolute top-0 left-0 w-1 h-full bg-sky-500"></div>

              <div className="flex items-center gap-2 mb-2.5">
                <div className="px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-400 text-[8.5px] font-black uppercase tracking-wider">
                  {selectedProvince.severity}
                </div>
                <h4 className="text-sm font-black text-white">{selectedProvince.province}</h4>
              </div>

              <p className="text-[11px] text-slate-300 leading-relaxed mb-3.5">
                {selectedProvince.alertDetails?.message || selectedProvince.alertDetails?.headline || "Monitoring active PAGASA weather system alerts."}
              </p>

              {selectedProvince.municipalities.length > 0 && (
                <div>
                  <h5 className="text-[8.5px] uppercase font-black tracking-widest text-slate-500 mb-2">Affected Sector Areas:</h5>
                  <div className="max-h-28 overflow-y-auto pr-1 flex flex-wrap gap-1 text-[10px] text-slate-300">
                    {selectedProvince.municipalities.map(m => (
                      <span key={m} className="px-1.5 py-0.5 rounded bg-slate-950/60 border border-white/5">{m}</span>
                    ))}
                  </div>
                </div>
              )}
              
              <div className="flex justify-between items-center text-[8.5px] text-slate-500 font-mono mt-3.5 pt-2.5 border-t border-white/5">
                <span>Issued: {selectedProvince.alertDetails?.issued_date ? new Date(selectedProvince.alertDetails.issued_date).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }) : "---"}</span>
                {selectedProvince.alertDetails?.expires && (
                  <span className="text-amber-500">Expires: {new Date(selectedProvince.alertDetails.expires).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}</span>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between border-b border-slate-900 pb-2 mb-2">
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-slate-500" />
              <span>Active Warnings ({activePolygons.length})</span>
            </h3>
          </div>

          {error && (
            <div className="flex items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-red-300">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <p className="text-xs">{error}</p>
            </div>
          )}

          {!loading && !error && mode === "rainfall" && (
            <div className="flex flex-col gap-4">
              
              {/* Red Warning Card */}
              {Object.keys(rainfallSummary.red).length > 0 && (
                <div className="bg-slate-950/40 rounded-xl overflow-hidden border border-red-950 shadow-lg group transition-all duration-300 hover:border-red-900/60">
                  <div className="bg-gradient-to-r from-red-700 to-red-600 px-4 py-2 flex justify-between items-center text-white text-xs font-bold tracking-widest uppercase">
                    <span>Red Warning</span>
                  </div>
                  <div className="p-4 text-xs text-slate-400 leading-relaxed space-y-2">
                    <p className="text-slate-400">Serious flooding is expected. Take immediate action.</p>
                    {renderAreaListDict(rainfallSummary.red, "bg-red-500/10 border-red-500/35 text-red-300", "border-red-500/50", "Red Warning", "🔴")}
                  </div>
                </div>
              )}

              {/* Orange Warning Card */}
              {Object.keys(rainfallSummary.orange).length > 0 && (
                <div className="bg-slate-950/40 rounded-xl overflow-hidden border border-orange-950 shadow-lg group transition-all duration-300 hover:border-orange-900/60">
                  <div className="bg-gradient-to-r from-orange-600 to-orange-500 px-4 py-2 flex justify-between items-center text-white text-xs font-bold tracking-widest uppercase">
                    <span>Orange Warning</span>
                  </div>
                  <div className="p-4 text-xs text-slate-400 leading-relaxed space-y-2">
                    <p className="text-slate-400">Flooding is threatening. Be fully prepared.</p>
                    {renderAreaListDict(rainfallSummary.orange, "bg-orange-500/10 border-orange-500/30 text-orange-300", "border-orange-500/40", "Orange Warning", "🟠")}
                  </div>
                </div>
              )}

              {/* Yellow Warning Card */}
              {Object.keys(rainfallSummary.yellow).length > 0 && (
                <div className="bg-slate-950/40 rounded-xl overflow-hidden border border-yellow-950 shadow-lg group transition-all duration-300 hover:border-yellow-900/60">
                  <div className="bg-gradient-to-r from-yellow-500 to-yellow-400 px-4 py-2 flex justify-between items-center text-slate-900 text-xs font-extrabold tracking-widest uppercase">
                    <span>Yellow Warning</span>
                  </div>
                  <div className="p-4 text-xs text-slate-400 leading-relaxed space-y-2">
                    <p className="text-slate-400">Flooding is possible. Keep monitoring.</p>
                    {renderAreaListDict(rainfallSummary.yellow, "bg-yellow-500/10 border-yellow-500/30 text-yellow-300", "border-yellow-500/30", "Yellow Warning", "🟡")}
                  </div>
                </div>
              )}

              {/* Light-Moderate Rain Card */}
              {(Object.keys(rainfallSummary.moderate).length > 0 || Object.keys(rainfallSummary.severe).length > 0) && (
                <div className="bg-slate-950/40 rounded-xl overflow-hidden border border-slate-800/80 shadow-lg group transition-all duration-300 hover:border-slate-700">
                  <div className="bg-slate-800/60 px-4 py-2 flex justify-between items-center text-slate-300 text-xs font-bold tracking-widest uppercase">
                    <span>Light to Moderate Rainfall</span>
                  </div>
                  <div className="p-4 text-xs text-slate-400 leading-relaxed space-y-2">
                    <p className="text-slate-400">Light showers observed. Keep safe.</p>
                    {renderAreaListDict({ ...rainfallSummary.severe, ...rainfallSummary.moderate }, "bg-cyan-500/10 border-cyan-500/30 text-cyan-300", "border-cyan-500/30", "Light-Moderate Rain", "💧")}
                  </div>
                </div>
              )}

              {/* Expecting Rainfall Card */}
              {Object.keys(rainfallSummary.expected).length > 0 && (
                <div className="bg-slate-950/40 rounded-xl overflow-hidden border border-slate-900 shadow-lg group transition-all duration-300">
                  <div className="bg-slate-900/40 px-4 py-2 flex justify-between items-center text-slate-400 text-xs font-bold tracking-widest uppercase">
                    <span>Expecting Rainfall</span>
                  </div>
                  <div className="p-4 text-xs text-slate-400 leading-relaxed space-y-2">
                    <p className="text-slate-400">Rain likely to develop or occur within 1-2 hours.</p>
                    {renderAreaListDict(rainfallSummary.expected, "bg-slate-800 text-slate-300 border-slate-700", "border-slate-700", "Expecting Rain", "☁️")}
                  </div>
                </div>
              )}

              {Object.keys(rainfallSummary.red).length === 0 && 
               Object.keys(rainfallSummary.orange).length === 0 && 
               Object.keys(rainfallSummary.yellow).length === 0 && 
               Object.keys(rainfallSummary.moderate).length === 0 && 
               Object.keys(rainfallSummary.severe).length === 0 && 
               Object.keys(rainfallSummary.expected).length === 0 && (
                <div className="p-8 text-center bg-slate-950/20 rounded-2xl border border-dashed border-white/5">
                  <CloudRain className="w-10 h-10 text-slate-600 mx-auto mb-2 opacity-50" />
                  <p className="text-xs text-slate-500 italic">No active rainfall warnings found.</p>
                </div>
              )}
            </div>
          )}

          {!loading && !error && mode === "thunderstorm" && (
            <div className="flex flex-col gap-4">
              
              {/* Affecting Thunderstorm */}
              {thunderSummary.affecting.length > 0 && (
                <div className="bg-slate-950/40 rounded-xl overflow-hidden border border-amber-950 shadow-lg group transition-all duration-300 hover:border-amber-900/60">
                  <div className="bg-gradient-to-r from-amber-600 to-amber-500 px-4 py-2 flex justify-between items-center text-white text-xs font-bold tracking-widest uppercase">
                    <span>Affecting Areas</span>
                  </div>
                  <div className="p-4 text-xs text-slate-400 leading-relaxed space-y-2">
                    <p className="text-slate-450">Moderate to heavy rain showers with lightning and strong winds are actively occurring.</p>
                    {renderAreaListArray(thunderSummary.affecting, "bg-amber-500/10 border-amber-500/35 text-amber-300", "border-amber-500/40", "Advisory Affecting", "⚡")}
                  </div>
                </div>
              )}

              {/* Expecting Thunderstorm */}
              {thunderSummary.expected.length > 0 && (
                <div className="bg-slate-950/40 rounded-xl overflow-hidden border border-yellow-950 shadow-lg group transition-all duration-300 hover:border-yellow-900/60">
                  <div className="bg-gradient-to-r from-yellow-500 to-yellow-400 px-4 py-2 flex justify-between items-center text-slate-950 text-xs font-black tracking-widest uppercase">
                    <span>Expecting Areas</span>
                  </div>
                  <div className="p-4 text-xs text-slate-400 leading-relaxed space-y-2">
                    <p className="text-slate-450">Favorable conditions for thunderstorm cells to develop or drift inside these zones within 2 hours.</p>
                    {renderAreaListArray(thunderSummary.expected, "bg-yellow-500/10 border-yellow-500/30 text-yellow-300", "border-yellow-500/30", "Advisory Expecting", "⛈️")}
                  </div>
                </div>
              )}

              {thunderSummary.affecting.length === 0 && thunderSummary.expected.length === 0 && (
                <div className="p-8 text-center bg-slate-950/20 rounded-2xl border border-dashed border-white/5">
                  <Zap className="w-10 h-10 text-slate-600 mx-auto mb-2 opacity-50" />
                  <p className="text-xs text-slate-500 italic">No active thunderstorm advisories found.</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Public Safety Precaution Bar Footer (Flex Shrink 0) */}
        <div className="bg-slate-950 p-4 border-t border-slate-900 flex flex-col gap-2 relative flex-shrink-0">
          <div className="bg-slate-900/30 border border-white/5 rounded-2xl p-3 flex items-start gap-3">
            <div className="text-sm shrink-0">⚠️</div>
            <div>
              <h5 className="text-slate-350 font-bold text-[10px] mb-0.5">Public Safety Precaution</h5>
              <p className="text-[9px] text-slate-500 leading-relaxed">
                Residents residing in warning/advisory sectors are instructed to check emergency supplies, monitor updates, and follow any local precaution cues.
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
  );
};

export default Alert;
