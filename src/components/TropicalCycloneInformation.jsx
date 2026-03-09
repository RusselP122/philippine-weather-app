// src/components/TropicalCycloneInformation.jsx
import React, { useEffect, useState } from "react";
import { Activity, Gauge, MapPin, Navigation, Wind, X } from "lucide-react";
import { getStormDisplayName } from "../utils/stormNaming";

const PAR_POLYGON = [
  [5.0, 115.0],
  [15.0, 115.0],
  [21.0, 120.0],
  [25.0, 120.0],
  [25.0, 135.0],
  [5.0, 135.0],
  [5.0, 115.0],
];

const DIRECTION_WORDS = {
  N: "North",
  NNE: "North-Northeast",
  NE: "Northeast",
  ENE: "East-Northeast",
  E: "East",
  ESE: "East-Southeast",
  SE: "Southeast",
  SSE: "South-Southeast",
  S: "South",
  SSW: "South-Southwest",
  SW: "Southwest",
  WSW: "West-Southwest",
  W: "West",
  WNW: "West-Northwest",
  NW: "Northwest",
  NNW: "North-Northwest",
};

const getDirectionWord = (label) => (label && DIRECTION_WORDS[label]) || label;

const describePressure = (pressure) => {
  if (isNaN(pressure)) return "Pressure data unavailable.";
  if (pressure < 950) return "Extremely low pressure – very intense system.";
  if (pressure < 980) return "Very low pressure – strong and likely intensifying.";
  if (pressure < 995) return "Moderately low pressure – notable strength.";
  return "Higher pressure – comparatively weaker system.";
};

const describeWindIntensity = (wind) => {
  if (wind >= 185) return "Super typhoon-force winds";
  if (wind >= 150) return "Typhoon-force winds";
  if (wind >= 118) return "Severe tropical storm-force winds";
  if (wind >= 89) return "Tropical storm-force winds";
  return "Gale to near-tropical storm winds";
};

const windIntensityPercent = (wind) => Math.min(100, Math.round((wind / 220) * 100));


function isInsidePar(lat, lon) {
  let inside = false;
  for (let i = 0, j = PAR_POLYGON.length - 1; i < PAR_POLYGON.length; j = i++) {
    const yi = PAR_POLYGON[i][0];
    const xi = PAR_POLYGON[i][1];
    const yj = PAR_POLYGON[j][0];
    const xj = PAR_POLYGON[j][1];

    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0000001) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function getDirectionLabel(deg) {
  const directions = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
  ];
  if (deg === null || deg === undefined || isNaN(deg) || deg < 0) return null;
  const index = Math.floor((deg + 11.25) / 22.5) % 16;
  return directions[index];
}

function to10MinWindKmH(from1MinKnots) {
  const tenMinKnots = from1MinKnots * 0.88;
  const tenMinKmh = tenMinKnots * 1.852;
  return Math.round(tenMinKmh / 5) * 5;
}

function toGustKmH(tenMinWindKmh) {
  const gust = tenMinWindKmh * 1.4;
  return Math.round(gust / 5) * 5;
}

function classifyTropicalCyclone(wind10MinKmh) {
  if (wind10MinKmh < 39) {
    return { code: "LPA", label: "LOW PRESSURE AREA", color: "bg-emerald-500/20 text-emerald-300" };
  }
  if (wind10MinKmh <= 61) {
    return { code: "TD", label: "TROPICAL DEPRESSION", color: "bg-yellow-400/20 text-yellow-300" };
  }
  if (wind10MinKmh <= 88) {
    return { code: "TS", label: "TROPICAL STORM", color: "bg-orange-500/20 text-orange-300" };
  }
  if (wind10MinKmh <= 117) {
    return { code: "STS", label: "SEVERE TROPICAL STORM", color: "bg-red-500/20 text-red-300" };
  }
  if (wind10MinKmh <= 184) {
    return { code: "TY", label: "TYPHOON", color: "bg-purple-500/20 text-purple-300" };
  }
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
  const d = new Date(date);
  const phTime = d.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${phTime} PHST`;
}

function generateStormSummary({
  displayName,
  classificationCode,
  windKmh,
  pressure,
  movementSpeedKmh,
  movementWord,
  distance,
  direction,
  threatLevel,
  insidePar
}) {
  const isLpa = classificationCode === "LPA";
  let summary = `${isLpa ? "A " : "The "}${displayName}`;

  if (distance && direction) {
    summary += ` located near ${distance} km ${direction} of Manila`;
  }

  summary += `, `;

  if (movementSpeedKmh !== null) {
    summary += `moving ${movementWord?.toLowerCase() || "in an unknown direction"} at ${movementSpeedKmh} km/h`;
  } else {
    summary += `with unknown movement speed`;
  }

  summary += `, bringing `;

  if (isLpa) {
    summary += `light to moderate rains.`;
  } else {
    summary += `maximum sustained winds of ${windKmh} km/h`;
    if (!isNaN(pressure)) {
      summary += ` and central pressure of ${pressure} hPa.`;
    } else {
      summary += `.`;
    }
  }

  if (isLpa) {
    summary += ` The potential for further development into a tropical depression is currently being monitored.`;
  } else if (classificationCode === "TD") {
    summary += ` This system poses a potential threat for heavy rainfall and may strengthen into a tropical storm.`;
  } else if (classificationCode === "TS" || classificationCode === "STS") {
    summary += ` This storm poses a significant threat of strong winds and heavy to intense rainfall in affected areas.`;
  } else if (classificationCode === "TY" || classificationCode === "STY") {
    summary += ` This is a highly dangerous system posing a severe threat of destructive winds, intense rainfall, and potential storm surges in affected areas.`;
  } else {
    // Fallback for any other/unrecognized classifications
    summary += ` ${threatLevel} threat of further development or impacts.`;
  }

  return summary;
}

function distanceAndBearingKmFromManila(lat, lon) {
  const manilaLat = 14.5995;
  const manilaLon = 120.9842;
  const R = 6371; // km

  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(lat - manilaLat);
  const dLon = toRad(lon - manilaLon);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(manilaLat)) *
    Math.cos(toRad(lat)) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = Math.round(R * c);

  const y = Math.sin(dLon) * Math.cos(toRad(lat));
  const x =
    Math.cos(toRad(manilaLat)) * Math.sin(toRad(lat)) -
    Math.sin(toRad(manilaLat)) * Math.cos(toRad(lat)) * Math.cos(dLon);
  const brng = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  const dir = getDirectionLabel(brng);

  return { distance, direction: dir };
}

const TropicalCycloneInformation = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [storm, setStorm] = useState(null);
  const [otherStorms, setOtherStorms] = useState([]);
  const [selectedOtherIndex, setSelectedOtherIndex] = useState(0);
  const [westernPacificStorms, setWesternPacificStorms] = useState([]);
  const [selectedWpIndex, setSelectedWpIndex] = useState(0);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const resp = await fetch("https://api.knackwx.com/atcf/v2");
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const data = await resp.json();
      if (!Array.isArray(data) || data.length === 0) {
        setStorm(null);
        setOtherStorms([]);
        setWesternPacificStorms([]);
        setSelectedWpIndex(0);
        return;
      }

      const westernPacific = [];
      const otherBasins = [];

      data.forEach((item) => {
        const parts = item.interp_sector_file?.split(/\s+/) || [];
        if (parts.length < 6) {
          otherBasins.push(item);
          return;
        }
        const lat = parseFloat(parts[4]);
        const lon = parseFloat(parts[5]);
        if (
          !isNaN(lat) &&
          !isNaN(lon) &&
          lat >= 0 &&
          lat <= 40 &&
          lon >= 105 &&
          lon <= 170
        ) {
          westernPacific.push(item);
        } else {
          otherBasins.push(item);
        }
      });

      const sortByUpdatedDesc = (arr) =>
        arr.sort((a, b) => {
          const ta = new Date(a.last_updated).getTime();
          const tb = new Date(b.last_updated).getTime();
          return tb - ta;
        });

      if (westernPacific.length) {
        const sortedWp = sortByUpdatedDesc(westernPacific);

        let primaryStorm = null;
        let primaryIndex = 0;
        for (let i = 0; i < sortedWp.length; i++) {
          const item = sortedWp[i];
          const parts = item.interp_sector_file?.split(/\s+/) || [];
          if (parts.length < 6) continue;
          const lat = parseFloat(parts[4]);
          const lon = parseFloat(parts[5]);
          if (isNaN(lat) || isNaN(lon)) continue;
          if (isInsidePar(lat, lon)) {
            primaryStorm = item;
            primaryIndex = i;
            break;
          }
        }

        if (!primaryStorm) {
          primaryStorm = sortedWp[0];
          primaryIndex = 0;
        }

        setWesternPacificStorms(sortedWp);
        setSelectedWpIndex(primaryIndex);
        setStorm(primaryStorm);
      } else {
        setStorm(null);
        setWesternPacificStorms([]);
        setSelectedWpIndex(0);
      }

      setOtherStorms(sortByUpdatedDesc(otherBasins));
    } catch (err) {
      console.error("Error loading tropical disturbance information:", err);
      setError("Unable to load tropical disturbance information at the moment.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center px-6">
        <p className="text-sm tracking-wide text-red-400">{error}</p>
      </div>
    );
  }

  const hasWesternPacificStorm = !!storm;

  // Pre-compute detailed fields for the primary Western Pacific storm, if present
  let mainStorm = null;
  if (hasWesternPacificStorm && storm) {
    const parts = storm.interp_sector_file?.split(/\s+/) || [];
    const rawName = parts[1] || storm.atcf_id || "Tropical Disturbance";

    const dateStr = parts[2] || "";
    const timeStr = parts[3] || "";
    const lat = parseFloat(parts[4]);
    const lon = parseFloat(parts[5]);
    const winds1MinKnots = parseFloat(parts[8]);

    const pressure = parseFloat(parts[9]);
    const speedKnots = parseFloat(parts[10]);
    const directionDeg = parseFloat(parts[11]);

    const wind10MinKmh = to10MinWindKmH(winds1MinKnots || 0);
    const gustKmh = toGustKmH(wind10MinKmh);
    const classification = classifyTropicalCyclone(wind10MinKmh);

    const insidePar = isInsidePar(lat, lon);
    const bannerText = insidePar
      ? "Now Inside the Philippine Area of Responsibility (PAR)"
      : "Currently Outside the Philippine Area of Responsibility (PAR)";
    const bannerClass = insidePar
      ? "bg-orange-600/80 text-slate-50"
      : "bg-red-600/80 text-slate-50";

    const validSpeed = speedKnots !== null && !isNaN(speedKnots) && speedKnots >= 0;
    const movementSpeedKmh = validSpeed ? Math.round(speedKnots * 1.852) : null;

    const movementDirectionLabel = (!isNaN(directionDeg) && directionDeg >= 0)
      ? getDirectionLabel(directionDeg)
      : null;
    const movementDirectionWord = getDirectionWord(movementDirectionLabel);

    const movementText = (movementSpeedKmh !== null)
      ? `Moving ${movementDirectionWord ? movementDirectionWord.toLowerCase() : movementDirectionLabel?.toLowerCase?.() || "in an unknown direction"} at ${movementSpeedKmh} km/h (Direction: ${(!isNaN(directionDeg) && directionDeg >= 0) ? `${Math.round(directionDeg)}°` : "—"})`
      : "Movement data unavailable";

    const { distance, direction } = distanceAndBearingKmFromManila(lat, lon);

    const dataTimeStr = (() => {
      if (!dateStr || !timeStr || dateStr.length < 8 || timeStr.length < 4) {
        return formatDataTime(storm.last_updated);
      }
      const yyyy = dateStr.substring(0, 4);
      const mm = dateStr.substring(4, 6);
      const dd = dateStr.substring(6, 8);
      const hh = timeStr.substring(0, 2);
      const min = timeStr.substring(2, 4);
      const iso = `${yyyy}-${mm}-${dd}T${hh}:${min}:00Z`;
      return formatDataTime(iso);
    })();

    const { displayName, intlName, pagasaName } = getStormDisplayName(
      rawName,
      classification.code,
      insidePar,
      storm.atcf_id
    );



    mainStorm = {
      name: rawName,
      atcfId: storm.atcf_id,
      displayName,
      intlName,
      pagasaName,
      lat,
      lon,
      wind10MinKmh,
      gustKmh,
      pressure,
      classification,
      insidePar,
      bannerText,
      bannerClass,
      movementText,
      distance,
      direction,
      dataTimeStr,
      movementSpeedKmh,
      movementDirectionLabel,
      movementDirectionWord,
      directionDeg: isNaN(directionDeg) ? null : Math.round(directionDeg),
      intensityPercent: windIntensityPercent(wind10MinKmh),
      threatLevel: threatLevelText(classification.code),
      threatBg: threatBgColor(classification.code),
      last_updated: storm.last_updated
    };
  }

  // Dynamically load Dapiya High-Res Imagery
  const StormMediaViewer = ({ stormData }) => {
    const floaterId = stormData.atcfId ? stormData.atcfId.toUpperCase() : null;
    const [dapiyaImgUrl, setDapiyaImgUrl] = useState(null);
    const [imgError, setImgError] = useState(false);
    const [imageType, setImageType] = useState('RGB');
    const [isImageDownloading, setIsImageDownloading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);

    useEffect(() => {
      if (floaterId) {
        let isMounted = true;

        // Initial load state reset (Only done on first mount or type change)
        setDapiyaImgUrl(null);
        setImgError(false);
        setIsImageDownloading(true);

        const fetchDapiyaImage = async (isAutoRefresh = false) => {
          try {
            const dirUrl = `https://data.dapiya.top/history/${floaterId}/${imageType}/`;
            const response = await fetch(dirUrl);
            if (!response.ok) throw new Error(`Dapiya directory not found for ${imageType}`);

            const htmlText = await response.text();

            // Extract all hrefs that look like image files
            const matches = [...htmlText.matchAll(/href="([^"]+\.(png|jpg|jpeg|gif))"/gi)];
            if (matches && matches.length > 0 && isMounted) {
              // Get the last matched file (most recent timestamp)
              const latestFile = matches[matches.length - 1][1];
              const newUrl = `${dirUrl}${latestFile}`;

              setDapiyaImgUrl(currentUrl => {
                // If this is a refresh and the exact image is already loaded, do nothing
                if (isAutoRefresh && currentUrl === newUrl) {
                  return currentUrl;
                }
                // If it's a new frame, trigger the transition and image download event handler
                if (isAutoRefresh) {
                  setIsImageDownloading(true);
                }
                return newUrl;
              });

            } else if (isMounted && !isAutoRefresh) {
              setImgError(true);
            }
          } catch (error) {
            console.error(`Failed to fetch Dapiya URL for ${imageType}:`, error);
            if (isMounted && !isAutoRefresh) setImgError(true);
          }
        };

        // Initial manual fetch
        fetchDapiyaImage(false);

        // Setup autonomous background polling (Every 5 minutes)
        const refreshInterval = setInterval(() => {
          fetchDapiyaImage(true);
        }, 5 * 60 * 1000);

        return () => {
          isMounted = false;
          clearInterval(refreshInterval);
        };
      }
    }, [floaterId, imageType]);

    // Lock body scroll when modal is open
    useEffect(() => {
      if (isModalOpen) {
        document.body.style.overflow = 'hidden';
      } else {
        document.body.style.overflow = 'auto';
      }
      return () => {
        document.body.style.overflow = 'auto';
      };
    }, [isModalOpen]);

    const WindyMap = () => (
      <div style={{ position: 'absolute', inset: 0 }}>
        <iframe
          key={stormData.last_updated}
          title="Interactive Storm Map"
          width="100%"
          height="100%"
          style={{ position: 'absolute', top: 0, left: 0, border: 0 }}
          src={`https://embed.windy.com/embed.html?lat=${stormData.lat}&lon=${stormData.lon}&zoom=6&level=surface&overlay=satellite&product=ecmwf&menu=&message=true&marker=true&calendar=now&pressure=&type=map&location=coordinates&detail=&metricWind=km%2Fh&metricTemp=%C2%B0C&radarRange=-1`}
          frameBorder="0"
        ></iframe>
        <div style={{ position: 'absolute', inset: 0, zIndex: 10, cursor: 'default' }} />
      </div>
    );

    if (!floaterId) {
      return <WindyMap />;
    }

    return (
      <>
        <div className="absolute inset-0 flex items-center justify-center bg-[#1e1e2d] relative group overflow-hidden">
          {/* Type Selector Overlay (Hover on desktop, always visible on mobile) */}
          <div className="absolute top-4 right-4 z-20 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity duration-300 focus-within:opacity-100">
            <select
              value={imageType}
              onChange={(e) => setImageType(e.target.value)}
              className="bg-slate-900/80 backdrop-blur-md text-slate-200 border border-slate-700 rounded-lg px-3 py-1.5 text-sm font-medium shadow-[0_4px_20px_rgba(0,0,0,0.5)] outline-none cursor-pointer hover:bg-slate-800 hover:border-blue-500/50 transition focus:ring-2 focus:ring-blue-500/50 appearance-none pr-8 relative"
              style={{
                backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' class='lucide lucide-chevron-down'/%3e%3cpolyline points='6 9 12 15 18 9' stroke='%2394a3b8' fill='none'/%3e%3c/svg%3e")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 0.5rem center',
                backgroundSize: '1em'
              }}
            >
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
              <p className="text-sm font-medium animate-pulse text-center px-4">Establishing link to Dapiya Satellite Network...<br /><span className="text-xs text-slate-500 mt-1 block">(Downloading High-Resolution {imageType} image)</span></p>
            </div>
          )}

          {dapiyaImgUrl && (
            <img
              src={dapiyaImgUrl}
              alt={`${imageType} Satellite Imagery for ${stormData.displayName}`}
              className={`w-full h-full object-contain z-0 transition-opacity duration-500 cursor-pointer hover:scale-[1.02] ${isImageDownloading ? 'opacity-0' : 'opacity-100'}`}
              onLoad={() => setIsImageDownloading(false)}
              onClick={() => setIsModalOpen(true)}
              onError={() => {
                setIsImageDownloading(false);
                setImgError(true);
              }}
            />
          )}
        </div>

        {/* Fullscreen Image Modal Overlay */}
        {isModalOpen && dapiyaImgUrl && !imgError && (
          <div className="fixed inset-0 z-[2000] flex flex-col items-center justify-center bg-black/95 backdrop-blur-md p-4 md:p-8 animate-in fade-in duration-300">
            <button
              onClick={() => setIsModalOpen(false)}
              className="absolute top-6 right-6 md:top-8 md:right-8 bg-slate-800/80 hover:bg-slate-700 hover:scale-110 text-white rounded-full p-2.5 transition-all z-[2010] shadow-lg border border-slate-600/50"
              aria-label="Close Fullscreen View"
            >
              <X className="w-6 h-6" />
            </button>

            <div className="relative w-full h-[85vh] flex items-center justify-center">
              <img
                src={dapiyaImgUrl}
                alt={`${imageType} Satellite Imagery Fullscreen`}
                className="max-w-full max-h-full object-contain rounded-xl shadow-[0_0_50px_rgba(0,0,0,0.8)] border border-slate-800/50"
              />
            </div>

            <div className="absolute bottom-6 md:bottom-8 left-0 right-0 text-center px-6">
              <p className="text-xs md:text-sm text-slate-400 font-medium tracking-wide">
                Satellite Imagery elegantly provided by <span className="text-blue-400">data.dapiya.top</span>
              </p>
            </div>
          </div>
        )}
      </>
    );
  };

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
                <h1 className="text-2xl font-semibold tracking-tight text-slate-50 md:text-3xl">
                  Tropical Disturbance Information
                </h1>
              </div>
            </div>
            <div>
              <p className="text-sm leading-relaxed text-slate-400">
                Real-time updates for the Western North Pacific and Philippine domain.
              </p>
              <div className="mt-3 h-px w-28 bg-gradient-to-r from-blue-400/70 via-cyan-300/60 to-transparent" />
            </div>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="inline-flex items-center justify-center rounded-full border border-slate-700/80 px-6 py-3 text-sm font-medium text-slate-100 shadow-inner shadow-slate-900/60 transition hover:border-blue-400/60 hover:text-white disabled:opacity-50 cursor-pointer"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </header>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 animate-pulse">
                <div className="h-3 bg-slate-700 rounded w-3/4 mb-2"></div>
                <div className="h-4 bg-slate-700 rounded w-1/2"></div>
              </div>
            ))}
          </div>
        ) : (
          <>
            {!hasWesternPacificStorm && (
              <section className="mb-10 flex items-center justify-center rounded-2xl border border-slate-700/70 bg-slate-900/60 px-8 py-6 text-center text-sm text-slate-200 shadow-[0_0_35px_rgba(8,47,73,0.45)]">
                <p className="max-w-xl font-medium leading-relaxed">
                  No active tropical disturbances in the Western North Pacific / Philippine domain at this time.
                </p>
              </section>
            )}

            {westernPacificStorms.length > 1 && (
              <div className="flex flex-col items-start lg:items-end mb-6 w-full lg:w-auto">
                <span className="text-[10px] md:text-xs uppercase tracking-wide text-slate-500 mb-1">
                  Select Active Storm
                </span>
                <select
                  value={selectedWpIndex}
                  onChange={(e) => {
                    const idx = Number(e.target.value);
                    setSelectedWpIndex(idx);
                    setStorm(westernPacificStorms[idx]);
                  }}
                  className="w-full lg:w-[320px] bg-slate-900/80 border border-slate-700 text-slate-100 text-sm rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all font-medium cursor-pointer"
                >
                  {westernPacificStorms.map((s, index) => {
                    const parts = s.interp_sector_file?.split(/\s+/) || [];
                    const rawName = parts[1] || s.atcf_id || "Tropical Disturbance";
                    const wind10 = to10MinWindKmH(parseFloat(parts[8]) || 0);
                    const cls = classifyTropicalCyclone(wind10);
                    const lat = parseFloat(parts[4]);
                    const lon = parseFloat(parts[5]);
                    const insidePar = isInsidePar(lat, lon);
                    const refinedName = getStormDisplayName(rawName, cls.code, insidePar, s.atcf_id);
                    return (
                      <option key={s.atcf_id || index} value={index} className="bg-slate-800">
                        {refinedName.displayName} - {cls.label}
                      </option>
                    );
                  })}
                </select>
              </div>
            )}

            {hasWesternPacificStorm && mainStorm && (
              <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6 mb-10">
                {/* Left Column: Stats */}
                <div className="flex flex-col gap-6 bg-[#2a2c3a] rounded-xl p-5 shadow-lg border border-slate-700/50">
                  {/* Header Box */}
                  <div className="bg-[#20212d] rounded-lg p-4 text-center border border-slate-700/50">
                    <h2 className="text-2xl font-bold text-yellow-400 capitalize whitespace-nowrap overflow-hidden text-ellipsis">
                      {mainStorm.classification.label.toLowerCase()}
                    </h2>
                    <p className="text-[10px] font-bold text-slate-300 tracking-wider mt-1 uppercase">
                      UPDATE - AS OF {mainStorm.dataTimeStr}
                    </p>
                  </div>

                  {/* List of Stats */}
                  <div className="flex flex-col gap-5 px-2">
                    {/* Max Wind */}
                    <div className="flex items-center gap-4">
                      <div className="flex-shrink-0 w-10 h-10 rounded-full border-2 border-yellow-500/80 flex items-center justify-center text-yellow-500">
                        <Wind className="w-5 h-5" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-yellow-500 font-bold text-sm tracking-wide">Max Wind (KM/H)</span>
                        <span className="text-sm text-slate-200 mt-0.5">{mainStorm.wind10MinKmh}km/h near the center</span>
                      </div>
                    </div>

                    {/* Pressure */}
                    <div className="flex items-center gap-4">
                      <div className="flex-shrink-0 w-10 h-10 rounded-full border-2 border-yellow-500/80 flex items-center justify-center text-yellow-500">
                        <Gauge className="w-5 h-5" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-yellow-500 font-bold text-sm tracking-wide">Pressure (hPa)</span>
                        <span className="text-sm text-slate-200 mt-0.5">{isNaN(mainStorm.pressure) ? "N/A" : `${mainStorm.pressure} hPa`}</span>
                      </div>
                    </div>

                    {/* Movement */}
                    <div className="flex items-center gap-4">
                      <div className="flex-shrink-0 w-10 h-10 rounded-full border-2 border-yellow-500/80 flex items-center justify-center text-yellow-500">
                        <Navigation className="w-5 h-5" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-yellow-500 font-bold text-sm tracking-wide">Current Movement (KM/H)</span>
                        <span className="text-sm text-slate-200 mt-0.5">
                          {mainStorm.movementSpeedKmh !== null
                            ? `${mainStorm.movementDirectionWord || "Unknown"} at ${mainStorm.movementSpeedKmh}km/h`
                            : "Movement data unavailable"}
                        </span>
                      </div>
                    </div>

                    {/* Chance of Development / Classification */}
                    <div className="flex items-center gap-4">
                      <div className="flex-shrink-0 w-10 h-10 rounded-full border-2 border-yellow-500/80 flex items-center justify-center text-yellow-500">
                        <Activity className="w-5 h-5" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-yellow-500 font-bold text-sm tracking-wide">Status / Threat Level</span>
                        <span className="text-sm text-slate-200 mt-0.5">{mainStorm.classification.code === "LPA" ? "Low to Medium Chance of Development" : `${mainStorm.classification.label} - ${mainStorm.threatLevel} Threat`}</span>
                      </div>
                    </div>
                  </div>

                  {/* Storm Summary */}
                  <div className="bg-[#20212d] rounded-lg p-5 mt-auto border border-slate-700/50">
                    <h3 className="text-yellow-500 font-bold text-lg mb-2">Storm Summary</h3>
                    <p className="text-sm text-slate-200 leading-relaxed text-center">
                      {generateStormSummary({
                        displayName: mainStorm.displayName || mainStorm.name,
                        classificationCode: mainStorm.classification.code,
                        windKmh: mainStorm.wind10MinKmh,
                        pressure: mainStorm.pressure,
                        movementSpeedKmh: mainStorm.movementSpeedKmh,
                        movementWord: mainStorm.movementDirectionWord,
                        distance: mainStorm.distance,
                        direction: mainStorm.direction,
                        threatLevel: mainStorm.threatLevel,
                        insidePar: mainStorm.insidePar
                      })}
                    </p>
                  </div>
                </div>

                {/* Right Column: Map & Threat Level */}
                <div className="flex flex-col h-full bg-[#2a2c3a] rounded-xl p-5 shadow-lg border border-slate-700/50">
                  <div className="flex-grow w-full rounded-lg overflow-hidden border-2 border-slate-600/50 bg-[#1e1e2d] relative flex items-center justify-center aspect-square md:aspect-auto md:min-h-[400px]">
                    {!isNaN(mainStorm.lat) && !isNaN(mainStorm.lon) ? (
                      <StormMediaViewer stormData={mainStorm} />
                    ) : (
                      <>
                        <div className="absolute inset-0 bg-gradient-to-br from-slate-800 to-slate-900 opacity-80"></div>
                        <MapPin className="w-16 h-16 text-slate-500 opacity-20 z-10" />
                        <span className="absolute z-10 text-slate-500 font-medium tracking-widest uppercase text-xs mt-20 text-center px-4">
                          Location Data Unavailable
                        </span>
                      </>
                    )}
                  </div>

                  <div className="mt-5 rounded-lg overflow-hidden border border-slate-700/50 flex flex-col">
                    <div className={`${mainStorm.threatBg} px-4 py-2 flex items-center gap-2`}>
                      <span className="bg-white/20 rounded-full w-6 h-6 flex items-center justify-center font-bold text-white text-sm">!</span>
                      <span className="text-white font-bold tracking-wide">Threat Level: {mainStorm.threatLevel}</span>
                    </div>
                    <div className="bg-[#20212d] px-4 py-3 text-center">
                      <span className="text-slate-200 text-sm font-medium">
                        {mainStorm.insidePar
                          ? (mainStorm.threatLevel === "High" ? "Destructive winds and intense rainfall expected." : "Scattered rainshowers and isolated thunderstorms possible in affected areas.")
                          : "System is outside PAR; no direct threat to the country at this time."}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {otherStorms.length > 0 && (
              <section className="mt-12 border-t border-slate-800/50 pt-8">
                <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold tracking-[0.3em] text-slate-300">
                      Other Active Tropical Disturbances (Outside Western Pacific)
                    </h2>
                    <p className="mt-2 text-sm text-slate-400">
                      Tropical systems currently being monitored outside of the Philippine Area of Responsibility.
                    </p>
                  </div>

                  {/* Select Storm Dropdown */}
                  {otherStorms.length > 1 && (
                    <div className="flex flex-col items-start md:items-end min-w-[280px]">
                      <span className="text-[10px] md:text-xs uppercase tracking-wide text-slate-500 mb-1">
                        Select Storm
                      </span>
                      <select
                        value={selectedOtherIndex}
                        onChange={(e) => setSelectedOtherIndex(Number(e.target.value))}
                        className="w-full bg-slate-900/80 border border-slate-700 text-slate-100 text-sm rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all font-medium cursor-pointer"
                      >
                        {otherStorms.map((s, index) => {
                          const parts = s.interp_sector_file?.split(/\s+/) || [];
                          const rawName = parts[1] || s.atcf_id || "Tropical Disturbance";
                          const wind10 = to10MinWindKmH(parseFloat(parts[8]) || 0);
                          const cls = classifyTropicalCyclone(wind10);
                          const lat = parseFloat(parts[4]);
                          const lon = parseFloat(parts[5]);
                          const insidePar = isInsidePar(lat, lon);
                          const refinedName = getStormDisplayName(rawName, cls.code, insidePar, s.atcf_id);
                          return (
                            <option key={s.atcf_id || index} value={index}>
                              {refinedName.displayName} - {cls.label}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1">
                  {(() => {
                    // Render ONLY the selected storm
                    const s = otherStorms[selectedOtherIndex];
                    if (!s) return null;

                    const parts = s.interp_sector_file?.split(/\s+/) || [];
                    const lat = parseFloat(parts[4]);
                    const lon = parseFloat(parts[5]);
                    const winds1MinKnots = parseFloat(parts[8]);
                    const pressure = parseFloat(parts[9]);
                    const speedKnots = parseFloat(parts[10]);

                    const wind10 = to10MinWindKmH(winds1MinKnots || 0);
                    const gust10 = toGustKmH(wind10);
                    const cls = classifyTropicalCyclone(wind10);
                    const insidePar = isInsidePar(lat, lon);
                    const rawName = parts[1] || s.atcf_id || "Tropical Disturbance";
                    const refinedName = getStormDisplayName(rawName, cls.code, insidePar, s.atcf_id);
                    const displayName = refinedName.displayName;
                    const validSpeed = speedKnots !== null && !isNaN(speedKnots) && speedKnots >= 0;
                    const movementSpeedKmh = validSpeed ? Math.round(speedKnots * 1.852) : null;

                    const directionValue = parseFloat(parts[11]);
                    const movementLabel = (!isNaN(directionValue) && directionValue >= 0) ? getDirectionLabel(directionValue) : null;
                    const movementWord = getDirectionWord(movementLabel);
                    const movementText = (movementSpeedKmh !== null)
                      ? `Moving ${movementWord || movementLabel || "unknown direction"} at ${movementSpeedKmh} km/h`
                      : "Movement data unavailable";

                    const { distance, direction } = distanceAndBearingKmFromManila(lat, lon);
                    const dataTimeStr = formatDataTime(s.last_updated);
                    const threatLevel = threatLevelText(cls.code);
                    const threatBg = threatBgColor(cls.code);

                    return (
                      <div key={s.atcf_id || s.last_updated} className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6 mb-8">
                        {/* Left Column: Stats */}
                        <div className="flex flex-col gap-6 bg-[#2a2c3a] rounded-xl p-5 shadow-lg border border-slate-700/50">
                          {/* Header Box */}
                          <div className="bg-[#20212d] rounded-lg p-4 text-center border border-slate-700/50">
                            <h2 className="text-2xl font-bold text-yellow-400 capitalize whitespace-nowrap overflow-hidden text-ellipsis">
                              {cls.label.toLowerCase()}
                            </h2>
                            <p className="text-[10px] font-bold text-slate-300 tracking-wider mt-1 uppercase">
                              UPDATE - AS OF {dataTimeStr}
                            </p>
                          </div>

                          {/* List of Stats */}
                          <div className="flex flex-col gap-5 px-2">
                            {/* Max Wind */}
                            <div className="flex items-center gap-4">
                              <div className="flex-shrink-0 w-10 h-10 rounded-full border-2 border-yellow-500/80 flex items-center justify-center text-yellow-500">
                                <Wind className="w-5 h-5" />
                              </div>
                              <div className="flex flex-col">
                                <span className="text-yellow-500 font-bold text-sm tracking-wide">Max Wind (KM/H)</span>
                                <span className="text-sm text-slate-200 mt-0.5">{wind10}km/h near the center</span>
                              </div>
                            </div>

                            {/* Pressure */}
                            <div className="flex items-center gap-4">
                              <div className="flex-shrink-0 w-10 h-10 rounded-full border-2 border-yellow-500/80 flex items-center justify-center text-yellow-500">
                                <Gauge className="w-5 h-5" />
                              </div>
                              <div className="flex flex-col">
                                <span className="text-yellow-500 font-bold text-sm tracking-wide">Pressure (hPa)</span>
                                <span className="text-sm text-slate-200 mt-0.5">{isNaN(pressure) ? "N/A" : `${pressure} hPa`}</span>
                              </div>
                            </div>

                            {/* Movement */}
                            <div className="flex items-center gap-4">
                              <div className="flex-shrink-0 w-10 h-10 rounded-full border-2 border-yellow-500/80 flex items-center justify-center text-yellow-500">
                                <Navigation className="w-5 h-5" />
                              </div>
                              <div className="flex flex-col">
                                <span className="text-yellow-500 font-bold text-sm tracking-wide">Current Movement (KM/H)</span>
                                <span className="text-sm text-slate-200 mt-0.5">
                                  {movementSpeedKmh !== null
                                    ? `${movementWord || "Unknown"} at ${movementSpeedKmh}km/h`
                                    : "Movement data unavailable"}
                                </span>
                              </div>
                            </div>

                            {/* Chance of Development / Classification */}
                            <div className="flex items-center gap-4">
                              <div className="flex-shrink-0 w-10 h-10 rounded-full border-2 border-yellow-500/80 flex items-center justify-center text-yellow-500">
                                <Activity className="w-5 h-5" />
                              </div>
                              <div className="flex flex-col">
                                <span className="text-yellow-500 font-bold text-sm tracking-wide">Status / Threat Level</span>
                                <span className="text-sm text-slate-200 mt-0.5">
                                  {cls.code === "LPA"
                                    ? "Potential for Development (Out of Basin)"
                                    : `${cls.label} - No Threat (Out of Basin)`}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Storm Summary */}
                          <div className="bg-[#20212d] rounded-lg p-5 mt-auto border border-slate-700/50">
                            <h3 className="text-yellow-500 font-bold text-lg mb-2">Storm Summary</h3>
                            <p className="text-sm text-slate-200 leading-relaxed text-center">
                              {generateStormSummary({
                                displayName: displayName || rawName,
                                classificationCode: cls.code,
                                windKmh: wind10,
                                pressure: pressure,
                                movementSpeedKmh: movementSpeedKmh,
                                movementWord: movementWord,
                                distance: null,
                                direction: null,
                                threatLevel: threatLevel,
                                insidePar: insidePar
                              })}
                            </p>
                          </div>
                        </div>

                        {/* Right Column: Map & Threat Level */}
                        <div className="flex flex-col h-full bg-[#2a2c3a] rounded-xl p-5 shadow-lg border border-slate-700/50">
                          <div className="flex-grow w-full rounded-lg overflow-hidden border-2 border-slate-600/50 bg-[#1e1e2d] relative flex items-center justify-center aspect-square md:aspect-auto md:min-h-[400px]">
                            {!isNaN(lat) && !isNaN(lon) ? (
                              <StormMediaViewer stormData={{
                                lat,
                                lon,
                                last_updated: s.last_updated,
                                displayName: displayName || rawName,
                                atcfId: s.atcf_id
                              }} />
                            ) : (
                              <>
                                <div className="absolute inset-0 bg-gradient-to-br from-slate-800 to-slate-900 opacity-80"></div>
                                <MapPin className="w-16 h-16 text-slate-500 opacity-20 z-10" />
                                <span className="absolute z-10 text-slate-500 font-medium tracking-widest uppercase text-xs mt-20 text-center px-4">
                                  Location Data Unavailable
                                </span>
                              </>
                            )}
                          </div>
                          {/* Threat Level Bar */}
                          <div className="mt-5 rounded-lg overflow-hidden border border-slate-700/50 flex flex-col">
                            <div className="bg-slate-600 px-4 py-2 flex items-center gap-2">
                              <span className="bg-white/20 rounded-full w-6 h-6 flex items-center justify-center font-bold text-white text-sm">i</span>
                              <span className="text-white font-bold tracking-wide">Threat Level: None (Out of Basin)</span>
                            </div>
                            <div className="bg-[#20212d] px-4 py-3 text-center">
                              <span className="text-slate-200 text-sm font-medium">
                                System is located outside the Western Pacific basin; no threat to the Philippines.
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </section>
            )}

            <section className="mt-12 border-t border-slate-800/50 pt-8">
              <details className="group rounded-2xl border border-slate-800/70 bg-slate-900/60 px-6 py-5 transition">
                <summary className="flex cursor-pointer items-center justify-between text-xs font-semibold uppercase tracking-[0.35em] text-slate-300">
                  Notes
                  <span className="text-[11px] text-slate-500 group-open:rotate-180">▾</span>
                </summary>
                <ul className="mt-4 space-y-3 text-sm text-slate-200">
                  <li className="flex items-start gap-3">
                    <span className="mt-[6px] h-2 w-2 rounded-full bg-blue-400"></span>
                    <span>Winds are 10-minute averages (PAGASA standard). Gusts ≈ 1.4 × sustained, rounded to the nearest 5 km/h.</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-[6px] h-2 w-2 rounded-full bg-cyan-300"></span>
                    <span>Conversions: 1 kt = 1.852 km/h; 1-min to 10-min winds: ×0.88.</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-[6px] h-2 w-2 rounded-full bg-indigo-300"></span>
                    <span>Always refer to official government advisories for warnings and bulletins.</span>
                  </li>
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