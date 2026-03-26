// src/components/Forecast.jsx
import React, { useEffect, useState } from "react";

// Build dynamic date strings for today and yesterday in YYYY-MM-DD format
const today = new Date();
const yyyy = today.getFullYear();
const mm = String(today.getMonth() + 1).padStart(2, "0");
const dd = String(today.getDate()).padStart(2, "0");
const todayDateStr = `${yyyy}-${mm}-${dd}`; // e.g. 2025-11-16

const yesterday = new Date(today);
yesterday.setDate(today.getDate() - 1);
const yyyyY = yesterday.getFullYear();
const mmY = String(yesterday.getMonth() + 1).padStart(2, "0");
const ddY = String(yesterday.getDate()).padStart(2, "0");
const yesterdayDateStr = `${yyyyY}-${mmY}-${ddY}`; // e.g. 2025-11-15

// Convert a model time string like "YYYY-MM-DDTHHMMSS" (UTC)
// to a 12-hour PHST label using custom 6-hour cycle mapping:
// 00Z -> 4:00 PM, 06Z -> 10:00 PM, 12Z -> 4:00 AM, 18Z -> 10:00 AM
const toPhstLabel = (modelTime) => {
  const timePart = modelTime.split("T")[1] || "000000"; // HHMMSS
  const utcHour = parseInt(timePart.slice(0, 2), 10);
  const utcMinute = parseInt(timePart.slice(2, 4), 10);

  // Base mapping for every 6-hour UTC cycle
  let phHour24;
  switch (utcHour) {
    case 0:
      phHour24 = 16; // 4 PM
      break;
    case 6:
      phHour24 = 22; // 10 PM
      break;
    case 12:
      phHour24 = 4; // 4 AM
      break;
    case 18:
      phHour24 = 10; // 10 AM
      break;
    default:
      // Fallback to simple UTC+8 if some other hour appears
      phHour24 = (utcHour + 8) % 24;
  }

  const minute = utcMinute;
  const period = phHour24 >= 12 ? "PM" : "AM";
  let hour12 = phHour24 % 12;
  if (hour12 === 0) hour12 = 12;

  const minuteStr = String(minute).padStart(2, "0");
  return `${hour12}:${minuteStr} ${period}`;
};

// Forecast products using the user's file naming pattern
// We define four UTC hours and generate entries for both 5-day and 15-day
// for today and yesterday, so that if today's images are not ready yet,
// yesterday's latest run still appears.
const FORECAST_HOURS = ["000000", "060000", "120000", "180000"]; // 00, 06, 12, 18 UTC
const FORECAST_DATES = [todayDateStr, yesterdayDateStr];

// Expand FORECAST_OPTIONS to support multiple models
const FORECAST_OPTIONS = FORECAST_DATES.flatMap((dateStr) =>
  FORECAST_HOURS.flatMap((hhmmss) => {
    const modelTime = `${dateStr}T${hhmmss}`;
    const hourUtc = hhmmss.slice(0, 2);
    const isMidnight = hhmmss === "000000";

    // Google DeepMind FNV3 Base Ensemble (no prefix)
    const fnv3Base5Day = isMidnight ? `/assets/tropical_cyclone_5day_forecast_${dateStr}.png` : `/assets/tropical_cyclone_5day_forecast_${modelTime}.png`;
    const fnv3Base15Day = isMidnight ? `/assets/tropical_cyclone_15day_forecast_${dateStr}.png` : `/assets/tropical_cyclone_15day_forecast_${modelTime}.png`;

    // Google DeepMind FNV3 Large Ensemble (fnv3_ prefix)
    const fnv3Large5Day = isMidnight ? `/assets/fnv3_tropical_cyclone_5day_forecast_${dateStr}.png` : `/assets/fnv3_tropical_cyclone_5day_forecast_${modelTime}.png`;
    const fnv3Large15Day = isMidnight ? `/assets/fnv3_tropical_cyclone_15day_forecast_${dateStr}.png` : `/assets/fnv3_tropical_cyclone_15day_forecast_${modelTime}.png`;

    return [
      {
        id: `fnv3-base-5day-${modelTime}`,
        type: "5day",
        model: "fnv3_base",
        label: `5-day forecast (${dateStr} ${hourUtc}:00 UTC)`,
        modelTime,
        imageSrc: fnv3Base5Day,
      },
      {
        id: `fnv3-base-15day-${modelTime}`,
        type: "15day",
        model: "fnv3_base",
        label: `15-day forecast (${dateStr} ${hourUtc}:00 UTC)`,
        modelTime,
        imageSrc: fnv3Base15Day,
      },
      {
        id: `fnv3-large-5day-${modelTime}`,
        type: "5day",
        model: "fnv3_large",
        label: `5-day forecast (${dateStr} ${hourUtc}:00 UTC)`,
        modelTime,
        imageSrc: fnv3Large5Day,
      },
      {
        id: `fnv3-large-15day-${modelTime}`,
        type: "15day",
        model: "fnv3_large",
        label: `15-day forecast (${dateStr} ${hourUtc}:00 UTC)`,
        modelTime,
        imageSrc: fnv3Large15Day,
      },
    ];
  })
);

const Forecast = () => {
  // IDs of options whose images have successfully loaded
  const [availableIds, setAvailableIds] = useState([]);
  const [selectedModel, setSelectedModel] = useState("fnv3_base");
  const [selectedTimeId, setSelectedTimeId] = useState(null); // stores the "type-modelTime" part

  // On mount, probe all forecast images and keep only those that exist
  useEffect(() => {
    FORECAST_OPTIONS.forEach((opt) => {
      const img = new Image();
      img.onload = () => {
        setAvailableIds((prev) =>
          prev.includes(opt.id) ? prev : [...prev, opt.id]
        );
      };
      img.onerror = () => {
        setAvailableIds((prev) => prev.filter((id) => id !== opt.id));
      };
      img.src = opt.imageSrc;
    });
  }, []);

  // Start with all options that have a real image, filtered by chosen model
  const availableOptionsForModel = FORECAST_OPTIONS.filter(
    (opt) => availableIds.includes(opt.id) && opt.model === selectedModel
  );

  // Collect distinct model time+type pairs to group them logically
  const latestConfigurations = Array.from(
    new Set(availableOptionsForModel.map((opt) => `${opt.type}-${opt.modelTime}`))
  ).sort((a, b) => {
    const timeA = a.substring(a.indexOf('-') + 1);
    const timeB = b.substring(b.indexOf('-') + 1);

    if (timeA !== timeB) return timeA < timeB ? 1 : -1;
    // For the same time, ensure 15day is sorted before 5day
    return a.startsWith("15day") ? -1 : 1;
  }); // Sort newest->oldest

  const visibleOptions = latestConfigurations.map((configId) => {
    return availableOptionsForModel.find(opt => `${opt.type}-${opt.modelTime}` === configId);
  }).filter(Boolean); // Keep unique valid options

  // Determine which option is effectively selected for the currently active model:
  const effectiveSelectedId =
    selectedTimeId && visibleOptions.some((opt) => `${opt.type}-${opt.modelTime}` === selectedTimeId)
      ? visibleOptions.find(opt => `${opt.type}-${opt.modelTime}` === selectedTimeId)?.id
      : visibleOptions.length
        ? visibleOptions[0].id
        : null;

  const current = effectiveSelectedId
    ? visibleOptions.find((opt) => opt.id === effectiveSelectedId)
    : null;
  const imageSrc = current ? current.imageSrc : "";

  const [enlargedImage, setEnlargedImage] = useState(null);

  return (
    <section className="bg-slate-950 py-12">
      <div className="max-w-6xl mx-auto px-4">
        <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-slate-50 mb-2">
              AI Forecast
            </h1>
            <p className="text-sm md:text-base text-slate-400 max-w-xl">
              Browse model guidance for the current tropical system. Choose a
              forecast product below to view the corresponding track prepared by
              Philippine Typhoon/Weather.
            </p>
          </div>

          <div className="flex flex-col items-start md:items-end gap-3 flex-shrink-0">
            {/* Interactive Spaghetti Map button */}
            <a
              href="/spaghetti"
              className="inline-flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 border border-slate-600 hover:border-slate-500 text-slate-200 text-xs font-semibold rounded-lg transition-colors shadow-sm cursor-pointer"
            >
              <svg className="w-3.5 h-3.5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              Interactive Map
            </a>

            {/* Model Toggle */}
            <div className="flex bg-slate-900/80 rounded-lg p-1 border border-slate-700">
              <button
                onClick={() => setSelectedModel("fnv3_base")}
                className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${selectedModel === "fnv3_base"
                  ? "bg-slate-700 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                  }`}
              >
                GDM FNV3 (Base)
              </button>
              <button
                onClick={() => setSelectedModel("fnv3_large")}
                className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${selectedModel === "fnv3_large"
                  ? "bg-slate-700 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                  }`}
              >
                FNV3 Large Ensemble
              </button>
            </div>

            <div className="w-full flex flex-col items-start md:items-end">
              {visibleOptions.length > 0 ? (
                <select
                  value={current ? `${current.type}-${current.modelTime}` : ""}
                  onChange={(e) => setSelectedTimeId(e.target.value)}
                  className="bg-slate-900/80 border border-slate-700 text-slate-100 text-sm rounded-lg px-3 py-2 w-full max-w-[280px] focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500 transition-all font-medium cursor-pointer"
                >
                  {visibleOptions.map((opt) => (
                    <option key={opt.id} value={`${opt.type}-${opt.modelTime}`}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-xs text-slate-500 py-2">
                  No images available for {selectedModel === "fnv3_base" ? "GDM-FNV3" : "Large Ensemble"} today.
                </span>
              )}
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[2fr,1fr] gap-8 items-start">
          {/* Forecast image panel */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden">
            <div className="border-b border-slate-800 px-4 py-2 flex items-center justify-between text-xs text-slate-400">
              <span>Forecast track map</span>
              <span className="font-mono text-[11px] text-slate-500">
                {current ? current.modelTime : "N/A"}
              </span>
            </div>
            <div className="h-80 md:h-[26rem] flex items-center justify-center bg-slate-900">
              {current ? (
                <img
                  src={imageSrc}
                  alt={`Forecast track for ${current.label}`}
                  onClick={() => setEnlargedImage(imageSrc)}
                  className="h-full w-full object-contain cursor-pointer hover:opacity-90 transition-opacity"
                />
              ) : (
                <span className="text-xs md:text-sm text-slate-500">
                  No forecast image available.
                </span>
              )}
            </div>
          </div>

          {/* Metadata / details panel */}
          <aside className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4 text-sm text-slate-200">
            <div>
              <h2 className="text-sm font-semibold text-slate-100 mb-1">
                Run details
              </h2>
              <dl className="space-y-1 text-xs md:text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Model time</dt>
                  <dd className="font-mono text-right text-slate-200">
                    {current
                      ? `${current.modelTime} (${toPhstLabel(
                        current.modelTime
                      )} PHST)`
                      : "N/A"}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Model source</dt>
                  <dd className="text-right">
                    {selectedModel === "fnv3_base" ? "GDM-FNV3 Ensemble" : "GDM-FNV3 Large Ensemble"}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Processed by</dt>
                  <dd className="text-right">Philippine Typhoon/Weather</dd>
                </div>
              </dl>
            </div>

            <div className="border-t border-slate-800 pt-4 space-y-2 text-xs md:text-sm">
              <p className="text-slate-300">
                This page is for visualization and guidance only. Always check
                official bulletins from PAGASA, JTWC, JMA, and your local
                authorities when making decisions for safety.
              </p>
            </div>
          </aside>
        </div>
      </div>

      {/* Full Screen Image Modal */}
      {enlargedImage && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm" onClick={() => setEnlargedImage(null)}>
          <button
            onClick={() => setEnlargedImage(null)}
            className="absolute top-4 right-4 p-2 text-white/70 hover:text-white bg-slate-800/50 hover:bg-slate-800 rounded-full transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
          <img
            src={enlargedImage}
            alt="Enlarged forecast"
            className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </section>
  );
};

export default Forecast;
