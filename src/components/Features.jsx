// src/components/Features.jsx
import React from "react";

const today = new Date();
const yyyy = today.getFullYear();
const mm = String(today.getMonth() + 1).padStart(2, "0");
const dd = String(today.getDate()).padStart(2, "0");
const todayDateStr = `${yyyy}-${mm}-${dd}`;

const Features = () => {
  return (
    <section className="py-16 bg-slate-950">
      <div className="max-w-6xl mx-auto px-4">
        <div className="text-center mb-12">
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-slate-50 mb-3">
            Philippine Typhoon/Weather Forecast Hub
          </h1>
          <p className="text-sm md:text-base text-slate-400 max-w-2xl mx-auto">
            This is where we share AI-powered forecasts and tropical cyclone
            updates for the Philippines, helping you stay prepared for changing
            weather across the islands.
          </p>
        </div>

        <div className="mb-8">
          <h2 className="text-xl md:text-2xl font-semibold text-slate-100 border-l-4 border-sky-500 pl-4">
            Weather Features
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch">
          {/* AI Forecast Feature */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 flex flex-col h-full gap-4 hover:border-sky-500/60 hover:shadow-lg hover:shadow-sky-900/30 transition-all">
            <h2 className="text-xl font-semibold text-slate-50 flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-sky-500/20 text-sky-300 text-sm font-bold">
                AI
              </span>
              AI Forecast
            </h2>
            <p className="text-sm text-slate-300">
              Get accurate, AI-powered weather forecasts tailored for the
              Philippines. Our system uses machine learning to estimate the
              intensity and track of the storm for communities across the
              country.
            </p>
            {/* Visual for AI forecast (using cyclone outlook image for now) */}
            <div className="bg-slate-900 border border-sky-500/40 h-44 md:h-48 rounded-xl overflow-hidden flex items-center justify-center">
              <img
                src="/images/tropical_cyclone_5day_forecast_2025-11-04T060000.png"
                alt="5-day forecast outlook used for AI forecast visual"
                className="h-full w-full object-cover"
              />
            </div>
            <div className="flex justify-end mt-auto">
              <a
                href="/forecast"
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-sky-500 text-slate-50 text-xs font-medium tracking-wide hover:bg-sky-400 transition-colors"
              >
                View AI Forecast
                <span className="text-[10px]">→</span>
              </a>
            </div>
          </div>
          {/* Weather Feature */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 flex flex-col h-full gap-4 hover:border-sky-500/60 hover:shadow-lg hover:shadow-sky-900/30 transition-all">
            <h2 className="text-xl font-semibold text-slate-50 flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-blue-500/20 text-blue-300 text-sm font-bold">
                W
              </span>
              Weather
            </h2>
            <p className="text-sm text-slate-300">
              Check local weather conditions for key Philippine cities, including
              current temperature, rain chances, and a simple hourly and daily
              outlook.
            </p>
            <div className="bg-slate-900 border border-blue-500/40 h-44 md:h-48 rounded-xl overflow-hidden flex items-center justify-center">
              <img
                src="/images/weather.webp"
                alt="Weather preview"
                className="h-full w-full object-cover"
              />
            </div>
            <div className="flex justify-end mt-auto">
              <a
                href="/weather"
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-blue-500 text-slate-50 text-xs font-medium tracking-wide hover:bg-blue-400 transition-colors"
              >
                View Weather
                <span className="text-[10px]">→</span>
              </a>
            </div>
          </div>
          {/* Daily Temperature Feature */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 flex flex-col h-full gap-4 hover:border-orange-500/60 hover:shadow-lg hover:shadow-orange-900/30 transition-all">
            <h2 className="text-xl font-semibold text-slate-50 flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-orange-500/15 text-orange-300 text-sm font-bold">
                DS
              </span>
              Daily Synoptic Reports
            </h2>
            <p className="text-sm text-slate-300">
              View official minimum and maximum temperatures from synoptic stations
              across the Philippines, derived from Ogimet reports.
            </p>
            <div className="bg-slate-900 border border-orange-500/40 h-44 md:h-48 rounded-xl overflow-hidden flex items-center justify-center">
              <div className="px-4 text-center text-xs text-slate-300">
                Official synoptic data. Updates daily.
              </div>
            </div>
            <div className="flex justify-end mt-2">
              <a
                href="/synoptic-reports"
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-orange-500 text-slate-50 text-xs font-medium tracking-wide hover:bg-orange-400 transition-colors"
              >
                View Synoptic Reports
                <span className="text-[10px]">→</span>
              </a>
            </div>
          </div>
          {/* Tropical Cyclone Feature */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 flex flex-col h-full gap-4 hover:border-sky-500/60 hover:shadow-lg hover:shadow-sky-900/30 transition-all">
            <h2 className="text-xl font-semibold text-slate-50 flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300 text-sm font-bold">
                TC
              </span>
              Tropical Cyclone
            </h2>
            <p className="text-sm text-slate-300">
              Track tropical cyclones in real-time with interactive maps. Stay
              informed about storm paths, intensities, and potential impacts.
            </p>
            {/* Visual for tropical cyclone track */}
            <div className="bg-slate-900 border border-emerald-500/40 h-44 md:h-48 rounded-xl overflow-hidden flex items-center justify-center">
              <img
                src="/images/weather-map-2025-11-09T00-05-12.png"
                alt="Tropical cyclone track weather map"
                className="h-full w-full object-cover"
              />
            </div>
            <div className="flex justify-end mt-auto">
              <a
                href="/cyclone"
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-emerald-500 text-slate-950 text-xs font-medium tracking-wide hover:bg-emerald-400 transition-colors"
              >
                View Cyclone Map
                <span className="text-[10px]">→</span>
              </a>
            </div>
          </div>
          {/* Tropical Weather Outlook Feature */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 flex flex-col h-full gap-4 hover:border-sky-500/60 hover:shadow-lg hover:shadow-sky-900/30 transition-all">
            <h2 className="text-xl font-semibold text-slate-50 flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/15 text-amber-300 text-sm font-bold">
                TO
              </span>
              Tropical Weather Outlook
            </h2>
            <p className="text-sm text-slate-300">
              See areas where tropical disturbances may develop over the next
              few days. Highlights potential low-pressure areas and zones of
              increased convective activity around the Philippines.
            </p>
            <div className="bg-slate-900 border border-amber-500/40 h-44 md:h-48 rounded-xl overflow-hidden flex items-center justify-center">
              <img
                src="/images/cyclone_development_areas_2025-11-18T180000.png"
                alt="Tropical weather outlook potential development areas"
                className="h-full w-full object-cover"
              />
            </div>
            <div className="flex justify-end mt-auto">
              <a
                href="/outlook"
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-amber-500 text-slate-950 text-xs font-medium tracking-wide hover:bg-amber-400 transition-colors"
              >
                View Outlook
                <span className="text-[10px]">→</span>
              </a>
            </div>
          </div>
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 flex flex-col h-full gap-4 hover:border-sky-500/60 hover:shadow-lg hover:shadow-sky-900/30 transition-all">
            <h2 className="text-xl font-semibold text-slate-50 flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/20 text-amber-300 text-sm font-bold">
                AL
              </span>
              Rainfall & Thunderstorm Alert
            </h2>
            <p className="text-sm text-slate-300">
              View advisory-style guidance for rainfall and thunderstorms to help you
              prepare for short-term weather risks in your area.
            </p>
            <div className="bg-slate-900 border border-amber-500/40 h-44 md:h-48 rounded-xl overflow-hidden flex items-center justify-center">
              <div className="px-4 text-center text-xs text-slate-300">
                Get a focused view of rainfall and thunderstorm advisories for your location.
              </div>
            </div>
            <div className="flex justify-end mt-auto">
              <a
                href="/alert"
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-amber-500 text-slate-950 text-xs font-medium tracking-wide hover:bg-amber-400 transition-colors"
              >
                View Alerts
                <span className="text-[10px]">→</span>
              </a>
            </div>
          </div>
          {/* Tropical Cyclone Warning Signal Feature */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 flex flex-col h-full gap-4 hover:border-sky-500/60 hover:shadow-lg hover:shadow-sky-900/30 transition-all">
            <h2 className="text-xl font-semibold text-slate-50 flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-orange-500/15 text-orange-300 text-sm font-bold">
                WS
              </span>
              Tropical Cyclone Warning Signal
            </h2>
            <p className="text-sm text-slate-300">
              Stay safe with real-time Public Storm Warning Signals (PSWS). Know
              the wind threats and lead times for areas under Signal No. 1 to 5.
            </p>
            {/* Visual for Warning Signal */}
            <div className="relative bg-slate-900 border border-orange-500/40 h-44 md:h-48 rounded-xl overflow-hidden flex items-center justify-center">
              <img
                src="/images/weather-map-2025-11-09T00-05-12.png"
                alt="Tropical cyclone warning signal map visualization"
                className="h-full w-full object-cover opacity-80"
              />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="bg-slate-950/70 backdrop-blur-sm border border-slate-700 text-orange-400 px-3 py-1 rounded-full text-xs font-mono">
                  Signal #1 - #5
                </span>
              </div>
            </div>
            <div className="flex justify-end mt-auto">
              <a
                href="/warning"
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-orange-500 text-slate-950 text-xs font-medium tracking-wide hover:bg-orange-400 transition-colors"
              >
                View Warnings
                <span className="text-[10px]">→</span>
              </a>
            </div>
          </div>
          {/* Tropical Cyclone Information Feature */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 flex flex-col h-full gap-4 hover:border-sky-500/60 hover:shadow-lg hover:shadow-sky-900/30 transition-all md:col-span-3 lg:col-span-1">
            <h2 className="text-xl font-semibold text-slate-50 flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-red-500/15 text-red-300 text-sm font-bold">
                TI
              </span>
              Tropical Cyclone Information
            </h2>
            <p className="text-sm text-slate-300">
              View an official style live summary of the latest tropical
              cyclone conditions, including classification, winds, gusts,
              pressure, movement, and PAR status for the Philippines.
            </p>
            <div className="bg-slate-900 border border-red-500/40 h-44 md:h-48 rounded-xl overflow-hidden flex items-center justify-center">
              <div className="px-4 text-center text-xs text-slate-300">
                Latest tropical cyclone information is refreshed regularly to
                reflect the most recent conditions.
              </div>
            </div>
            <div className="flex justify-end mt-2">
              <a
                href="/tc-info"
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-red-500 text-slate-950 text-xs font-medium tracking-wide hover:bg-red-400 transition-colors"
              >
                View Cyclone Info
                <span className="text-[10px]">→</span>
              </a>
            </div>
          </div>

        </div>

        <div className="mb-8 mt-12">
          <h2 className="text-xl md:text-2xl font-semibold text-slate-100 border-l-4 border-violet-500 pl-4">
            Volcanology and Seismology
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch">
          {/* Earthquake Map Feature */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 flex flex-col h-full gap-4 hover:border-violet-500/60 hover:shadow-lg hover:shadow-violet-900/30 transition-all md:col-span-3 lg:col-span-1">
            <h2 className="text-xl font-semibold text-slate-50 flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-violet-500/15 text-violet-300 text-sm font-bold">
                EQ
              </span>
              Earthquake Map
            </h2>
            <p className="text-sm text-slate-300">
              Monitor recent earthquake activity in the Philippines. View magnitude,
              depth, and location data on an interactive map.
            </p>
            <div className="bg-slate-900 border border-violet-500/40 h-44 md:h-48 rounded-xl overflow-hidden flex items-center justify-center">
              <div className="px-4 text-center text-xs text-slate-300">
                Data provided by PHIVOLCS. Updates every 1 minutes.
              </div>
            </div>
            <div className="flex justify-end mt-2">
              <a
                href="/earthquake"
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-violet-500 text-slate-50 text-xs font-medium tracking-wide hover:bg-violet-400 transition-colors"
              >
                View Earthquake Map
                <span className="text-[10px]">→</span>
              </a>
            </div>
          </div>

          {/* Volcanoes Feature */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 flex flex-col h-full gap-4 hover:border-rose-500/60 hover:shadow-lg hover:shadow-rose-900/30 transition-all md:col-span-3 lg:col-span-1">
            <h2 className="text-xl font-semibold text-slate-50 flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-rose-500/15 text-rose-300 text-sm font-bold">
                VO
              </span>
              Volcanoes
            </h2>
            <p className="text-sm text-slate-300">
              Stay updated on the status of active volcanoes in the Philippines.
              Check alert levels and latest advisories from PHIVOLCS.
            </p>
            <div className="bg-slate-900 border border-rose-500/40 h-44 md:h-48 rounded-xl overflow-hidden flex items-center justify-center">
              <div className="px-4 text-center text-xs text-slate-300">
                Official volcano bulletins. Updates as needed.
              </div>
            </div>
            <div className="flex justify-end mt-2">
              <a
                href="/volcanoes"
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-rose-500 text-slate-50 text-xs font-medium tracking-wide hover:bg-rose-400 transition-colors"
              >
                View Volcanoes
                <span className="text-[10px]">→</span>
              </a>
            </div>
          </div>


        </div>
      </div>
    </section>
  );
};

export default Features;
