// src/components/TropicalCycloneInformation.jsx
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Activity, Gauge, MapPin, Navigation, Wind, X, Compass, ShieldAlert, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { getStormDisplayName } from "../utils/stormNaming";

const getThemeClasses = (code) => {
  const themes = {
    LPA: {
      text: "text-emerald-400",
      border: "border-emerald-500/30",
      accent: "text-emerald-400 border-emerald-500/30",
      bgLight: "bg-emerald-500/10",
      glow: "shadow-[0_0_20px_rgba(16,185,129,0.15)]",
      badge: "bg-emerald-500/20 text-emerald-300",
      threatBg: "bg-emerald-600"
    },
    TD: {
      text: "text-yellow-400",
      border: "border-yellow-500/30",
      accent: "text-yellow-400 border-yellow-500/30",
      bgLight: "bg-yellow-500/10",
      glow: "shadow-[0_0_20px_rgba(234,179,8,0.15)]",
      badge: "bg-yellow-400/20 text-yellow-300",
      threatBg: "bg-yellow-600"
    },
    TS: {
      text: "text-orange-400",
      border: "border-orange-500/30",
      accent: "text-orange-400 border-orange-500/30",
      bgLight: "bg-orange-500/10",
      glow: "shadow-[0_0_20px_rgba(249,115,22,0.15)]",
      badge: "bg-orange-500/20 text-orange-300",
      threatBg: "bg-orange-600"
    },
    STS: {
      text: "text-red-400",
      border: "border-red-500/30",
      accent: "text-red-400 border-red-500/30",
      bgLight: "bg-red-500/10",
      glow: "shadow-[0_0_20px_rgba(239,68,68,0.15)]",
      badge: "bg-red-500/20 text-red-300",
      threatBg: "bg-red-600"
    },
    TY: {
      text: "text-purple-400",
      border: "border-purple-500/30",
      accent: "text-purple-400 border-purple-500/30",
      bgLight: "bg-purple-500/10",
      glow: "shadow-[0_0_20px_rgba(168,85,247,0.15)]",
      badge: "bg-purple-500/20 text-purple-300",
      threatBg: "bg-purple-600"
    },
    STY: {
      text: "text-pink-400",
      border: "border-pink-500/30",
      accent: "text-pink-400 border-pink-500/30",
      bgLight: "bg-pink-500/10",
      glow: "shadow-[0_0_20px_rgba(236,72,153,0.15)]",
      badge: "bg-pink-500/20 text-pink-300",
      threatBg: "bg-pink-600"
    }
  };
  return themes[code] || themes.LPA;
};

const formatSpeed = (speedKmh, unit) => {
  if (speedKmh === null || speedKmh === undefined || isNaN(speedKmh)) return "N/A";
  if (unit === "kt") {
    return `${Math.round(speedKmh / 1.852)} kt`;
  }
  if (unit === "mph") {
    return `${Math.round(speedKmh * 0.621371)} mph`;
  }
  return `${speedKmh} km/h`;
};

const PAR_POLYGON = [
  [5.0, 115.0], [15.0, 115.0], [21.0, 120.0], [25.0, 120.0],
  [25.0, 135.0], [5.0, 135.0], [5.0, 115.0]
];

const DIRECTION_WORDS = {
  N: "North", NNE: "North-Northeast", NE: "Northeast", ENE: "East-Northeast",
  E: "East", ESE: "East-Southeast", SE: "Southeast", SSE: "South-Southeast",
  S: "South", SSW: "South-Southwest", SW: "Southwest", WSW: "West-Southwest",
  W: "West", WNW: "West-Northwest", NW: "Northwest", NNW: "North-Northwest",
};

const getDirectionWord = (label) => (label && DIRECTION_WORDS[label]) || label;

const windIntensityPercent = (wind) => Math.min(100, Math.round((wind / 220) * 100));

function isInsidePar(lat, lon) {
  const normLon = ((lon % 360) + 360) % 360;
  let inside = false;
  for (let i = 0, j = PAR_POLYGON.length - 1; i < PAR_POLYGON.length; j = i++) {
    const yi = PAR_POLYGON[i][0];
    const xi = PAR_POLYGON[i][1];
    const yj = PAR_POLYGON[j][0];
    const xj = PAR_POLYGON[j][1];
    const intersect = yi > lat !== yj > lat && normLon < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0000001) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distToSegmentSquared(p, v, w) {
  const pLat = p[0];
  let pLon = p[1];

  // Wrap pLon so it is close to v[1]
  let diffV = pLon - v[1];
  diffV = ((diffV + 180) % 360 + 360) % 360 - 180;
  pLon = v[1] + diffV;

  const l2 = (v[0] - w[0]) ** 2 + (v[1] - w[1]) ** 2;
  if (l2 === 0) return (pLat - v[0]) ** 2 + (pLon - v[1]) ** 2;
  let t = ((pLat - v[0]) * (w[0] - v[0]) + (pLon - v[1]) * (w[1] - v[1])) / l2;
  t = Math.max(0, Math.min(1, t));
  return (pLat - (v[0] + t * (w[0] - v[0]))) ** 2 + (pLon - (v[1] + t * (w[1] - v[1]))) ** 2;
}

function distanceToParKm(lat, lon) {
  const normLon = ((lon % 360) + 360) % 360;
  if (isInsidePar(lat, normLon)) return 0;
  let minDistSq = Infinity;
  for (let i = 0; i < PAR_POLYGON.length - 1; i++) {
    const distSq = distToSegmentSquared([lat, normLon], PAR_POLYGON[i], PAR_POLYGON[i + 1]);
    if (distSq < minDistSq) minDistSq = distSq;
  }
  return Math.round(Math.sqrt(minDistSq) * 111);
}

function getDirectionLabel(deg) {
  const directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  if (deg === null || deg === undefined || isNaN(deg) || deg < 0) return null;
  const index = Math.floor((deg + 11.25) / 22.5) % 16;
  return directions[index];
}

function to10MinWindKmH(from1MinKnots) {
  const tenMinKmh = from1MinKnots * 1.852;
  return Math.round(tenMinKmh / 5) * 5;
}

function toGustKmH(tenMinWindKmh) {
  return Math.round((tenMinWindKmh * 1.4) / 5) * 5;
}

function classifyTropicalCyclone(wind10MinKmh) {
  if (wind10MinKmh < 39) return { code: "LPA", label: "LOW PRESSURE AREA", color: "bg-emerald-500/20 text-emerald-300" };
  if (wind10MinKmh <= 61) return { code: "TD", label: "TROPICAL DEPRESSION", color: "bg-yellow-400/20 text-yellow-300" };
  if (wind10MinKmh <= 88) return { code: "TS", label: "TROPICAL STORM", color: "bg-orange-500/20 text-orange-300" };
  if (wind10MinKmh <= 117) return { code: "STS", label: "SEVERE TROPICAL STORM", color: "bg-red-500/20 text-red-300" };
  if (wind10MinKmh <= 184) return { code: "TY", label: "TYPHOON", color: "bg-purple-500/20 text-purple-300" };
  return { code: "STY", label: "SUPER TYPHOON", color: "bg-pink-500/20 text-pink-300" };
}

function threatLevelText(code) {
  if (["TY", "STY"].includes(code)) return "High";
  if (["STS", "TS"].includes(code)) return "Medium";
  if (code === "TD") return "Low";
  return "Monitoring";
}

function threatBgColor(code) {
  if (["TY", "STY"].includes(code)) return "bg-red-600";
  if (["STS", "TS"].includes(code)) return "bg-orange-600";
  if (code === "TD") return "bg-yellow-600";
  return "bg-slate-600";
}

function formatDataTime(date) {
  if (!date) return "-";
  return `${new Date(date).toLocaleString("en-PH", {
    timeZone: "Asia/Manila", year: "numeric", month: "short",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  })} PHST`;
}

function distanceAndBearingKmFromManila(lat, lon) {
  const manilaLat = 14.5995, manilaLon = 120.9842;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(lat - manilaLat), dLon = toRad(lon - manilaLon);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(manilaLat)) * Math.cos(toRad(lat)) * Math.sin(dLon / 2) ** 2;
  const distance = Math.round(6371 * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))));
  const y = Math.sin(dLon) * Math.cos(toRad(lat));
  const x = Math.cos(toRad(manilaLat)) * Math.sin(toRad(lat)) - Math.sin(toRad(manilaLat)) * Math.cos(toRad(lat)) * Math.cos(dLon);
  const brng = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return { distance, direction: getDirectionLabel(brng) };
}

function generateStormSummary({ displayName, classificationCode, windKmh, pressure, movementSpeedKmh, movementWord, distance, direction, threatLevel, insidePar, distToPar }, windUnit = "kmh") {
  const isLpa = classificationCode === "LPA";
  let summary = `${isLpa ? "A " : "The "}${displayName}`;
  if (distance && direction) summary += ` located near ${distance} km ${direction} of Manila`;

  if (movementSpeedKmh === 0) {
    summary += `, and is currently stationary`;
  } else if (movementSpeedKmh !== null && movementSpeedKmh > 0) {
    summary += `, moving ${movementWord?.toLowerCase() || "unknown direction"} at ${formatSpeed(movementSpeedKmh, windUnit)}`;
  } else {
    summary += `, with unknown movement speed`;
  }

  if (isLpa) {
    summary += `, bringing light to moderate rains. The potential for further development into a tropical depression is currently being monitored.`;
  } else {
    summary += `, bringing maximum sustained winds of ${formatSpeed(windKmh, windUnit)}${!isNaN(pressure) ? ` and central pressure of ${pressure} hPa.` : "."}`;
    if (classificationCode === "TD") summary += ` This system poses a potential threat for heavy rainfall.`;
    else if (["TS", "STS"].includes(classificationCode)) summary += ` This storm poses a significant threat of strong winds and heavy rainfall.`;
    else if (["TY", "STY"].includes(classificationCode)) summary += ` This is a highly dangerous system posing a severe threat of destructive winds and intense rainfall.`;
    else summary += ` ${threatLevel} threat of further development or impacts.`;
  }

  if (!insidePar && distToPar > 0) {
    summary += ` The system is currently outside the Philippine Area of Responsibility, approximately ${distToPar} km from the PAR boundary.`;
  }
  return summary;
}

// ─────────────────────────────────────────────────────────────────────────────
// UI Components
// ─────────────────────────────────────────────────────────────────────────────

const StormMediaViewer = ({ stormData, isOtherBasin }) => {
  const floaterId = stormData.atcfId?.toUpperCase();
  const [dapiyaImgUrl, setDapiyaImgUrl] = useState(null);
  const [imgError, setImgError] = useState(false);
  const [imageType, setImageType] = useState('RGB');
  const [isImageDownloading, setIsImageDownloading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("satellite"); // "satellite" | "spaghetti" | "windy"
  const [selectedModel, setSelectedModel] = useState("gdm_fnv3"); // "gdm_fnv3" | "ecmwf_ifs" | "ecmwf_aifs"
  const [selectedCycle, setSelectedCycle] = useState(stormData.initCycle || "00Z");
  const [spaghettiError, setSpaghettiError] = useState(false);
  const [spaghettiLoading, setSpaghettiLoading] = useState(true);
  const [urlAttempt, setUrlAttempt] = useState(0);

  // Manifest & Available Cycles
  const [manifestData, setManifestData] = useState([]);
  const [availableCycles, setAvailableCycles] = useState({ "00Z": true, "06Z": true, "12Z": true, "18Z": true });

  // Zoom & Pan Preservation State
  const [zoomScale, setZoomScale] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Extract normalized storm IDs
  const wpId = React.useMemo(() => {
    if (!floaterId) return "";
    const m = floaterId.match(/(?:WP)?(\d{2})/);
    return m ? `WP${m[1]}` : floaterId;
  }, [floaterId]);

  const numWId = React.useMemo(() => {
    if (!floaterId) return "";
    const m = floaterId.match(/(\d{2})W?/);
    return m ? `${m[1]}W` : floaterId;
  }, [floaterId]);

  const stormDateStr = React.useMemo(() => {
    if (stormData.initDate && stormData.initDate.length === 8) {
      return stormData.initDate;
    }
    const dt = stormData.analysis_time ? new Date(stormData.analysis_time) : (stormData.last_updated ? new Date(stormData.last_updated) : new Date());
    if (!isNaN(dt.getTime())) {
      return dt.toISOString().slice(0, 10).replace(/-/g, "");
    }
    return new Date().toISOString().slice(0, 10).replace(/-/g, "");
  }, [stormData]);

  // Load spaghetti manifest
  useEffect(() => {
    let isMounted = true;
    fetch('/data/spaghetti_manifest.json')
      .then(res => res.ok ? res.json() : [])
      .then(data => {
        if (isMounted) setManifestData(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (isMounted) setManifestData([]);
      });
    return () => { isMounted = false; };
  }, []);

  // Determine available cycles for the CURRENT storm & selected model
  useEffect(() => {
    const cycles = ["00Z", "06Z", "12Z", "18Z"];
    const avail = { "00Z": false, "06Z": false, "12Z": false, "18Z": false };

    const stormAtcfId = (stormData?.atcf_id || "").toUpperCase();
    let stormEntries = manifestData.filter(e => {
      const eStorm = (e.storm_id || "").toUpperCase();
      const eAtcf = (e.atcf_id || "").toUpperCase();
      return (
        (wpId && (eStorm === wpId.toUpperCase() || eAtcf === wpId.toUpperCase())) ||
        (numWId && (eStorm === numWId.toUpperCase() || eAtcf === numWId.toUpperCase())) ||
        (floaterId && (eStorm === floaterId.toUpperCase() || eAtcf === floaterId.toUpperCase())) ||
        (stormAtcfId && (eStorm.includes(stormAtcfId) || stormAtcfId.includes(eStorm) || eAtcf.includes(stormAtcfId) || stormAtcfId.includes(eAtcf)))
      ) && e.model === selectedModel;
    });

    if (stormEntries.length === 0) {
      // Invest fallback: if storm was upgraded (e.g. 92W -> 11W), match recent Invest entries in manifest
      stormEntries = manifestData.filter(e => {
        const eAtcf = (e.atcf_id || "").toUpperCase();
        const eStorm = (e.storm_id || "").toUpperCase();
        const isInvest = /^9\d[Ww]$/.test(eAtcf) || /^WP9\d$/i.test(eStorm);
        return isInvest && e.model === selectedModel;
      });
    }

    if (stormEntries.length > 0) {
      // Find the latest init_date in the manifest for this storm & model
      const latestInitDate = stormEntries.reduce((max, e) => (e.init_date > max ? e.init_date : max), "");
      const latestEntries = stormEntries.filter(e => e.init_date === latestInitDate);

      latestEntries.forEach(e => {
        if (e.cycle && avail.hasOwnProperty(e.cycle)) {
          avail[e.cycle] = true;
        }
      });
    }

    setAvailableCycles(avail);

    // Default to the latest available cycle for the latest init_date
    if (!avail[selectedCycle]) {
      const preferredOrder = ["18Z", "12Z", "06Z", "00Z"];
      const bestCycle = preferredOrder.find(c => avail[c]);
      if (bestCycle) {
        setSelectedCycle(bestCycle);
      }
    }
  }, [manifestData, wpId, numWId, floaterId, selectedModel, stormData]);

  // If the active tab is somehow spaghetti but the storm is out of basin, default back to satellite
  useEffect(() => {
    if (isOtherBasin && activeTab === "spaghetti") {
      setActiveTab("satellite");
    }
  }, [isOtherBasin, activeTab]);

  useEffect(() => {
    if (!floaterId) return;
    let isMounted = true;
    setDapiyaImgUrl(null);
    setImgError(false);
    setIsImageDownloading(true);

    const fetchDapiyaImage = async (isAutoRefresh = false) => {
      try {
        const dirUrl = `https://data.dapiya.top/history/${floaterId}/${imageType}/`;
        const response = await fetch(dirUrl);
        if (!response.ok) throw new Error(`Dapiya directory not found for ${imageType}`);
        const htmlText = await response.text();
        const matches = [...htmlText.matchAll(/href="([^"]+\.(png|jpg|jpeg|gif))"/gi)];
        if (matches.length > 0 && isMounted) {
          const newUrl = `${dirUrl}${matches[matches.length - 1][1]}`;
          setDapiyaImgUrl(curr => {
            if (isAutoRefresh && curr === newUrl) return curr;
            if (isAutoRefresh) setIsImageDownloading(true);
            return newUrl;
          });
        } else if (isMounted && !isAutoRefresh) setImgError(true);
      } catch (error) {
        if (isMounted && !isAutoRefresh) setImgError(true);
      }
    };

    fetchDapiyaImage(false);
    const refreshInterval = setInterval(() => fetchDapiyaImage(true), 5 * 60 * 1000);
    return () => { isMounted = false; clearInterval(refreshInterval); };
  }, [floaterId, imageType]);

  useEffect(() => {
    setUrlAttempt(0);
    setSpaghettiError(false);
    setSpaghettiLoading(true);
  }, [selectedModel, selectedCycle, stormDateStr, wpId]);

  useEffect(() => {
    document.body.style.overflow = isModalOpen ? 'hidden' : 'auto';
    return () => { document.body.style.overflow = 'auto'; };
  }, [isModalOpen]);

  // Compute spaghetti URL based on current attempt and manifest entries
  const spaghettiUrl = React.useMemo(() => {
    const stormAtcfId = (stormData?.atcf_id || "").toUpperCase();
    if (manifestData && manifestData.length > 0) {
      let stormEntries = manifestData.filter(e => {
        const eStorm = (e.storm_id || "").toUpperCase();
        const eAtcf = (e.atcf_id || "").toUpperCase();
        return (
          (wpId && (eStorm === wpId.toUpperCase() || eAtcf === wpId.toUpperCase())) ||
          (numWId && (eStorm === numWId.toUpperCase() || eAtcf === numWId.toUpperCase())) ||
          (floaterId && (eStorm === floaterId.toUpperCase() || eAtcf === floaterId.toUpperCase())) ||
          (stormAtcfId && (eStorm.includes(stormAtcfId) || stormAtcfId.includes(eStorm) || eAtcf.includes(stormAtcfId) || stormAtcfId.includes(eAtcf)))
        ) && e.model === selectedModel && e.cycle === selectedCycle;
      });

      if (stormEntries.length === 0) {
        // Fallback for newly upgraded storms to match recent invest entries in manifest
        stormEntries = manifestData.filter(e => {
          const eAtcf = (e.atcf_id || "").toUpperCase();
          const eStorm = (e.storm_id || "").toUpperCase();
          const isInvest = /^9\d[Ww]$/.test(eAtcf) || /^WP9\d$/i.test(eStorm);
          return isInvest && e.model === selectedModel && e.cycle === selectedCycle;
        });
      }

      if (stormEntries.length > 0) {
        stormEntries.sort((a, b) => b.init_date.localeCompare(a.init_date));
        const matched = stormEntries[0];
        if (matched.filename) return `/assets/${matched.filename}`;
        if (matched.alt_filename) return `/assets/${matched.alt_filename}`;
      }
    }

    if (urlAttempt === 0) return `/assets/${wpId}_${stormDateStr}_${selectedCycle}_${selectedModel}.png`;
    if (urlAttempt === 1) return `/assets/${numWId}_${stormDateStr}_${selectedCycle}_${selectedModel}.png`;
    if (urlAttempt === 2) return `/assets/${wpId.toLowerCase()}_${selectedModel}_spaghetti.png`;
    return `/assets/${wpId}_${stormDateStr}_${selectedCycle}_${selectedModel}.png`;
  }, [manifestData, urlAttempt, wpId, numWId, floaterId, stormDateStr, selectedCycle, selectedModel, stormData]);

  const handleSpaghettiError = () => {
    if (urlAttempt < 2) {
      setUrlAttempt(prev => prev + 1);
    } else {
      setSpaghettiLoading(false);
      setSpaghettiError(true);
    }
  };

  // Zoom & Pan Handlers
  const handleZoomIn = () => setZoomScale(prev => Math.min(prev + 0.5, 4));
  const handleZoomOut = () => setZoomScale(prev => {
    const next = Math.max(prev - 0.5, 1);
    if (next === 1) setPanOffset({ x: 0, y: 0 });
    return next;
  });
  const handleResetZoom = () => {
    setZoomScale(1);
    setPanOffset({ x: 0, y: 0 });
  };

  const handleMouseDown = (e) => {
    if (zoomScale <= 1) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
  };

  const handleMouseMove = (e) => {
    if (!isDragging || zoomScale <= 1) return;
    setPanOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMouseUp = () => setIsDragging(false);

  const WindyMap = () => (
    <div style={{ position: 'absolute', inset: 0 }}>
      <iframe key={stormData.last_updated} title="Interactive Storm Map" width="100%" height="100%" style={{ position: 'absolute', top: 0, left: 0, border: 0 }} src={`https://embed.windy.com/embed.html?lat=${stormData.lat}&lon=${stormData.lon}&zoom=6&level=surface&overlay=satellite&product=ecmwf&menu=&message=true&marker=true&calendar=now&pressure=&type=map&location=coordinates&detail=&metricWind=km%2Fh&metricTemp=%C2%B0C&radarRange=-1`} frameBorder="0" />
    </div>
  );

  const SpaghettiView = () => (
    <div 
      className="absolute inset-0 flex items-center justify-center bg-[#1e1e2d] overflow-hidden select-none"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {spaghettiLoading && !spaghettiError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#1e1e2d] text-slate-400 z-10">
          <div className="w-10 h-10 border-4 border-slate-700 border-t-blue-500 rounded-full animate-spin mb-4"></div>
          <p className="text-sm font-medium animate-pulse text-center">Loading {selectedCycle} spaghetti tracks...</p>
        </div>
      )}
      {spaghettiError ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#1e1e2d] text-slate-400 z-10 p-6 text-center animate-in fade-in duration-300">
          <ShieldAlert className="w-12 h-12 text-slate-500 mb-3" />
          <p className="text-sm font-medium text-slate-300">Spaghetti Tracks Unavailable</p>
          <p className="text-xs text-slate-500 mt-1">No forecast track clusters generated for {selectedModel.replace('_', ' ').toUpperCase()} on cycle {selectedCycle}.</p>
        </div>
      ) : (
        <div
          className="w-full h-full flex items-center justify-center transition-transform duration-100 ease-out"
          style={{
            transform: `scale(${zoomScale}) translate(${panOffset.x / zoomScale}px, ${panOffset.y / zoomScale}px)`,
            cursor: zoomScale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'pointer'
          }}
        >
          <img
            src={spaghettiUrl}
            alt={`${selectedModel.toUpperCase()} ${selectedCycle} Spaghetti Tracks`}
            className={`w-full h-full object-contain z-0 transition-opacity duration-300 ${spaghettiLoading ? 'opacity-0' : 'opacity-100'}`}
            onLoad={() => setSpaghettiLoading(false)}
            onError={handleSpaghettiError}
            onClick={() => { if (zoomScale === 1) setIsModalOpen(true); }}
          />
        </div>
      )}

      {/* Floating Zoom & Pan Control Bar overlay (Spaghetti view) */}
      {!spaghettiError && (
        <div className="absolute bottom-3 right-3 z-20 flex items-center gap-1 bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-lg p-1 shadow-lg">
          <button
            onClick={handleZoomIn}
            title="Zoom In"
            className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded transition cursor-pointer"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={handleZoomOut}
            disabled={zoomScale <= 1}
            title="Zoom Out"
            className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded transition disabled:opacity-40 cursor-pointer"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          {zoomScale > 1 && (
            <button
              onClick={handleResetZoom}
              title="Reset View"
              className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded transition cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );

  if (!floaterId) return <WindyMap />;

  return (
    <>
      <div className="absolute inset-0 flex flex-col bg-[#1e1e2d] group overflow-hidden">
        {/* Control Bar */}
        <div className="z-20 flex flex-wrap items-center justify-start sm:justify-between gap-3 p-3 bg-slate-900/90 backdrop-blur-md border-b border-slate-800/80 shadow-md">
          {/* Main View Switcher */}
          <div className="flex bg-slate-950/80 border border-slate-800 rounded-lg p-0.5 shadow-inner flex-wrap gap-0.5">
            <button
              onClick={() => setActiveTab("satellite")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer text-center whitespace-nowrap ${activeTab === "satellite" ? "bg-cyan-500 text-slate-950 font-bold shadow" : "text-slate-400 hover:text-slate-200"
                }`}
            >
              Satellite View
            </button>
            {!isOtherBasin && (
              <button
                onClick={() => setActiveTab("spaghetti")}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer text-center whitespace-nowrap ${activeTab === "spaghetti" ? "bg-cyan-500 text-slate-950 font-bold shadow" : "text-slate-400 hover:text-slate-200"
                  }`}
              >
                Spaghetti Tracks
              </button>
            )}
            <button
              onClick={() => setActiveTab("windy")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer text-center whitespace-nowrap ${activeTab === "windy" ? "bg-cyan-500 text-slate-950 font-bold shadow" : "text-slate-400 hover:text-slate-200"
                }`}
            >
              Live Windy Map
            </button>
          </div>

          {/* Spaghetti Controls (Cycle Buttons & Model Selector) */}
          {activeTab === "spaghetti" && (
            <div className="flex items-center gap-2 flex-wrap">
              {/* Forecast Cycle Buttons */}
              <div className="flex bg-slate-950/80 border border-slate-800 rounded-lg p-0.5 shadow-inner flex-wrap gap-0.5 items-center">
                <span className="text-[10px] font-bold text-slate-400 uppercase px-2">Cycle:</span>
                {["00Z", "06Z", "12Z", "18Z"].map((cycle) => {
                  const isAvailable = availableCycles[cycle];
                  const isSelected = selectedCycle === cycle;
                  return (
                    <button
                      key={cycle}
                      disabled={!isAvailable}
                      onClick={() => setSelectedCycle(cycle)}
                      className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition-all cursor-pointer ${
                        isSelected
                          ? "bg-cyan-500 text-slate-950 font-bold shadow"
                          : isAvailable
                          ? "text-slate-300 hover:bg-slate-800 hover:text-white"
                          : "opacity-40 cursor-not-allowed bg-slate-900/50 text-slate-600"
                      }`}
                    >
                      {cycle}
                    </button>
                  );
                })}
              </div>

              {/* Model Selector */}
              <div className="flex bg-slate-950/80 border border-slate-800 rounded-lg p-0.5 shadow-inner flex-wrap gap-0.5">
                <button
                  onClick={() => setSelectedModel("gdm_fnv3")}
                  className={`px-2.5 py-1.5 text-[10px] font-semibold rounded-md transition-all cursor-pointer text-center whitespace-nowrap ${selectedModel === "gdm_fnv3" ? "bg-cyan-500 text-slate-950 font-bold shadow" : "text-slate-400 hover:text-slate-200"
                    }`}
                >
                  GDM WNC
                </button>
                <button
                  onClick={() => setSelectedModel("ecmwf_ifs")}
                  className={`px-2.5 py-1.5 text-[10px] font-semibold rounded-md transition-all cursor-pointer text-center whitespace-nowrap ${selectedModel === "ecmwf_ifs" ? "bg-cyan-500 text-slate-950 font-bold shadow" : "text-slate-400 hover:text-slate-200"
                    }`}
                >
                  ECMWF IFS
                </button>
                <button
                  onClick={() => setSelectedModel("ecmwf_aifs")}
                  className={`px-2.5 py-1.5 text-[10px] font-semibold rounded-md transition-all cursor-pointer text-center whitespace-nowrap ${selectedModel === "ecmwf_aifs" ? "bg-cyan-500 text-slate-950 font-bold shadow" : "text-slate-400 hover:text-slate-200"
                    }`}
                >
                  ECMWF AIFS
                </button>
              </div>
            </div>
          )}

          {/* Satellite Image Selector */}
          {activeTab === "satellite" && (
            <select
              value={imageType}
              onChange={(e) => setImageType(e.target.value)}
              className="bg-slate-950 border border-slate-800 text-slate-300 rounded-lg px-3 py-1.5 text-xs font-semibold shadow outline-none cursor-pointer hover:bg-slate-900 hover:text-slate-100 transition"
            >
              <option value="RGB">RGB (Colorized IR)</option>
              <option value="OTT">OTT (Overshooting Tops)</option>
              <option value="TRUECOLOR">Truecolor (Daylight)</option>
              <option value="VIS">Visible (High-Res)</option>
              <option value="BD">Enhanced IR (BD Array)</option>
              <option value="WV">Water Vapor</option>
            </select>
          )}
        </div>

        {/* Media Content Area */}
        <div className="flex-grow relative w-full h-full bg-[#1e1e2d] flex items-center justify-center overflow-hidden">
          {activeTab === "windy" ? (
            <WindyMap />
          ) : activeTab === "spaghetti" ? (
            <SpaghettiView />
          ) : (
            <>
              {imgError && <div className="absolute inset-0 z-10"><WindyMap /></div>}
              {(!dapiyaImgUrl || isImageDownloading) && !imgError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#1e1e2d] text-slate-400 z-10">
                  <div className="w-10 h-10 border-4 border-slate-700 border-t-blue-500 rounded-full animate-spin mb-4"></div>
                  <p className="text-sm font-medium animate-pulse text-center px-4">
                    Establishing link to Dapiya Satellite Network...<br />
                    <span className="text-xs text-slate-500 mt-1 block">(Downloading {imageType} image)</span>
                  </p>
                </div>
              )}
              {dapiyaImgUrl && (
                <img
                  src={dapiyaImgUrl}
                  alt={`${imageType} Satellite`}
                  className={`w-full h-full object-contain z-0 transition-opacity duration-500 cursor-pointer hover:scale-[1.01] ${isImageDownloading ? 'opacity-0' : 'opacity-100'}`}
                  onLoad={() => setIsImageDownloading(false)}
                  onClick={() => setIsModalOpen(true)}
                  onError={() => { setIsImageDownloading(false); setImgError(true); }}
                />
              )}
            </>
          )}
        </div>
      </div>
      {isModalOpen && createPortal(
        <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/95 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <button onClick={() => setIsModalOpen(false)} className="absolute top-6 right-6 bg-slate-800/80 hover:bg-slate-700 text-white rounded-full p-2.5 transition-all z-[10000] border border-slate-600/50 cursor-pointer"><X className="w-6 h-6" /></button>
          <img
            src={activeTab === "spaghetti" ? spaghettiUrl : dapiyaImgUrl}
            alt="Fullscreen View"
            className="max-w-full max-h-[85vh] object-contain rounded-xl shadow-[0_0_50px_rgba(0,0,0,0.8)] border border-slate-800/50"
          />
        </div>,
        document.body
      )}
    </>
  );
};

const StormCardSkeleton = () => (
  <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6 mb-10 animate-pulse">
    <div className="flex flex-col gap-6 bg-[#2a2c3a] rounded-xl p-5 shadow-lg border border-slate-700/50">
      <div className="bg-slate-800 rounded-lg h-16 w-full"></div>
      <div className="flex flex-col gap-5 px-2 mt-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-slate-800 flex-shrink-0"></div>
            <div className="flex flex-col gap-2 w-full">
              <div className="h-3 bg-slate-800 rounded w-1/3"></div>
              <div className="h-3 bg-slate-800 rounded w-2/3"></div>
            </div>
          </div>
        ))}
      </div>
      <div className="bg-slate-800 rounded-lg h-32 mt-auto"></div>
    </div>
    <div className="flex flex-col h-full bg-[#2a2c3a] rounded-xl p-5 shadow-lg border border-slate-700/50">
      <div className="w-full rounded-lg bg-slate-800 h-[500px] sm:h-[580px] md:h-[640px] lg:h-[680px]"></div>
      <div className="mt-5 bg-slate-800 rounded-lg h-12"></div>
    </div>
  </div>
);

const StormDashboardCard = ({ storm, isOtherBasin, windUnit }) => {
  if (!storm) return null;

  const theme = getThemeClasses(storm.classification.code);

  const movementText = storm.movementSpeedKmh === 0
    ? "Stationary"
    : (storm.movementSpeedKmh !== null && storm.movementSpeedKmh > 0)
      ? `${storm.movementDirectionWord || "Unknown"} at ${formatSpeed(storm.movementSpeedKmh, windUnit)}`
      : "Movement data unavailable";

  const threatText = isOtherBasin
    ? "System is located outside the Western Pacific basin; no threat to the Philippines."
    : storm.insidePar
      ? (storm.threatLevel === "High" ? "Destructive winds and intense rainfall expected." : "Scattered rainshowers and isolated thunderstorms possible in affected areas.")
      : `System is outside PAR (approx. ${storm.distToPar} km away); no direct threat to the country at this time.`;

  const threatDisplayLevel = isOtherBasin ? "None (Out of Basin)" : storm.threatLevel;

  let threatBg = theme.threatBg;
  if (isOtherBasin) {
    threatBg = "bg-slate-800 border border-slate-700/80";
  } else if (storm.classification.code === "LPA" && !storm.insidePar) {
    threatBg = "bg-slate-700/60";
  }

  const sustainedWindText = formatSpeed(storm.wind10MinKmh, windUnit);
  const gustText = formatSpeed(storm.gustKmh, windUnit);

  return (
    <div className={`grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6 mb-10 transition-all duration-500 animate-in fade-in border border-slate-800/40 rounded-xl p-1 bg-slate-900/10 ${theme.glow}`}>
      {/* Left Column: Stats */}
      <div className={`flex flex-col gap-6 bg-[#2a2c3a]/90 backdrop-blur-md rounded-xl p-5 shadow-lg border border-slate-700/30 hover:${theme.border} transition duration-300`}>
        <div className={`bg-[#20212d] rounded-lg p-4 text-center border ${theme.border} flex flex-col items-center gap-2 shadow-inner`}>
          <div className="flex items-center gap-2 flex-wrap justify-center">
            {/* PAR Status Badge */}
            {isOtherBasin ? (
              <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-slate-800 text-slate-400 border border-slate-700 rounded-full">
                Out of Basin
              </span>
            ) : storm.insidePar ? (
              <span className="px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-red-500/20 text-red-400 border border-red-500/30 rounded-full flex items-center gap-1 animate-pulse">
                <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-ping"></span>
                Inside PAR
              </span>
            ) : (
              <span className="px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-full">
                Outside PAR
              </span>
            )}
            {/* Coordinates Pill */}
            {!isNaN(storm.lat) && !isNaN(storm.lon) && (
              <span className="px-2.5 py-0.5 text-[9px] font-mono bg-slate-900 text-slate-400 rounded-full border border-slate-800/80">
                {Math.abs(storm.lat).toFixed(1)}°{storm.lat >= 0 ? "N" : "S"}, {Math.abs(storm.lon).toFixed(1)}°{storm.lon >= 0 ? "E" : "W"}
              </span>
            )}
          </div>

          <h2 className={`text-2xl font-black ${theme.text} tracking-wide uppercase whitespace-nowrap overflow-hidden text-ellipsis w-full`}>
            {storm.displayName}
          </h2>
          <p className="text-[9px] font-bold text-slate-400 tracking-wider uppercase">
            {storm.classification.label} - AS OF {storm.dataTimeStr}
          </p>
        </div>

        {/* 2x2 Glassmorphic Stats Grid */}
        <div className="grid grid-cols-2 gap-4">
          {/* Card 1: Winds & Gusts */}
          <div className={`p-3.5 bg-[#20212d]/50 backdrop-blur-md rounded-xl border border-slate-700/50 hover:${theme.border} hover:${theme.glow} transition duration-300 flex flex-col justify-between`}>
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-8 h-8 rounded-full border-2 ${theme.border} flex items-center justify-center ${theme.text}`}><Wind className="w-4 h-4" /></div>
              <span className={`${theme.text} font-bold text-[10px] uppercase tracking-wider`}>Winds & Gusts</span>
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-100">{sustainedWindText}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">Sustained</div>
              {storm.gustKmh > 0 && (
                <div className="mt-2 pt-1.5 border-t border-slate-800/80">
                  <div className="text-xs font-semibold text-slate-200">{gustText}</div>
                  <div className="text-[9px] text-slate-400">Gusts (Est.)</div>
                </div>
              )}
            </div>
            {/* Visual Progress Bar */}
            <div className="mt-3 w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
              <div className={`h-full ${storm.classification.code === "LPA" ? "bg-emerald-500" : storm.classification.code === "TD" ? "bg-yellow-500" : storm.classification.code === "TS" || storm.classification.code === "STS" ? "bg-orange-500" : storm.classification.code === "TY" ? "bg-purple-500" : "bg-pink-500"}`} style={{ width: `${windIntensityPercent(storm.wind10MinKmh)}%` }}></div>
            </div>
          </div>

          {/* Card 2: Pressure */}
          <div className={`p-3.5 bg-[#20212d]/50 backdrop-blur-md rounded-xl border border-slate-700/50 hover:${theme.border} hover:${theme.glow} transition duration-300 flex flex-col justify-between`}>
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-8 h-8 rounded-full border-2 ${theme.border} flex items-center justify-center ${theme.text}`}><Gauge className="w-4 h-4" /></div>
              <span className={`${theme.text} font-bold text-[10px] uppercase tracking-wider`}>Pressure</span>
            </div>
            <div className="my-auto">
              <div className="text-sm font-semibold text-slate-100">{isNaN(storm.pressure) ? "N/A" : `${storm.pressure} hPa`}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">Central Min</div>
            </div>
            <div className="text-[9px] text-slate-500 italic mt-2">Lower is stronger</div>
          </div>

          {/* Card 3: Movement */}
          <div className={`p-3.5 bg-[#20212d]/50 backdrop-blur-md rounded-xl border border-slate-700/50 hover:${theme.border} hover:${theme.glow} transition duration-300 flex flex-col justify-between`}>
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-8 h-8 rounded-full border-2 ${theme.border} flex items-center justify-center ${theme.text}`}><Navigation className="w-4 h-4" /></div>
              <span className={`${theme.text} font-bold text-[10px] uppercase tracking-wider`}>Movement</span>
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-100 truncate">{storm.movementDirectionWord || "Stationary"}</div>
              <div className="text-[10px] text-slate-400 mt-1 font-mono">{storm.movementSpeedKmh !== null && storm.movementSpeedKmh > 0 ? formatSpeed(storm.movementSpeedKmh, windUnit) : "Stationary"}</div>
            </div>
          </div>

          {/* Card 4: Status Badges */}
          <div className={`p-3.5 bg-[#20212d]/50 backdrop-blur-md rounded-xl border border-slate-700/50 hover:${theme.border} hover:${theme.glow} transition duration-300 flex flex-col justify-between gap-2`}>
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full border-2 ${theme.border} flex items-center justify-center ${theme.text}`}><Activity className="w-4 h-4" /></div>
              <span className={`${theme.text} font-bold text-[10px] uppercase tracking-wider`}>Threat Status</span>
            </div>
            <div className="flex flex-col gap-1.5 mt-auto">
              <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider text-center ${theme.badge}`}>
                {storm.classification.code}
              </span>
              <span className={`px-2 py-0.5 rounded text-[9px] font-bold text-white uppercase tracking-wider text-center ${threatBg}`}>
                {threatDisplayLevel}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-[#20212d] rounded-lg p-4 mt-auto border border-slate-700/50 shadow-inner">
          <h3 className={`font-bold text-sm mb-1.5 uppercase tracking-wider flex items-center gap-1.5 ${theme.text}`}>
            <Compass className="w-4 h-4" /> Storm Summary
          </h3>
          <p className="text-xs text-slate-300 leading-relaxed text-left">
            {generateStormSummary(storm, windUnit)}
          </p>
        </div>
      </div>

      {/* Right Column: Map */}
      <div className={`flex flex-col h-full bg-[#2a2c3a]/90 backdrop-blur-md rounded-xl p-5 shadow-lg border border-slate-700/30 hover:${theme.border} transition duration-300`}>
        <div className={`w-full rounded-lg overflow-hidden border-2 border-slate-700/50 bg-[#1e1e2d] relative flex items-center justify-center h-[500px] sm:h-[580px] md:h-[640px] lg:h-[680px] shadow-lg`}>
          {!isNaN(storm.lat) && !isNaN(storm.lon) ? (
            <StormMediaViewer stormData={storm} isOtherBasin={isOtherBasin} />
          ) : (
            <>
              <div className="absolute inset-0 bg-gradient-to-br from-slate-800 to-slate-900 opacity-80 animate-pulse"></div>
              <MapPin className="w-16 h-16 text-slate-500 opacity-20 z-10 animate-bounce" />
              <span className="absolute z-10 text-slate-500 font-medium tracking-widest uppercase text-xs mt-20 text-center px-4">Location Data Unavailable</span>
            </>
          )}
        </div>

        <div className="mt-5 rounded-lg overflow-hidden border border-slate-700/50 flex flex-col shadow border-t-0">
          <div className={`${threatBg} px-4 py-2.5 flex items-center gap-2`}>
            <span className="bg-white/20 rounded-full w-5 h-5 flex items-center justify-center font-bold text-white text-xs border border-white/10">{isOtherBasin ? 'i' : '!'}</span>
            <span className="text-white font-bold tracking-wide text-xs uppercase">Threat Assessment: {threatDisplayLevel}</span>
          </div>
          <div className="bg-[#20212d] px-4 py-3 text-center border-t border-slate-800/80">
            <span className="text-slate-300 text-xs font-medium leading-relaxed">{threatText}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Application Component
// ─────────────────────────────────────────────────────────────────────────────

const TropicalCycloneInformation = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [storm, setStorm] = useState(null);
  const [otherStorms, setOtherStorms] = useState([]);
  const [selectedOtherIndex, setSelectedOtherIndex] = useState(0);
  const [westernPacificStorms, setWesternPacificStorms] = useState([]);
  const [selectedWpIndex, setSelectedWpIndex] = useState(0);
  const [windUnit, setWindUnit] = useState("kmh"); // "kmh" | "kt" | "mph"

  // Parse and enrich a raw ATCF item into a complete Storm object
  const enrichStormData = (item, isOther) => {
    const parts = item.interp_sector_file?.split(/\s+/) || [];
    const rawName = parts[1] || item.storm_name || item.atcf_id || "Tropical Disturbance";
    const dateStr = parts[2] || "";
    const timeStr = parts[3] || "";
    const lat = !isNaN(parseFloat(parts[4])) ? parseFloat(parts[4]) : item.latitude;
    const lon = !isNaN(parseFloat(parts[5])) ? parseFloat(parts[5]) : item.longitude;
    const winds1MinKnots = !isNaN(parseFloat(parts[8])) ? parseFloat(parts[8]) : (item.winds || 0);
    const pressure = !isNaN(parseFloat(parts[9])) ? parseFloat(parts[9]) : (item.pressure || NaN);
    const speedKnots = !isNaN(parseFloat(parts[10])) ? parseFloat(parts[10]) : (item.movespeed || 0);
    const directionDeg = !isNaN(parseFloat(parts[11])) ? parseFloat(parts[11]) : (item.movedir || 0);

    const wind10MinKmh = to10MinWindKmH(winds1MinKnots || 0);
    const gustKmh = toGustKmH(wind10MinKmh);
    const classification = classifyTropicalCyclone(wind10MinKmh);
    const insidePar = (!isNaN(lat) && !isNaN(lon)) ? isInsidePar(lat, lon) : false;

    const { distance, direction } = (!isNaN(lat) && !isNaN(lon)) ? distanceAndBearingKmFromManila(lat, lon) : { distance: null, direction: null };
    const distToPar = (!isNaN(lat) && !isNaN(lon)) ? distanceToParKm(lat, lon) : 0;

    let dataTimeStr = "";
    let initDate = dateStr;
    let initCycle = "00Z";
    if (!dateStr || !timeStr || dateStr.length < 8 || timeStr.length < 4) {
      dataTimeStr = formatDataTime(item.last_updated);
      const dt = item.analysis_time ? new Date(item.analysis_time) : (item.last_updated ? new Date(item.last_updated) : new Date());
      if (!isNaN(dt.getTime())) {
        initDate = dt.toISOString().slice(0, 10).replace(/-/g, "");
        const hr = dt.getUTCHours();
        const cycleHr = Math.floor(hr / 6) * 6;
        initCycle = `${cycleHr.toString().padStart(2, "0")}Z`;
      }
    } else {
      const iso = `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}T${timeStr.substring(0, 2)}:${timeStr.substring(2, 4)}:00Z`;
      dataTimeStr = formatDataTime(iso);
      if (timeStr.length >= 2) {
        const hr = parseInt(timeStr.substring(0, 2), 10);
        if (!isNaN(hr)) {
          const cycleHr = Math.floor(hr / 6) * 6;
          initCycle = `${cycleHr.toString().padStart(2, "0")}Z`;
        }
      }
    }

    const { displayName } = getStormDisplayName(rawName, classification.code, insidePar, item.atcf_id);

    return {
      ...item,
      name: rawName,
      atcfId: item.atcf_id,
      displayName,
      initDate,
      initCycle,
      lat, lon, wind10MinKmh, gustKmh, pressure, classification, insidePar,
      // Map fields directly for generateStormSummary destructuring
      classificationCode: classification.code,
      windKmh: wind10MinKmh,
      movementWord: getDirectionWord(getDirectionLabel(directionDeg)),
      distance: isOther ? null : distance,
      direction: isOther ? null : direction,
      distToPar, dataTimeStr,
      movementSpeedKmh: (speedKnots !== null && speedKnots >= 0) ? Math.round(speedKnots * 1.852) : null,
      movementDirectionWord: getDirectionWord(getDirectionLabel(directionDeg)),
      threatLevel: threatLevelText(classification.code),
      threatBg: threatBgColor(classification.code)
    };
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const resp = await fetch("https://api.knackwx.com/atcf/v2");
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();

      if (!Array.isArray(data) || data.length === 0) {
        setStorm(null); setOtherStorms([]); setWesternPacificStorms([]); return;
      }

      const westernPacific = [];
      const otherBasins = [];

      data.forEach((item) => {
        const parts = item.interp_sector_file?.split(/\s+/) || [];
        if (parts.length >= 6) {
          const lat = parseFloat(parts[4]), lon = parseFloat(parts[5]);
          if (!isNaN(lat) && !isNaN(lon) && lat >= 0 && lat <= 40 && lon >= 105 && lon <= 180) {
            westernPacific.push(item);
            return;
          }
        }
        otherBasins.push(item);
      });

      const sortByUpdatedDesc = (arr) => arr.sort((a, b) => new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime());

      if (westernPacific.length) {
        const sortedWp = sortByUpdatedDesc(westernPacific).map(s => enrichStormData(s, false));
        const primaryIndex = sortedWp.findIndex(s => s.insidePar);

        setWesternPacificStorms(sortedWp);
        setSelectedWpIndex(primaryIndex >= 0 ? primaryIndex : 0);
        setStorm(sortedWp[primaryIndex >= 0 ? primaryIndex : 0]);
      } else {
        setStorm(null); setWesternPacificStorms([]);
      }

      setOtherStorms(sortByUpdatedDesc(otherBasins).map(s => enrichStormData(s, true)));
    } catch (err) {
      console.error("Error:", err);
      setError("Unable to load tropical disturbance information at the moment.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center px-6">
        <p className="text-sm tracking-wide text-red-400">{error}</p>
      </div>
    );
  }

  const hasWesternPacificStorm = !!storm;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col">
      <div className="max-w-7xl mx-auto w-full px-3 py-8 md:px-8 md:py-12">
        <header className="mb-10 flex flex-col gap-6 rounded-2xl border border-slate-800/70 bg-slate-900/50 px-6 py-6 shadow-[0_20px_70px_-40px_rgba(59,130,246,0.8)] md:flex-row md:items-center md:justify-between">
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-blue-500/10 text-blue-300">
                <Wind className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[10px] uppercase tracking-[0.35em] text-slate-500">Situation Room</p>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-50 md:text-3xl">Tropical Disturbance Information</h1>
              </div>
            </div>
            <div>
              <p className="text-sm leading-relaxed text-slate-400">Real-time updates for the Western North Pacific and Philippine domain.</p>
              <div className="mt-3 h-px w-28 bg-gradient-to-r from-blue-400/70 via-cyan-300/60 to-transparent" />
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Unit Switcher */}
            <div className="flex items-center bg-slate-950/80 border border-slate-800 rounded-full p-0.5 shadow-inner">
              {["kmh", "kt", "mph"].map((unit) => (
                <button
                  key={unit}
                  onClick={() => setWindUnit(unit)}
                  className={`px-3 py-1.5 text-xs font-bold rounded-full transition-all uppercase cursor-pointer ${windUnit === unit ? "bg-cyan-500 text-slate-950 font-black shadow" : "text-slate-400 hover:text-slate-200"
                    }`}
                >
                  {unit === "kmh" ? "km/h" : unit === "kt" ? "kt" : "mph"}
                </button>
              ))}
            </div>

            <button onClick={fetchData} disabled={loading} className="inline-flex items-center justify-center rounded-full border border-slate-700/80 px-6 py-3 text-sm font-medium text-slate-100 shadow-inner shadow-slate-900/60 transition hover:border-blue-400/60 hover:text-white disabled:opacity-50 cursor-pointer">
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>
        </header>

        {loading ? (
          <StormCardSkeleton />
        ) : (
          <>
            {!hasWesternPacificStorm && (
              <section className="mb-10 flex items-center justify-center rounded-2xl border border-slate-700/70 bg-slate-900/60 px-8 py-6 text-center text-sm text-slate-200 shadow-[0_0_35px_rgba(8,47,73,0.45)]">
                <p className="max-w-xl font-medium leading-relaxed">No active tropical disturbances in the Western North Pacific / Philippine domain at this time.</p>
              </section>
            )}

            {westernPacificStorms.length > 1 && (
              <div className="flex flex-col items-start lg:items-end mb-6 w-full lg:w-auto animate-in fade-in">
                <span className="text-[10px] md:text-xs uppercase tracking-wide text-slate-500 mb-1">Select Active Storm</span>
                <select value={selectedWpIndex} onChange={(e) => { const idx = Number(e.target.value); setSelectedWpIndex(idx); setStorm(westernPacificStorms[idx]); }} className="w-full lg:w-[320px] bg-slate-900/80 border border-slate-700 text-slate-100 text-sm rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 transition-all cursor-pointer">
                  {westernPacificStorms.map((s, index) => (
                    <option key={s.atcf_id || index} value={index} className="bg-slate-800">
                      {s.displayName} - {s.classification.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {hasWesternPacificStorm && <StormDashboardCard storm={storm} isOtherBasin={false} windUnit={windUnit} />}

            {otherStorms.length > 0 && (
              <section className="mt-12 border-t border-slate-800/50 pt-8 animate-in fade-in">
                <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold tracking-[0.3em] text-slate-300">Other Active Tropical Disturbances (Outside Western Pacific)</h2>
                    <p className="mt-2 text-sm text-slate-400">Tropical systems currently being monitored outside of the Philippine Area of Responsibility.</p>
                  </div>
                  {otherStorms.length > 1 && (
                    <div className="flex flex-col items-start md:items-end min-w-[280px]">
                      <span className="text-[10px] md:text-xs uppercase tracking-wide text-slate-500 mb-1">Select Storm</span>
                      <select value={selectedOtherIndex} onChange={(e) => setSelectedOtherIndex(Number(e.target.value))} className="w-full bg-slate-900/80 border border-slate-700 text-slate-100 text-sm rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 transition-all cursor-pointer">
                        {otherStorms.map((s, index) => (
                          <option key={s.atcf_id || index} value={index} className="bg-slate-800">{s.displayName} - {s.classification.label}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
                <StormDashboardCard storm={otherStorms[selectedOtherIndex]} isOtherBasin={true} windUnit={windUnit} />
              </section>
            )}

            <section className="mt-12 border-t border-slate-800/50 pt-8">
              <details className="group rounded-2xl border border-slate-800/70 bg-slate-900/60 px-6 py-5 transition">
                <summary className="flex cursor-pointer items-center justify-between text-xs font-semibold uppercase tracking-[0.35em] text-slate-300">
                  Notes
                  <span className="text-[11px] text-slate-500 group-open:rotate-180">▾</span>
                </summary>
                <ul className="mt-4 space-y-3 text-sm text-slate-200">
                  <li className="flex items-start gap-3"><span className="mt-[6px] h-2 w-2 rounded-full bg-blue-400"></span><span>Winds are 10-minute averages (PAGASA standard). Gusts ≈ 1.4 × sustained, rounded to the nearest 5 km/h.</span></li>
                  <li className="flex items-start gap-3"><span className="mt-[6px] h-2 w-2 rounded-full bg-cyan-300"></span><span>Conversions: 1 kt = 1.852 km/h.</span></li>
                  <li className="flex items-start gap-3"><span className="mt-[6px] h-2 w-2 rounded-full bg-indigo-300"></span><span>Always refer to official government advisories for warnings and bulletins.</span></li>
                </ul>
              </details>
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default TropicalCycloneInformation;