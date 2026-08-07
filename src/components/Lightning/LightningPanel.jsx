import React from 'react';
import { 
  Radio, 
  ChevronUp, 
  ChevronDown, 
  Timer, 
  ShieldAlert, 
  Globe, 
  Activity 
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { getAgeRangeLabel, getStrikeColor } from "../../data/lightningConfig";

const LightningPanel = ({
  isMobileCollapsed,
  setIsMobileCollapsed,
  connectionStatus,
  stats,
  timeRange,
  setTimeRange,
  rangeCounts,
  filteredStrikes,
  latestStrikeTime,
  activeWarningZones,
  selectedAgeCategory,
  setSelectedAgeCategory
}) => {
  // Connection badge helper
  const getStatusBadge = () => {
    switch (connectionStatus) {
      case "Connected":
        return (
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.1)]">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Connected
          </span>
        );
      case "Reconnecting":
        return (
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            Reconnecting
          </span>
        );
      case "Disconnected":
      default:
        return (
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-450 animate-ping" />
            Disconnected
          </span>
        );
    }
  };

  return (
    <div
      className={`w-full md:w-80 lg:w-96 transition-all duration-500 ease-in-out bg-[#070b13]/95 md:bg-[#03060c]/90 backdrop-blur-xl border-t md:border-t-0 md:border-l border-slate-900 flex flex-col z-20 overflow-hidden shadow-[-15px_0_35px_rgba(0,0,0,0.6)] ${
        isMobileCollapsed ? "h-[60px] flex-none" : "h-[calc(60vh-64px)] flex-1"
      } md:h-full md:flex-none`}
    >
      
      {/* Header Block */}
      <div
        onClick={() => {
          if (window.innerWidth < 768) {
            setIsMobileCollapsed(!isMobileCollapsed);
          }
        }}
        className={`bg-slate-950/80 px-5 border-b border-slate-900 relative overflow-hidden flex-shrink-0 cursor-pointer md:cursor-default transition-all duration-300 ${
          isMobileCollapsed ? "py-4.5" : "py-5"
        }`}
      >
        <div className="absolute top-0 right-0 w-24 h-24 bg-sky-500/5 blur-xl rounded-full pointer-events-none" />
        <h1 className="text-sm sm:text-base font-black tracking-wider text-white uppercase flex items-center justify-between relative">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-sky-400 animate-pulse" />
            <span>Real-time Lightning</span>
          </div>
          <div className="flex items-center gap-2.5">
            {getStatusBadge()}
            <span className="md:hidden">
              {isMobileCollapsed ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </span>
          </div>
        </h1>
        
        <div className={`mt-3 flex gap-2 flex-wrap transition-all duration-300 ${
          isMobileCollapsed ? "hidden md:flex" : "flex"
        }`}>
          <span className="text-[9px] font-mono bg-slate-950 text-slate-400 py-1 px-2 rounded border border-slate-850">
            PAGASA Network Endpoint
          </span>
        </div>
      </div>

      {/* Dynamic Statistics Cards Grid */}
      <div className="p-4 grid grid-cols-2 gap-2.5 bg-slate-950/30 border-b border-slate-900/60 flex-shrink-0">
        <div className="bg-slate-900/20 border border-slate-850 rounded-xl p-3 text-center flex flex-col justify-center relative overflow-hidden">
          {stats.totalVisible > 0 && (
            <div className="absolute top-1.5 right-1.5 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
            </div>
          )}
          <span className="text-[9px] text-slate-400 uppercase tracking-wider font-extrabold">Active (Selected)</span>
          <span className="text-2xl font-black text-rose-500 mt-1">{stats.totalVisible}</span>
        </div>
        <div className="bg-slate-900/20 border border-slate-850 rounded-xl p-3 text-center flex flex-col justify-center">
          <span className="text-[9px] text-slate-400 uppercase tracking-wider font-extrabold">In-Memory Buffer</span>
          <span className="text-2xl font-black text-sky-400 mt-1">{stats.totalInMemory}</span>
        </div>
        <div className="bg-slate-900/20 border border-slate-850 rounded-xl p-3 text-center flex flex-col justify-center">
          <span className="text-[9px] text-slate-400 uppercase tracking-wider font-extrabold">Max Amplitude</span>
          <span className="text-xl font-black text-amber-500 mt-1">
            {stats.maxAmplitude > 0 ? `${stats.maxAmplitude.toFixed(1)} A` : "0 A"}
          </span>
        </div>
        <div className="bg-slate-900/20 border border-slate-850 rounded-xl p-3 text-center flex flex-col justify-center">
          <span className="text-[9px] text-slate-400 uppercase tracking-wider font-extrabold">Peak Region</span>
          <span className="text-base font-black text-emerald-400 mt-1 truncate">{stats.mostActiveRegion}</span>
        </div>
      </div>

      {/* Time-Range selector blocks */}
      <div className="p-4 border-b border-slate-900/60 flex-shrink-0 bg-slate-950/15">
        <div className="text-[9px] text-slate-400 font-extrabold uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
          <Timer className="w-3.5 h-3.5 text-sky-400" />
          <span>Buffer Timeframes:</span>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {[1, 5, 10, 20, 30, 40, 50, 90].map((val) => (
            <button
              key={val}
              onClick={() => setTimeRange(val)}
              className={`py-2 px-1 rounded-lg text-[9px] font-extrabold uppercase border transition-all cursor-pointer flex flex-col items-center justify-center gap-0.5 ${
                timeRange === val
                  ? "bg-sky-500/10 text-sky-400 border-sky-500/30 shadow-md shadow-sky-500/5"
                  : "bg-slate-900/20 border-slate-850 text-slate-500 hover:text-slate-300"
              }`}
            >
              <span>{getAgeRangeLabel(val)}</span>
              <span className={`text-[8px] font-bold ${timeRange === val ? "text-sky-300" : "text-slate-600"}`}>
                ({rangeCounts[val] || 0})
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Dynamic stacked distribution bar to visualize storm decay/growth state */}
      {filteredStrikes.length > 0 && (
        <div className="px-4 py-3.5 border-b border-slate-900/60 flex-shrink-0 bg-slate-950/15">
          <div className="text-[9px] text-slate-400 font-extrabold uppercase tracking-wider mb-2 flex justify-between items-center">
            <span>Age Composition:</span>
            <span className="font-mono text-slate-550">Relative volume segments</span>
          </div>
          <div className="h-2 w-full rounded-full overflow-hidden flex bg-slate-900 border border-slate-850">
            {[
              { key: '0-5', color: '#ef4444' },
              { key: '5-10', color: '#f97316' },
              { key: '10-20', color: '#eab308' },
              { key: '20-30', color: '#84cc16' },
              { key: '30-40', color: '#22c55e' },
              { key: '40-50', color: '#06b6d4' },
              { key: '50-90', color: '#3b82f6' }
            ].map(segment => {
              // Compute counts within current segment
              let count = 0;
              filteredStrikes.forEach(s => {
                const ageMin = (latestStrikeTime - s.observedAtMs) / 60000;
                if (segment.key === '0-5' && ageMin <= 5) count++;
                if (segment.key === '5-10' && ageMin > 5 && ageMin <= 10) count++;
                if (segment.key === '10-20' && ageMin > 10 && ageMin <= 20) count++;
                if (segment.key === '20-30' && ageMin > 20 && ageMin <= 30) count++;
                if (segment.key === '30-40' && ageMin > 30 && ageMin <= 40) count++;
                if (segment.key === '40-50' && ageMin > 40 && ageMin <= 50) count++;
                if (segment.key === '50-90' && ageMin > 50 && ageMin <= 90) count++;
              });

              const percentage = filteredStrikes.length > 0 ? (count / filteredStrikes.length) * 100 : 0;
              if (percentage === 0) return null;
              return (
                <div
                  key={segment.key}
                  style={{ width: `${percentage}%`, backgroundColor: segment.color }}
                  title={`${segment.key}m: ${count} strikes (${percentage.toFixed(0)}%)`}
                  className="h-full first:rounded-l-full last:rounded-r-full transition-all duration-300"
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Warning Zones and real-time logs */}
      <div className="p-4 flex-1 overflow-y-auto space-y-5">
        
        {/* Active warning zones */}
        <div>
          <h2 className="text-slate-400 font-bold uppercase tracking-wider text-[9.5px] flex items-center gap-1.5 border-b border-slate-900 pb-2 mb-3">
            <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />
            <span>Storm Alert Centers</span>
          </h2>
          
          {activeWarningZones.length > 0 ? (
            <div className="space-y-2">
              {activeWarningZones.map((feat) => (
                <div
                  key={feat.name}
                  className="p-2.5 rounded-xl border bg-slate-950/20 animate-border-glow flex justify-between items-center transition-all hover:bg-slate-900/40 relative overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-sky-500/5 to-transparent animate-[pulse_4s_ease-in-out_infinite]" />
                  <div className="flex items-center gap-2 relative z-10">
                    <div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.7)]" />
                    <div>
                      <span className="text-xs font-black text-white">{feat.name}</span>
                      <span className="text-[9px] text-slate-500 block uppercase tracking-wider font-mono">
                        {feat.group} • {feat.region.split("(")[0].trim()}
                      </span>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-md bg-slate-900 border border-sky-900/50 text-[10px] font-black text-amber-400 relative z-10 shadow-lg shadow-sky-900/20">
                    {feat.count} Hits
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center p-4 border border-dashed border-slate-900/60 rounded-xl">
              <span className="text-[10px] text-slate-600">No active severe storm centers detected.</span>
            </div>
          )}
        </div>

        {/* Color Age Legend (Interactive Category Filter) */}
        <div>
          <h2 className="text-slate-400 font-bold uppercase tracking-wider text-[9.5px] flex items-center justify-between border-b border-slate-900 pb-2 mb-3">
            <div className="flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-sky-400" />
              <span>Strike Age Legend</span>
            </div>
            {selectedAgeCategory && (
              <button
                onClick={() => setSelectedAgeCategory(null)}
                className="text-[8.5px] text-sky-400 hover:text-sky-350 font-black uppercase px-2 py-0.5 rounded bg-sky-950/40 border border-sky-500/25 cursor-pointer animate-pulse"
              >
                Reset Filter
              </button>
            )}
          </h2>
          <div className="bg-slate-950/30 border border-slate-900 rounded-xl p-3.5 grid grid-cols-2 gap-2 text-[9.5px] font-mono select-none">
            {[
              { label: "0 - 5 min", color: "#ef4444", key: "0-5" },
              { label: "5 - 10 min", color: "#f97316", key: "5-10" },
              { label: "10 - 20 min", color: "#eab308", key: "10-20" },
              { label: "20 - 30 min", color: "#84cc16", key: "20-30" },
              { label: "30 - 40 min", color: "#22c55e", key: "30-40" },
              { label: "40 - 50 min", color: "#06b6d4", key: "40-50" },
              { label: "50 - 90 min", color: "#3b82f6", key: "50-90" }
            ].map(cat => (
              <button
                key={cat.key}
                onClick={() => setSelectedAgeCategory(selectedAgeCategory === cat.key ? null : cat.key)}
                className={`flex items-center gap-2 px-1.5 py-1 rounded transition-all cursor-pointer text-left w-full border ${
                  selectedAgeCategory === cat.key
                    ? "bg-slate-900 border-slate-700 font-extrabold text-white shadow-sm"
                    : "bg-transparent border-transparent hover:bg-slate-900/30"
                }`}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                <span className={selectedAgeCategory === cat.key ? "text-white" : "text-slate-400 hover:text-slate-200"}>
                  {cat.label}
                </span>
              </button>
            ))}
            <div className="flex items-center gap-2 px-1.5 py-1 text-slate-500 border border-transparent">
              <span className="w-2 h-2 rounded-full border border-dashed border-slate-700 bg-transparent shrink-0" />
              <span>&gt; 90m (Pruned)</span>
            </div>
          </div>
        </div>

        {/* Real-time Stroke log */}
        <div>
          <h2 className="text-slate-400 font-bold uppercase tracking-wider text-[9.5px] flex items-center gap-1.5 border-b border-slate-900 pb-2 mb-3">
            <Activity className="w-3.5 h-3.5 text-rose-500 animate-pulse" />
            <span>Strike Log Stream</span>
          </h2>

          {filteredStrikes.length > 0 ? (
            <div className="space-y-1.5 font-mono text-[9px]">
              <AnimatePresence initial={false}>
                {filteredStrikes.slice(0, 15).map((s) => {
                  const ageMs = latestStrikeTime - s.observedAtMs;
                  const color = getStrikeColor(ageMs) || "#475569";
                  return (
                    <motion.div
                      key={s.id}
                      initial={{ opacity: 0, y: -15, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.1 } }}
                      transition={{ type: "spring", stiffness: 400, damping: 25 }}
                      className="p-2 rounded-lg border border-slate-900 bg-slate-950/20 flex justify-between items-center hover:border-slate-800 hover:bg-slate-900/40 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                        <span className="font-extrabold text-slate-300">STRIKE</span>
                        <span className="text-slate-500">
                          ({s.lat.toFixed(3)}, {s.lon.toFixed(3)})
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-2 font-bold">
                        {s.amplitude !== 0 && (
                          <span className="text-slate-400">{s.amplitude.toFixed(1)} A</span>
                        )}
                        <span className="opacity-60">
                          {ageMs < 60050 ? `${Math.round(ageMs / 1000)}s ago` : `${Math.floor(ageMs / 60000)}m ago`}
                        </span>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          ) : (
            <div className="text-center p-4 border border-dashed border-slate-900/60 rounded-xl">
              <span className="text-[10px] text-slate-600">No strikes matching active range.</span>
            </div>
          )}
        </div>

      </div>

      {/* Footer */}
      <div className="bg-slate-950 p-4.5 border-t border-slate-900 flex flex-col gap-1.5 flex-shrink-0">
        <div className="text-sky-400 font-black text-xs text-center tracking-wider uppercase flex items-center justify-center gap-1">
          <Radio className="w-3.5 h-3.5 text-sky-400 animate-pulse" />
          <span>PAGASA Lightning Network</span>
        </div>
        <div className="text-[9px] text-slate-600 text-center font-mono leading-tight">
          DOST-PAGASA Nation observations & live feed
        </div>
      </div>

    </div>
  );
};

export default LightningPanel;
