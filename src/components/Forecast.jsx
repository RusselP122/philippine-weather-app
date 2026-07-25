// src/components/Forecast.jsx
import React, { useEffect, useState, useMemo } from "react";
import {
  Maximize2,
  Layers,
  Map,
  Compass,
  Info,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Grid,
  Minimize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Activity,
  Calendar,
  X,
  Database
} from "lucide-react";

// Helper to resolve asset URLs relative to the base path in both local development and deployed production (subfolder) environments
const getAssetUrl = (path) => {
  const base = import.meta.env.BASE_URL || "/";
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  return `${base}${cleanPath}`;
};

// Build dynamic date strings for today and yesterday in YYYY-MM-DD format
const today = new Date();
const yyyy = today.getFullYear();
const mm = String(today.getMonth() + 1).padStart(2, "0");
const dd = String(today.getDate()).padStart(2, "0");
const todayDateStr = `${yyyy}-${mm}-${dd}`;

const yesterday = new Date(today);
yesterday.setDate(today.getDate() - 1);
const yyyyY = yesterday.getFullYear();
const mmY = String(yesterday.getMonth() + 1).padStart(2, "0");
const ddY = String(yesterday.getDate()).padStart(2, "0");
const yesterdayDateStr = `${yyyyY}-${mmY}-${ddY}`;

// Convert a model time string like "YYYY-MM-DDTHHMMSS" (UTC) to PHST
const toPhstLabel = (modelTime) => {
  const timePart = modelTime.split("T")[1] || "000000"; // HHMMSS
  const utcHour = parseInt(timePart.slice(0, 2), 10);
  const utcMinute = parseInt(timePart.slice(2, 4), 10);

  let phHour24;
  switch (utcHour) {
    case 0: phHour24 = 16; break; // 4 PM
    case 6: phHour24 = 22; break; // 10 PM
    case 12: phHour24 = 4; break;  // 4 AM
    case 18: phHour24 = 10; break; // 10 AM
    default: phHour24 = (utcHour + 8) % 24;
  }

  const period = phHour24 >= 12 ? "PM" : "AM";
  let hour12 = phHour24 % 12;
  if (hour12 === 0) hour12 = 12;

  const minuteStr = String(utcMinute).padStart(2, "0");
  return `${hour12}:${minuteStr} ${period}`;
};

const FORECAST_HOURS = ["000000", "060000", "120000", "180000"];
const FORECAST_DATES = [todayDateStr, yesterdayDateStr];

const MODEL_INFO = {
  fnv3_base: {
    name: "GDM FNV3P2",
    desc: "Google DeepMind FuXi-Nazca V3 core meteorological forecasting model ensemble (FNV3P2).",
    type: "Machine Learning (ML)",
    resolution: "High Resolution / Fast Convergence"
  },
  fnv3p1: {
    name: "GDM FNV3P1",
    desc: "Earlier version of Google's AI cyclone model with an upgraded tracker. Operational Sept 2025 - May 2026.",
    type: "Machine Learning (ML)",
    resolution: "High Resolution"
  },
  oper: {
    name: "GDM OPER",
    desc: "The best operational cyclone forecasts from Google models, utilizing historical version adjustments.",
    type: "Operational Ensemble",
    resolution: "Continuous Forecast History"
  },
  fnv3_large: {
    name: "FNV3 Large Ensemble",
    desc: "DeepMind Nazca Large-scale track ensemble providing enhanced dispersion paths.",
    type: "AI Ensemble Deep-Learning",
    resolution: "Medium Span / High Dispersion"
  },
  ifs: {
    name: "ECMWF IFS",
    desc: "European Centre for Medium-Range Weather Forecasts Integrated Forecasting System.",
    type: "Physical Hydrodynamic Ensemble",
    resolution: "Global Standard / High Detail"
  },
  aifs: {
    name: "ECMWF AIFS",
    desc: "ECMWF's newly integrated Artificial Intelligence hybrid track forecasting engine.",
    type: "AI-Physics Hybrid Model",
    resolution: "Enhanced Track Accuracy"
  },
  aigefs: {
    name: "AI-GEFS",
    desc: "NOAA's Global Ensemble Forecast System tracks parsed and plotted through machine learning.",
    type: "Machine Learning Ensemble",
    resolution: "Global Coverage / Outdated Warning Safety Check"
  }
};

const FORECAST_OPTIONS = FORECAST_DATES.flatMap((dateStr) =>
  FORECAST_HOURS.flatMap((hhmmss) => {
    const modelTime = `${dateStr}T${hhmmss}`;
    const hourUtc = hhmmss.slice(0, 2);
    const isMidnight = hhmmss === "000000";

    const fnv3Base5Day = isMidnight ? `/assets/tropical_cyclone_5day_forecast_FNV3P2_${dateStr}.png` : `/assets/tropical_cyclone_5day_forecast_FNV3P2_${modelTime}.png`;
    const fnv3Base15Day = isMidnight ? `/assets/tropical_cyclone_15day_forecast_FNV3P2_${dateStr}.png` : `/assets/tropical_cyclone_15day_forecast_FNV3P2_${modelTime}.png`;

    const fnv3p15Day = isMidnight ? `/assets/tropical_cyclone_5day_forecast_FNV3P1_${dateStr}.png` : `/assets/tropical_cyclone_5day_forecast_FNV3P1_${modelTime}.png`;
    const fnv3p115Day = isMidnight ? `/assets/tropical_cyclone_15day_forecast_FNV3P1_${dateStr}.png` : `/assets/tropical_cyclone_15day_forecast_FNV3P1_${modelTime}.png`;

    const oper5Day = isMidnight ? `/assets/tropical_cyclone_5day_forecast_OPER_${dateStr}.png` : `/assets/tropical_cyclone_5day_forecast_OPER_${modelTime}.png`;
    const oper15Day = isMidnight ? `/assets/tropical_cyclone_15day_forecast_OPER_${dateStr}.png` : `/assets/tropical_cyclone_15day_forecast_OPER_${modelTime}.png`;

    const fnv3Large5Day = isMidnight ? `/assets/fnv3_tropical_cyclone_5day_forecast_${dateStr}.png` : `/assets/fnv3_tropical_cyclone_5day_forecast_${modelTime}.png`;
    const fnv3Large15Day = isMidnight ? `/assets/fnv3_tropical_cyclone_15day_forecast_${dateStr}.png` : `/assets/fnv3_tropical_cyclone_15day_forecast_${modelTime}.png`;

    const ifs5Day = `/assets/ifs_tropical_cyclone_5day_forecast_${modelTime}.png`;
    const ifs15Day = `/assets/ifs_tropical_cyclone_15day_forecast_${modelTime}.png`;

    const aifs5Day = `/assets/aifs_tropical_cyclone_5day_forecast_${modelTime}.png`;
    const aifs15Day = `/assets/aifs_tropical_cyclone_15day_forecast_${modelTime}.png`;

    const aigefs5Day = `/assets/aigefs_tropical_cyclone_5day_forecast_${modelTime}.png`;
    const aigefs15Day = `/assets/aigefs_tropical_cyclone_15day_forecast_${modelTime}.png`;

    return [
      { id: `fnv3-base-5day-${modelTime}`, type: "5day", model: "fnv3_base", label: `5-day forecast (${dateStr} ${hourUtc}:00 UTC)`, modelTime, imageSrc: getAssetUrl(fnv3Base5Day) },
      { id: `fnv3-base-15day-${modelTime}`, type: "15day", model: "fnv3_base", label: `15-day forecast (${dateStr} ${hourUtc}:00 UTC)`, modelTime, imageSrc: getAssetUrl(fnv3Base15Day) },
      { id: `fnv3p1-5day-${modelTime}`, type: "5day", model: "fnv3p1", label: `5-day forecast (${dateStr} ${hourUtc}:00 UTC)`, modelTime, imageSrc: getAssetUrl(fnv3p15Day) },
      { id: `fnv3p1-15day-${modelTime}`, type: "15day", model: "fnv3p1", label: `15-day forecast (${dateStr} ${hourUtc}:00 UTC)`, modelTime, imageSrc: getAssetUrl(fnv3p115Day) },
      { id: `oper-5day-${modelTime}`, type: "5day", model: "oper", label: `5-day forecast (${dateStr} ${hourUtc}:00 UTC)`, modelTime, imageSrc: getAssetUrl(oper5Day) },
      { id: `oper-15day-${modelTime}`, type: "15day", model: "oper", label: `15-day forecast (${dateStr} ${hourUtc}:00 UTC)`, modelTime, imageSrc: getAssetUrl(oper15Day) },
      { id: `fnv3-large-5day-${modelTime}`, type: "5day", model: "fnv3_large", label: `5-day forecast (${dateStr} ${hourUtc}:00 UTC)`, modelTime, imageSrc: getAssetUrl(fnv3Large5Day) },
      { id: `fnv3-large-15day-${modelTime}`, type: "15day", model: "fnv3_large", label: `15-day forecast (${dateStr} ${hourUtc}:00 UTC)`, modelTime, imageSrc: getAssetUrl(fnv3Large15Day) },
      { id: `ifs-5day-${modelTime}`, type: "5day", model: "ifs", label: `5-day forecast (${dateStr} ${hourUtc}:00 UTC)`, modelTime, imageSrc: getAssetUrl(ifs5Day) },
      { id: `ifs-15day-${modelTime}`, type: "15day", model: "ifs", label: `15-day forecast (${dateStr} ${hourUtc}:00 UTC)`, modelTime, imageSrc: getAssetUrl(ifs15Day) },
      { id: `aifs-5day-${modelTime}`, type: "5day", model: "aifs", label: `5-day forecast (${dateStr} ${hourUtc}:00 UTC)`, modelTime, imageSrc: getAssetUrl(aifs5Day) },
      { id: `aifs-15day-${modelTime}`, type: "15day", model: "aifs", label: `15-day forecast (${dateStr} ${hourUtc}:00 UTC)`, modelTime, imageSrc: getAssetUrl(aifs15Day) },
      { id: `aigefs-5day-${modelTime}`, type: "5day", model: "aigefs", label: `5-day forecast (${dateStr} ${hourUtc}:00 UTC)`, modelTime, imageSrc: getAssetUrl(aigefs5Day) },
      { id: `aigefs-15day-${modelTime}`, type: "15day", model: "aigefs", label: `15-day forecast (${dateStr} ${hourUtc}:00 UTC)`, modelTime, imageSrc: getAssetUrl(aigefs15Day) },
    ];
  })
);

const Forecast = () => {
  const [availableIds, setAvailableIds] = useState([]);
  const [selectedModel, setSelectedModel] = useState("fnv3_base");
  const [selectedTimeId, setSelectedTimeId] = useState(null);
  const [enlargedImage, setEnlargedImage] = useState(null);
  const [enlargedModelKey, setEnlargedModelKey] = useState(null);
  const [showClusters, setShowClusters] = useState(false);
  const [showForecastTrack, setShowForecastTrack] = useState(false);
  const [stormsIndex, setStormsIndex] = useState([]);
  const [selectedStormId, setSelectedStormId] = useState("latest");

  useEffect(() => {
    fetch(getAssetUrl("/data/tc_storms_index.json"))
      .then((res) => {
        if (res.ok) return res.json();
        throw new Error("Failed to load storms index");
      })
      .then((json) => {
        setStormsIndex((json || []).filter((s) => s.active));
      })
      .catch((err) => {
        console.error("Error loading storms index in Forecast:", err);
      });
  }, []);

  // Interactive UI improvements states
  const [compareMode, setCompareMode] = useState(false);
  const [activeModelTab, setActiveModelTab] = useState("characteristics");
  const [zoomScale, setZoomScale] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const [showTrends, setShowTrends] = useState(false);
  const [trendsManifest, setTrendsManifest] = useState(null);
  const [activeTrendDistId, setActiveTrendDistId] = useState(null);
  const [isWideTrend, setIsWideTrend] = useState(false);
  const [trendHorizon, setTrendHorizon] = useState("5day");

  // Touch swipe state for modal slider
  const [swipeStart, setSwipeStart] = useState(null);
  const [swipeEnd, setSwipeEnd] = useState(null);

  const handleOpenEnlarged = (modelKey, directUrl = null) => {
    resetZoom();
    if (modelKey && MODEL_INFO[modelKey]) {
      setEnlargedModelKey(modelKey);
      setEnlargedImage(null);
    } else {
      setEnlargedImage(directUrl);
      setEnlargedModelKey(null);
    }
  };

  const handleCloseEnlarged = () => {
    setEnlargedModelKey(null);
    setEnlargedImage(null);
    resetZoom();
  };

  // Automatically sync/default the trend horizon when model changes
  useEffect(() => {
    setTrendHorizon(selectedModel === "fnv3_large" ? "15day" : "5day");
  }, [selectedModel]);

  useEffect(() => {
    if (showTrends && !trendsManifest) {
      fetch(getAssetUrl("/data/trends/manifest.json"))
        .then(res => {
          if (res.ok) return res.json();
          throw new Error("Failed to load trends manifest");
        })
        .then(data => {
          setTrendsManifest(data);
          const key = `${selectedModel === "fnv3_large" ? "large" : "base"}_${trendHorizon}`;
          const dists = data[key] || [];
          if (dists.length > 0) {
            setActiveTrendDistId(dists[0].id);
          }
        })
        .catch(err => {
          console.error(err);
          setTrendsManifest({});
        });
    }
  }, [showTrends, selectedModel, trendHorizon, trendsManifest]);

  // Disable trends view if selected model is changed to one that does not support it
  useEffect(() => {
    if (selectedModel !== "fnv3_base" && selectedModel !== "fnv3_large") {
      setShowTrends(false);
      setShowForecastTrack(false);
    } else {
      setShowForecastTrack(false);
    }
    if (selectedModel !== "fnv3_large") {
      setShowClusters(false);
    }
    setSelectedStormId("latest");
  }, [selectedModel]);

  // Disable trends view if compareMode is turned on
  useEffect(() => {
    if (compareMode) {
      setShowTrends(false);
      setShowForecastTrack(false);
    }
  }, [compareMode]);

  useEffect(() => {
    if (trendsManifest) {
      const key = `${selectedModel === "fnv3_large" ? "large" : "base"}_${trendHorizon}`;
      const dists = trendsManifest[key] || [];
      if (dists.length > 0) {
        setActiveTrendDistId(dists[0].id);
      } else {
        setActiveTrendDistId(null);
      }
    }
  }, [selectedModel, trendHorizon, trendsManifest]);

  // Probe available images in local assets
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

  const allAvailableOptions = useMemo(() => {
    return FORECAST_OPTIONS.filter((opt) => availableIds.includes(opt.id));
  }, [availableIds]);

  const latestConfigurations = useMemo(() => {
    // In single-model mode, only show run cycles where the selected model has images
    const filteredOptions = compareMode
      ? allAvailableOptions
      : allAvailableOptions.filter((opt) => opt.model === selectedModel);
    return Array.from(
      new Set(filteredOptions.map((opt) => `${opt.type}-${opt.modelTime}`))
    ).sort((a, b) => {
      const timeA = a.substring(a.indexOf('-') + 1);
      const timeB = b.substring(b.indexOf('-') + 1);
      if (timeA !== timeB) return timeA < timeB ? 1 : -1;
      return a.startsWith("15day") ? -1 : 1;
    });
  }, [allAvailableOptions, selectedModel, compareMode]);

  const timelineConfigs = useMemo(() => {
    return latestConfigurations.map((configId) => {
      const parts = configId.split('-');
      const type = parts[0];
      const modelTime = parts.slice(1).join('-');
      // Find any option that matches this config to get a nice formatted label / cycleText
      const opt = allAvailableOptions.find(o => o.type === type && o.modelTime === modelTime);
      return {
        configId,
        type,
        modelTime,
        label: opt ? opt.label : `${type} forecast (${modelTime})`,
      };
    });
  }, [latestConfigurations, allAvailableOptions]);

  const activeConfigId = useMemo(() => {
    if (selectedTimeId && latestConfigurations.includes(selectedTimeId)) {
      return selectedTimeId;
    }
    return latestConfigurations.length ? latestConfigurations[0] : null;
  }, [selectedTimeId, latestConfigurations]);

  const current = useMemo(() => {
    if (!activeConfigId) return null;
    const parts = activeConfigId.split('-');
    const type = parts[0];
    const modelTime = parts.slice(1).join('-');
    const opt = FORECAST_OPTIONS.find(
      (o) => o.model === selectedModel && o.type === type && o.modelTime === modelTime
    );
    const isAvailable = opt ? availableIds.includes(opt.id) : false;
    return {
      id: opt ? opt.id : `fallback-${selectedModel}-${activeConfigId}`,
      type,
      modelTime,
      model: selectedModel,
      label: opt ? opt.label : `${type} forecast (${modelTime})`,
      imageSrc: isAvailable ? opt.imageSrc : null,
    };
  }, [activeConfigId, selectedModel, availableIds]);

  let imageSrc = current ? current.imageSrc : null;
  if (showForecastTrack) {
    imageSrc = getAssetUrl(`/assets/tc_forecast_${selectedStormId}.png`);
  } else if (selectedModel === "fnv3_large" && showClusters && imageSrc) {
    imageSrc = imageSrc.replace(".png", "_cluster.png");
  }



  // Handle zooming & panning interactive lightbox
  const handleWheel = (e) => {
    e.preventDefault();
    const scaleFactor = 0.15;
    const nextScale = e.deltaY < 0 ? zoomScale + scaleFactor : zoomScale - scaleFactor;
    setZoomScale(Math.min(4, Math.max(1, nextScale)));
  };

  const handleMouseDown = (e) => {
    if (zoomScale <= 1) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    setPanOffset({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const resetZoom = () => {
    setZoomScale(1);
    setPanOffset({ x: 0, y: 0 });
  };

  return (
    <section className="bg-slate-950 py-8 md:py-12 relative overflow-x-hidden selection:bg-cyan-500 selection:text-white">
      <style>{`
        .bg-grid-pattern {
            background-image: linear-gradient(to right, rgba(255,255,255,0.015) 1px, transparent 1px),
                              linear-gradient(to bottom, rgba(255,255,255,0.015) 1px, transparent 1px);
            background-size: 32px 32px;
        }
        .custom-glass {
            background: rgba(15, 23, 42, 0.6);
            backdrop-filter: blur(16px);
            border: 1px solid rgba(255, 255, 255, 0.06);
        }
        .custom-scroll::-webkit-scrollbar {
          height: 6px;
        }
        .custom-scroll::-webkit-scrollbar-track {
          background: rgba(255,255,255,0.02);
          border-radius: 8px;
        }
        .custom-scroll::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.1);
          border-radius: 8px;
        }
      `}</style>

      {/* Grid texture overlay for premium aesthetic */}
      <div className="absolute inset-0 bg-grid-pattern pointer-events-none z-0"></div>

      <div className="max-w-6xl mx-auto px-4 relative z-10 flex flex-col gap-6 md:gap-8">

        {/* Header Block */}
        <header className="custom-glass rounded-3xl p-5 md:p-7 shadow-2xl flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6 border-b border-white/5 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-80 h-80 bg-gradient-to-br from-cyan-500/10 to-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_rgba(34,211,238,0.7)]"></span>
              <span className="text-xs font-black uppercase tracking-widest text-slate-400">Meteorological Guidance</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent">
              Forecast Models
            </h1>
            <p className="text-xs md:text-sm text-slate-400 max-w-xl mt-1 leading-relaxed">
              Explore advanced machine learning track models side-by-side. All tracks are generated dynamically from NOAA, ECMWF, and DeepMind.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3.5 w-full xl:w-auto shrink-0 z-10">
            {/* Interactive Spaghetti Map link */}
            <a
              href="/spaghetti"
              className="px-4 py-2.5 bg-slate-900 border border-white/5 hover:border-slate-500 rounded-xl text-xs font-black tracking-wide text-slate-400 hover:text-white transition-all shadow-lg flex items-center gap-2 cursor-pointer"
            >
              <Map className="w-4 h-4" />
              <span>SPAGHETTI PLOT</span>
            </a>

            {/* Run Cycle Trends comparison button */}
            {(selectedModel === "fnv3_base" || selectedModel === "fnv3_large") && (
              <button
                onClick={() => setShowTrends(!showTrends)}
                className={`px-4 py-2.5 rounded-xl text-xs font-black tracking-wide transition-all border flex items-center gap-2 cursor-pointer shadow-lg ${showTrends
                    ? "bg-cyan-500/10 border-cyan-400/40 text-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.25)]"
                    : "bg-slate-900 border-white/5 text-slate-400 hover:text-white"
                  }`}
              >
                <Activity className="w-4 h-4" />
                <span>{showTrends ? "CLOSE TRENDS" : "RUN CYCLE TRENDS"}</span>
              </button>
            )}



            {/* Split Screen Multi Compare toggler */}
            <button
              onClick={() => setCompareMode(!compareMode)}
              className={`px-4 py-2.5 rounded-xl text-xs font-black tracking-wide transition-all border flex items-center gap-2 cursor-pointer shadow-lg ${compareMode
                ? "bg-cyan-500/10 border-cyan-500/40 text-cyan-400"
                : "bg-slate-900 border-white/5 text-slate-400 hover:text-white"
                }`}
            >
              <Grid className="w-4 h-4" />
              <span>{compareMode ? "SINGLE MODEL MODE" : "COMPARISON GRID"}</span>
            </button>
          </div>
        </header>

        {/* Model Tabs Selection Timeline */}
        {!compareMode && (
          <div className="flex overflow-x-auto w-full custom-scroll pb-2 gap-2 shrink-0 z-20">
            {Object.keys(MODEL_INFO).map((modelKey) => (
              <button
                key={modelKey}
                onClick={() => { setSelectedModel(modelKey); setSelectedTimeId(null); }}
                className={`px-4 py-2.5 rounded-xl text-xs font-black tracking-wider transition-all duration-300 border cursor-pointer whitespace-nowrap ${selectedModel === modelKey
                  ? "bg-slate-800 text-cyan-400 border-white/10 shadow-lg shadow-black/40"
                  : "bg-slate-950/60 border-white/5 text-slate-500 hover:text-slate-200"
                  }`}
              >
                {MODEL_INFO[modelKey].name}
              </button>
            ))}
          </div>
        )}

        {/* Timeline selecting slider nodes (replacing old dropdown) */}
        {!showTrends && (timelineConfigs.length > 0 ? (
          <div className="flex flex-col gap-2">
            <span className="text-[10px] uppercase font-black tracking-widest text-slate-500 flex items-center gap-1.5 pl-1">
              <Calendar className="w-3.5 h-3.5" />
              <span>Select Model Run Cycle</span>
            </span>
            <div className="flex overflow-x-auto gap-2.5 custom-scroll pb-2 w-full">
              {timelineConfigs.map((opt) => {
                const isActive = (activeConfigId === opt.configId);
                const cycleText = opt.label.substring(opt.label.indexOf('(') + 1, opt.label.indexOf(')'));

                return (
                  <button
                    key={opt.configId}
                    onClick={() => setSelectedTimeId(opt.configId)}
                    className={`px-3.5 py-2.5 rounded-xl text-xs transition-all border flex flex-col items-start gap-1 cursor-pointer shrink-0 text-left ${isActive
                      ? "bg-cyan-500/10 border-cyan-400/40 text-white shadow-lg shadow-black/35 scale-102"
                      : "bg-slate-950/50 border-white/5 text-slate-400 hover:text-slate-200 hover:bg-slate-900/60"
                      }`}
                  >
                    <span className="font-black capitalize">{opt.type === "5day" ? "5-Day Outlook" : "15-Day Longrange"}</span>
                    <span className="text-[10px] font-mono opacity-60 font-semibold">{cycleText}</span>
                  </button>
                );
              })}
            </div>

            {((selectedModel === "fnv3_base" || selectedModel === "fnv3_large") && !compareMode) && (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[10px] uppercase font-black tracking-widest text-slate-500 pl-1">
                  View Mode:
                </span>
                <div className="flex rounded-xl bg-slate-950 p-1 border border-white/5 shadow-inner">
                  <button
                    onClick={() => { setShowClusters(false); setShowForecastTrack(false); }}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black tracking-wide transition-all cursor-pointer ${(!showClusters && !showForecastTrack) ? "bg-slate-800 text-cyan-400 shadow" : "text-slate-500 hover:text-slate-300"
                      }`}
                  >
                    STANDARD OUTLOOK
                  </button>
                  {selectedModel === "fnv3_large" && (
                    <button
                      onClick={() => { setShowClusters(true); setShowForecastTrack(false); }}
                      className={`px-3 py-1.5 rounded-lg text-[10px] font-black tracking-wide transition-all cursor-pointer ${showClusters ? "bg-slate-800 text-cyan-400 shadow" : "text-slate-500 hover:text-slate-300"
                        }`}
                    >
                      TRACK CLUSTERS
                    </button>
                  )}
                  <button
                    onClick={() => { setShowClusters(false); setShowForecastTrack(true); }}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black tracking-wide transition-all cursor-pointer ${showForecastTrack ? "bg-slate-800 text-cyan-400 shadow" : "text-slate-500 hover:text-slate-300"
                      }`}
                  >
                    FORECAST TRACK
                  </button>
                </div>
              </div>
            )}

            {showForecastTrack && stormsIndex.length > 0 && !compareMode && (
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className="text-[10px] uppercase font-black tracking-widest text-slate-500 pl-1">
                  Storm Track:
                </span>
                <div className="flex flex-wrap rounded-xl bg-slate-950 p-1 border border-white/5 shadow-inner gap-0.5">
                  <button
                    onClick={() => setSelectedStormId("latest")}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black tracking-wide transition-all cursor-pointer ${selectedStormId === "latest" ? "bg-slate-800 text-cyan-400 shadow" : "text-slate-500 hover:text-slate-300"
                      }`}
                  >
                    ALL SYSTEMS (COMPOSITE)
                  </button>
                  {stormsIndex.map((storm) => (
                    <button
                      key={storm.track_id}
                      onClick={() => setSelectedStormId(storm.track_id)}
                      className={`px-3 py-1.5 rounded-lg text-[10px] font-black tracking-wide transition-all cursor-pointer ${selectedStormId === storm.track_id ? "bg-slate-800 text-cyan-400 shadow" : "text-slate-500 hover:text-slate-300"
                        }`}
                    >
                      {storm.storm_name.toUpperCase()} ({storm.track_id})
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="p-5 rounded-2xl custom-glass text-center text-xs text-slate-500">
            No track forecasts found in active directories for any model today.
          </div>
        ))}

        {/* Grid / Single Map layout switch */}
        {compareMode ? (
          /* Multi Model Comparison Grid Mode */
          <div className="flex flex-col gap-5">
            <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
              <h3 className="text-xs font-black uppercase text-slate-400 tracking-wider flex items-center gap-2">
                <Grid className="w-4 h-4 text-cyan-400" />
                <span>Comparing forecast tracks ({current ? `${current.type.toUpperCase()} / ${current.modelTime}` : "N/A"})</span>
              </h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {Object.keys(MODEL_INFO).map((modelKey) => {
                const info = MODEL_INFO[modelKey];
                let image = null;
                if (activeConfigId) {
                  const parts = activeConfigId.split('-');
                  const type = parts[0];
                  const modelTime = parts.slice(1).join('-');
                  const opt = FORECAST_OPTIONS.find(
                    (o) => o.model === modelKey && o.type === type && o.modelTime === modelTime
                  );
                  const isAvailable = opt ? availableIds.includes(opt.id) : false;
                  image = isAvailable ? opt.imageSrc : null;
                  if (modelKey === "fnv3_large" && showClusters && image) {
                    image = image.replace(".png", "_cluster.png");
                  }
                }

                return (
                  <div key={modelKey} className="custom-glass rounded-3xl p-4 flex flex-col justify-between relative overflow-hidden group hover:border-cyan-500/30 transition-all shadow-xl">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-cyan-500/5 blur-xl rounded-full pointer-events-none"></div>

                    <div>
                      <div className="flex items-center justify-between mb-3 border-b border-white/5 pb-2">
                        <span className="text-xs font-black text-white">{info.name}</span>
                        <span className="text-[9px] uppercase font-bold text-slate-500 bg-slate-950 px-2 py-0.5 rounded-lg border border-white/5">
                          {info.type.split(" ")[0]}
                        </span>
                      </div>

                      <div className="h-56 w-full bg-slate-950 border border-white/5 rounded-2xl overflow-hidden flex items-center justify-center relative group/img">
                        {image ? (
                          <>
                            <img
                              src={image}
                              alt={`Grid compare track for ${info.name}`}
                              className="w-full h-full object-contain cursor-pointer hover:opacity-90 transition-opacity"
                              onClick={() => handleOpenEnlarged(modelKey)}
                            />
                            <button
                              onClick={() => handleOpenEnlarged(modelKey)}
                              className="absolute bottom-2.5 right-2.5 p-2 bg-slate-900/90 hover:bg-slate-800 border border-white/10 rounded-xl text-white opacity-0 group-hover/img:opacity-100 transition-opacity cursor-pointer shadow-lg"
                            >
                              <Maximize2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <div className="text-center p-4 flex flex-col items-center gap-2 cursor-pointer" onClick={() => handleOpenEnlarged(modelKey)}>
                            <Database className="w-8 h-8 text-slate-700 animate-pulse" />
                            <span className="text-[10px] text-slate-500 font-bold leading-tight">Image not available at this hour cycle.</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <p className="text-[10px] text-slate-500 font-bold leading-relaxed mt-3">{info.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* Single Interactive Track Visualizer */
          <div className="grid grid-cols-1 lg:grid-cols-[2fr,1fr] gap-6 md:gap-8 items-start">

            {/* Left Column Forecast Map or Trends Map */}
            <div className="custom-glass rounded-3xl p-3 shadow-2xl relative group flex flex-col">
              <div className="border-b border-white/5 px-4.5 py-2.5 flex items-center justify-between text-xs text-slate-400">
                <span className="font-bold flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                  <span>{showTrends ? "Run Cycle Forecast Trends Map" : "Forecast Track Map"}</span>
                </span>
                <div className="flex items-center gap-2">
                  {showTrends && (
                    <button
                      onClick={() => setShowTrends(false)}
                      className="px-2 py-1 bg-slate-900 border border-white/10 hover:border-slate-500 rounded-lg text-[10px] font-black text-slate-400 hover:text-white transition-all cursor-pointer flex items-center gap-1"
                    >
                      <X className="w-3 h-3" />
                      <span>Back to Forecast</span>
                    </button>
                  )}
                  <span className="font-mono text-[10px] text-slate-500 font-bold bg-slate-950 px-2 py-0.5 rounded-lg border border-white/5">
                    {current ? current.modelTime : "N/A"}
                  </span>
                </div>
              </div>

              {showTrends ? (
                /* Trends inline container */
                <div className="mt-2 flex flex-col gap-3">
                  {/* Trends inline controls toolbar */}
                  <div className="flex flex-col sm:flex-row gap-4 justify-between items-stretch sm:items-center p-3 bg-slate-950/40 border border-white/5 rounded-2xl">
                    {/* Active System selection */}
                    <div className="flex-1 flex flex-col gap-1.5">
                      <span className="text-[9px] uppercase font-black tracking-widest text-slate-500 pl-1">
                        Select Active System
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {(() => {
                          const key = `${selectedModel === "fnv3_large" ? "large" : "base"}_${trendHorizon}`;
                          const dists = trendsManifest?.[key] || [];
                          if (dists.length === 0) {
                            return (
                              <div className="text-[10px] text-slate-500 italic font-bold">
                                No active systems meeting threshold.
                              </div>
                            );
                          }
                          return dists.map((d) => (
                            <button
                              key={d.id}
                              onClick={() => setActiveTrendDistId(d.id)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border cursor-pointer ${activeTrendDistId === d.id
                                  ? "bg-cyan-500/15 border-cyan-400/40 text-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.2)]"
                                  : "bg-slate-900/40 border-white/5 text-slate-400 hover:text-slate-200"
                                }`}
                            >
                              {d.name}
                            </button>
                          ));
                        })()}
                      </div>
                    </div>

                    {/* Horizon selection */}
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <span className="text-[9px] uppercase font-black tracking-widest text-slate-500 pl-1">
                        Forecast Horizon
                      </span>
                      <div className="flex rounded-lg bg-slate-950 p-1 border border-white/5">
                        <button
                          onClick={() => setTrendHorizon("5day")}
                          className={`px-3 py-1 text-center rounded text-[10px] font-black tracking-wide transition-all cursor-pointer ${trendHorizon === "5day" ? "bg-slate-800 text-cyan-400 shadow" : "text-slate-500 hover:text-slate-300"
                            }`}
                        >
                          5-Day
                        </button>
                        <button
                          onClick={() => setTrendHorizon("15day")}
                          className={`px-3 py-1 text-center rounded text-[10px] font-black tracking-wide transition-all cursor-pointer ${trendHorizon === "15day" ? "bg-slate-800 text-cyan-400 shadow" : "text-slate-500 hover:text-slate-300"
                            }`}
                        >
                          15-Day
                        </button>
                      </div>
                    </div>

                    {/* Width options */}
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <span className="text-[9px] uppercase font-black tracking-widest text-slate-500 pl-1">
                        Extent Width
                      </span>
                      <div className="flex rounded-lg bg-slate-950 p-1 border border-white/5">
                        <button
                          onClick={() => setIsWideTrend(false)}
                          className={`px-3 py-1 text-center rounded text-[10px] font-black tracking-wide transition-all cursor-pointer ${!isWideTrend ? "bg-slate-800 text-cyan-400 shadow" : "text-slate-500 hover:text-slate-300"
                            }`}
                        >
                          Standard
                        </button>
                        <button
                          onClick={() => setIsWideTrend(true)}
                          className={`px-3 py-1 text-center rounded text-[10px] font-black tracking-wide transition-all cursor-pointer ${isWideTrend ? "bg-slate-800 text-cyan-400 shadow" : "text-slate-500 hover:text-slate-300"
                            }`}
                        >
                          Wide
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Trends map image viewport */}
                  <div className="h-80 md:h-[28rem] flex items-center justify-center bg-slate-950 border border-white/5 rounded-2xl overflow-hidden relative shadow-inner">
                    {(() => {
                      const key = `${selectedModel === "fnv3_large" ? "large" : "base"}_${trendHorizon}`;
                      const dists = trendsManifest?.[key] || [];
                      const activeDist = dists.find(d => d.id === activeTrendDistId) || dists[0];

                      if (!trendsManifest) {
                        return (
                          <div className="flex flex-col items-center justify-center p-8 text-center gap-2">
                            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cyan-400"></div>
                            <span className="text-xs text-slate-500 font-bold">Loading trends manifest...</span>
                          </div>
                        );
                      }

                      if (dists.length === 0 || !activeDist) {
                        return (
                          <div className="text-center p-8 flex flex-col items-center gap-3">
                            <Database className="w-10 h-10 text-slate-700 animate-pulse" />
                            <span className="text-xs text-slate-500 font-bold leading-relaxed max-w-sm">
                              No trend maps pre-rendered for this cycle. Trend maps are only generated for systems with ≥100 tracks (Large) or ≥25 tracks (Base).
                            </span>
                          </div>
                        );
                      }

                      const imgPath = isWideTrend ? activeDist.wide : activeDist.standard;
                      const finalImgUrl = getAssetUrl(imgPath);

                      return (
                        <>
                          <img
                            src={finalImgUrl}
                            alt={`Trends map for ${activeDist.name}`}
                            className="h-full w-full object-contain cursor-pointer transition-opacity hover:opacity-90"
                            onClick={() => setEnlargedImage(finalImgUrl)}
                          />
                          <button
                            onClick={() => setEnlargedImage(finalImgUrl)}
                            className="absolute bottom-4 right-4 p-3 bg-slate-900/95 hover:bg-slate-800 border border-white/10 hover:border-slate-500 rounded-2xl text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shadow-2xl flex items-center gap-1.5 text-xs font-bold"
                          >
                            <Maximize2 className="w-4 h-4" />
                            <span>Maximize Image</span>
                          </button>
                        </>
                      );
                    })()}
                  </div>
                </div>
              ) : (
                /* Standard Forecast Map */
                <div className="h-80 md:h-[28rem] flex items-center justify-center bg-slate-950 border border-white/5 rounded-2xl overflow-hidden relative mt-1.5 shadow-inner">
                  {current && imageSrc ? (
                    <>
                      <img
                        src={imageSrc}
                        alt={`Forecast track for ${current.label}`}
                        className="h-full w-full object-contain cursor-pointer transition-opacity hover:opacity-90"
                        onClick={() => handleOpenEnlarged(compareMode ? selectedModel : null, imageSrc)}
                      />
                      <button
                        onClick={() => handleOpenEnlarged(compareMode ? selectedModel : null, imageSrc)}
                        className="absolute bottom-4 right-4 p-3 bg-slate-900/95 hover:bg-slate-800 border border-white/10 hover:border-slate-500 rounded-2xl text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shadow-2xl flex items-center gap-1.5 text-xs font-bold"
                      >
                        <Maximize2 className="w-4 h-4" />
                        <span>Maximize Image</span>
                      </button>
                    </>
                  ) : (
                    <div className="text-center p-8 flex flex-col items-center gap-3">
                      <Database className="w-10 h-10 text-slate-700 animate-pulse" />
                      <span className="text-xs md:text-sm text-slate-500 font-bold">No forecast image available as of the moment.</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right Column Metadata Details */}
            <div className="flex flex-col gap-6">

              {/* Active Model run details or Trend Details */}
              <aside className="custom-glass rounded-3xl p-5 md:p-6 shadow-2xl space-y-4 text-xs md:text-sm text-slate-300 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-cyan-500/5 blur-2xl rounded-full"></div>

                {showTrends ? (
                  /* Trend Details View */
                  <div>
                    <h2 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-3.5 flex items-center gap-1.5">
                      <Layers className="w-4 h-4 text-cyan-400" />
                      <span>Trend Details</span>
                    </h2>
                    {(() => {
                      const key = `${selectedModel === "fnv3_large" ? "large" : "base"}_${trendHorizon}`;
                      const dists = trendsManifest?.[key] || [];
                      const activeDist = dists.find(d => d.id === activeTrendDistId) || dists[0];
                      const totalMembers = selectedModel === "fnv3_large" ? 1000 : 50;

                      if (!activeDist) {
                        return (
                          <div className="text-slate-500 text-xs italic">
                            No active system details.
                          </div>
                        );
                      }

                      const supportRatio = (activeDist.trackCount / totalMembers) * 100;

                      return (
                        <dl className="space-y-3">
                          <div className="flex justify-between items-center gap-4 border-b border-white/5 pb-2">
                            <dt className="text-slate-500 font-bold">System Name</dt>
                            <dd className="font-mono text-right text-slate-200 font-bold">
                              {activeDist.name}
                            </dd>
                          </div>
                          <div className="flex justify-between items-center gap-4 border-b border-white/5 pb-2">
                            <dt className="text-slate-500 font-bold">Supporting Tracks</dt>
                            <dd className="text-right text-cyan-400 font-bold">
                              {activeDist.trackCount} / {totalMembers} members
                            </dd>
                          </div>
                          <div className="flex flex-col gap-1.5 border-b border-white/5 pb-2">
                            <div className="flex justify-between items-center">
                              <span className="text-slate-500 font-bold">Support Ratio</span>
                              <span className="text-right text-cyan-400 font-bold">{supportRatio.toFixed(1)}%</span>
                            </div>
                            <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden border border-white/5">
                              <div
                                className="h-full bg-gradient-to-r from-cyan-500 to-indigo-500 rounded-full transition-all duration-500"
                                style={{ width: `${Math.min(100, supportRatio)}%` }}
                              ></div>
                            </div>
                          </div>
                          <div className="flex justify-between items-center gap-4 border-b border-white/5 pb-2">
                            <dt className="text-slate-500 font-bold">Model Engine</dt>
                            <dd className="text-right text-slate-200 font-bold">
                              {MODEL_INFO[selectedModel]?.name}
                            </dd>
                          </div>
                          <div className="flex justify-between items-center gap-4">
                            <dt className="text-slate-500 font-bold">Visualized By</dt>
                            <dd className="text-right text-slate-200 font-bold">Philippine Typhoon/Weather</dd>
                          </div>
                        </dl>
                      );
                    })()}
                  </div>
                ) : (
                  /* Standard Run Details */
                  <div>
                    <h2 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-3.5 flex items-center gap-1.5">
                      <Layers className="w-4 h-4 text-cyan-400" />
                      <span>Run Details</span>
                    </h2>
                    <dl className="space-y-3">
                      <div className="flex justify-between items-center gap-4 border-b border-white/5 pb-2">
                        <dt className="text-slate-500 font-bold">Model Time</dt>
                        <dd className="font-mono text-right text-slate-200 font-bold">
                          {current
                            ? `${current.modelTime.replace("T", " ")}`
                            : "N/A"}
                        </dd>
                      </div>
                      <div className="flex justify-between items-center gap-4 border-b border-white/5 pb-2">
                        <dt className="text-slate-500 font-bold">Local Time</dt>
                        <dd className="text-right text-cyan-400 font-bold">
                          {current
                            ? `${toPhstLabel(current.modelTime)} PHST`
                            : "N/A"}
                        </dd>
                      </div>
                      <div className="flex justify-between items-center gap-4 border-b border-white/5 pb-2">
                        <dt className="text-slate-500 font-bold">Model Engine</dt>
                        <dd className="text-right text-slate-200 font-bold">
                          {MODEL_INFO[selectedModel]?.name}
                        </dd>
                      </div>
                      <div className="flex justify-between items-center gap-4">
                        <dt className="text-slate-500 font-bold">Visualized By</dt>
                        <dd className="text-right text-slate-200 font-bold">Philippine Typhoon/Weather</dd>
                      </div>
                    </dl>
                  </div>
                )}

                <div className="border-t border-white/5 pt-4 space-y-2.5 text-xs text-slate-500 leading-relaxed font-medium">
                  <div className="flex items-start gap-2.5">
                    <Info className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
                    <p className="text-slate-400">
                      {showTrends
                        ? "Run cycle trends show the spatial track agreements and supporting member counts for disturbances over the last 4 forecast runs."
                        : "These forecast maps are compiled directly from satellite runs. Always verify coordinates with official alerts from PAGASA and local hazard offices."
                      }
                    </p>
                  </div>
                </div>
              </aside>

              {/* Model Intelligence matrix (Accordions) */}
              <div className="custom-glass rounded-3xl p-5 md:p-6 shadow-2xl flex flex-col gap-4">
                <div className="flex rounded-xl bg-slate-950 p-1 border border-white/5 shrink-0">
                  <button
                    onClick={() => setActiveModelTab("characteristics")}
                    className={`flex-1 py-2 text-center rounded-lg text-xs font-black tracking-wide transition-all cursor-pointer ${activeModelTab === "characteristics" ? "bg-slate-800 text-cyan-400 shadow" : "text-slate-500"
                      }`}
                  >
                    Details
                  </button>
                  <button
                    onClick={() => setActiveModelTab("precision")}
                    className={`flex-1 py-2 text-center rounded-lg text-xs font-black tracking-wide transition-all cursor-pointer ${activeModelTab === "precision" ? "bg-slate-800 text-cyan-400 shadow" : "text-slate-500"
                      }`}
                  >
                    Specs
                  </button>
                </div>

                {activeModelTab === "characteristics" ? (
                  <div className="text-xs text-slate-400 leading-relaxed space-y-2.5">
                    <h5 className="text-white font-black">{MODEL_INFO[selectedModel]?.name}</h5>
                    <p className="font-medium">{MODEL_INFO[selectedModel]?.desc}</p>
                  </div>
                ) : (
                  <div className="text-xs text-slate-400 leading-relaxed space-y-3">
                    <div className="flex justify-between border-b border-white/5 pb-1.5">
                      <span className="text-slate-500 font-bold">Category</span>
                      <span className="text-white font-black">{MODEL_INFO[selectedModel]?.type}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 font-bold">Resolution</span>
                      <span className="text-white font-black">{MODEL_INFO[selectedModel]?.resolution}</span>
                    </div>
                  </div>
                )}
              </div>

            </div>
          </div>
        )}

      </div>

      {/* Full Screen Interactive Image Modal (with Model Slider & Touch Swipe) */}
      {(enlargedModelKey || enlargedImage) && (() => {
        let displayImg = enlargedImage;
        let activeInfo = null;

        if (enlargedModelKey && activeConfigId) {
          activeInfo = MODEL_INFO[enlargedModelKey];
          const parts = activeConfigId.split('-');
          const type = parts[0];
          const modelTime = parts.slice(1).join('-');
          const opt = FORECAST_OPTIONS.find(
            (o) => o.model === enlargedModelKey && o.type === type && o.modelTime === modelTime
          );
          const isAvailable = opt ? availableIds.includes(opt.id) : false;
          displayImg = isAvailable ? opt.imageSrc : null;
          if (enlargedModelKey === "fnv3_large" && showClusters && displayImg) {
            displayImg = displayImg.replace(".png", "_cluster.png");
          }
        }

        const modelKeys = Object.keys(MODEL_INFO);
        const activeIdx = enlargedModelKey ? modelKeys.indexOf(enlargedModelKey) : -1;

        const handlePrevModel = (e) => {
          e?.stopPropagation();
          if (activeIdx < 0) return;
          resetZoom();
          const prevIdx = (activeIdx - 1 + modelKeys.length) % modelKeys.length;
          setEnlargedModelKey(modelKeys[prevIdx]);
        };

        const handleNextModel = (e) => {
          e?.stopPropagation();
          if (activeIdx < 0) return;
          resetZoom();
          const nextIdx = (activeIdx + 1) % modelKeys.length;
          setEnlargedModelKey(modelKeys[nextIdx]);
        };

        return (
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/95 p-3 md:p-6 backdrop-blur-md overflow-hidden select-none"
            onClick={handleCloseEnlarged}
          >
            {/* Modal Header Toolbar */}
            <div className="absolute top-3 left-3 right-3 z-50 flex flex-col md:flex-row md:items-center justify-between gap-2.5 pointer-events-none">
              {/* Active Model Badge */}
              <div className="flex items-center gap-2 pointer-events-auto shrink-0">
                {activeInfo ? (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900/90 backdrop-blur-md rounded-2xl border border-white/10 shadow-xl">
                    <span className="text-xs font-black text-white">{activeInfo.name}</span>
                    <span className="text-[9px] uppercase font-bold text-slate-400 bg-slate-950 px-1.5 py-0.5 rounded border border-white/5">
                      {activeInfo.type.split(" ")[0]}
                    </span>
                  </div>
                ) : (
                  <div className="bg-slate-900/90 backdrop-blur-md px-3.5 py-1.5 rounded-2xl border border-white/10 flex items-center gap-2 shadow-xl">
                    <Maximize2 className="w-4 h-4 text-cyan-400" />
                    <span className="text-xs font-black text-white uppercase tracking-wider">Visualizer</span>
                  </div>
                )}
              </div>

              {/* Center Model Pills Bar (Tightly wrapped with w-fit) */}
              {enlargedModelKey && (
                <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-1 px-1.5 bg-slate-900/90 backdrop-blur-md rounded-2xl border border-white/10 pointer-events-auto shadow-xl w-fit max-w-full">
                  {modelKeys.map((mk) => {
                    const isAct = mk === enlargedModelKey;
                    const shortName = MODEL_INFO[mk].name.replace("GDM ", "").replace("ECMWF ", "");
                    return (
                      <button
                        key={mk}
                        onClick={(e) => { e.stopPropagation(); resetZoom(); setEnlargedModelKey(mk); }}
                        className={`px-2.5 py-1 text-[10px] font-bold rounded-xl transition-all whitespace-nowrap cursor-pointer ${
                          isAct
                            ? "bg-cyan-500 text-slate-950 font-black shadow-[0_0_10px_rgba(34,211,238,0.5)]"
                            : "text-slate-400 hover:text-white hover:bg-slate-800/60"
                        }`}
                      >
                        {shortName}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Right Controls (Zoom & Close) */}
              <div className="flex items-center gap-1 bg-slate-900/90 backdrop-blur-md p-1 rounded-2xl border border-white/10 shadow-xl pointer-events-auto shrink-0 self-end md:self-auto">
                <div className="text-[10px] font-black text-slate-300 px-2 hidden md:block">
                  Zoom: {zoomScale.toFixed(1)}x
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setZoomScale(Math.min(4, zoomScale + 0.5)); }}
                  className="p-2 rounded-xl hover:bg-slate-800 text-white transition cursor-pointer"
                  title="Zoom In"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setZoomScale(Math.max(1, zoomScale - 0.5)); }}
                  className="p-2 rounded-xl hover:bg-slate-800 text-white transition cursor-pointer"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); resetZoom(); }}
                  className="p-2 rounded-xl hover:bg-slate-800 text-white transition cursor-pointer"
                  title="Reset Zoom"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
                <button
                  onClick={handleCloseEnlarged}
                  className="p-2 rounded-xl hover:bg-red-500/20 text-red-400 hover:text-red-300 transition cursor-pointer"
                  title="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Desktop Side Arrows (Hidden on Mobile to Prevent Image Overlap) */}
            {enlargedModelKey && (
              <button
                onClick={handlePrevModel}
                title="Previous model (Left Arrow)"
                className="hidden sm:flex absolute left-5 top-1/2 -translate-y-1/2 z-50 p-3.5 bg-slate-900/90 hover:bg-cyan-500 hover:text-slate-950 text-white rounded-2xl border border-white/10 hover:border-cyan-400 shadow-2xl transition-all hover:scale-110 active:scale-95 cursor-pointer items-center justify-center"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
            )}

            {enlargedModelKey && (
              <button
                onClick={handleNextModel}
                title="Next model (Right Arrow)"
                className="hidden sm:flex absolute right-5 top-1/2 -translate-y-1/2 z-50 p-3.5 bg-slate-900/90 hover:bg-cyan-500 hover:text-slate-950 text-white rounded-2xl border border-white/10 hover:border-cyan-400 shadow-2xl transition-all hover:scale-110 active:scale-95 cursor-pointer items-center justify-center"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            )}

            {/* Center Image Container */}
            <div
              className="w-full h-full flex items-center justify-center relative"
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onTouchStart={(e) => {
                if (e.touches.length < 1) return;
                setSwipeStart(e.touches[0].clientX);
                if (zoomScale > 1) {
                  setIsDragging(true);
                  setDragStart({ x: e.touches[0].clientX - panOffset.x, y: e.touches[0].clientY - panOffset.y });
                }
              }}
              onTouchMove={(e) => {
                if (e.touches.length < 1) return;
                setSwipeEnd(e.touches[0].clientX);
                if (isDragging && zoomScale > 1) {
                  setPanOffset({
                    x: e.touches[0].clientX - dragStart.x,
                    y: e.touches[0].clientY - dragStart.y
                  });
                }
              }}
              onTouchEnd={() => {
                setIsDragging(false);
                if (zoomScale <= 1 && swipeStart !== null && swipeEnd !== null && enlargedModelKey) {
                  const dist = swipeStart - swipeEnd;
                  if (dist > 40) handleNextModel();
                  else if (dist < -40) handlePrevModel();
                }
                setSwipeStart(null);
                setSwipeEnd(null);
              }}
            >
              {displayImg ? (
                <img
                  key={enlargedModelKey || displayImg}
                  src={displayImg}
                  alt="Enlarged forecast map visualizer"
                  style={{
                    transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomScale})`,
                    cursor: zoomScale > 1 ? (isDragging ? "grabbing" : "grab") : "default",
                    transition: isDragging ? "none" : "transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)"
                  }}
                  className="max-w-full max-h-[75vh] sm:max-h-[82vh] object-contain rounded-2xl shadow-2xl select-none animate-in fade-in duration-200"
                  onClick={(e) => e.stopPropagation()}
                  onDragStart={(e) => e.preventDefault()}
                />
              ) : (
                <div className="text-center p-8 flex flex-col items-center gap-3 bg-slate-900/90 border border-white/10 rounded-3xl z-10" onClick={(e) => e.stopPropagation()}>
                  <Database className="w-12 h-12 text-slate-600 animate-pulse" />
                  <span className="text-sm font-bold text-slate-300">
                    No forecast map image available for {activeInfo ? activeInfo.name : "this model"} at this cycle.
                  </span>
                  <span className="text-xs text-slate-500 font-medium">Use the navigation bar to slide to another model.</span>
                </div>
              )}
            </div>

            {/* Bottom Dock Navigation Bar (Mobile & Desktop) */}
            {enlargedModelKey && (
              <div 
                className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 bg-slate-900/95 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-white/10 shadow-2xl pointer-events-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={handlePrevModel}
                  className="flex items-center gap-1 px-3 py-1.5 bg-slate-800 hover:bg-cyan-500 hover:text-slate-950 text-white rounded-full text-xs font-bold transition-all cursor-pointer shadow"
                  title="Previous Model"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span className="text-[11px]">Prev</span>
                </button>

                <div className="flex items-center gap-1.5 px-1">
                  {modelKeys.map((mk) => (
                    <button
                      key={mk}
                      onClick={(e) => { e.stopPropagation(); resetZoom(); setEnlargedModelKey(mk); }}
                      className={`h-2 rounded-full transition-all cursor-pointer ${
                        mk === enlargedModelKey ? "w-5 bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" : "w-2 bg-slate-700 hover:bg-slate-500"
                      }`}
                      title={MODEL_INFO[mk].name}
                    />
                  ))}
                </div>

                <button
                  onClick={handleNextModel}
                  className="flex items-center gap-1 px-3 py-1.5 bg-slate-800 hover:bg-cyan-500 hover:text-slate-950 text-white rounded-full text-xs font-bold transition-all cursor-pointer shadow"
                  title="Next Model"
                >
                  <span className="text-[11px]">Next</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        );
      })()}


    </section>
  );
};

export default Forecast;