// src/components/Features.jsx
import React, { useState, useEffect } from "react";

const FEATURE_DATA = [
  {
    id: "ai-forecast",
    title: "AI Forecast",
    category: "Forecasts",
    icon: "AI",
    iconColor: "text-sky-300",
    iconBg: "bg-sky-500/20",
    borderHover: "hover:border-sky-500/60 hover:shadow-sky-900/30",
    buttonBg: "bg-sky-500 hover:bg-sky-400",
    buttonText: "text-slate-50",
    description: "Get accurate, AI-powered weather forecasts tailored for the Philippines. Our system uses machine learning to estimate the intensity and track of storms.",
    image: "/images/tropical_cyclone_5day_forecast_2025-11-04T060000.png",
    link: "/forecast",
    linkText: "View AI Forecast"
  },
  {
    id: "weather",
    title: "Weather",
    category: "Weather",
    icon: "W",
    iconColor: "text-blue-300",
    iconBg: "bg-blue-500/20",
    borderHover: "hover:border-blue-500/60 hover:shadow-blue-900/30",
    buttonBg: "bg-blue-500 hover:bg-blue-400",
    buttonText: "text-slate-50",
    description: "Check local weather conditions for key Philippine cities, including current temperature, rain chances, and a simple hourly and daily outlook.",
    image: "/images/weather.webp",
    link: "/weather",
    linkText: "View Weather"
  },
  {
    id: "synoptic",
    title: "Daily Synoptic Reports",
    category: "Weather",
    icon: "DS",
    iconColor: "text-orange-300",
    iconBg: "bg-orange-500/15",
    borderHover: "hover:border-orange-500/60 hover:shadow-orange-900/30",
    buttonBg: "bg-orange-500 hover:bg-orange-400",
    buttonText: "text-slate-50",
    description: "View official minimum and maximum temperatures from synoptic stations across the Philippines, derived from Ogimet reports.",
    image: "/images/synoptic_preview.png",
    link: "/synoptic-reports",
    linkText: "View Synoptic Reports"
  },
  {
    id: "cyclone",
    title: "Tropical Cyclone",
    category: "Cyclones",
    icon: "TC",
    iconColor: "text-emerald-300",
    iconBg: "bg-emerald-500/15",
    borderHover: "hover:border-emerald-500/60 hover:shadow-emerald-900/30",
    buttonBg: "bg-emerald-500 hover:bg-emerald-400",
    buttonText: "text-slate-950",
    description: "Track tropical cyclones in real-time with interactive maps. Stay informed about storm paths, intensities, and potential impacts.",
    image: "/images/weather-map-2025-11-09T00-05-12.png",
    link: "/cyclone",
    linkText: "View Cyclone Map"
  },
  {
    id: "outlook",
    title: "Tropical Weather Outlook",
    category: "Cyclones",
    icon: "TO",
    iconColor: "text-amber-300",
    iconBg: "bg-amber-500/15",
    borderHover: "hover:border-amber-500/60 hover:shadow-amber-900/30",
    buttonBg: "bg-amber-500 hover:bg-amber-400",
    buttonText: "text-slate-950",
    description: "See areas where tropical disturbances may develop over the next few days. Highlights potential low-pressure areas around the Philippines.",
    image: "/images/cyclone_development_areas_2025-11-18.png",
    link: "/outlook",
    linkText: "View Outlook"
  },
  {
    id: "models",
    title: "Forecast Models",
    category: "Forecasts",
    icon: "FM",
    iconColor: "text-teal-300",
    iconBg: "bg-teal-500/15",
    borderHover: "hover:border-teal-500/60 hover:shadow-teal-900/30",
    buttonBg: "bg-teal-500 hover:bg-teal-400",
    buttonText: "text-slate-950",
    description: "Interactive forecast maps from global models. Currently featuring GFS Accumulated Rainfall. Wind and other parameters coming soon.",
    image: "/images/rainfall_preview.png",
    link: "/forecast-models",
    linkText: "View Forecast Maps"
  },
  {
    id: "alerts",
    title: "Rainfall & Thunderstorm Alert",
    category: "Alerts",
    icon: "AL",
    iconColor: "text-yellow-300",
    iconBg: "bg-yellow-500/20",
    borderHover: "hover:border-yellow-500/60 hover:shadow-yellow-900/30",
    buttonBg: "bg-yellow-500 hover:bg-yellow-400",
    buttonText: "text-slate-950",
    description: "View advisory-style guidance for rainfall and thunderstorms to help you prepare for short-term weather risks in your area.",
    image: "/images/alert_preview.png",
    link: "/alert",
    linkText: "View Alerts"
  },
  {
    id: "warning",
    title: "Tropical Cyclone Warning Signal",
    category: "Alerts",
    icon: "WS",
    iconColor: "text-red-300",
    iconBg: "bg-red-500/15",
    borderHover: "hover:border-red-500/60 hover:shadow-red-900/30",
    buttonBg: "bg-red-500 hover:bg-red-400",
    buttonText: "text-slate-950",
    description: "Stay safe with real-time Public Storm Warning Signals (PSWS). Know the wind threats and lead times for areas under Signal No. 1 to 5.",
    image: "/images/weather-map-2025-11-09T00-05-12.png",
    overlay: <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><span className="bg-slate-950/70 backdrop-blur-sm border border-slate-700 text-orange-400 px-3 py-1 rounded-full text-xs font-mono">Signal #1 - #5</span></div>,
    link: "/warning",
    linkText: "View Warnings"
  },
  {
    id: "tc-info",
    title: "Tropical Cyclone Information",
    category: "Cyclones",
    icon: "TI",
    iconColor: "text-rose-300",
    iconBg: "bg-rose-500/15",
    borderHover: "hover:border-rose-500/60 hover:shadow-rose-900/30",
    buttonBg: "bg-rose-500 hover:bg-rose-400",
    buttonText: "text-slate-950",
    description: "View an official style live summary of the latest tropical cyclone conditions, including classification, winds, gusts, pressure, and PAR status.",
    image: "/images/tc_info_preview.png",
    link: "/tc-info",
    linkText: "View Cyclone Info"
  },
  {
    id: "earthquake",
    title: "Earthquake Map",
    category: "Seismology",
    icon: "EQ",
    iconColor: "text-violet-300",
    iconBg: "bg-violet-500/15",
    borderHover: "hover:border-violet-500/60 hover:shadow-violet-900/30",
    buttonBg: "bg-violet-500 hover:bg-violet-400",
    buttonText: "text-slate-50",
    description: "Monitor recent earthquake activity in the Philippines. View magnitude, depth, and location data on an interactive map.",
    customVisual: (
      <div className="bg-slate-900 border border-violet-500/40 h-44 md:h-48 rounded-xl overflow-hidden flex items-center justify-center relative group">
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none opacity-20">
          <div className="w-full h-[1px] bg-violet-500 mb-2"></div>
          <div className="w-full h-[1px] bg-violet-500 mb-2"></div>
          <div className="w-full h-[1px] bg-violet-500"></div>
        </div>
        <div className="px-4 text-center text-xs text-slate-300 z-10 transition-transform group-hover:scale-105">Data provided by PHIVOLCS.<br />Updates every 1 minute.</div>
      </div>
    ),
    link: "/earthquake",
    linkText: "View Earthquake Map"
  },
  {
    id: "volcano",
    title: "Volcanoes",
    category: "Seismology",
    icon: "VO",
    iconColor: "text-rose-300",
    iconBg: "bg-rose-500/15",
    borderHover: "hover:border-rose-500/60 hover:shadow-rose-900/30",
    buttonBg: "bg-rose-500 hover:bg-rose-400",
    buttonText: "text-slate-50",
    description: "Stay updated on the status of active volcanoes in the Philippines. Check alert levels and latest advisories from PHIVOLCS.",
    customVisual: (
      <div className="bg-slate-900 border border-rose-500/40 h-44 md:h-48 rounded-xl overflow-hidden flex items-center justify-center relative group">
        <div className="px-4 text-center text-xs text-slate-300 z-10 transition-transform group-hover:scale-105">Official volcano bulletins.<br />Updates as needed.</div>
      </div>
    ),
    link: "/volcanoes",
    linkText: "View Volcanoes"
  },
  {
    id: "weather-advisory",
    title: "Weather Advisory",
    category: "Alerts",
    icon: "WA",
    iconColor: "text-sky-300",
    iconBg: "bg-sky-500/15",
    borderHover: "hover:border-sky-500/60 hover:shadow-sky-900/30",
    buttonBg: "bg-sky-500 hover:bg-sky-400",
    buttonText: "text-slate-950",
    description: "View weather advisories mapped by province. See 24-HR rainfall forecasts for weather systems like Monsoons and Shear Lines using ECMWF IFS data.",
    customVisual: (
      <div className="bg-slate-900 border border-sky-500/40 h-44 md:h-48 rounded-xl overflow-hidden flex items-center justify-center relative group">
        <div className="px-4 text-center text-xs text-slate-300 z-10 transition-transform group-hover:scale-105">Interactive rainfall map.<br />Data via ECMWF IFS.</div>
      </div>
    ),
    link: "/weather-advisory",
    linkText: "View Advisories"
  },
  {
    id: "lightning",
    title: "Lightning Detection",
    category: "Weather",
    icon: "⚡",
    iconColor: "text-amber-300",
    iconBg: "bg-amber-500/25",
    borderHover: "hover:border-amber-500/60 hover:shadow-amber-900/30",
    buttonBg: "bg-amber-500 hover:bg-amber-400",
    buttonText: "text-slate-950",
    description: "Monitor real-time lightning strikes across the Philippines. Track intracloud (C-to-C) and ground (C-to-G) strokes to identify forming severe thunderstorms.",
    customVisual: (
      <div className="bg-slate-900 border border-amber-500/40 h-44 md:h-48 rounded-xl overflow-hidden flex items-center justify-center relative group">
        <div className="px-4 text-center text-xs text-slate-300 z-10 transition-transform group-hover:scale-105">Real-time lightning coordinates.<br />Updates every 30 seconds.</div>
      </div>
    ),
    link: "/lightning",
    linkText: "View Lightning Map"
  },
  {
    id: "radar",
    title: "Live Doppler Radar",
    category: "Weather",
    icon: "📡",
    iconColor: "text-emerald-300",
    iconBg: "bg-emerald-500/20",
    borderHover: "hover:border-emerald-500/60 hover:shadow-emerald-900/30",
    buttonBg: "bg-emerald-500 hover:bg-emerald-400",
    buttonText: "text-slate-950",
    description: "Monitor near real-time radar imagery from the PAGASA Doppler Radar network. View precipitation intensity, track storm systems, and animate radar loops.",
    customVisual: (
      <div className="bg-slate-900 border border-emerald-500/40 h-44 md:h-48 rounded-xl overflow-hidden flex items-center justify-center relative group">
        <div className="px-4 text-center text-xs text-slate-300 z-10 transition-transform group-hover:scale-105">Live PAGASA Doppler Radar loop.<br />Updates as new frames are released.</div>
      </div>
    ),
    link: "/radar",
    linkText: "View Live Radar"
  }
];
const PAR_POLYGON = [
  [5.0, 115.0], [15.0, 115.0], [21.0, 120.0], [25.0, 120.0],
  [25.0, 135.0], [5.0, 135.0], [5.0, 115.0]
];

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

const formatCoords = (lat, lon) => {
  const latDir = lat >= 0 ? "N" : "S";
  const lonDir = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(1)}°${latDir}, ${Math.abs(lon).toFixed(1)}°${lonDir}`;
};

const getStormTypeLabel = (nature) => {
  const types = {
    TD: "Tropical Depression",
    TS: "Tropical Storm",
    TY: "Typhoon",
    STY: "Super Typhoon",
    LO: "Low Pressure Area",
    DB: "Tropical Disturbance",
    TC: "Tropical Cyclone"
  };
  return types[nature] || "Tropical Weather System";
};

const Features = () => {
  const [activeCategory, setActiveCategory] = useState("All");
  const [selectedFeature, setSelectedFeature] = useState(FEATURE_DATA[0]);
  const [activeStorms, setActiveStorms] = useState([]);
  const [loadingStorms, setLoadingStorms] = useState(true);
  const [errorStorms, setErrorStorms] = useState(null);

  const categories = ["All", "Weather", "Cyclones", "Forecasts", "Alerts", "Seismology"];

  const filteredFeatures = FEATURE_DATA.filter(f =>
    activeCategory === "All" ? true : f.category === activeCategory
  );

  // Sync selected feature with category filtering changes
  useEffect(() => {
    if (filteredFeatures.length > 0 && !filteredFeatures.some(f => f.id === selectedFeature?.id)) {
      setSelectedFeature(filteredFeatures[0]);
    }
  }, [activeCategory]);

  useEffect(() => {
    let active = true;
    fetch("https://api.knackwx.com/atcf/v2")
      .then(res => {
        if (!res.ok) throw new Error("Failed to fetch active storm data");
        return res.json();
      })
      .then(data => {
        if (!active) return;
        // Filter for Western Pacific only
        const wpac = data.filter(storm => storm.basin === "WPAC");
        setActiveStorms(wpac);
        setLoadingStorms(false);
      })
      .catch(err => {
        if (!active) return;
        console.error("Error fetching storms:", err);
        setErrorStorms(err.message);
        setLoadingStorms(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="py-20 bg-slate-950 min-h-screen">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16 animate-in fade-in slide-in-from-bottom-4 duration-700">
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-slate-50 mb-4">
            Philippine Typhoon/Weather <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-blue-600">Hub</span>
          </h1>
          <p className="text-sm md:text-base text-slate-400 max-w-2xl mx-auto leading-relaxed">
            Your centralized portal for AI-powered forecasts, real-time tropical cyclone
            updates, and critical geological alerts across the Philippine archipelago.
          </p>
        </div>

        {/* Active Storms Tracker Section */}
        <div className="mb-12 max-w-4xl mx-auto animate-in fade-in duration-700 delay-100">
          {loadingStorms ? (
            <div className="bg-slate-900/30 border border-slate-800/85 rounded-3xl p-6 text-center text-slate-400 backdrop-blur-sm">
              <div className="w-5 h-5 border-2 border-sky-400 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
              <span className="text-sm">Checking for active storms in the Western Pacific...</span>
            </div>
          ) : errorStorms ? (
            <div className="bg-red-500/10 border border-red-500/20 rounded-3xl p-4 text-center text-red-400 text-xs">
              Unable to load active storm updates. Please check back later.
            </div>
          ) : activeStorms.length === 0 ? (
            <div className="bg-slate-900/30 border border-slate-900/80 rounded-3xl p-5 text-center text-slate-400 backdrop-blur-sm flex items-center justify-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              <span className="text-sm font-medium text-slate-300">No Active Weather disturbance in the Western Pacific Basin.</span>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                    </span>
                    Active Tropical Cyclones ({activeStorms.length})
                  </h3>
                  <a
                    href="/tc-info"
                    className="text-xs text-sky-400 hover:text-sky-300 transition-colors flex items-center gap-1 font-medium hover:underline mt-0.5"
                  >
                    See more info <span className="text-[10px]">→</span>
                  </a>
                </div>
                <span className="text-[10px] font-mono text-slate-500">Source: ATCF</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {activeStorms.map((storm) => {
                  const inPar = isInsidePar(storm.latitude, storm.longitude);
                  const windKmh = Math.round((storm.winds * 1.852) / 5) * 5;
                  return (
                    <div
                      key={storm.long_atcf_id || storm.atcf_id}
                      className="bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-2xl p-5 flex flex-col justify-between gap-4 transition-all duration-300 hover:border-slate-700/60"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h4 className="font-bold text-slate-50 text-base flex items-center gap-2">
                            🌀 {storm.storm_name === "INVEST" ? `${storm.storm_name} ${storm.atcf_id}` : storm.storm_name}
                          </h4>
                          <span className="text-xs text-slate-400 font-medium">
                            {getStormTypeLabel(storm.cyclone_nature)}
                          </span>
                        </div>
                        <span className={`text-xs font-semibold ${inPar ? "text-red-500" : "text-amber-500"}`}>
                          {inPar ? "Inside PAR" : "Outside PAR"}
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-2 text-center bg-slate-950/40 rounded-xl p-3 border border-slate-900/50">
                        <div>
                          <div className="text-[10px] text-slate-500 uppercase font-semibold">Winds</div>
                          <div className="text-sm font-bold text-slate-200 mt-0.5">{windKmh} km/h</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-500 uppercase font-semibold">Pressure</div>
                          <div className="text-sm font-bold text-slate-200 mt-0.5">{storm.pressure} hPa</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-500 uppercase font-semibold">Position</div>
                          <div className="text-sm font-bold text-slate-200 mt-0.5 font-mono text-[11px] leading-relaxed">
                            {formatCoords(storm.latitude, storm.longitude)}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap justify-center gap-3 mb-12 animate-in fade-in duration-1000 delay-150">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-5 py-2 rounded-full text-sm font-medium transition-all duration-300 ${activeCategory === cat
                ? "bg-slate-100 text-slate-900 shadow-[0_0_20px_rgba(255,255,255,0.2)]"
                : "bg-slate-800/50 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Control Center Dashboard Split Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch mb-20">

          {/* Left Column: Navigation Dock */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            {/* Mobile View: Horizontal Tabs Selector */}
            <div className="block lg:hidden overflow-x-auto pb-4 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
              <div className="flex gap-3 whitespace-nowrap min-w-max">
                {filteredFeatures.map((feature) => {
                  const isSelected = feature.id === selectedFeature?.id;
                  return (
                    <button
                      key={feature.id}
                      onClick={() => setSelectedFeature(feature)}
                      className={`flex items-center gap-2 px-4 py-3 rounded-2xl border text-sm font-medium transition-all ${isSelected
                          ? "bg-slate-800/80 border-slate-700 text-slate-50 shadow-md"
                          : "bg-slate-900/40 border-slate-900/80 text-slate-400 hover:bg-slate-900/80 hover:text-slate-200"
                        }`}
                    >
                      <span className={`inline-flex h-6 w-6 items-center justify-center rounded-lg text-xs font-bold ${feature.iconBg} ${feature.iconColor}`}>
                        {feature.icon}
                      </span>
                      {feature.title}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Desktop View: Vertical Sidebar scroll list */}
            <div className="hidden lg:flex flex-col gap-2 max-h-[600px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
              {filteredFeatures.map((feature) => {
                const isSelected = feature.id === selectedFeature?.id;
                return (
                  <button
                    key={feature.id}
                    onClick={() => setSelectedFeature(feature)}
                    className={`flex items-center justify-between text-left p-4 rounded-2xl border transition-all duration-300 group cursor-pointer relative overflow-hidden ${isSelected
                        ? "bg-slate-800/80 border-slate-700 text-slate-50 shadow-lg shadow-blue-500/5 translate-x-1"
                        : "bg-slate-900/40 border-slate-900/80 text-slate-400 hover:bg-slate-900/80 hover:border-slate-800 hover:text-slate-200"
                      }`}
                  >
                    {/* Selected Active Accent Bar */}
                    {isSelected && (
                      <div className="absolute left-0 top-0 bottom-0 w-[4px] bg-sky-500"></div>
                    )}

                    <div className="flex items-center gap-3">
                      <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl text-sm font-bold transition-transform group-hover:scale-105 ${feature.iconBg} ${feature.iconColor}`}>
                        {feature.icon}
                      </span>
                      <div>
                        <div className="font-semibold text-sm">{feature.title}</div>
                        <div className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">{feature.category}</div>
                      </div>
                    </div>

                    <div className={`text-xs transition-all duration-300 ${isSelected ? "text-sky-400 translate-x-0.5" : "text-slate-600 group-hover:text-slate-400 group-hover:translate-x-0.5"}`}>
                      →
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Column: Interactive Details Stage Pane */}
          <div className="lg:col-span-7">
            {selectedFeature ? (
              <div
                key={selectedFeature.id}
                className="bg-slate-900/50 backdrop-blur-md border border-slate-800 rounded-3xl p-6 md:p-8 flex flex-col justify-between h-full gap-6 shadow-2xl relative overflow-hidden animate-in fade-in slide-in-from-right-4 duration-300"
              >
                {/* Visual Ambient Glows */}
                <div className="absolute -top-24 -right-24 w-48 h-48 bg-blue-500/5 rounded-full blur-3xl pointer-events-none"></div>
                <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-sky-500/5 rounded-full blur-3xl pointer-events-none"></div>

                <div className="space-y-6">
                  {/* Header info */}
                  <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                    <div className="flex items-center gap-3">
                      <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl text-base font-bold ${selectedFeature.iconBg} ${selectedFeature.iconColor}`}>
                        {selectedFeature.icon}
                      </span>
                      <div>
                        <h2 className="text-xl md:text-2xl font-bold text-slate-50">{selectedFeature.title}</h2>
                        <span className="inline-block text-[10px] font-mono text-slate-400 bg-slate-800 border border-slate-700/50 px-2 py-0.5 rounded mt-1 uppercase tracking-wider">
                          {selectedFeature.category}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Body description */}
                  <p className="text-sm md:text-base text-slate-300 leading-relaxed">
                    {selectedFeature.description}
                  </p>

                  {/* Feature Visual Stage */}
                  {selectedFeature.customVisual ? (
                    selectedFeature.customVisual
                  ) : (
                    <div className="relative bg-slate-950 border border-slate-800/80 rounded-2xl overflow-hidden h-48 md:h-56 flex items-center justify-center group">
                      <img
                        src={selectedFeature.image}
                        alt={`${selectedFeature.title} visual`}
                        className="absolute inset-0 h-full w-full object-cover opacity-80 transition-transform duration-700 group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/60 via-transparent to-transparent pointer-events-none"></div>
                      {selectedFeature.overlay}
                    </div>
                  )}
                </div>

                {/* Footer Action Button */}
                <div className="flex justify-end pt-4 border-t border-slate-800/60 mt-auto">
                  <a
                    href={selectedFeature.link}
                    target={typeof selectedFeature.link === "string" && selectedFeature.link.startsWith("http") ? "_blank" : undefined}
                    rel={typeof selectedFeature.link === "string" && selectedFeature.link.startsWith("http") ? "noopener noreferrer" : undefined}
                    className={`inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold tracking-wide transition-all shadow-lg hover:shadow-sky-500/10 ${selectedFeature.buttonBg} ${selectedFeature.buttonText}`}
                  >
                    {selectedFeature.linkText}
                    <span className="text-xs">→</span>
                  </a>
                </div>
              </div>
            ) : (
              <div className="bg-slate-900/50 backdrop-blur-md border border-slate-800 rounded-3xl p-8 flex flex-col items-center justify-center h-full text-slate-500">
                Select a weather tool from the list to view details.
              </div>
            )}
          </div>

        </div>

        {filteredFeatures.length === 0 && (
          <div className="text-center py-20 text-slate-500">
            No features found for this category.
          </div>
        )}

        {/* Facebook Feed Section */}
        <div className="mt-24 border-t border-slate-800/80 pt-16 animate-in fade-in duration-1000 delay-300">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            <div className="lg:col-span-5 text-left space-y-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-medium">
                <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
                Community & Social
              </div>
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-50">
                Stay Updated on <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-sky-400">Facebook</span>
              </h2>
              <p className="text-slate-400 leading-relaxed text-sm md:text-base">
                Follow our official Facebook page for real-time storm warnings, interactive discussion, and community updates during severe weather events in the Philippines.
              </p>

              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="h-6 w-6 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-blue-400 text-sm font-bold">✓</div>
                  <div>
                    <h4 className="text-sm font-semibold text-slate-200">Latest Storm Announcements</h4>
                    <p className="text-xs text-slate-400">Immediate alerts as warnings are issued.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="h-6 w-6 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-blue-400 text-sm font-bold">✓</div>
                  <div>
                    <h4 className="text-sm font-semibold text-slate-200">Interactive Discussions</h4>
                    <p className="text-xs text-slate-400">Share local conditions and photos with others.</p>
                  </div>
                </div>
              </div>

              <div className="pt-2">
                <a
                  href="https://www.facebook.com/profile.php?id=100092463782813"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-slate-50 px-6 py-3 rounded-xl text-sm font-medium transition-all shadow-lg hover:shadow-blue-500/20"
                >
                  <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                    <path d="M22 12c0-5.52-4.48-10-10-10S2 6.48 2 12c0 4.84 3.44 8.87 8 9.8V15H8v-3h2V9.5C10 7.57 11.57 6 13.5 6H16v3h-2c-.55 0-1 .45-1 1v2h3v3h-3v6.95c4.56-.93 8-4.96 8-9.75z" />
                  </svg>
                  Visit Facebook Page
                </a>
              </div>
            </div>

            <div className="lg:col-span-7 flex justify-center lg:justify-end">
              <div className="relative w-full max-w-[500px] bg-slate-900/40 border border-slate-800 rounded-3xl p-4 md:p-6 backdrop-blur-md shadow-2xl hover:border-blue-500/30 transition-all duration-500 group overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full blur-3xl pointer-events-none group-hover:bg-blue-500/10 transition-all duration-500"></div>
                <div className="absolute bottom-0 left-0 w-32 h-32 bg-sky-500/5 rounded-full blur-3xl pointer-events-none group-hover:bg-sky-500/10 transition-all duration-500"></div>

                <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
                    <div className="w-3 h-3 rounded-full bg-yellow-500/80"></div>
                    <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
                  </div>
                  <span className="text-[10px] font-mono text-slate-500 tracking-wider uppercase">Live Feed</span>
                </div>

                <div className="w-full flex justify-center rounded-2xl overflow-hidden bg-slate-950 border border-slate-800/80 min-h-[500px]">
                  <iframe
                    src="https://www.facebook.com/plugins/page.php?href=https%3A%2F%2Fwww.facebook.com%2Fprofile.php%3Fid%3D100092463782813&tabs=timeline&width=500&height=500&small_header=false&adapt_container_width=true&hide_cover=false&show_facepile=true&appId"
                    width="100%"
                    height="500"
                    style={{ border: "none", overflow: "hidden" }}
                    scrolling="no"
                    frameBorder="0"
                    allowFullScreen={true}
                    allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
                    className="w-full max-w-[500px] h-[500px]"
                  ></iframe>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Features;
