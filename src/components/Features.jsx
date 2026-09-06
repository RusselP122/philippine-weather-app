// src/components/Features.jsx
import React, { useState, useEffect, useMemo } from "react";
import {
  Cpu,
  Radio,
  Wind,
  ShieldAlert,
  GitFork,
  Activity,
  Flame,
  BarChart3,
  CloudSun,
  CloudRain,
  Layers,
  Search,
  ArrowRight,
  Compass,
  Waves,
  AlertTriangle,
  Sparkles,
  MapPin,
  TrendingUp,
  Clock,
  X,
  CheckCircle2
} from "lucide-react";
import { getStormDisplayName } from "../utils/stormNaming";

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

// Built-in Lightweight Interactive Visual Widgets
const RadarVisual = () => (
  <div className="relative w-full h-full bg-slate-950/80 rounded-2xl overflow-hidden border border-emerald-500/20 flex items-center justify-center p-4">
    {/* Grid & Concentric Rings */}
    <div className="absolute inset-0 bg-[radial-gradient(#10b98115_1px,transparent_1px)] [background-size:16px_16px]"></div>
    <div className="absolute w-36 h-36 rounded-full border border-emerald-500/20"></div>
    <div className="absolute w-24 h-24 rounded-full border border-emerald-500/30"></div>
    <div className="absolute w-12 h-12 rounded-full border border-emerald-500/40"></div>
    <div className="absolute w-full h-[1px] bg-emerald-500/20"></div>
    <div className="absolute h-full w-[1px] bg-emerald-500/20"></div>

    {/* Rotating Radar Sweep */}
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div
        className="w-40 h-40 rounded-full animate-spin [animation-duration:4s]"
        style={{
          background: "conic-gradient(from 0deg, transparent 0deg, transparent 270deg, rgba(16,185,129,0.35) 360deg)"
        }}
      ></div>
    </div>

    {/* Simulated Echo Blips */}
    <span className="absolute top-1/3 right-1/3 w-3 h-3 rounded-full bg-emerald-400/80 blur-[2px] animate-pulse"></span>
    <span className="absolute bottom-1/3 right-1/4 w-4 h-2 rounded-full bg-yellow-400/70 blur-[2px]"></span>
    <span className="absolute top-1/2 left-1/4 w-2 h-2 rounded-full bg-sky-400/80 blur-[1px]"></span>

    {/* Center Node */}
    <div className="relative z-10 flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900/90 border border-emerald-500/40 text-[11px] font-mono text-emerald-300 backdrop-blur-sm shadow-lg shadow-emerald-950/50">
      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
      PAGASA Doppler Live
    </div>
  </div>
);

const AIFirVisual = () => (
  <div className="relative w-full h-full bg-slate-950/80 rounded-2xl overflow-hidden border border-sky-500/20 flex flex-col justify-between p-4">
    <div className="absolute inset-0 bg-gradient-to-tr from-sky-500/10 via-blue-500/5 to-transparent"></div>

    {/* Trajectory Simulation Lines */}
    <svg className="absolute inset-0 w-full h-full opacity-60" viewBox="0 0 200 120" preserveAspectRatio="none">
      <defs>
        <linearGradient id="aiGrad" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0.2" />
        </linearGradient>
      </defs>
      {/* Confidence Cone */}
      <polygon points="20,100 180,20 180,60 20,100" fill="url(#aiGrad)" opacity="0.25" />
      {/* Ensemble Track Lines */}
      <path d="M 20,100 Q 90,80 180,25" fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeDasharray="3 3" />
      <path d="M 20,100 Q 100,60 180,45" fill="none" stroke="#60a5fa" strokeWidth="1.5" />
      <path d="M 20,100 Q 80,95 180,55" fill="none" stroke="#818cf8" strokeWidth="1.5" opacity="0.7" />
    </svg>

    <div className="relative z-10 flex items-center justify-between">
      <span className="text-[10px] font-mono uppercase tracking-wider text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded border border-sky-500/30">
        ECMWF AIFS • AI-GFS
      </span>
      <span className="flex h-2 w-2 relative">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
        <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500"></span>
      </span>
    </div>

    <div className="relative z-10 flex items-center justify-between text-xs text-slate-300">
      <div>
        <div className="text-[10px] text-slate-500">Model Accuracy</div>
        <div className="font-semibold text-sky-300">94.8% Skill Score</div>
      </div>
      <div className="text-right">
        <div className="text-[10px] text-slate-500">Lead Horizon</div>
        <div className="font-semibold text-slate-200">5-Day Multi-Model</div>
      </div>
    </div>
  </div>
);

const CycloneVisual = () => (
  <div className="relative w-full h-full bg-slate-950/80 rounded-2xl overflow-hidden border border-rose-500/20 flex items-center justify-center p-4">
    {/* PAR Grid */}
    <div className="absolute inset-0 border border-dashed border-rose-500/20 m-3 rounded-xl flex items-start justify-end p-2">
      <span className="text-[9px] font-mono text-rose-400/80 uppercase">PAR Boundary</span>
    </div>

    {/* Concentric Isobars */}
    <div className="absolute w-28 h-28 rounded-full border border-rose-500/30 animate-ping [animation-duration:3s]"></div>
    <div className="absolute w-20 h-20 rounded-full border border-rose-500/40"></div>
    <div className="absolute w-10 h-10 rounded-full border border-rose-400/60 bg-rose-500/10 flex items-center justify-center">
      <span className="text-sm font-bold text-rose-300">🌀</span>
    </div>

    <div className="absolute bottom-3 left-4 z-10">
      <span className="text-[10px] font-mono text-slate-400 bg-slate-900/90 border border-slate-800 px-2 py-0.5 rounded">
        Live PAR Tracking
      </span>
    </div>
  </div>
);

const WarningVisual = () => (
  <div className="relative w-full h-full bg-slate-950/80 rounded-2xl overflow-hidden border border-red-500/20 flex flex-col justify-between p-4">
    <div className="flex items-center justify-between">
      <span className="text-[10px] font-mono text-red-400 bg-red-500/10 px-2 py-0.5 rounded border border-red-500/30">
        PSWS Threat Matrix
      </span>
      <ShieldAlert className="w-4 h-4 text-red-400" />
    </div>

    <div className="grid grid-cols-5 gap-1.5 py-2">
      {[1, 2, 3, 4, 5].map((sig) => (
        <div
          key={sig}
          className={`flex flex-col items-center justify-center py-2 rounded-lg border text-center transition-all ${sig <= 2
            ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
            : sig <= 4
              ? "bg-orange-500/15 border-orange-500/40 text-orange-400"
              : "bg-red-500/20 border-red-500/50 text-red-300 font-bold animate-pulse"
            }`}
        >
          <span className="text-[9px] text-slate-400 uppercase">Sig</span>
          <span className="text-sm font-bold mt-0.5">#{sig}</span>
        </div>
      ))}
    </div>

    <div className="text-[11px] text-slate-400 flex items-center justify-between">
      <span>Wind Speeds</span>
      <span className="text-slate-200 font-mono text-[10px]">39 to 185+ km/h</span>
    </div>
  </div>
);

const EarthquakeVisual = () => (
  <div className="relative w-full h-full bg-slate-950/80 rounded-2xl overflow-hidden border border-violet-500/20 flex flex-col justify-between p-4">
    <div className="flex items-center justify-between">
      <span className="text-[10px] font-mono text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded border border-violet-500/30">
        PHIVOLCS Seismic Stream
      </span>
      <Activity className="w-4 h-4 text-violet-400" />
    </div>

    {/* Seismogram Wave */}
    <svg className="w-full h-12 my-auto" viewBox="0 0 160 40" preserveAspectRatio="none">
      <path
        d="M 0,20 L 30,20 L 35,16 L 40,24 L 45,10 L 50,30 L 55,5 L 60,35 L 65,15 L 70,25 L 75,20 L 160,20"
        fill="none"
        stroke="#a78bfa"
        strokeWidth="1.8"
        className="animate-pulse"
      />
    </svg>

    <div className="flex items-center justify-between text-[11px] text-slate-400">
      <span>Updates every 60s</span>
      <span className="text-violet-300 font-semibold">Mag • Depth • Epicenter</span>
    </div>
  </div>
);

const VolcanoVisual = () => (
  <div className="relative w-full h-full bg-slate-950/80 rounded-2xl overflow-hidden border border-orange-500/20 flex flex-col justify-between p-4">
    <div className="flex items-center justify-between">
      <span className="text-[10px] font-mono text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded border border-orange-500/30">
        PHIVOLCS Volcano Bulletins
      </span>
      <Flame className="w-4 h-4 text-orange-400" />
    </div>

    <div className="flex items-center justify-center gap-3 my-auto">
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-orange-500/15 border border-orange-500/30 text-orange-300 text-xs font-semibold">
        <span className="w-2 h-2 rounded-full bg-orange-400 animate-ping"></span>
        Active Caldera Monitoring
      </div>
    </div>

    <div className="text-[11px] text-slate-400 flex items-center justify-between">
      <span>Coverage</span>
      <span className="text-slate-200">Mayon • Taal • Kanlaon • Bulusan</span>
    </div>
  </div>
);

const SynopticVisual = () => (
  <div className="relative w-full h-full bg-slate-950/80 rounded-2xl overflow-hidden border border-cyan-500/20 flex flex-col justify-between p-4">
    <div className="flex items-center justify-between">
      <span className="text-[10px] font-mono text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/30">
        Ogimet Station Network
      </span>
      <BarChart3 className="w-4 h-4 text-cyan-400" />
    </div>

    <div className="space-y-1.5 my-auto">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-400">Tuguegarao</span>
        <span className="text-rose-400 font-mono font-semibold">36.8°C Max</span>
      </div>
      <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
        <div className="bg-gradient-to-r from-cyan-400 to-rose-500 h-full w-[85%] rounded-full"></div>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-400">Baguio City</span>
        <span className="text-sky-300 font-mono font-semibold">15.2°C Min</span>
      </div>
    </div>

    <div className="text-[11px] text-slate-400 text-right">Official 24-hr synoptic readings</div>
  </div>
);

const SpaghettiVisual = () => (
  <div className="relative w-full h-full bg-slate-950/80 rounded-2xl overflow-hidden border border-indigo-500/20 flex flex-col justify-between p-4">
    <div className="flex items-center justify-between">
      <span className="text-[10px] font-mono text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/30">
        Ensemble Multi-Models
      </span>
      <GitFork className="w-4 h-4 text-indigo-400" />
    </div>

    <svg className="w-full h-14 my-auto opacity-80" viewBox="0 0 160 50">
      <path d="M 10,40 Q 60,35 150,10" fill="none" stroke="#6366f1" strokeWidth="1.8" />
      <path d="M 10,40 Q 70,30 150,20" fill="none" stroke="#38bdf8" strokeWidth="1.5" />
      <path d="M 10,40 Q 50,42 150,30" fill="none" stroke="#f43f5e" strokeWidth="1.5" />
      <path d="M 10,40 Q 80,25 150,5" fill="none" stroke="#10b981" strokeWidth="1.5" />
    </svg>

    <div className="text-[11px] text-slate-400 flex items-center justify-between">
      <span>Ensembles</span>
      <span className="text-indigo-300 font-semibold">GFS • ECMWF • UKMET • CMC</span>
    </div>
  </div>
);

const ALL_FEATURES = [
  {
    id: "ai-forecast",
    title: "AI 5-Day Storm Forecast",
    tagline: "Machine learning intensity & trajectory predictions",
    category: "Forecasts",
    badge: "AI-POWERED",
    badgeColor: "bg-sky-500/20 text-sky-300 border-sky-500/40",
    icon: Cpu,
    iconColor: "text-sky-400",
    accentGlow: "from-sky-500/20 via-blue-500/5 to-transparent",
    borderClass: "hover:border-sky-500/50 hover:shadow-sky-500/10",
    description: "Deep learning models (ECMWF AIFS, AI-GFS) estimating tropical disturbance tracks, central pressures, and gust potentials across the Philippine archipelago.",
    link: "/forecast",
    linkText: "Launch AI Forecast",
    featured: true,
    visual: <AIFirVisual />,
    tags: ["ECMWF AIFS", "AI-GFS", "PAR Path", "5-Day Horizon"]
  },
  {
    id: "radar",
    title: "Live Doppler Radar",
    tagline: "High-resolution PAGASA station composite loops",
    category: "Radar & Weather",
    badge: "REAL-TIME",
    badgeColor: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    icon: Radio,
    iconColor: "text-emerald-400",
    accentGlow: "from-emerald-500/20 via-teal-500/5 to-transparent",
    borderClass: "hover:border-emerald-500/50 hover:shadow-emerald-500/10",
    description: "Near real-time reflectivity imagery from nationwide PAGASA Doppler radars. Track rainbands, thunderstorm cores, and storm movement with playback loops.",
    link: "/radar",
    linkText: "View Live Radar",
    featured: true,
    visual: <RadarVisual />,
    tags: ["PAGASA Network", "Reflectivity Loop", "Station Selector", "Live"]
  },
  {
    id: "cyclone",
    title: "Tropical Cyclone Tracker",
    tagline: "Real-time track, PAR entry & storm category status",
    category: "Cyclones",
    badge: "CRITICAL",
    badgeColor: "bg-rose-500/20 text-rose-300 border-rose-500/40",
    icon: Wind,
    iconColor: "text-rose-400",
    accentGlow: "from-rose-500/20 via-red-500/5 to-transparent",
    borderClass: "hover:border-rose-500/50 hover:shadow-rose-500/10",
    description: "Track active typhoons, tropical storms, and low-pressure areas. View coordinates, forecast cones, current winds, and PAR boundary status.",
    link: "/cyclone",
    linkText: "Open Cyclone Tracker",
    featured: true,
    visual: <CycloneVisual />,
    tags: ["ATCF Live", "PAR Polygon", "JTWC / PAGASA", "Intensity"]
  },
  {
    id: "warning",
    title: "Tropical Cyclone Warning Signal",
    tagline: "Official Public Storm Warning Signals (PSWS #1 to #5)",
    category: "Alerts",
    badge: "PUBLIC SAFETY",
    badgeColor: "bg-red-500/20 text-red-300 border-red-500/40",
    icon: ShieldAlert,
    iconColor: "text-red-400",
    borderClass: "hover:border-red-500/50 hover:shadow-red-500/10",
    description: "Check official wind hazard levels for affected provinces and municipalities with expected lead times and safety precautions.",
    link: "/warning",
    linkText: "Check Warning Signals",
    visual: <WarningVisual />,
    tags: ["Signal 1 to 5", "PAGASA PSWS", "Wind Threat", "Provinces"]
  },
  {
    id: "spaghetti",
    title: "Spaghetti Ensemble Plots",
    tagline: "Multi-model ensemble track convergence & spread",
    category: "Forecasts",
    badge: "ENSEMBLES",
    badgeColor: "bg-indigo-500/20 text-indigo-300 border-indigo-500/40",
    icon: GitFork,
    iconColor: "text-indigo-400",
    borderClass: "hover:border-indigo-500/50 hover:shadow-indigo-500/10",
    description: "Compare GEFS, ECMWF EPS, UKMET, and CMC ensemble members to understand storm path uncertainty and potential Philippine landfall scenarios.",
    link: "/spaghetti",
    linkText: "View Spaghetti Plots",
    visual: <SpaghettiVisual />,
    tags: ["GEFS 31-Member", "ECMWF EPS", "Model Spread", "Landfall"]
  },
  {
    id: "earthquake",
    title: "Earthquake Monitor",
    tagline: "PHIVOLCS real-time seismic events & fault line maps",
    category: "Seismology",
    badge: "SEISMOLOGY",
    badgeColor: "bg-violet-500/20 text-violet-300 border-violet-500/40",
    icon: Activity,
    iconColor: "text-violet-400",
    borderClass: "hover:border-violet-500/50 hover:shadow-violet-500/10",
    description: "Interactive earthquake map with magnitude circles, depth scales, active fault overlays, and automatic 1-minute PHIVOLCS feed sync.",
    link: "/earthquake",
    linkText: "Explore Earthquake Map",
    visual: <EarthquakeVisual />,
    tags: ["PHIVOLCS Feed", "Active Faults", "Magnitude", "Tsunami Risk"]
  },
  {
    id: "volcanoes",
    title: "Volcano Alert Status",
    tagline: "Active volcano bulletins, seismic swarms & SO2 flux",
    category: "Seismology",
    badge: "GEOLOGY",
    badgeColor: "bg-orange-500/20 text-orange-300 border-orange-500/40",
    icon: Flame,
    iconColor: "text-orange-400",
    borderClass: "hover:border-orange-500/50 hover:shadow-orange-500/10",
    description: "Monitor alert levels (Level 0 to 5) for Taal, Mayon, Kanlaon, Bulusan, and other active volcanoes with official PHIVOLCS advisories.",
    link: "/volcanoes",
    linkText: "View Volcano Bulletins",
    visual: <VolcanoVisual />,
    tags: ["Alert Levels 0-5", "Mayon", "Taal", "Kanlaon", "SO2 Flux"]
  },
  {
    id: "synoptic",
    title: "Daily Synoptic Reports",
    tagline: "Official synoptic station maximum & minimum temperatures",
    category: "Radar & Weather",
    badge: "CLIMATE DATA",
    badgeColor: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40",
    icon: BarChart3,
    iconColor: "text-cyan-400",
    borderClass: "hover:border-cyan-500/50 hover:shadow-cyan-500/10",
    description: "View verified 24-hour extremes, heat index values, and Ogimet observations across PAGASA synoptic stations nationwide.",
    link: "/synoptic-reports",
    linkText: "View Synoptic Reports",
    visual: <SynopticVisual />,
    tags: ["Ogimet Synop", "High/Low Temps", "Heat Index", "Rain Totals"]
  },
  {
    id: "weather-advisory",
    title: "Weather Advisory & Rainfall",
    tagline: "ECMWF IFS 24-HR provincial precipitation maps",
    category: "Alerts",
    badge: "ECMWF IFS",
    badgeColor: "bg-sky-500/20 text-sky-300 border-sky-500/40",
    icon: CloudRain,
    iconColor: "text-sky-400",
    borderClass: "hover:border-sky-500/50 hover:shadow-sky-500/10",
    description: "High-resolution provincial rainfall advisory maps for Shear Lines, Southwest Monsoon (Habagat), Northeast Monsoon (Amihan), and LPA systems.",
    link: "/weather-advisory",
    linkText: "View Advisories",
    tags: ["ECMWF 0.25°", "Shear Line", "Habagat / Amihan", "Provincial"]
  },
  {
    id: "tc-info",
    title: "Tropical Cyclone Bulletins",
    tagline: "Official live storm summary & intensity metrics",
    category: "Cyclones",
    badge: "LIVE BULLETIN",
    badgeColor: "bg-rose-500/20 text-rose-300 border-rose-500/40",
    icon: Compass,
    iconColor: "text-rose-400",
    borderClass: "hover:border-rose-500/50 hover:shadow-rose-500/10",
    description: "Comprehensive weather bulletin format showing central pressure, sustained winds, gusts, direction, and distance from major Philippine landmasses.",
    link: "/tc-info",
    linkText: "Read TC Information",
    tags: ["Central Pressure", "Max Gusts", "Movement", "PAR Status"]
  },
  {
    id: "outlook",
    title: "Tropical Weather Outlook",
    tagline: "2-week tropical disturbance genesis guidance",
    category: "Cyclones",
    badge: "GENESIS OUTLOOK",
    badgeColor: "bg-amber-500/20 text-amber-300 border-amber-500/40",
    icon: AlertTriangle,
    iconColor: "text-amber-400",
    borderClass: "hover:border-amber-500/50 hover:shadow-amber-500/10",
    description: "Identify potential low-pressure development areas over the Philippine Sea, West Philippine Sea, and Caroline Islands 7 to 14 days in advance.",
    link: "/outlook",
    linkText: "View 2-Week Outlook",
    tags: ["LPA Formation", "Week 1 & 2", "ECMWF / GFS", "Genesis Risk"]
  },
  {
    id: "weather",
    title: "City Weather & Forecast",
    tagline: "Live conditions & hourly forecasts for Philippine cities",
    category: "Radar & Weather",
    badge: "LOCAL WEATHER",
    badgeColor: "bg-blue-500/20 text-blue-300 border-blue-500/40",
    icon: CloudSun,
    iconColor: "text-blue-400",
    borderClass: "hover:border-blue-500/50 hover:shadow-blue-500/10",
    description: "Check live temperature, humidity, UV index, rain probability, and 7-day forecasts for Metro Manila, Cebu, Davao, Baguio, and key municipalities.",
    link: "/weather",
    linkText: "Check City Weather",
    tags: ["Hourly Forecast", "Rain Probability", "UV Index", "7-Day Outlook"]
  },
  {
    id: "models",
    title: "Forecast Numerical Models",
    tagline: "Global GFS & ECMWF model run visualizations",
    category: "Forecasts",
    badge: "GLOBAL MODELS",
    badgeColor: "bg-teal-500/20 text-teal-300 border-teal-500/40",
    icon: Layers,
    iconColor: "text-teal-400",
    borderClass: "hover:border-teal-500/50 hover:shadow-teal-500/10",
    description: "Interactive model maps covering GFS Accumulated Rainfall, MSLP wind fields, temperature anomalies, and moisture convergence.",
    link: "/forecast-models",
    linkText: "Open Model Maps",
    tags: ["GFS 0.25°", "Accumulated Rain", "MSLP Wind", "Dynamic Runs"]
  },
  {
    id: "enso",
    title: "ENSO Climate Monitor",
    tagline: "El Niño & La Niña Pacific SST anomaly tracker",
    category: "Forecasts",
    badge: "CLIMATOLOGY",
    badgeColor: "bg-purple-500/20 text-purple-300 border-purple-500/40",
    icon: Waves,
    iconColor: "text-purple-400",
    borderClass: "hover:border-purple-500/50 hover:shadow-purple-500/10",
    description: "Track Niño 3.4 sea surface temperature anomalies, Oceanic Niño Index (ONI), and climate outlook impacts on Philippine seasonal rainfall.",
    link: "/enso",
    linkText: "View ENSO Diagnostics",
    tags: ["Niño 3.4", "SST Anomaly", "Drought / Rain", "Seasonal Forecast"]
  },
  {
    id: "risk-area",
    title: "Risk Area Hazard Assessment",
    tagline: "Vulnerability analysis & high-risk zone mapping",
    category: "Alerts",
    badge: "HAZARDS",
    badgeColor: "bg-rose-500/20 text-rose-300 border-rose-500/40",
    icon: ShieldAlert,
    iconColor: "text-rose-400",
    borderClass: "hover:border-rose-500/50 hover:shadow-rose-500/10",
    description: "Identify high-risk coastal and mountainous regions susceptible to storm surges, riverine flooding, and landslide hazards.",
    link: "/risk-area",
    linkText: "Explore Risk Zones",
    tags: ["Flood Hazards", "Landslide Risk", "Storm Surge", "Preparedness"]
  }
];

const CATEGORIES = [
  "All",
  "Forecasts",
  "Cyclones",
  "Radar & Weather",
  "Alerts",
  "Seismology"
];

const Features = () => {
  const [activeCategory, setActiveCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeStorms, setActiveStorms] = useState([]);
  const [loadingStorms, setLoadingStorms] = useState(true);
  const [errorStorms, setErrorStorms] = useState(null);

  // Fetch real-time Western Pacific storm data
  useEffect(() => {
    let active = true;
    fetch("https://api.knackwx.com/atcf/v2")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch active storm data");
        return res.json();
      })
      .then((data) => {
        if (!active) return;
        const wpac = Array.isArray(data) ? data.filter((storm) => storm.basin === "WPAC") : [];
        setActiveStorms(wpac);
        setLoadingStorms(false);
      })
      .catch((err) => {
        if (!active) return;
        console.error("Error fetching storms:", err);
        setErrorStorms(err.message);
        setLoadingStorms(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Filter features based on Category + Search
  const filteredFeatures = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    return ALL_FEATURES.filter((feature) => {
      const matchesCategory =
        activeCategory === "All" || feature.category === activeCategory;
      if (!matchesCategory) return false;

      if (!query) return true;

      const titleMatch = feature.title.toLowerCase().includes(query);
      const taglineMatch = feature.tagline.toLowerCase().includes(query);
      const descMatch = feature.description.toLowerCase().includes(query);
      const tagMatch = feature.tags?.some((t) => t.toLowerCase().includes(query));

      return titleMatch || taglineMatch || descMatch || tagMatch;
    });
  }, [activeCategory, searchQuery]);

  return (
    <section className="py-16 md:py-24 bg-slate-950 min-h-screen relative overflow-hidden">
      {/* Background ambient lighting effects */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-sky-600/10 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute bottom-10 left-1/3 w-[500px] h-72 bg-emerald-600/5 rounded-full blur-3xl pointer-events-none"></div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">

        {/* Header Hero Section */}
        <div className="text-center max-w-3xl mx-auto mb-10">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-900/90 border border-slate-800 text-slate-300 text-xs font-medium mb-6 shadow-inner backdrop-blur-md">
            <Sparkles className="w-3.5 h-3.5 text-sky-400 animate-spin [animation-duration:6s]" />
            <span>National Weather & Geological Intelligence Hub</span>
          </div>

          <h1 className="text-3xl sm:text-4xl md:text-6xl font-extrabold tracking-tight text-slate-50 mb-5 leading-tight">
            Philippine Weather & <br className="hidden sm:inline" />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-400 via-blue-400 to-indigo-400">
              Typhoon Weather
            </span>
          </h1>

          <p className="text-sm sm:text-base text-slate-400 leading-relaxed max-w-2xl mx-auto">
            Real-time Doppler radar loops, AI-powered storm intensity models, official PSWS warning signals,
            and PHIVOLCS seismic monitoring tailored for the Philippine archipelago.
          </p>
        </div>

        {/* Live Western Pacific Basin Status Banner */}
        <div className="max-w-4xl mx-auto mb-12">
          {loadingStorms ? (
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4 text-center text-slate-400 backdrop-blur-md flex items-center justify-center gap-3">
              <div className="w-4 h-4 border-2 border-sky-400 border-t-transparent rounded-full animate-spin"></div>
              <span className="text-xs sm:text-sm">Scanning Western Pacific basin for active cyclones...</span>
            </div>
          ) : errorStorms ? (
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-3.5 text-center text-slate-400 text-xs backdrop-blur-md">
              Basin monitor live feed standby. Direct radar and forecast models remain fully operational.
            </div>
          ) : activeStorms.length === 0 ? (
            <div className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-4 backdrop-blur-md flex items-center justify-between shadow-lg shadow-black/20">
              <div className="flex items-center gap-3">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                </span>
                <div>
                  <span className="text-xs sm:text-sm font-semibold text-slate-200">
                    Western Pacific Basin: Normal
                  </span>
                  <span className="hidden sm:inline text-xs text-slate-400 ml-2">
                    No active tropical cyclone threats inside the Philippine Area of Responsibility (PAR).
                  </span>
                </div>
              </div>
              <a
                href="/outlook"
                className="text-xs text-sky-400 hover:text-sky-300 font-medium flex items-center gap-1 transition-colors hover:underline"
              >
                View 14-day genesis outlook <ArrowRight className="w-3 h-3" />
              </a>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500"></span>
                  </span>
                  <h2 className="text-xs sm:text-sm font-bold text-slate-200">
                    Active Tropical Systems in Western Pacific ({activeStorms.length})
                  </h2>
                </div>
                <a
                  href="/tc-info"
                  className="text-xs text-sky-400 hover:text-sky-300 transition-colors flex items-center gap-1 font-medium hover:underline"
                >
                  Official storm bulletin <ArrowRight className="w-3 h-3" />
                </a>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {activeStorms.map((storm) => {
                  const inPar = isInsidePar(storm.latitude, storm.longitude);
                  const windKmh = Math.round((storm.winds * 1.852) / 5) * 5;
                  const { displayName } = getStormDisplayName(storm.storm_name, storm.cyclone_nature, inPar, storm.atcf_id || storm.long_atcf_id);
                  return (
                    <div
                      key={storm.long_atcf_id || storm.atcf_id}
                      className="bg-slate-900/70 backdrop-blur-md border border-slate-800 hover:border-slate-700 rounded-2xl p-4.5 transition-all shadow-lg flex flex-col justify-between gap-3"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="font-bold text-slate-50 text-base flex items-center gap-2">
                            <span>🌀</span>
                            <span>{displayName}</span>
                          </div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            {getStormTypeLabel(storm.cyclone_nature)}
                          </div>
                        </div>

                        <span
                          className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${inPar
                            ? "bg-rose-500/15 border-rose-500/40 text-rose-300"
                            : "bg-amber-500/15 border-amber-500/40 text-amber-300"
                            }`}
                        >
                          {inPar ? "Inside PAR" : "Outside PAR"}
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-2 text-center bg-slate-950/60 rounded-xl p-2.5 border border-slate-800/80">
                        <div>
                          <div className="text-[10px] text-slate-500 uppercase font-semibold">Winds</div>
                          <div className="text-xs sm:text-sm font-bold text-slate-200">{windKmh} km/h</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-500 uppercase font-semibold">Pressure</div>
                          <div className="text-xs sm:text-sm font-bold text-slate-200">{storm.pressure} hPa</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-500 uppercase font-semibold">Coordinates</div>
                          <div className="text-[11px] font-mono text-slate-300">{formatCoords(storm.latitude, storm.longitude)}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Search & Category Filter Controls */}
        <div className="max-w-4xl mx-auto mb-10 space-y-4">
          {/* Quick Search Input */}
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tools & models (e.g., 'radar', 'cyclone', 'volcano', 'signals', 'ECMWF')..."
              className="w-full bg-slate-900/60 border border-slate-800 focus:border-sky-500/80 text-slate-100 placeholder-slate-500 text-sm rounded-2xl pl-11 pr-10 py-3.5 outline-none transition-all shadow-inner backdrop-blur-md"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Category Filter Pills */}
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            {CATEGORIES.map((category) => {
              const isActive = activeCategory === category;
              return (
                <button
                  key={category}
                  onClick={() => setActiveCategory(category)}
                  className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-medium transition-all duration-200 cursor-pointer ${isActive
                    ? "bg-slate-100 text-slate-950 font-semibold shadow-lg shadow-white/10 scale-105"
                    : "bg-slate-900/50 text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-slate-800/80"
                    }`}
                >
                  {category}
                </button>
              );
            })}
          </div>
        </div>

        {/* Bento Grid Layout */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-24">
          {filteredFeatures.map((feature) => {
            const IconComponent = feature.icon;
            const isFeatured = feature.featured && (!searchQuery || searchQuery.length < 3);

            return (
              <div
                key={feature.id}
                className={`group relative bg-slate-900/40 backdrop-blur-md border border-slate-800/90 rounded-3xl p-6 flex flex-col justify-between transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl ${feature.borderClass} ${isFeatured ? "md:col-span-2 lg:col-span-1 min-h-[380px]" : "min-h-[340px]"
                  }`}
              >
                {/* Subtle Ambient Hover Glow */}
                <div
                  className={`absolute inset-0 bg-gradient-to-br ${feature.accentGlow || "from-slate-800/20 to-transparent"
                    } opacity-0 group-hover:opacity-100 transition-opacity duration-500 rounded-3xl pointer-events-none`}
                ></div>

                <div className="space-y-4 relative z-10">
                  {/* Top Bar: Icon + Badge */}
                  <div className="flex items-center justify-between">
                    <div
                      className={`w-11 h-11 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center transition-transform group-hover:scale-110 duration-300 shadow-md`}
                    >
                      <IconComponent className={`w-5 h-5 ${feature.iconColor}`} />
                    </div>

                    <span
                      className={`text-[10px] font-mono font-semibold px-2.5 py-1 rounded-full border ${feature.badgeColor}`}
                    >
                      {feature.badge}
                    </span>
                  </div>

                  {/* Title & Tagline */}
                  <div>
                    <h2 className="text-lg font-bold text-slate-50 group-hover:text-sky-300 transition-colors flex items-center gap-1.5">
                      {feature.title}
                    </h2>
                    <p className="text-xs text-slate-400 font-medium mt-0.5">
                      {feature.tagline}
                    </p>
                  </div>

                  {/* Visual Widget Preview */}
                  {feature.visual && (
                    <div className="h-32 sm:h-36 w-full rounded-2xl overflow-hidden shadow-inner">
                      {feature.visual}
                    </div>
                  )}

                  {/* Description */}
                  <p className="text-xs text-slate-400 leading-relaxed line-clamp-3">
                    {feature.description}
                  </p>
                </div>

                {/* Bottom Footer: Tags & Action Button */}
                <div className="pt-4 border-t border-slate-800/80 mt-4 relative z-10 flex items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    {feature.tags?.slice(0, 2).map((tag, i) => (
                      <span
                        key={i}
                        className="text-[10px] text-slate-400 bg-slate-950/80 px-2 py-0.5 rounded border border-slate-800/80"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  <a
                    href={feature.link}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-sky-400 group-hover:text-sky-300 transition-all hover:translate-x-0.5"
                  >
                    <span>{feature.linkText}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            );
          })}
        </div>

        {/* Empty Search Fallback */}
        {filteredFeatures.length === 0 && (
          <div className="text-center py-20 bg-slate-900/30 border border-slate-800/80 rounded-3xl max-w-md mx-auto p-8 mb-24">
            <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mx-auto mb-3 text-slate-400">
              <Search className="w-6 h-6" />
            </div>
            <h3 className="text-base font-semibold text-slate-200 mb-1">No tools matched your search</h3>
            <p className="text-xs text-slate-400 mb-4">
              Try searching with general terms like "typhoon", "radar", "seismic", or click "All" categories.
            </p>
            <button
              onClick={() => {
                setSearchQuery("");
                setActiveCategory("All");
              }}
              className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded-xl transition-all"
            >
              Reset Search & Filters
            </button>
          </div>
        )}

        {/* Facebook Community Section */}
        <div className="border-t border-slate-800/80 pt-16">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-5 space-y-5">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-medium">
                <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
                Official Social Community
              </div>

              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-slate-50">
                Join the Philippine <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-sky-400">
                  Weather Community
                </span>
              </h2>

              <p className="text-slate-400 leading-relaxed text-sm">
                Get immediate bulletins, share ground conditions during severe typhoons, and connect with fellow weather enthusiasts across Luzon, Visayas, and Mindanao.
              </p>

              <div className="space-y-3 pt-1">
                <div className="flex items-center gap-3">
                  <div className="h-6 w-6 rounded-full bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400 text-xs font-bold">
                    ✓
                  </div>
                  <span className="text-xs sm:text-sm text-slate-300 font-medium">
                    Immediate severe storm warning announcements
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-6 w-6 rounded-full bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400 text-xs font-bold">
                    ✓
                  </div>
                  <span className="text-xs sm:text-sm text-slate-300 font-medium">
                    Ground photos & provincial rainfall reports
                  </span>
                </div>
              </div>

              <div className="pt-3">
                <a
                  href="https://www.facebook.com/profile.php?id=100092463782813"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-slate-50 px-6 py-3 rounded-xl text-sm font-semibold transition-all shadow-lg hover:shadow-blue-500/25"
                >
                  <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                    <path d="M22 12c0-5.52-4.48-10-10-10S2 6.48 2 12c0 4.84 3.44 8.87 8 9.8V15H8v-3h2V9.5C10 7.57 11.57 6 13.5 6H16v3h-2c-.55 0-1 .45-1 1v2h3v3h-3v6.95c4.56-.93 8-4.96 8-9.75z" />
                  </svg>
                  <span>Follow Facebook Page</span>
                </a>
              </div>
            </div>

            <div className="lg:col-span-7 flex justify-center lg:justify-end">
              <div className="relative w-full max-w-[500px] bg-slate-900/50 border border-slate-800 rounded-3xl p-4 sm:p-6 backdrop-blur-md shadow-2xl overflow-hidden group hover:border-blue-500/30 transition-all">
                <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
                    <div className="w-3 h-3 rounded-full bg-yellow-500/80"></div>
                    <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                    Live Facebook Feed
                  </span>
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
                    title="Facebook Page Feed"
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
