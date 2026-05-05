// src/components/TropicalCycloneInformation.jsx
import React, { useEffect, useState } from "react";
import { Activity, Gauge, MapPin, Navigation, Wind, X } from "lucide-react";
import { getStormDisplayName } from "../utils/stormNaming";

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
  let inside = false;
  for (let i = 0, j = PAR_POLYGON.length - 1; i < PAR_POLYGON.length; j = i++) {
    const yi = PAR_POLYGON[i][0];
    const xi = PAR_POLYGON[i][1];
    const yj = PAR_POLYGON[j][0];
    const xj = PAR_POLYGON[j][1];
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0000001) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distToSegmentSquared(p, v, w) {
  const l2 = (v[0] - w[0])**2 + (v[1] - w[1])**2;
  if (l2 === 0) return (p[0] - v[0])**2 + (p[1] - v[1])**2;
  let t = ((p[0] - v[0]) * (w[0] - v[0]) + (p[1] - v[1]) * (w[1] - v[1])) / l2;
  t = Math.max(0, Math.min(1, t));
  return (p[0] - (v[0] + t * (w[0] - v[0])))**2 + (p[1] - (v[1] + t * (w[1] - v[1])))**2;
}

function distanceToParKm(lat, lon) {
  if (isInsidePar(lat, lon)) return 0;
  let minDistSq = Infinity;
  for (let i = 0; i < PAR_POLYGON.length - 1; i++) {
    const distSq = distToSegmentSquared([lat, lon], PAR_POLYGON[i], PAR_POLYGON[i + 1]);
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
  const tenMinKmh = from1MinKnots * 0.88 * 1.852;
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
  const a = Math.sin(dLat / 2)**2 + Math.cos(toRad(manilaLat)) * Math.cos(toRad(lat)) * Math.sin(dLon / 2)**2;
  const distance = Math.round(6371 * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))));
  const y = Math.sin(dLon) * Math.cos(toRad(lat));
  const x = Math.cos(toRad(manilaLat)) * Math.sin(toRad(lat)) - Math.sin(toRad(manilaLat)) * Math.cos(toRad(lat)) * Math.cos(dLon);
  const brng = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return { distance, direction: getDirectionLabel(brng) };
}

function generateStormSummary({ displayName, classificationCode, windKmh, pressure, movementSpeedKmh, movementWord, distance, direction, threatLevel, insidePar, distToPar }) {
  const isLpa = classificationCode === "LPA";
  let summary = `${isLpa ? "A " : "The "}${displayName}`;
  if (distance && direction) summary += ` located near ${distance} km ${direction} of Manila`;
  
  summary += `, moving ${movementSpeedKmh !== null ? `${movementWord?.toLowerCase() || "unknown direction"} at ${movementSpeedKmh} km/h` : "with unknown movement speed"}`;
  
  if (isLpa) {
    summary += `, bringing light to moderate rains. The potential for further development into a tropical depression is currently being monitored.`;
  } else {
    summary += `, bringing maximum sustained winds of ${windKmh} km/h${!isNaN(pressure) ? ` and central pressure of ${pressure} hPa.` : "."}`;
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

const StormMediaViewer = ({ stormData }) => {
  const floaterId = stormData.atcfId?.toUpperCase();
  const [dapiyaImgUrl, setDapiyaImgUrl] = useState(null);
  const [imgError, setImgError] = useState(false);
  const [imageType, setImageType] = useState('RGB');
  const [isImageDownloading, setIsImageDownloading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

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
    document.body.style.overflow = isModalOpen ? 'hidden' : 'auto';
    return () => { document.body.style.overflow = 'auto'; };
  }, [isModalOpen]);

  const WindyMap = () => (
    <div style={{ position: 'absolute', inset: 0 }}>
      <iframe key={stormData.last_updated} title="Interactive Storm Map" width="100%" height="100%" style={{ position: 'absolute', top: 0, left: 0, border: 0 }} src={`https://embed.windy.com/embed.html?lat=${stormData.lat}&lon=${stormData.lon}&zoom=6&level=surface&overlay=satellite&product=ecmwf&menu=&message=true&marker=true&calendar=now&pressure=&type=map&location=coordinates&detail=&metricWind=km%2Fh&metricTemp=%C2%B0C&radarRange=-1`} frameBorder="0" />
      <div style={{ position: 'absolute', inset: 0, zIndex: 10, cursor: 'default' }} />
    </div>
  );

  if (!floaterId) return <WindyMap />;

  return (
    <>
      <div className="absolute inset-0 flex items-center justify-center bg-[#1e1e2d] group overflow-hidden">
        <div className="absolute top-4 right-4 z-20 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity duration-300 focus-within:opacity-100">
          <select value={imageType} onChange={(e) => setImageType(e.target.value)} className="bg-slate-900/80 backdrop-blur-md text-slate-200 border border-slate-700 rounded-lg px-3 py-1.5 text-sm font-medium shadow-lg outline-none cursor-pointer hover:bg-slate-800 transition">
            <option value="RGB">RGB (Colorized IR)</option>
            <option value="OTT">OTT (Overshooting Tops)</option>
            <option value="TRUECOLOR">Truecolor (Daylight)</option>
            <option value="VIS">Visible (High-Res)</option>
            <option value="BD">Enhanced IR (BD Array)</option>
            <option value="WV">Water Vapor</option>
          </select>
        </div>
        {imgError && <div className="absolute inset-0 z-10"><WindyMap /></div>}
        {(!dapiyaImgUrl || isImageDownloading) && !imgError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#1e1e2d] text-slate-400 z-10">
            <div className="w-10 h-10 border-4 border-slate-700 border-t-blue-500 rounded-full animate-spin mb-4"></div>
            <p className="text-sm font-medium animate-pulse text-center px-4">Establishing link to Dapiya Satellite Network...<br /><span className="text-xs text-slate-500 mt-1 block">(Downloading {imageType} image)</span></p>
          </div>
        )}
        {dapiyaImgUrl && (
          <img src={dapiyaImgUrl} alt={`${imageType} Satellite`} className={`w-full h-full object-contain z-0 transition-opacity duration-500 cursor-pointer hover:scale-[1.02] ${isImageDownloading ? 'opacity-0' : 'opacity-100'}`} onLoad={() => setIsImageDownloading(false)} onClick={() => setIsModalOpen(true)} onError={() => { setIsImageDownloading(false); setImgError(true); }} />
        )}
      </div>
      {isModalOpen && dapiyaImgUrl && !imgError && (
        <div className="fixed inset-0 z-[2000] flex flex-col items-center justify-center bg-black/95 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <button onClick={() => setIsModalOpen(false)} className="absolute top-6 right-6 bg-slate-800/80 hover:bg-slate-700 text-white rounded-full p-2.5 transition-all z-[2010] border border-slate-600/50"><X className="w-6 h-6" /></button>
          <img src={dapiyaImgUrl} alt="Fullscreen Satellite" className="max-w-full max-h-[85vh] object-contain rounded-xl shadow-[0_0_50px_rgba(0,0,0,0.8)] border border-slate-800/50" />
        </div>
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
      <div className="flex-grow w-full rounded-lg bg-slate-800 md:min-h-[400px]"></div>
      <div className="mt-5 bg-slate-800 rounded-lg h-12"></div>
    </div>
  </div>
);

const StormDashboardCard = ({ storm, isOtherBasin }) => {
  if (!storm) return null;

  const movementText = (storm.movementSpeedKmh !== null)
    ? `${storm.movementDirectionWord || "Unknown"} at ${storm.movementSpeedKmh}km/h`
    : "Movement data unavailable";

  const threatText = isOtherBasin
    ? "System is located outside the Western Pacific basin; no threat to the Philippines."
    : storm.insidePar
      ? (storm.threatLevel === "High" ? "Destructive winds and intense rainfall expected." : "Scattered rainshowers and isolated thunderstorms possible in affected areas.")
      : `System is outside PAR (approx. ${storm.distToPar} km away); no direct threat to the country at this time.`;

  const threatDisplayLevel = isOtherBasin ? "None (Out of Basin)" : storm.threatLevel;
  const threatBg = isOtherBasin ? "bg-slate-600" : storm.threatBg;
  const statusLabel = isOtherBasin 
      ? (storm.classification.code === "LPA" ? "Potential for Development (Out of Basin)" : `${storm.classification.label} - No Threat (Out of Basin)`)
      : (storm.classification.code === "LPA" ? "Low to Medium Chance of Development" : `${storm.classification.label} - ${storm.threatLevel} Threat`);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6 mb-10 transition-opacity duration-500 animate-in fade-in">
      {/* Left Column: Stats */}
      <div className="flex flex-col gap-6 bg-[#2a2c3a] rounded-xl p-5 shadow-lg border border-slate-700/50">
        <div className="bg-[#20212d] rounded-lg p-4 text-center border border-slate-700/50">
          <h2 className="text-2xl font-bold text-yellow-400 capitalize whitespace-nowrap overflow-hidden text-ellipsis">
            {storm.classification.label.toLowerCase()}
          </h2>
          <p className="text-[10px] font-bold text-slate-300 tracking-wider mt-1 uppercase">
            UPDATE - AS OF {storm.dataTimeStr}
          </p>
        </div>

        <div className="flex flex-col gap-5 px-2">
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0 w-10 h-10 rounded-full border-2 border-yellow-500/80 flex items-center justify-center text-yellow-500"><Wind className="w-5 h-5" /></div>
            <div className="flex flex-col">
              <span className="text-yellow-500 font-bold text-sm tracking-wide">Max Wind (KM/H)</span>
              <span className="text-sm text-slate-200 mt-0.5">{storm.wind10MinKmh}km/h near the center</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0 w-10 h-10 rounded-full border-2 border-yellow-500/80 flex items-center justify-center text-yellow-500"><Gauge className="w-5 h-5" /></div>
            <div className="flex flex-col">
              <span className="text-yellow-500 font-bold text-sm tracking-wide">Pressure (hPa)</span>
              <span className="text-sm text-slate-200 mt-0.5">{isNaN(storm.pressure) ? "N/A" : `${storm.pressure} hPa`}</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0 w-10 h-10 rounded-full border-2 border-yellow-500/80 flex items-center justify-center text-yellow-500"><Navigation className="w-5 h-5" /></div>
            <div className="flex flex-col">
              <span className="text-yellow-500 font-bold text-sm tracking-wide">Current Movement (KM/H)</span>
              <span className="text-sm text-slate-200 mt-0.5">{movementText}</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0 w-10 h-10 rounded-full border-2 border-yellow-500/80 flex items-center justify-center text-yellow-500"><Activity className="w-5 h-5" /></div>
            <div className="flex flex-col">
              <span className="text-yellow-500 font-bold text-sm tracking-wide">Status / Threat Level</span>
              <span className="text-sm text-slate-200 mt-0.5">{statusLabel}</span>
            </div>
          </div>
        </div>

        <div className="bg-[#20212d] rounded-lg p-5 mt-auto border border-slate-700/50">
          <h3 className="text-yellow-500 font-bold text-lg mb-2">Storm Summary</h3>
          <p className="text-sm text-slate-200 leading-relaxed text-center">
            {generateStormSummary(storm)}
          </p>
        </div>
      </div>

      {/* Right Column: Map */}
      <div className="flex flex-col h-full bg-[#2a2c3a] rounded-xl p-5 shadow-lg border border-slate-700/50">
        <div className="flex-grow w-full rounded-lg overflow-hidden border-2 border-slate-600/50 bg-[#1e1e2d] relative flex items-center justify-center aspect-square md:aspect-auto md:min-h-[400px]">
          {!isNaN(storm.lat) && !isNaN(storm.lon) ? (
            <StormMediaViewer stormData={storm} />
          ) : (
            <>
              <div className="absolute inset-0 bg-gradient-to-br from-slate-800 to-slate-900 opacity-80"></div>
              <MapPin className="w-16 h-16 text-slate-500 opacity-20 z-10" />
              <span className="absolute z-10 text-slate-500 font-medium tracking-widest uppercase text-xs mt-20 text-center px-4">Location Data Unavailable</span>
            </>
          )}
        </div>

        <div className="mt-5 rounded-lg overflow-hidden border border-slate-700/50 flex flex-col">
          <div className={`${threatBg} px-4 py-2 flex items-center gap-2`}>
            <span className="bg-white/20 rounded-full w-6 h-6 flex items-center justify-center font-bold text-white text-sm">{isOtherBasin ? 'i' : '!'}</span>
            <span className="text-white font-bold tracking-wide">Threat Level: {threatDisplayLevel}</span>
          </div>
          <div className="bg-[#20212d] px-4 py-3 text-center">
            <span className="text-slate-200 text-sm font-medium">{threatText}</span>
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

  // Parse and enrich a raw ATCF item into a complete Storm object
  const enrichStormData = (item, isOther) => {
    const parts = item.interp_sector_file?.split(/\s+/) || [];
    const rawName = parts[1] || item.atcf_id || "Tropical Disturbance";
    const dateStr = parts[2] || "";
    const timeStr = parts[3] || "";
    const lat = parseFloat(parts[4]);
    const lon = parseFloat(parts[5]);
    const winds1MinKnots = parseFloat(parts[8]);
    const pressure = parseFloat(parts[9]);
    const speedKnots = parseFloat(parts[10]);
    const directionDeg = parseFloat(parts[11]);

    const wind10MinKmh = to10MinWindKmH(winds1MinKnots || 0);
    const classification = classifyTropicalCyclone(wind10MinKmh);
    const insidePar = (!isNaN(lat) && !isNaN(lon)) ? isInsidePar(lat, lon) : false;
    
    const { distance, direction } = (!isNaN(lat) && !isNaN(lon)) ? distanceAndBearingKmFromManila(lat, lon) : { distance: null, direction: null };
    const distToPar = (!isNaN(lat) && !isNaN(lon)) ? distanceToParKm(lat, lon) : 0;

    let dataTimeStr = "";
    if (!dateStr || !timeStr || dateStr.length < 8 || timeStr.length < 4) {
      dataTimeStr = formatDataTime(item.last_updated);
    } else {
      const iso = `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}T${timeStr.substring(0, 2)}:${timeStr.substring(2, 4)}:00Z`;
      dataTimeStr = formatDataTime(iso);
    }

    const { displayName } = getStormDisplayName(rawName, classification.code, insidePar, item.atcf_id);

    return {
      ...item,
      name: rawName,
      atcfId: item.atcf_id,
      displayName,
      lat, lon, wind10MinKmh, pressure, classification, insidePar,
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
          if (!isNaN(lat) && !isNaN(lon) && lat >= 0 && lat <= 40 && lon >= 105 && lon <= 170) {
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
      <div className="max-w-5xl mx-auto w-full px-6 py-12 md:px-8">
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
          <button onClick={fetchData} disabled={loading} className="inline-flex items-center justify-center rounded-full border border-slate-700/80 px-6 py-3 text-sm font-medium text-slate-100 shadow-inner shadow-slate-900/60 transition hover:border-blue-400/60 hover:text-white disabled:opacity-50 cursor-pointer">
            {loading ? "Loading..." : "Refresh"}
          </button>
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

            {hasWesternPacificStorm && <StormDashboardCard storm={storm} isOtherBasin={false} />}

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
                <StormDashboardCard storm={otherStorms[selectedOtherIndex]} isOtherBasin={true} />
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
                  <li className="flex items-start gap-3"><span className="mt-[6px] h-2 w-2 rounded-full bg-cyan-300"></span><span>Conversions: 1 kt = 1.852 km/h; 1-min to 10-min winds: ×0.88.</span></li>
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