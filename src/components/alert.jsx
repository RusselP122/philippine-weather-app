import React, { useEffect, useMemo, useState, useRef } from "react";
import { CloudRain, Zap, AlertTriangle, Wind, Info, MapPin, Maximize2, Search, X, ChevronRight, CheckCircle2, ChevronDown, Camera, Download, Layers, ShieldAlert, Compass, FileText, Map as MapIcon, TrendingUp } from "lucide-react";

// Robustly handle API URL - fallback to known working endpoint patterns if needed
const ALERTS_URL = "/api/cap-alerts";

const PH_BOUNDS = [
  [4, 116],
  [22.5, 127.5],
];

const ADVISORY_AFFECTING_COLOR = "#0ea5e9";
const ADVISORY_AFFECTING_EDGE = "#0284c7";
const ADVISORY_EXPECTING_COLOR = "#93c5fd";
const ADVISORY_EXPECTING_EDGE = "#60a5fa";

const THUNDER_AFFECTING_COLOR = "#f59e0b";
const THUNDER_AFFECTING_EDGE = "#d97706";
const THUNDER_EXPECTING_COLOR = "#fcd34d";
const THUNDER_EXPECTING_EDGE = "#f59e0b";

const WARNING_LEVEL_COLORS = {
  yellow: { fill: "#facc15", edge: "#eab308" },
  orange: { fill: "#f97316", edge: "#ea580c" },
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

function geojsonGeometryToLatLngs(geometry) {
  if (!geometry) return null;
  const { type, coordinates } = geometry;
  if (!coordinates) return null;

  const toLatLng = (pair) => {
    if (!Array.isArray(pair) || pair.length < 2) return null;
    const [lon, lat] = pair;
    return [lat, lon];
  };

  const convertRing = (ring) =>
    ring
      .map(toLatLng)
      .filter((p) => p !== null);

  if (type === "Polygon") {
    return coordinates.map(convertRing);
  }

  if (type === "MultiPolygon") {
    const rings = [];
    coordinates.forEach((poly) => {
      if (Array.isArray(poly)) {
        poly.forEach(ring => {
          if (Array.isArray(ring)) {
            const r = convertRing(ring);
            if (r.length) rings.push(r);
          }
        });
      }
    });
    return rings.length ? rings : null;
  }

  return null;
}

function findProvinceGeometry(name, geoData) {
  if (!name || !geoData || !geoData.features) return null;

  let cleanName = String(name).trim().toLowerCase();
  if (cleanName.includes("manila")) {
    cleanName = "metropolitan manila";
  }

  // Try exact match first
  let feature = geoData.features.find(f => {
    const provName = String(f.properties.PROV_NAME || f.properties.PROVINCE || f.properties.NAME_1 || f.properties.name || "").trim().toLowerCase();
    return provName === cleanName;
  });

  if (feature) return feature.geometry;

  // Try substring match if not found exactly
  feature = geoData.features.find(f => {
    const provName = String(f.properties.PROV_NAME || f.properties.PROVINCE || f.properties.NAME_1 || f.properties.name || "").trim().toLowerCase();
    return provName.includes(cleanName) || cleanName.includes(provName);
  });

  return feature ? feature.geometry : null;
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

function collectProvincePolygons(alerts, geoData) {
  const results = [];
  alerts.forEach((alert) => {
    const provinces = normalizeProvinces(alert.provinces);
    provinces.forEach((prov, index) => {
      const name = prov.province || prov.areaDesc;
      if (!name) return;

      const muniName = prov.municipality || "";
      let latlngs = null;
      let isFallback = false;

      if (prov.shape) {
        latlngs = shapeToLatLngs(prov.shape);
      }
      if (!latlngs && prov.polygon) {
        latlngs = polygonStringToLatLngs(prov.polygon);
      }

      // Fallback: If no geometry exists on the province entry, look it up in geoData
      if (!latlngs && geoData) {
        const geom = findProvinceGeometry(name, geoData);
        if (geom) {
          latlngs = geojsonGeometryToLatLngs(geom);
          isFallback = true;
        }
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
        id: `${alert.identifier || alert.headline || "alert"}-${name}-${muniName || index}`,
        name,
        muniName,
        latlngs,
        alert,
        provinceMeta: prov,
        areaType,
        warningLevel,
        isFallback
      });
    });
  });

  // Deduplicate by province name (for fallback province geometries) or province+municipality (for municipality geometries)
  const severityRank = {
    red: 5,
    orange: 4,
    yellow: 3,
    affecting: 2,
    "light-moderate": 2,
    "light moderate": 2,
    moderate: 2,
    expecting: 1,
    expected: 1
  };

  const getRank = (item) => {
    const type = String(item.areaType || "").toLowerCase();
    const level = String(item.warningLevel || "").toLowerCase();
    return Math.max(severityRank[type] || 0, severityRank[level] || 0);
  };

  const deduplicated = {};
  results.forEach((item) => {
    let key;
    if (item.isFallback || !item.muniName) {
      key = `prov-${item.name.toLowerCase().trim()}`;
    } else {
      key = `muni-${item.name.toLowerCase().trim()}-${item.muniName.toLowerCase().trim()}`;
    }

    if (!deduplicated[key] || getRank(item) > getRank(deduplicated[key])) {
      deduplicated[key] = item;
    }
  });

  return Object.values(deduplicated);
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

      if (pType === "expecting" || pType === "expected") {
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
      if (pType === "affecting" || pType === "light-moderate" || pType === "light moderate" || pType === "moderate") {
        addToCategory("moderate", provinceName, municipalityName);
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
  const [showLabels, setShowLabels] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);
  const [hoveredAlertProv, setHoveredAlertProv] = useState(null);
  const [isExporting, setIsExporting] = useState(false);

  const mapContainerRef = useRef(null);
  const dashboardRef = useRef(null);

  // 1. Dynamic bounds and projection mapping logic
  const canvasWidth = 1000;
  const canvasHeight = 1400;

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

  // 2. Base map layout shapes with Lake Masks
  const mapData = useMemo(() => {
    if (!geoData) return null;

    let minLon = 180, maxLon = -180;
    let minLat = 90, maxLat = -90;

    // Scan coordinates to find strict bounding box limits
    const findBounds = (c) => {
      if (typeof c[0] === 'number') {
        const [lon, lat] = c;
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      } else {
        c.forEach(findBounds);
      }
    };

    geoData.features.forEach((f) => {
      findBounds(f.geometry.coordinates);
    });

    // Dynamic projection function inside useMemo
    const localProject = (lon, lat) => {
      const x = ((lon - minLon) / (maxLon - minLon)) * canvasWidth;
      const y = ((maxLat - lat) / (maxLat - minLat)) * canvasHeight;
      return [x, y];
    };

    const projectedFeatures = geoData.features.map((f) => {
      const provName = f.properties.PROV_NAME || f.properties.PROVINCE || f.properties.NAME_1 || f.properties.name || "Unknown";
      const region = f.properties.REGION || "";
      const group = getIslandGroup(region);

      const generateD = (coords, type) => {
        if (type === "Polygon") {
          return coords.map(ring => {
            return ring.map((coord, index) => {
              const [x, y] = localProject(coord[0], coord[1]);
              return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
            }).join(' ') + ' Z';
          }).join(' ');
        } else if (type === "MultiPolygon") {
          return coords.map(poly => {
            return poly.map(ring => {
              return ring.map((coord, index) => {
                const [x, y] = localProject(coord[0], coord[1]);
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
          const [x, y] = localProject(lon, lat);
          sumX += x;
          sumY += y;
          count++;
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

    const bounds = {
      All: { minX: 0, maxX: 1000, minY: 0, maxY: canvasHeight },
      Luzon: { minX: canvasWidth, maxX: 0, minY: canvasHeight, maxY: 0 },
      Visayas: { minX: canvasWidth, maxX: 0, minY: canvasHeight, maxY: 0 },
      Mindanao: { minX: canvasWidth, maxX: 0, minY: canvasHeight, maxY: 0 }
    };

    // Calculate strict bounding box enclosing each island group (matching WeatherAdvisory)
    projectedFeatures.forEach((f) => {
      const g = f.group;
      const originalFeature = geoData.features.find(
        (orig) =>
          (orig.properties.ID_1 || orig.properties.PROV_NAME || orig.properties.PROVINCE || orig.properties.NAME_1) === f.id ||
          orig.properties.PROV_NAME === f.name
      );

      if (originalFeature) {
        const updateBounds = (c) => {
          if (typeof c[0] === 'number') {
            const [lon, lat] = c;
            const [x, y] = localProject(lon, lat);
            if (x < bounds[g].minX) bounds[g].minX = x;
            if (x > bounds[g].maxX) bounds[g].maxX = x;
            if (y < bounds[g].minY) bounds[g].minY = y;
            if (y > bounds[g].maxY) bounds[g].maxY = y;
          } else {
            c.forEach(updateBounds);
          }
        };
        updateBounds(originalFeature.geometry.coordinates);
      }
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

    // Extract overlay paths for Laguna de Bay, Taal Lake, and Taal Volcano to mask colors
    const batangasFeature = geoData.features.find(f => {
      const name = f.properties.PROV_NAME || f.properties.PROVINCE || f.properties.NAME_1 || f.properties.name || "";
      return name === "Batangas";
    });
    const lagunaFeature = geoData.features.find(f => {
      const name = f.properties.PROV_NAME || f.properties.PROVINCE || f.properties.NAME_1 || f.properties.name || "";
      return name === "Laguna";
    });

    const projectRing = (ring) => {
      return ring.map((coord, index) => {
        const [x, y] = localProject(coord[0], coord[1]);
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ') + ' Z';
    };

    let taalLakePath = "";
    let taalVolcanoPath = "";
    if (batangasFeature && batangasFeature.geometry.type === "MultiPolygon") {
      const coords = batangasFeature.geometry.coordinates;
      if (coords[2] && coords[2][1]) {
        taalLakePath = projectRing(coords[2][1]);
      }
      if (coords[3] && coords[3][0]) {
        taalVolcanoPath = projectRing(coords[3][0]);
      }
    }

    let lagunaDeBayPath = "";
    if (lagunaFeature && lagunaFeature.geometry.type === "Polygon") {
      const coords = lagunaFeature.geometry.coordinates;
      if (coords[2]) {
        lagunaDeBayPath = projectRing(coords[2]);
      }
    }

    return {
      features: projectedFeatures,
      bounds,
      canvasWidth,
      canvasHeight,
      lagunaDeBayPath,
      taalLakePath,
      taalVolcanoPath,
      project: localProject
    };
  }, [geoData]);

  const project = mapData?.project || ((lon, lat) => {
    // Fallback static projection
    const minLon = 114.0;
    const maxLon = 128.0;
    const minLat = 4.0;
    const maxLat = 22.0;
    const x = ((lon - minLon) / (maxLon - minLon)) * canvasWidth;
    const y = ((maxLat - lat) / (maxLat - minLat)) * canvasHeight;
    return [x, y];
  });

  // Compute active viewBox coordinate bounds dynamically based on region selection
  const activeViewBox = useMemo(() => {
    if (!mapData) return "0 0 1000 1400";
    const b = mapData.bounds[activeRegion];
    if (!b) return "0 0 1000 1400";
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    return `${b.minX.toFixed(1)} ${b.minY.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`;
  }, [mapData, activeRegion]);

  // Dynamic infographic map SVG-to-PNG exporter (Dynamic Legend, Title, and Lists)
  const exportMapAsPNG = () => {
    const svgElement = mapContainerRef.current?.querySelector("svg");
    if (!svgElement) return;
    setIsExporting(true);

    try {
      let col1Name = "", col2Name = "", col3Name = "", col4Name = "", col5Name = "";
      let col1Color = "", col2Color = "", col3Color = "", col4Color = "", col5Color = "";
      let col1Count = 0, col2Count = 0, col3Count = 0, col4Count = 0, col5Count = 0;
      let col1List = [], col2List = [], col3List = [], col4List = [], col5List = [];

      if (mode === "rainfall") {
        col1Name = "RED"; col1Color = "#ef4444"; col1Count = Object.keys(rainfallSummary.red).length; col1List = Object.keys(rainfallSummary.red).sort();
        col2Name = "ORANGE"; col2Color = "#f97316"; col2Count = Object.keys(rainfallSummary.orange).length; col2List = Object.keys(rainfallSummary.orange).sort();
        col3Name = "YELLOW"; col3Color = "#facc15"; col3Count = Object.keys(rainfallSummary.yellow).length; col3List = Object.keys(rainfallSummary.yellow).sort();
        col4Name = "LT BLUE"; col4Color = "#38BDF8"; col4Count = Object.keys({ ...rainfallSummary.severe, ...rainfallSummary.moderate }).length; col4List = Object.keys({ ...rainfallSummary.severe, ...rainfallSummary.moderate }).sort();
        col5Name = "EXPECTING"; col5Color = "#93c5fd"; col5Count = Object.keys(rainfallSummary.expected).length; col5List = Object.keys(rainfallSummary.expected).sort();
      } else {
        col1Name = "AFFECTING"; col1Color = "#F59E0B"; col1Count = thunderSummary.affecting.length; col1List = [...thunderSummary.affecting].sort();
        col2Name = "EXPECTING"; col2Color = "#FBBF24"; col2Count = thunderSummary.expected.length; col2List = [...thunderSummary.expected].sort();
      }

      const renderProvinceList = (provinces, xPos, startY, color) => {
        if (provinces.length === 0) {
          return `<text x="${xPos}" y="${startY}" fill="#475569" font-size="9.5" text-anchor="middle" font-style="italic">None</text>`;
        }
        let markup = "";
        const maxLines = 10;
        for (let i = 0; i < provinces.length; i++) {
          if (i >= maxLines) {
            markup += `<text x="${xPos}" y="${startY + i * 11.5}" fill="${color}" font-size="8.5" font-weight="bold" text-anchor="middle">+ ${provinces.length - maxLines} more</text>`;
            break;
          }
          markup += `<text x="${xPos}" y="${startY + i * 11.5}" fill="#e2e8f0" font-size="9" text-anchor="middle">${provinces[i]}</text>`;
        }
        return markup;
      };

      const clonedSvg = svgElement.cloneNode(true);
      clonedSvg.setAttribute("viewBox", "0 0 1400 1400");
      clonedSvg.setAttribute("width", "1400");
      clonedSvg.setAttribute("height", "1400");
      clonedSvg.removeAttribute("style");

      // Clean up interactive map controls in cloned document
      clonedSvg.querySelectorAll(".no-export").forEach(el => el.remove());

      const svgNS = "http://www.w3.org/2000/svg";
      const latestAlert = alerts[0] || {};
      const validityText1 = latestAlert.issued_date ? `Issued: ${new Date(latestAlert.issued_date).toLocaleString("en-PH")}` : "Real-time CAP Alerts Feed";
      const validityText2 = latestAlert.expires ? `Expires: ${new Date(latestAlert.expires).toLocaleString("en-PH")}` : `Updated: ${lastUpdated ? lastUpdated.toLocaleString("en-PH") : "N/A"}`;

      // 1. Dynamic Map Title Block
      const titleGroup = document.createElementNS(svgNS, "g");
      titleGroup.setAttribute("transform", "translate(1010, 60)");
      titleGroup.setAttribute("font-family", "monospace");
      titleGroup.innerHTML = `
        <rect x="0" y="0" width="370" height="240" rx="14" fill="rgba(9, 13, 22, 0.95)" stroke="rgba(255, 255, 255, 0.15)" stroke-width="1.2" />
        <text x="25" y="40" fill="#38bdf8" font-size="15" font-weight="bold" letter-spacing="1.5">Rainfall Advisory</text>
        <text x="25" y="65" fill="#f1f5f9" font-size="13" font-weight="bold" font-family="sans-serif">${mode.toUpperCase()} HAZARDS</text>
        <line x1="25" y1="80" x2="345" y2="80" stroke="rgba(255, 255, 255, 0.12)" stroke-width="1" />
        <text x="25" y="108" fill="#e2e8f0" font-size="11" font-weight="bold" font-family="sans-serif">SYSTEM STATUS DETAILS:</text>
        <text x="25" y="132" fill="#38bdf8" font-size="11.5" font-weight="bold">${dynamicWeatherSystem}</text>
        <text x="25" y="156" fill="#cbd5e1" font-size="11" font-weight="bold">${validityText1}</text>
        <text x="25" y="176" fill="#fb923c" font-size="11" font-weight="bold">${validityText2}</text>
        <line x1="25" y1="196" x2="345" y2="196" stroke="rgba(255, 255, 255, 0.08)" stroke-width="1" />
        <text x="25" y="218" fill="#64748b" font-size="10.5">Aggregator Desk Feed (Real-Time CAP)</text>
      `;
      clonedSvg.appendChild(titleGroup);

      // 2. Warning Level Legend Box
      const legendGroup = document.createElementNS(svgNS, "g");
      legendGroup.setAttribute("transform", "translate(1010, 320)");
      legendGroup.setAttribute("font-family", "sans-serif");

      let legendHTML = "";
      if (mode === "rainfall") {
        legendHTML = `
          <rect x="0" y="0" width="370" height="370" rx="14" fill="rgba(9, 13, 22, 0.95)" stroke="rgba(255, 255, 255, 0.15)" stroke-width="1.2" />
          <text x="25" y="38" fill="#38bdf8" font-size="13" font-weight="bold" letter-spacing="1.5" font-family="monospace">WARNING LEVEL LEGEND</text>
          <line x1="25" y1="50" x2="345" y2="50" stroke="rgba(255, 255, 255, 0.12)" stroke-width="1" />
          
          <rect x="25" y="68" width="22" height="22" rx="6" fill="#ef4444" stroke="rgba(255, 255, 255, 0.2)" stroke-width="0.5" />
          <text x="60" y="84" fill="#f1f5f9" font-size="12" font-weight="bold">Red Warning (Critical)</text>
          <text x="60" y="100" fill="#94a3b8" font-size="10">Serious flooding expected. Evacuate.</text>
          
          <rect x="25" y="120" width="22" height="22" rx="6" fill="#f97316" stroke="rgba(255, 255, 255, 0.2)" stroke-width="0.5" />
          <text x="60" y="136" fill="#f1f5f9" font-size="12" font-weight="bold">Orange Alert (Prepare)</text>
          <text x="60" y="152" fill="#94a3b8" font-size="10">Flooding threatening. High landslide risk.</text>
          
          <rect x="25" y="172" width="22" height="22" rx="6" fill="#facc15" stroke="rgba(255, 255, 255, 0.2)" stroke-width="0.5" />
          <text x="60" y="188" fill="#f1f5f9" font-size="12" font-weight="bold">Yellow Advisory (Monitor)</text>
          <text x="60" y="204" fill="#94a3b8" font-size="10">Low-lying flooding possible.</text>
          
          <rect x="25" y="224" width="22" height="22" rx="6" fill="#38BDF8" stroke="rgba(255, 255, 255, 0.2)" stroke-width="0.5" />
          <text x="60" y="240" fill="#f1f5f9" font-size="12" font-weight="bold">Light-Moderate Rain (Observe)</text>
          <text x="60" y="256" fill="#94a3b8" font-size="10">Showers observed. Exercise caution.</text>
          
          <rect x="25" y="276" width="22" height="22" rx="6" fill="#93c5fd" stroke="rgba(255, 255, 255, 0.2)" stroke-width="0.5" />
          <text x="60" y="292" fill="#f1f5f9" font-size="12" font-weight="bold">Expecting Rainfall (Standby)</text>
          <text x="60" y="308" fill="#94a3b8" font-size="10">Rain likely to develop within 1-2 hours.</text>
        `;
      } else {
        legendHTML = `
          <rect x="0" y="0" width="370" height="370" rx="14" fill="rgba(9, 13, 22, 0.95)" stroke="rgba(255, 255, 255, 0.15)" stroke-width="1.2" />
          <text x="25" y="38" fill="#38bdf8" font-size="13" font-weight="bold" letter-spacing="1.5" font-family="monospace">WARNING LEVEL LEGEND</text>
          <line x1="25" y1="50" x2="345" y2="50" stroke="rgba(255, 255, 255, 0.12)" stroke-width="1" />
          <rect x="25" y="68" width="24" height="24" rx="6" fill="#f59e0b" stroke="rgba(255, 255, 255, 0.2)" stroke-width="0.5" />
          <text x="62" y="85" fill="#f1f5f9" font-size="13" font-weight="bold">Affecting Areas</text>
          <text x="62" y="102" fill="#94a3b8" font-size="10.5">Heavy rains, lightning, strong winds occurring.</text>
          <rect x="25" y="124" width="24" height="24" rx="6" fill="#fbbf24" stroke="rgba(255, 255, 255, 0.2)" stroke-width="0.5" />
          <text x="62" y="141" fill="#f1f5f9" font-size="13" font-weight="bold">Expecting Areas</text>
          <text x="62" y="158" fill="#94a3b8" font-size="10.5">Favorable conditions for cell development.</text>
        `;
      }
      legendGroup.innerHTML = legendHTML;
      clonedSvg.appendChild(legendGroup);

      // 3. Dynamic Warning Metrics Box
      const metricsGroup = document.createElementNS(svgNS, "g");
      metricsGroup.setAttribute("transform", "translate(1010, 710)");
      metricsGroup.setAttribute("font-family", "sans-serif");

      let metricsHTML = "";
      if (mode === "rainfall") {
        const col1ListMarkup = renderProvinceList(col1List, 30, 92, col1Color);
        const col2ListMarkup = renderProvinceList(col2List, 30, 92, col2Color);
        const col3ListMarkup = renderProvinceList(col3List, 30, 92, col3Color);
        const col4ListMarkup = renderProvinceList(col4List, 30, 92, col4Color);
        const col5ListMarkup = renderProvinceList(col5List, 30, 92, col5Color);

        metricsHTML = `
          <rect x="0" y="0" width="370" height="290" rx="14" fill="rgba(9, 13, 22, 0.95)" stroke="rgba(255, 255, 255, 0.15)" stroke-width="1.2" />
          <text x="25" y="38" fill="#38bdf8" font-size="13" font-weight="bold" letter-spacing="1.5" font-family="monospace">PROVINCIAL WARNING METRICS</text>
          <line x1="25" y1="50" x2="345" y2="50" stroke="rgba(255, 255, 255, 0.12)" stroke-width="1" />
          
          <g transform="translate(25, 70)">
            <g>
              <rect x="0" y="0" width="60" height="65" rx="10" fill="rgba(239, 68, 68, 0.12)" stroke="rgba(239, 68, 68, 0.25)" stroke-width="1" />
              <text x="30" y="35" fill="#ef4444" font-size="24" font-weight="bold" text-anchor="middle">${col1Count}</text>
              <text x="30" y="52" fill="#ef4444" font-size="8.5" font-weight="bold" text-anchor="middle" letter-spacing="0.5">${col1Name}</text>
              <line x1="6" y1="78" x2="54" y2="78" stroke="rgba(255, 255, 255, 0.08)" stroke-width="0.8" />
              ${col1ListMarkup}
            </g>
            <g transform="translate(65, 0)">
              <rect x="0" y="0" width="60" height="65" rx="10" fill="rgba(249, 115, 22, 0.12)" stroke="rgba(249, 115, 22, 0.25)" stroke-width="1" />
              <text x="30" y="35" fill="#f97316" font-size="24" font-weight="bold" text-anchor="middle">${col2Count}</text>
              <text x="30" y="52" fill="#f97316" font-size="8.5" font-weight="bold" text-anchor="middle" letter-spacing="0.5">${col2Name}</text>
              <line x1="6" y1="78" x2="54" y2="78" stroke="rgba(255, 255, 255, 0.08)" stroke-width="0.8" />
              ${col2ListMarkup}
            </g>
            <g transform="translate(130, 0)">
              <rect x="0" y="0" width="60" height="65" rx="10" fill="rgba(250, 204, 21, 0.12)" stroke="rgba(250, 204, 21, 0.25)" stroke-width="1" />
              <text x="30" y="35" fill="#facc15" font-size="24" font-weight="bold" text-anchor="middle">${col3Count}</text>
              <text x="30" y="52" fill="#facc15" font-size="8.5" font-weight="bold" text-anchor="middle" letter-spacing="0.5">${col3Name}</text>
              <line x1="6" y1="78" x2="54" y2="78" stroke="rgba(255, 255, 255, 0.08)" stroke-width="0.8" />
              ${col3ListMarkup}
            </g>
            <g transform="translate(195, 0)">
              <rect x="0" y="0" width="60" height="65" rx="10" fill="rgba(56, 189, 248, 0.12)" stroke="rgba(56, 189, 248, 0.25)" stroke-width="1" />
              <text x="30" y="35" fill="#38bdf8" font-size="24" font-weight="bold" text-anchor="middle">${col4Count}</text>
              <text x="30" y="52" fill="#38bdf8" font-size="8.5" font-weight="bold" text-anchor="middle" letter-spacing="0.5">${col4Name}</text>
              <line x1="6" y1="78" x2="54" y2="78" stroke="rgba(255, 255, 255, 0.08)" stroke-width="0.8" />
              ${col4ListMarkup}
            </g>
            <g transform="translate(260, 0)">
              <rect x="0" y="0" width="60" height="65" rx="10" fill="rgba(147, 197, 253, 0.12)" stroke="rgba(147, 197, 253, 0.25)" stroke-width="1" />
              <text x="30" y="35" fill="#93c5fd" font-size="24" font-weight="bold" text-anchor="middle">${col5Count}</text>
              <text x="30" y="52" fill="#60a5fa" font-size="8.5" font-weight="bold" text-anchor="middle" letter-spacing="0.5">${col5Name}</text>
              <line x1="6" y1="78" x2="54" y2="78" stroke="rgba(255, 255, 255, 0.08)" stroke-width="0.8" />
              ${col5ListMarkup}
            </g>
          </g>
        `;
      } else {
        const col1ListMarkup = renderProvinceList(col1List, 78, 92, col1Color);
        const col2ListMarkup = renderProvinceList(col2List, 78, 92, col2Color);

        metricsHTML = `
          <rect x="0" y="0" width="370" height="290" rx="14" fill="rgba(9, 13, 22, 0.95)" stroke="rgba(255, 255, 255, 0.15)" stroke-width="1.2" />
          <text x="25" y="38" fill="#38bdf8" font-size="13" font-weight="bold" letter-spacing="1.5" font-family="monospace">PROVINCIAL WARNING METRICS</text>
          <line x1="25" y1="50" x2="345" y2="50" stroke="rgba(255, 255, 255, 0.12)" stroke-width="1" />
          
          <g transform="translate(25, 70)">
            <g>
              <rect x="0" y="0" width="156" height="65" rx="10" fill="rgba(245, 158, 11, 0.12)" stroke="rgba(245, 158, 11, 0.25)" stroke-width="1" />
              <text x="78" y="35" fill="#f59e0b" font-size="24" font-weight="bold" text-anchor="middle">${col1Count}</text>
              <text x="78" y="52" fill="#f59e0b" font-size="9" font-weight="bold" text-anchor="middle" letter-spacing="0.5">${col1Name}</text>
              <line x1="8" y1="78" x2="148" y2="78" stroke="rgba(255, 255, 255, 0.08)" stroke-width="0.8" />
              ${col1ListMarkup}
            </g>
            <g transform="translate(164, 0)">
              <rect x="0" y="0" width="156" height="65" rx="10" fill="rgba(252, 211, 77, 0.12)" stroke="rgba(252, 211, 77, 0.25)" stroke-width="1" />
              <text x="78" y="35" fill="#fbbf24" font-size="24" font-weight="bold" text-anchor="middle">${col2Count}</text>
              <text x="78" y="52" fill="#fbbf24" font-size="9" font-weight="bold" text-anchor="middle" letter-spacing="0.5">${col2Name}</text>
              <line x1="8" y1="78" x2="148" y2="78" stroke="rgba(255, 255, 255, 0.08)" stroke-width="0.8" />
              ${col2ListMarkup}
            </g>
          </g>
        `;
      }
      metricsGroup.innerHTML = metricsHTML;
      clonedSvg.appendChild(metricsGroup);

      const serializer = new XMLSerializer();
      let svgString = serializer.serializeToString(clonedSvg);
      const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
      const URL = window.URL || window.webkitURL || window;
      const blobURL = URL.createObjectURL(svgBlob);

      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 1400;
        canvas.height = 1400;
        const ctx = canvas.getContext("2d");

        ctx.fillStyle = "#020617";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const pngURL = canvas.toDataURL("image/png");
        const downloadLink = document.createElement("a");
        downloadLink.href = pngURL;
        downloadLink.download = `PAGASA_CAP_Alert_${mode.toUpperCase()}_${new Date().toISOString().split('T')[0]}.png`;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        URL.revokeObjectURL(blobURL);
        setIsExporting(false);
      };
      img.src = blobURL;
    } catch (err) {
      console.error("Failed to export SVG as PNG:", err);
      setIsExporting(false);
    }
  };



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
    () => collectProvincePolygons(rainfallAlerts, geoData),
    [rainfallAlerts, geoData]
  );

  const thunderPolygons = useMemo(
    () => collectProvincePolygons(thunderAlerts, geoData),
    [thunderAlerts, geoData]
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

  // 7. Dynamic region boundary zoom logic is handled automatically via activeViewBox inside the SVG viewBox attribute.

  const handleMouseMove = (e) => {
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
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border flex items-center gap-1.5 cursor-pointer text-left ${isHovered || isSelected
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
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border flex items-center gap-1.5 cursor-pointer text-left ${isHovered || isSelected
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
    <div ref={dashboardRef} data-screenshot-root className="relative h-[calc(100vh-64px)] w-full bg-slate-950 font-sans overflow-hidden flex flex-col md:flex-row selection:bg-sky-500 selection:text-white">
      <style>{`
        [data-screenshot-root] {
          --color-slate-950: #020617;
          --color-slate-900: #0f172a;
          --color-slate-800: #1e293b;
          --color-slate-700: #334155;
          --color-slate-650: #475569;
          --color-slate-600: #475569;
          --color-slate-500: #64748b;
          --color-slate-450: #94a3b8;
          --color-slate-400: #94a3b8;
          --color-slate-350: #cbd5e1;
          --color-slate-300: #cbd5e1;
          --color-sky-950: #082f49;
          --color-sky-900: #0c4a6e;
          --color-sky-500: #0ea5e9;
          --color-sky-450: #38bdf8;
          --color-sky-400: #38bdf8;
          --color-red-950: #450a0a;
          --color-red-500: #ef4444;
          --color-red-400: #f87171;
          --color-orange-950: #431407;
          --color-orange-600: #ea580c;
          --color-orange-500: #f97316;
          --color-orange-400: #fb923c;
          --color-yellow-950: #422006;
          --color-yellow-500: #eab308;
          --color-yellow-450: #facc15;
          --color-yellow-400: #facc15;
          --color-yellow-350: #fde047;
          --color-yellow-300: #fde047;
          --color-purple-950: #3b0764;
          --color-purple-500: #a855f7;
          --color-purple-400: #c084fc;
          --color-purple-305: #d8b4fe;
          --color-purple-300: #d8b4fe;
          --color-amber-950: #451a03;
          --color-amber-600: #d97706;
          --color-amber-500: #f59e0b;
          --color-amber-450: #fbbf24;
          --color-amber-400: #fbbf24;
          --color-amber-305: #fde68a;
          --color-amber-300: #fde68a;
          --color-emerald-500: #10b981;
          --color-emerald-400: #34d399;
          --color-indigo-950: #1e1b4b;
          --color-cyan-500: #06b6d4;
          --color-cyan-305: #cffafe;
          --color-cyan-300: #cffafe;
        }
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
      <div className="md:hidden absolute top-4 left-4 right-4 z-[2000] flex rounded-2xl border border-white/10 bg-slate-900/90 p-1 backdrop-blur-md shadow-2xl no-export">
        <button
          onClick={() => setMobileTab("map")}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${mobileTab === "map" ? "bg-slate-800 text-sky-400 shadow-md border border-white/5" : "text-slate-400"
            }`}
        >
          🗺️ Interactive Map
        </button>
        <button
          onClick={() => setMobileTab("list")}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${mobileTab === "list" ? "bg-slate-800 text-sky-400 shadow-md border border-white/5" : "text-slate-400"
            }`}
        >
          📋 Warnings {activePolygons.length > 0 && `(${activePolygons.length})`}
        </button>
      </div>

      {/* ── INTERACTIVE DYNAMIC MAP CONTAINER (LEFT SIDE) ── */}
      <div
        ref={mapContainerRef}
        className={`relative w-full md:h-full md:flex-grow md:flex-1 bg-[#020617] overflow-hidden flex items-center justify-center border-b md:border-b-0 border-slate-800/80 ${mobileTab !== "map" ? "hidden md:flex" : "flex flex-1 h-full w-full"
          }`}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => {
          setIsTooltipVisible(false);
          setHoveredProvince(null);
          setHoveredAlertProv(null);
        }}
      >
        {/* Radar-like background grid lines */}
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_center,rgba(15,23,42,0.6)_0%,rgba(2,6,23,1)_95%)]" />

        {/* Dynamic Zooming SVG Map Canvas */}
        {mapData && (
          <svg
            className="w-auto h-full max-h-full max-w-full aspect-[1000/1400] relative z-10 select-none cursor-crosshair transition-all duration-[1200ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]"
            viewBox={activeViewBox}
            style={{
              filter: "drop-shadow(0 25px 50px rgba(0, 0, 0, 0.4))",
            }}
            onClick={() => {
              setHoveredProvince(null);
              setSelectedProvince(null);
              setIsTooltipVisible(false);
            }}
          >
            {/* Fine Technical Grid Lines */}
            <defs>
              <pattern id="grid" width="100" height="100" patternUnits="userSpaceOnUse">
                <path d="M 100 0 L 0 0 0 100" fill="none" stroke="rgba(51, 65, 85, 0.15)" strokeWidth="0.8" />
              </pattern>
            </defs>
            <rect width={mapData.canvasWidth} height={mapData.canvasHeight} fill="url(#grid)" />

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

            {/* Vintage compass rose */}
            <g transform="translate(90, 135)" className="opacity-[0.25] pointer-events-none font-mono">
              <circle r="48" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
              <circle r="40" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="0.8" strokeDasharray="2 3" />
              <line x1="0" y1="-55" x2="0" y2="55" stroke="rgba(255,255,255,0.25)" strokeWidth="0.8" />
              <line x1="-55" y1="0" x2="55" y2="0" stroke="rgba(255,255,255,0.25)" strokeWidth="0.8" />
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
                const isHovered = hoveredProvince === feature.name;
                const isSelected = selectedProvince?.province === feature.name;
                const isActive = isHovered || isSelected;

                return (
                  <path
                    key={`base-${feature.id}`}
                    d={feature.d}
                    fill="#334155"
                    stroke={isActive ? "#ffffff" : "rgba(15, 23, 42, 0.4)"}
                    strokeWidth={isActive ? 2.5 : 0.8}
                    className="transition-all duration-300 hover:fill-slate-800/40 cursor-pointer"
                    style={{
                      opacity: hoveredProvince
                        ? (isHovered ? 1 : 0.45)
                        : (selectedProvince ? (isSelected ? 1 : 0.55) : 1),
                      filter: isActive ? "drop-shadow(0 0 8px rgba(255,255,255,0.4)) brightness(1.15)" : "none"
                    }}
                    onMouseEnter={() => {
                      setHoveredProvince(feature.name);
                    }}
                    onMouseLeave={() => {
                      setHoveredProvince(null);
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      const correspondingPolygon = activePolygons.find(p => p.name === feature.name);
                      setSelectedProvince({
                        province: feature.name,
                        severity: correspondingPolygon?.warningLevel || correspondingPolygon?.areaType || "Active Alert",
                        municipalities: correspondingPolygon?.provinceMeta?.municipality ? [correspondingPolygon.provinceMeta.municipality] : [],
                        alertDetails: correspondingPolygon?.alert
                      });
                    }}
                  />
                );
              })}
            </g>

            {/* Warning polygons */}
            <g>
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
                    areaType === "light-moderate" ||
                    areaType === "light moderate" ||
                    areaType === "moderate" ||
                    areaType === "expecting" ||
                    areaType === "expected" ||
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

                  let fillOpacity = 0.65;
                  if (mode === "rainfall") {
                    if (areaType === "affecting" || areaType === "light-moderate" || areaType === "light moderate" || areaType === "moderate") {
                      fillColor = "#38bdf8";
                      borderColor = "#38bdf8";
                      fillOpacity = 0.55;
                    } else if (areaType === "expecting" || areaType === "expected") {
                      fillColor = "#93c5fd";
                      borderColor = "#60a5fa";
                      fillOpacity = 0.55;
                    } else if (levelKey === "red") {
                      fillColor = "#ef4444";
                      borderColor = "#dc2626";
                    } else if (levelKey === "orange") {
                      fillColor = "#f97316";
                      borderColor = "#ea580c";
                    } else if (levelKey === "yellow") {
                      fillColor = "#facc15";
                      borderColor = "#eab308";
                    } else {
                      fillColor = "#38bdf8";
                      borderColor = "#38bdf8";
                      fillOpacity = 0.55;
                    }
                  } else {
                    if (areaType === "affecting") {
                      fillColor = "#f59e0b";
                      borderColor = "#f59e0b";
                    } else if (areaType === "expecting") {
                      fillColor = "#fbbf24";
                      borderColor = "#fbbf24";
                      fillOpacity = 0.55;
                    } else if (levelKey === "red") {
                      fillColor = "#ef4444";
                      borderColor = "#dc2626";
                    } else if (levelKey === "orange") {
                      fillColor = "#f97316";
                      borderColor = "#ea580c";
                    } else if (levelKey === "yellow") {
                      fillColor = "#facc15";
                      borderColor = "#eab308";
                    } else {
                      fillColor = "#f59e0b";
                      borderColor = "#f59e0b";
                      fillOpacity = 0.55;
                    }
                  }

                  const pathD = generatePathFromLatLngs(prov.latlngs);
                  const isSyncHovered = hoveredProvince === prov.name;

                  return (
                    <path
                      key={`${prov.id}-${mode}-svg`}
                      d={pathD}
                      fill={fillColor}
                      fillOpacity={fillOpacity}
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

            {/* Uncolored Lake overlays to cover warning colors on Laguna de Bay and Taal Volcano */}
            <g pointer-events="none">
              {mapData.lagunaDeBayPath && (
                <path d={mapData.lagunaDeBayPath} fill="#020617" stroke="rgba(15, 23, 42, 0.4)" strokeWidth={0.8} />
              )}
              {mapData.taalLakePath && (
                <path d={mapData.taalLakePath} fill="#020617" stroke="rgba(15, 23, 42, 0.4)" strokeWidth={0.8} />
              )}
              {mapData.taalVolcanoPath && (
                <path d={mapData.taalVolcanoPath} fill="#020617" stroke="rgba(15, 23, 42, 0.4)" strokeWidth={0.8} />
              )}
            </g>

            {/* Interactive Province Labels */}
            <g className="pointer-events-none select-none font-mono no-export">
              {mapData.features.map((feature) => {
                const correspondingPolygon = activePolygons.find(p => p.name === feature.name);
                const isHovered = hoveredProvince === feature.name;
                const isSelected = selectedProvince?.province === feature.name;
                const isActive = isHovered || isSelected;

                if (showLabels && feature.centroid && (correspondingPolygon || isActive)) {
                  return (
                    <g key={`lbl-${feature.id}`} transform={`translate(${feature.centroid[0]}, ${feature.centroid[1]})`}>
                      <rect
                        x={-(feature.name.length * 3.2 + 6)}
                        y="-15"
                        width={feature.name.length * 6.4 + 12}
                        height="18"
                        rx="4"
                        fill="rgba(15, 23, 42, 0.85)"
                        stroke="rgba(255,255,255,0.15)"
                        strokeWidth="0.5"
                      />
                      <text
                        y="-3"
                        textAnchor="middle"
                        fill={isActive ? "#ffffff" : "#cbd5e1"}
                        fontSize="8.5"
                        fontWeight={correspondingPolygon ? "bold" : "normal"}
                      >
                        {feature.name}
                      </text>
                    </g>
                  );
                }
                return null;
              })}
            </g>
          </svg>
        )}

        {/* Floating Controller overlay (Top Left) */}
        <div className="absolute top-16 md:top-4 left-4 right-4 z-20 flex flex-row md:flex-col items-center md:items-start gap-2 flex-wrap pointer-events-none">
          {/* Island Group Selector */}
          <div className="bg-slate-950/80 backdrop-blur-md p-1 rounded-lg border border-slate-800/80 shadow-xl flex gap-1 pointer-events-auto no-export">
            {["All", "Luzon", "Visayas", "Mindanao"].map((region) => (
              <button
                key={region}
                onClick={() => setActiveRegion(region)}
                className={`px-2.5 py-1 rounded text-[10px] sm:text-xs font-bold tracking-wide uppercase cursor-pointer transition-all duration-300 ${activeRegion === region
                  ? "bg-sky-500 text-white shadow-md shadow-sky-500/10 scale-105"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/50"
                  }`}
              >
                {region}
              </button>
            ))}
          </div>

          <div className="flex gap-2 pointer-events-auto no-export">
            {/* Toggle Map Labels */}
            <button
              onClick={() => setShowLabels(!showLabels)}
              className={`px-2.5 py-1.5 rounded-lg text-[10px] sm:text-xs font-semibold backdrop-blur-md border shadow-lg flex items-center justify-center gap-1 cursor-pointer transition-all duration-300 ${showLabels
                ? "bg-emerald-600/80 text-white border-emerald-500"
                : "bg-slate-950/80 text-slate-400 border-slate-800 hover:bg-slate-900/80"
                }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>{showLabels ? "Hide Names" : "Names"}</span>
            </button>

            {/* Export PNG Infographic Exporter */}
            <button
              onClick={exportMapAsPNG}
              disabled={isExporting}
              className="px-2.5 py-1.5 rounded-lg text-[10px] sm:text-xs font-semibold backdrop-blur-md border border-slate-800 shadow-lg flex items-center justify-center gap-1 cursor-pointer bg-slate-950/80 text-slate-400 hover:bg-slate-900/80 hover:text-sky-400 transition-all duration-300 disabled:opacity-50"
            >
              {isExporting ? (
                <>
                  <span className="animate-spin rounded-full h-3 w-3 border border-sky-400 border-t-transparent"></span>
                  <span>Generating...</span>
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" />
                  <span>Export</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Map Legend Overlay (Bottom Left) */}
        <div className="absolute bottom-6 left-6 z-[1000] bg-slate-950/95 backdrop-blur-md border border-slate-700/80 p-4 rounded-2xl shadow-2xl flex flex-col gap-2.5 no-export max-w-[220px]">
          <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-400">Map Legend</h3>
          <div className="flex flex-col gap-2 text-xs font-medium text-slate-200">
            {mode === "rainfall" ? (
              <>
                <div className="flex items-center gap-2.5">
                  <span className="w-3 h-3 rounded bg-red-500 border border-red-400/50 shadow-[0_0_8px_rgba(239,68,68,0.6)] shrink-0"></span>
                  <span className="text-slate-200">Red Alert (Critical)</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="w-3 h-3 rounded bg-orange-500 border border-orange-400/50 shadow-[0_0_8px_rgba(249,115,22,0.6)] shrink-0"></span>
                  <span className="text-slate-200">Orange Alert (Prepare)</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="w-3 h-3 rounded bg-yellow-400 border border-yellow-300/50 shadow-[0_0_8px_rgba(250,204,21,0.6)] shrink-0"></span>
                  <span className="text-slate-200">Yellow Alert (Monitor)</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="w-3 h-3 rounded bg-sky-400 border border-sky-300/50 shadow-[0_0_8px_rgba(56,189,248,0.6)] shrink-0"></span>
                  <span className="text-slate-200">Light-Moderate Rain</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="w-3 h-3 rounded bg-blue-400 border border-blue-300/50 shadow-[0_0_8px_rgba(96,165,250,0.6)] shrink-0"></span>
                  <span className="text-slate-200">Expecting Areas</span>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2.5">
                  <span className="w-3 h-3 rounded bg-amber-500 border border-amber-400/50 shadow-[0_0_8px_rgba(245,158,11,0.6)] shrink-0"></span>
                  <span className="text-slate-200">Affecting Areas</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="w-3 h-3 rounded bg-yellow-400 border border-yellow-300/50 shadow-[0_0_8px_rgba(250,204,21,0.6)] shrink-0"></span>
                  <span className="text-slate-200">Expecting Areas</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── DYNAMIC CURSOR FLOATING GLASS TOOLTIP ── */}
        {isTooltipVisible && hoveredAlertProv && (
          <div
            className="absolute z-50 pointer-events-none w-72 rounded-xl border border-slate-700/60 bg-slate-950/90 p-4 text-slate-200 shadow-2xl backdrop-blur-lg flex flex-col gap-2.5 no-export"
            style={{
              left: tooltipPos.x,
              top: tooltipPos.y,
              transform: "translate3d(0, 0, 0)"
            }}
          >
            {/* Tooltip Header */}
            <div className="flex justify-between items-start border-b border-slate-800 pb-2">
              <div>
                <h3 className="font-bold text-slate-100 text-sm tracking-wide">{hoveredAlertProv.name}</h3>
                <p className="text-[10px] font-semibold text-sky-400 uppercase tracking-wider mt-0.5">
                  CAP Warning Zone
                </p>
              </div>
              <MapPin className="w-4 h-4 text-sky-400 opacity-80" />
            </div>

            {/* Severity and status reading */}
            <div className="flex items-center gap-4 bg-slate-900/60 px-3 py-2 rounded-lg border border-slate-800">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-sky-500/10 text-sky-400">
                <CloudRain className="w-4 h-4 animate-pulse" />
              </div>
              <div>
                <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">Warning Level</p>
                <p className="text-sm font-bold text-white tracking-wide capitalize">
                  {hoveredAlertProv.warningLevel || hoveredAlertProv.areaType || "Active Alert"}
                </p>
              </div>
            </div>

            {/* Alert Message Details */}
            {hoveredAlertProv.alert && (
              <div className="p-2.5 rounded-lg border border-slate-800/80 bg-slate-900/40 text-[10px] leading-relaxed">
                <p className="text-slate-350 line-clamp-3">{hoveredAlertProv.alert.headline || hoveredAlertProv.alert.message}</p>
              </div>
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
      <div className={`w-full md:w-80 lg:w-96 flex-1 md:flex-none bg-[#090d16]/95 md:bg-[#050811]/90 backdrop-blur-xl border-t md:border-t-0 md:border-l border-slate-800/80 flex flex-col z-20 overflow-hidden shadow-[-15px_0_35px_rgba(0,0,0,0.6)] ${mobileTab !== "list" ? "hidden md:flex" : "flex flex-1 h-full w-full"
        }`}>

        {/* PAGASA Style Header */}
        <div className="bg-gradient-to-r from-sky-950/80 to-blue-950/80 p-5 pt-20 md:pt-5 border-b border-sky-850/60 text-center relative overflow-hidden flex-shrink-0">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(14,165,233,0.1)_0%,transparent_70%)] pointer-events-none" />

          <div className="absolute top-20 right-4 md:top-5 md:right-5 no-export">
            <button
              onClick={exportMapAsPNG}
              disabled={isExporting}
              title="Export Alert Summary Image"
              className="p-2 bg-slate-950/60 hover:bg-slate-900 border border-slate-800 rounded-xl text-sky-400 cursor-pointer transition-all hover:scale-105 active:scale-95 flex items-center justify-center"
            >
              {isExporting ? (
                <span className="animate-spin rounded-full h-4 w-4 border-2 border-sky-400 border-t-transparent"></span>
              ) : (
                <Camera className="w-4 h-4" />
              )}
            </button>
          </div>

          <div className="flex items-center justify-center gap-1.5 mb-1.5 no-export">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-[9px] font-black text-emerald-400 tracking-widest uppercase">Live Desk Feed</span>
          </div>

          <h1 className="text-lg font-black tracking-widest text-white uppercase flex items-center justify-center gap-2">
            <AlertTriangle className="w-5 h-5 text-sky-400 animate-pulse" />
            <span>Weather Advisory</span>
          </h1>
          <p className={`text-xs font-semibold uppercase tracking-widest mt-1 ${mode === "rainfall" ? "text-sky-300" : "text-amber-400"}`}>
            PAGASA {mode === "rainfall" ? "RAINFALL" : "THUNDERSTORM"} ADVISORY
          </p>

          {/* Mode Sliding Controls */}
          <div className="flex rounded-xl border border-white/5 bg-slate-950/80 p-1 mt-3.5 shadow-inner w-full justify-center">
            <button
              type="button"
              onClick={() => { setMode("rainfall"); setSelectedProvince(null); }}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[10px] font-black tracking-wider transition-all duration-300 cursor-pointer ${mode === "rainfall"
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
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[10px] font-black tracking-wider transition-all duration-300 cursor-pointer ${mode === "thunderstorm"
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

        {/* ── STATS OVERVIEW DASHBOARD ── */}
        <div className={`grid gap-1.5 px-4 py-3 bg-slate-950/60 border-b border-slate-900/60 flex-shrink-0 no-export ${mode === 'rainfall' ? 'grid-cols-5' : 'grid-cols-4'}`}>
          {mode === "rainfall" ? (
            <>
              <div className="flex flex-col items-center justify-center p-1 rounded bg-red-500/10 border border-red-500/20 animate-in fade-in duration-200">
                <span className="text-xs font-mono font-black text-red-500">{Object.keys(rainfallSummary.red).length}</span>
                <span className="text-[8.5px] text-red-400 font-bold uppercase tracking-wider mt-0.5">Red</span>
              </div>
              <div className="flex flex-col items-center justify-center p-1 rounded bg-orange-500/10 border border-orange-500/20 animate-in fade-in duration-200">
                <span className="text-xs font-mono font-black text-orange-500">{Object.keys(rainfallSummary.orange).length}</span>
                <span className="text-[8.5px] text-orange-400 font-bold uppercase tracking-wider mt-0.5">Orange</span>
              </div>
              <div className="flex flex-col items-center justify-center p-1 rounded bg-yellow-500/10 border border-yellow-500/20 animate-in fade-in duration-200">
                <span className="text-xs font-mono font-black text-yellow-500">{Object.keys(rainfallSummary.yellow).length}</span>
                <span className="text-[8.5px] text-yellow-400 font-bold uppercase tracking-wider mt-0.5">Yellow</span>
              </div>
              <div className="flex flex-col items-center justify-center p-1 rounded bg-sky-500/10 border border-sky-500/20 animate-in fade-in duration-200">
                <span className="text-xs font-mono font-black text-sky-500">
                  {Object.keys({ ...rainfallSummary.severe, ...rainfallSummary.moderate }).length}
                </span>
                <span className="text-[8.5px] text-sky-400 font-bold uppercase tracking-wider mt-0.5">Lt-Mod</span>
              </div>
              <div className="flex flex-col items-center justify-center p-1 rounded bg-blue-500/10 border border-blue-500/20 animate-in fade-in duration-200">
                <span className="text-xs font-mono font-black text-blue-500">
                  {Object.keys(rainfallSummary.expected).length}
                </span>
                <span className="text-[8.5px] text-blue-400 font-bold uppercase tracking-wider mt-0.5">Expect</span>
              </div>
            </>
          ) : (
            <>
              <div className="col-span-2 flex flex-col items-center justify-center p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 animate-in fade-in duration-200">
                <span className="text-sm font-mono font-black text-amber-500">{thunderSummary.affecting.length}</span>
                <span className="text-[8.5px] text-amber-400 font-bold uppercase tracking-wider mt-0.5">Affecting</span>
              </div>
              <div className="col-span-2 flex flex-col items-center justify-center p-1.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20 animate-in fade-in duration-200">
                <span className="text-sm font-mono font-black text-yellow-500">{thunderSummary.expected.length}</span>
                <span className="text-[8.5px] text-yellow-400 font-bold uppercase tracking-wider mt-0.5">Expecting</span>
              </div>
            </>
          )}
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
            <div className="flex flex-col gap-4 animate-in fade-in duration-300">

              {/* Red Warning Card */}
              {Object.keys(rainfallSummary.red).length > 0 && (
                <div className="bg-gradient-to-br from-red-950/40 to-slate-900/60 border border-red-500/35 rounded-2xl overflow-hidden shadow-lg shadow-red-950/20 group transition-all duration-300 hover:border-red-500/50 hover:shadow-red-950/30">
                  <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-3 flex justify-between items-center text-white text-xs font-bold tracking-widest uppercase">
                    <div className="flex items-center gap-2">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                      </span>
                      <span className="text-red-400 font-extrabold tracking-wider">Red Warning Alert</span>
                    </div>
                    <span className="text-[10px] text-red-400 bg-red-500/15 px-2.5 py-0.5 rounded-full font-extrabold">CRITICAL</span>
                  </div>
                  <div className="p-4 text-xs text-slate-400 leading-relaxed space-y-3">
                    <p className="text-slate-300 font-medium">Serious flooding is expected. Take immediate action.</p>
                    {renderAreaListDict(rainfallSummary.red, "bg-red-500/10 border-red-500/35 text-red-305", "border-red-500/50", "Red Warning", "🔴")}
                  </div>
                </div>
              )}

              {/* Orange Warning Card */}
              {Object.keys(rainfallSummary.orange).length > 0 && (
                <div className="bg-gradient-to-br from-orange-950/40 to-slate-900/60 border border-orange-500/35 rounded-2xl overflow-hidden shadow-lg shadow-orange-950/20 group transition-all duration-300 hover:border-orange-500/50 hover:shadow-orange-950/30">
                  <div className="bg-orange-500/10 border-b border-orange-500/20 px-4 py-3 flex justify-between items-center text-white text-xs font-bold tracking-widest uppercase">
                    <div className="flex items-center gap-2">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500"></span>
                      </span>
                      <span className="text-orange-400 font-extrabold tracking-wider">Orange Warning Alert</span>
                    </div>
                    <span className="text-[10px] text-orange-400 bg-orange-500/15 px-2.5 py-0.5 rounded-full font-extrabold">PREPARE</span>
                  </div>
                  <div className="p-4 text-xs text-slate-400 leading-relaxed space-y-3">
                    <p className="text-slate-300 font-medium">Flooding is threatening. Be fully prepared.</p>
                    {renderAreaListDict(rainfallSummary.orange, "bg-orange-500/10 border-orange-500/30 text-orange-305", "border-orange-500/40", "Orange Warning", "🟠")}
                  </div>
                </div>
              )}

              {/* Yellow Warning Card */}
              {Object.keys(rainfallSummary.yellow).length > 0 && (
                <div className="bg-gradient-to-br from-yellow-950/30 to-slate-900/60 border border-yellow-500/35 rounded-2xl overflow-hidden shadow-lg shadow-yellow-950/10 group transition-all duration-300 hover:border-yellow-500/50 hover:shadow-yellow-950/20">
                  <div className="bg-yellow-500/10 border-b border-yellow-500/20 px-4 py-3 flex justify-between items-center text-white text-xs font-bold tracking-widest uppercase">
                    <div className="flex items-center gap-2">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-500"></span>
                      </span>
                      <span className="text-yellow-400 font-extrabold tracking-wider">Yellow Warning Alert</span>
                    </div>
                    <span className="text-[10px] text-yellow-450 bg-yellow-500/15 px-2.5 py-0.5 rounded-full font-extrabold">MONITOR</span>
                  </div>
                  <div className="p-4 text-xs text-slate-400 leading-relaxed space-y-3">
                    <p className="text-slate-300 font-medium">Flooding is possible. Keep monitoring.</p>
                    {renderAreaListDict(rainfallSummary.yellow, "bg-yellow-500/10 border-yellow-500/30 text-yellow-305", "border-yellow-500/30", "Yellow Warning", "🟡")}
                  </div>
                </div>
              )}

              {/* Light-Moderate Rain Card */}
              {(Object.keys(rainfallSummary.moderate).length > 0 || Object.keys(rainfallSummary.severe).length > 0) && (
                <div className="bg-gradient-to-br from-sky-950/30 to-slate-900/60 border border-sky-500/35 rounded-2xl overflow-hidden shadow-lg group transition-all duration-300 hover:border-sky-500/50">
                  <div className="bg-sky-500/10 border-b border-sky-500/20 px-4 py-3 flex justify-between items-center text-white text-xs font-bold tracking-widest uppercase">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-sky-400"></span>
                      <span className="text-sky-450 font-extrabold tracking-wider">Light to Moderate Rainfall</span>
                    </div>
                    <span className="text-[10px] text-sky-400 bg-sky-500/15 px-2.5 py-0.5 rounded-full font-extrabold">OBSERVE</span>
                  </div>
                  <div className="p-4 text-xs text-slate-400 leading-relaxed space-y-3">
                    <p className="text-slate-300 font-medium">Light showers observed. Keep safe.</p>
                    {renderAreaListDict({ ...rainfallSummary.severe, ...rainfallSummary.moderate }, "bg-cyan-500/10 border-cyan-500/30 text-cyan-305", "border-cyan-500/30", "Light-Moderate Rain", "💧")}
                  </div>
                </div>
              )}

              {/* Expecting Rainfall Card */}
              {Object.keys(rainfallSummary.expected).length > 0 && (
                <div className="bg-gradient-to-br from-blue-950/20 to-slate-900/60 border border-blue-500/35 rounded-2xl overflow-hidden shadow-lg group transition-all duration-300 hover:border-blue-500/50">
                  <div className="bg-blue-500/10 border-b border-blue-500/20 px-4 py-3 flex justify-between items-center text-white text-xs font-bold tracking-widest uppercase">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-blue-400"></span>
                      <span className="text-blue-400 font-extrabold tracking-wider">Expecting Rainfall</span>
                    </div>
                    <span className="text-[10px] text-blue-400 bg-blue-500/15 px-2.5 py-0.5 rounded-full font-extrabold">STANDBY</span>
                  </div>
                  <div className="p-4 text-xs text-slate-400 leading-relaxed space-y-3">
                    <p className="text-slate-300 font-medium">Rain likely to develop or occur within 1-2 hours.</p>
                    {renderAreaListDict(rainfallSummary.expected, "bg-blue-500/10 border-blue-500/30 text-blue-300", "border-blue-500/30", "Expecting Rain", "☁️")}
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
            <div className="flex flex-col gap-4 animate-in fade-in duration-300">

              {/* Affecting Thunderstorm */}
              {thunderSummary.affecting.length > 0 && (
                <div className="bg-gradient-to-br from-amber-950/40 to-slate-900/60 border border-amber-500/35 rounded-2xl overflow-hidden shadow-lg shadow-amber-950/20 group transition-all duration-300 hover:border-amber-500/50 hover:shadow-amber-950/30">
                  <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-3 flex justify-between items-center text-white text-xs font-bold tracking-widest uppercase">
                    <div className="flex items-center gap-2">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                      </span>
                      <span className="text-amber-450 font-extrabold tracking-wider">Affecting Areas</span>
                    </div>
                    <span className="text-[10px] text-amber-405 bg-amber-500/15 px-2.5 py-0.5 rounded-full font-extrabold">ACTIVE HAZARD</span>
                  </div>
                  <div className="p-4 text-xs text-slate-400 leading-relaxed space-y-3">
                    <p className="text-slate-300 font-medium">Moderate to heavy rain showers with lightning and strong winds are actively occurring.</p>
                    {renderAreaListArray(thunderSummary.affecting, "bg-amber-500/10 border-amber-500/30 text-amber-305", "border-amber-500/40", "Advisory Affecting", "⚡")}
                  </div>
                </div>
              )}

              {/* Expecting Thunderstorm */}
              {thunderSummary.expected.length > 0 && (
                <div className="bg-gradient-to-br from-yellow-950/30 to-slate-900/60 border border-yellow-500/35 rounded-2xl overflow-hidden shadow-lg shadow-yellow-950/10 group transition-all duration-300 hover:border-yellow-500/50 hover:shadow-yellow-950/20">
                  <div className="bg-yellow-500/10 border-b border-yellow-500/20 px-4 py-3 flex justify-between items-center text-white text-xs font-black tracking-widest uppercase">
                    <div className="flex items-center gap-2">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-500"></span>
                      </span>
                      <span className="text-yellow-450 font-extrabold tracking-wider">Expecting Areas</span>
                    </div>
                    <span className="text-[10px] text-yellow-400 bg-yellow-500/25 px-2.5 py-0.5 rounded-full font-extrabold">DEVELOPING</span>
                  </div>
                  <div className="p-4 text-xs text-slate-400 leading-relaxed space-y-3">
                    <p className="text-slate-300 font-medium">Favorable conditions for thunderstorm cells to develop or drift inside these zones within 2 hours.</p>
                    {renderAreaListArray(thunderSummary.expected, "bg-yellow-500/10 border-yellow-500/30 text-yellow-305", "border-yellow-500/30", "Advisory Expecting", "⛈️")}
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
              <h5 className="text-slate-200 font-bold text-[10px] mb-0.5">Public Safety Precaution</h5>
              <p className="text-[9px] text-slate-300 leading-relaxed">
                Residents residing in warning/advisory sectors are instructed to check emergency supplies, monitor updates, and follow any local precaution cues.
              </p>
            </div>
          </div>
          <div className="text-center text-[8px] text-slate-400 font-mono tracking-wider mt-1 uppercase">
            Philippine Weather Alert System | PAGASA Bulletins
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
