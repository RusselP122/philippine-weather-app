// src/components/Features.jsx
import React, { useState } from "react";

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
  }
];

const FeatureCard = ({ feature }) => {
  return (
    <div className={`bg-slate-900/80 border border-slate-800 rounded-2xl p-6 flex flex-col h-full gap-4 transition-all duration-300 transform hover:-translate-y-1 hover:shadow-lg ${feature.borderHover}`}>
      <h2 className="text-xl font-semibold text-slate-50 flex items-center gap-2">
        <span className={`inline-flex h-8 w-8 items-center justify-center rounded-xl text-sm font-bold ${feature.iconBg} ${feature.iconColor}`}>
          {feature.icon}
        </span>
        {feature.title}
      </h2>
      <p className="text-sm text-slate-300 flex-grow leading-relaxed">
        {feature.description}
      </p>

      {feature.customVisual ? (
        feature.customVisual
      ) : (
        <div className="relative bg-slate-900 border border-slate-700/50 h-44 md:h-48 rounded-xl overflow-hidden flex items-center justify-center group">
          <img
            src={feature.image}
            alt={`${feature.title} visual`}
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
          />
          {feature.overlay}
        </div>
      )}

      <div className="flex justify-end mt-4">
        <a
          href={feature.link}
          className={`inline-flex items-center gap-1 px-4 py-2.5 rounded-full text-xs font-semibold tracking-wide transition-colors ${feature.buttonBg} ${feature.buttonText}`}
        >
          {feature.linkText}
          <span className="text-[10px] ml-1">→</span>
        </a>
      </div>
    </div>
  );
};

const Features = () => {
  const [activeCategory, setActiveCategory] = useState("All");

  const categories = ["All", "Weather", "Cyclones", "Forecasts", "Alerts", "Seismology"];

  const filteredFeatures = FEATURE_DATA.filter(f =>
    activeCategory === "All" ? true : f.category === activeCategory
  );

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

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 items-stretch">
          {filteredFeatures.map((feature, idx) => (
            <div
              key={feature.id}
              className="animate-in fade-in zoom-in-95 duration-500 fill-mode-both"
              style={{ animationDelay: `${idx * 100}ms` }}
            >
              <FeatureCard feature={feature} />
            </div>
          ))}
        </div>

        {filteredFeatures.length === 0 && (
          <div className="text-center py-20 text-slate-500">
            No features found for this category.
          </div>
        )}
      </div>
    </section>
  );
};

export default Features;
