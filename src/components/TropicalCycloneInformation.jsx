// src/components/TropicalCycloneInformation.jsx
import React, { useEffect, useState } from "react";
import { Activity, Gauge, MapPin, Navigation, Wind } from "lucide-react";
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
    };
  }

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
            className="inline-flex items-center justify-center rounded-full border border-slate-700/80 px-6 py-3 text-sm font-medium text-slate-100 shadow-inner shadow-slate-900/60 transition hover:border-blue-400/60 hover:text-white disabled:opacity-50"
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

            {hasWesternPacificStorm && mainStorm && (
              <>
                <div
                  className={`mb-8 rounded-2xl px-6 py-3 text-xs font-semibold tracking-[0.3em] uppercase ${mainStorm.bannerClass}`}
                >
                  {mainStorm.bannerText}
                </div>

                <section className="mb-10 rounded-2xl border border-slate-800/70 bg-gradient-to-br from-slate-950/90 via-slate-900/70 to-slate-900/40 p-6 shadow-[0_40px_90px_-60px_rgba(45,212,191,0.8)]">
                  <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-[0.35em] text-slate-500">System Name</p>
                      <div className="flex items-center gap-3">
                        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-cyan-500/10 text-cyan-300">
                          <Wind className="h-4 w-4" />
                        </span>

                        <h2 className="text-3xl font-semibold text-slate-50">{mainStorm.displayName || mainStorm.name}</h2>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      {westernPacificStorms.length > 1 && (
                        <select
                          value={selectedWpIndex}
                          onChange={(e) => {
                            const idx = Number(e.target.value);
                            setSelectedWpIndex(idx);
                            setStorm(westernPacificStorms[idx]);
                          }}
                          className="rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1 text-xs text-slate-200"
                        >
                          {westernPacificStorms.map((s, index) => {
                            const parts = s.interp_sector_file?.split(/\s+/) || [];
                            const rawName = parts[1] || s.atcf_id || "Tropical Disturbance";
                            let optionLabel = rawName;
                            if (optionLabel.toUpperCase().includes("INVEST")) {
                              optionLabel = "Low Pressure Area";
                            }
                            const lat = parseFloat(parts[4]);
                            const lon = parseFloat(parts[5]);
                            const inPar = !isNaN(lat) && !isNaN(lon) && isInsidePar(lat, lon);
                            const suffix = inPar ? " (inside PAR)" : " (outside PAR)";
                            return (
                              <option key={s.atcf_id || `${s.last_updated}-${index}`} value={index}>
                                {optionLabel}
                                {suffix}
                              </option>
                            );
                          })}
                        </select>
                      )}
                      <span
                        className={`inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-xs font-semibold tracking-wide backdrop-blur ${mainStorm.classification.color}`}
                      >
                        <Wind className="h-4 w-4" />
                        {mainStorm.classification.label}
                        <span className="text-slate-200">• {mainStorm.wind10MinKmh} km/h (10-min avg)</span>
                      </span>
                    </div>
                  </div>
                  <div className="grid gap-5">
                    <div className="flex flex-col gap-4 md:grid md:grid-cols-2">
                      <div className="flex items-start gap-3">
                        <span className="rounded-full bg-slate-800/80 p-2 text-cyan-300">
                          <Wind className="h-4 w-4" />
                        </span>
                        <div>
                          <p className="text-xs uppercase tracking-wide text-slate-500">Sustained Winds</p>
                          <p className="text-sm font-semibold text-slate-50">
                            {mainStorm.wind10MinKmh} km/h (10-minute)
                          </p>
                          <p className="text-xs text-slate-400">
                            Gusts up to {mainStorm.gustKmh} km/h • {describeWindIntensity(mainStorm.wind10MinKmh)}
                          </p>
                          <div className="mt-2 h-2 rounded-full bg-slate-800">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500"
                              style={{ width: `${mainStorm.intensityPercent}%` }}
                            ></div>
                          </div>
                          <p className="mt-1 text-[11px] text-slate-500">Progress toward maximum Super typhoon intensity</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <span className="rounded-full bg-slate-800/80 p-2 text-amber-300">
                          <Activity className="h-4 w-4" />
                        </span>
                        <div>
                          <p className="text-xs uppercase tracking-wide text-slate-500">Gust Potential</p>
                          <p className="text-sm font-semibold text-slate-50">Gusts up to {mainStorm.gustKmh} km/h</p>
                          <p className="text-xs text-slate-400">Category {mainStorm.classification.code} winds possible near the center.</p>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-4 md:grid md:grid-cols-2">
                      <div className="flex items-start gap-3">
                        <span className="rounded-full bg-slate-800/80 p-2 text-rose-300">
                          <Gauge className="h-4 w-4" />
                        </span>
                        <div>
                          <p className="text-xs uppercase tracking-wide text-slate-500">Central Pressure</p>
                          <p className="text-sm font-semibold text-slate-50">
                            {isNaN(mainStorm.pressure) ? "Not available" : `${mainStorm.pressure} hPa`}
                          </p>
                          <p className="text-xs text-slate-400">{describePressure(mainStorm.pressure)}</p>
                          <p className="text-[11px] text-slate-500">Lower pressure typically indicates a stronger disturbance.</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <span className="rounded-full bg-slate-800/80 p-2 text-emerald-300">
                          <Navigation className="h-4 w-4" />
                        </span>
                        <div>
                          <p className="text-xs uppercase tracking-wide text-slate-500">Movement</p>
                          <p className="text-sm font-semibold text-slate-50">{mainStorm.movementText}</p>
                          <p className="text-xs text-slate-400">
                            {mainStorm.movementSpeedKmh
                              ? `Direction: ${mainStorm.movementDirectionWord || mainStorm.movementDirectionLabel || "—"} (${mainStorm.directionDeg ?? "—"}°)`
                              : "Movement trend unavailable"}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-4 md:grid md:grid-cols-2">
                      <div className="flex items-start gap-3">
                        <span className="rounded-full bg-slate-800/80 p-2 text-indigo-300">
                          <MapPin className="h-4 w-4" />
                        </span>
                        <div>
                          <p className="text-xs uppercase tracking-wide text-slate-500">Position & Reference</p>
                          <p className="text-sm font-semibold text-slate-50">
                            {isNaN(mainStorm.lat) || isNaN(mainStorm.lon)
                              ? "Coordinates unavailable"
                              : `${Math.abs(mainStorm.lat).toFixed(1)}°${mainStorm.lat >= 0 ? "N" : "S"}, ${Math.abs(mainStorm.lon).toFixed(1)}°${mainStorm.lon >= 0 ? "E" : "W"}`}
                          </p>
                          {!isNaN(mainStorm.lat) && !isNaN(mainStorm.lon) && (
                            <>
                              <p className="text-xs text-slate-400">
                                Approx. {mainStorm.distance} km {mainStorm.direction} of Manila
                              </p>
                              <p className="text-xs text-slate-400">
                                {mainStorm.insidePar
                                  ? "Currently inside the Philippine Area of Responsibility (PAR)."
                                  : "Currently outside the Philippine Area of Responsibility (PAR)."}
                              </p>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-between rounded-2xl border border-slate-800/60 bg-slate-900/60 px-4 py-3">
                        <div>
                          <p className="text-xs uppercase tracking-wide text-slate-500">View detailed track</p>
                          <p className="text-sm font-semibold text-slate-50">Open interactive map</p>
                        </div>
                        <a
                          href="/cyclone"
                          className="rounded-full border border-slate-700/70 px-4 py-2 text-xs font-semibold text-slate-50 transition hover:border-cyan-300 hover:text-white"
                        >
                          View on Map
                        </a>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="mb-12 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-4 shadow-inner shadow-slate-950/40">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Classification</p>
                    <p className="text-base font-semibold text-slate-50">{mainStorm.classification.label}</p>
                  </div>

                  <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-4 shadow-inner shadow-slate-950/40">
                    <p className="text-xs uppercase tracking-wide text-slate-400">10-Min Sustained Winds</p>
                    <p className="text-base font-semibold text-slate-50">{mainStorm.wind10MinKmh} km/h near center</p>
                  </div>

                  <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-4 shadow-inner shadow-slate-950/40">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Gustiness</p>
                    <p className="text-base font-semibold text-slate-50">Up to {mainStorm.gustKmh} km/h</p>
                  </div>

                  <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-4 shadow-inner shadow-slate-950/40">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Central Pressure</p>
                    <p className="text-base font-semibold text-slate-50">
                      {isNaN(mainStorm.pressure) ? "N/A" : `${mainStorm.pressure} hPa`}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-4 shadow-inner shadow-slate-950/40">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Movement</p>
                    <p className="text-base font-semibold text-slate-50">{mainStorm.movementText}</p>
                  </div>

                  <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-4 shadow-inner shadow-slate-950/40">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Current Location</p>
                    <p className="text-base font-semibold text-slate-50">
                      {isNaN(mainStorm.lat) || isNaN(mainStorm.lon)
                        ? "N/A"
                        : `${Math.abs(mainStorm.lat).toFixed(1)}°${mainStorm.lat >= 0 ? "N" : "S"}, ${Math.abs(mainStorm.lon).toFixed(1)}°${mainStorm.lon >= 0 ? "E" : "W"}`}
                    </p>
                    {!isNaN(mainStorm.lat) && !isNaN(mainStorm.lon) && (
                      <p className="text-xs text-slate-400">
                        ~{mainStorm.distance} km {mainStorm.direction} of Manila
                      </p>
                    )}
                  </div>
                </section>
              </>
            )}

            {otherStorms.length > 0 && (
              <section className="mt-12 border-t border-slate-800/50 pt-8">
                <h2 className="mb-6 text-lg font-semibold tracking-[0.3em] text-slate-300">
                  Other Active Tropical Disturbances (Outside PAR)
                </h2>
                <p className="mb-6 text-sm text-slate-400">
                  Tropical systems currently being monitored outside of the Philippine Area of Responsibility.
                </p>
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                  {otherStorms.map((s) => {
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

                    return (
                      <a
                        key={s.atcf_id || s.last_updated}
                        href="/cyclone"
                        className="group flex min-h-[220px] flex-col rounded-2xl border border-slate-800/70 bg-slate-900/65 p-5 shadow-[0_25px_60px_-45px_rgba(8,145,178,0.8)] transition hover:border-cyan-300/70"
                        aria-label={`View detailed track for ${displayName}`}
                      >
                        <div className="mb-4 flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <p className="text-xs uppercase tracking-[0.35em] text-slate-500">System</p>
                            <div className="flex items-center gap-2">
                              <Wind className="h-4 w-4 text-cyan-300" />
                              <p className="text-lg font-semibold text-slate-50">{displayName}</p>
                            </div>
                          </div>
                          <span
                            className={`inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-[11px] font-semibold tracking-wide ${cls.color}`}
                          >
                            {cls.label}
                          </span>
                        </div>
                        <div className="space-y-2 text-sm text-slate-300">
                          <p>
                            <span className="font-semibold text-slate-50">Sustained:</span> {wind10} km/h (10-min avg)
                          </p>
                          <p>
                            <span className="font-semibold text-slate-50">Gusts:</span> up to {gust10} km/h
                          </p>
                          <p>
                            <span className="font-semibold text-slate-50">Pressure:</span> {isNaN(pressure) ? "N/A" : `${pressure} hPa`}
                          </p>
                          <p>
                            <span className="font-semibold text-slate-50">Movement:</span> {movementText}
                          </p>
                          {!isNaN(lat) && !isNaN(lon) && (
                            <p>
                              <span className="font-semibold text-slate-50">Position:</span> {Math.abs(lat).toFixed(1)}°{lat >= 0 ? "N" : "S"}, {Math.abs(lon).toFixed(1)}°{lon >= 0 ? "E" : "W"}
                            </p>
                          )}
                        </div>
                        <div className="mt-auto flex items-center justify-between pt-4 text-[11px] text-slate-500">
                          <span>Updated: {formatDataTime(s.last_updated)}</span>
                          <span className="text-cyan-300 opacity-0 transition group-hover:opacity-100">View details →</span>
                        </div>
                      </a>
                    );
                  })}
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