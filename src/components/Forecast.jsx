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

const FORECAST_OPTIONS = FORECAST_DATES.flatMap((dateStr) =>
  FORECAST_HOURS.flatMap((hhmmss) => {
    const modelTime = `${dateStr}T${hhmmss}`;
    const hourUtc = hhmmss.slice(0, 2);

    // For 00:00 UTC, your filenames omit the time part and use just the date,
    // e.g. tropical_cyclone_15day_forecast_2025-11-16.png
    const isMidnight = hhmmss === "000000";
    const fiveDayImageSrc = isMidnight
      ? `/assets/tropical_cyclone_5day_forecast_${dateStr}.png`
      : `/assets/tropical_cyclone_5day_forecast_${modelTime}.png`;
    const fifteenDayImageSrc = isMidnight
      ? `/assets/tropical_cyclone_15day_forecast_${dateStr}.png`
      : `/assets/tropical_cyclone_15day_forecast_${modelTime}.png`;

    return [
      {
        id: `5day-${modelTime}`,
        label: `5-day forecast (${dateStr} ${hourUtc}:00 UTC)`,
        modelTime,
        imageSrc: fiveDayImageSrc,
      },
      {
        id: `15day-${modelTime}`,
        label: `15-day forecast (${dateStr} ${hourUtc}:00 UTC)`,
        modelTime,
        imageSrc: fifteenDayImageSrc,
      },
    ];
  })
);

const Forecast = () => {
  // IDs of options whose images have successfully loaded
  const [availableIds, setAvailableIds] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

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

  // Start with all options that have a real image
  const availableOptions = FORECAST_OPTIONS.filter((opt) =>
    availableIds.includes(opt.id)
  );

  // Collect distinct modelTime cycles, sort newest->oldest, and keep only the
  // latest four cycles (e.g. 00, 06, 12, 18 UTC). Older cycles are dropped.
  const latestModelTimes = Array.from(
    new Set(availableOptions.map((opt) => opt.modelTime))
  )
    .sort((a, b) => (a < b ? 1 : -1))
    .slice(0, 4);

  const visibleOptions = latestModelTimes.length
    ? availableOptions
        .filter((opt) => latestModelTimes.includes(opt.modelTime))
        .sort((a, b) => (a.modelTime < b.modelTime ? 1 : -1))
    : [];

  // Determine which option is effectively selected:
  // - If the user has chosen something and it's still available, keep it.
  // - Otherwise, default to the latest available option (index 0 after sorting).
  const effectiveSelectedId =
    selectedId && visibleOptions.some((opt) => opt.id === selectedId)
      ? selectedId
      : visibleOptions.length
      ? visibleOptions[0].id
      : null;

  const current = effectiveSelectedId
    ? visibleOptions.find((opt) => opt.id === effectiveSelectedId) ??
      visibleOptions[0]
    : null;
  const imageSrc = current ? current.imageSrc : "";

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

          <div className="flex flex-col items-start md:items-end gap-2">
            <span className="text-xs uppercase tracking-wide text-slate-500">
              Forecast product
            </span>
            {visibleOptions.length > 0 ? (
              <select
                value={effectiveSelectedId ?? ""}
                onChange={(e) => setSelectedId(e.target.value)}
                className="bg-slate-900/80 border border-slate-700 text-slate-100 text-xs md:text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
              >
                {visibleOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-xs text-slate-500">
                No forecast images available for today.
              </span>
            )}
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
                  className="h-full w-full object-contain"
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
                  <dd className="text-right">GDM-FNV3</dd>
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
    </section>
  );
};

export default Forecast;
