import React from 'react';
import { Radio, X, Info, Palette } from 'lucide-react';

const StationInspector = ({
  showRightPanel,
  setShowRightPanel,
  stations,
  hoveredStationId,
  selectedStationId,
  setHoveredStationId,
  setSelectedStationId,
  colorTheme,
  setColorTheme,
  setIsPlaying,
  scale
}) => {
  return (
    <div
      className={`absolute right-0 md:right-4 top-20 bottom-0 md:bottom-28 w-full md:w-80 z-45 md:z-30 transition-all duration-300 ease-out flex flex-col pointer-events-auto ${
        showRightPanel
          ? "translate-x-0 opacity-100"
          : "translate-x-full md:translate-x-[110%] opacity-0 pointer-events-none"
      }`}
    >
      <div className="bg-slate-950/95 md:bg-slate-900/80 backdrop-blur-xl border border-slate-800/85 md:rounded-3xl p-5 shadow-2xl flex-grow overflow-y-auto flex flex-col gap-6 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
        
        <div className="flex justify-between items-center border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Radio className="h-4.5 w-4.5 text-cyan-400 animate-pulse" />
            <span className="font-bold tracking-widest text-xs text-slate-300 font-mono uppercase">Network Diagnostic</span>
          </div>
          <button
            onClick={() => setShowRightPanel(false)}
            className="md:hidden text-slate-400 hover:text-white p-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Dynamic Station Inspector card */}
        {(selectedStationId || hoveredStationId) ? (() => {
          const activeId = hoveredStationId || selectedStationId;
          const station = stations.find(s => s.id === activeId);
          if (!station) return null;

          let markerColorClass = "bg-slate-400 text-slate-950";
          if (station.status === "online") markerColorClass = "bg-cyan-500/20 text-cyan-400 border border-cyan-500/35";
          else if (station.status === "maintenance") markerColorClass = "bg-red-500/20 text-red-400 border border-red-500/35";
          else if (station.status === "standby") markerColorClass = "bg-yellow-500/20 text-yellow-400 border border-yellow-500/35";

          return (
            <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-cyan-500/20 rounded-2xl p-4 flex flex-col gap-2.5 shadow-lg relative overflow-hidden group animate-in fade-in zoom-in-95 duration-200">
              <div className="absolute top-0 right-0 h-16 w-16 bg-cyan-500/5 rounded-bl-full pointer-events-none"></div>
              <div className="flex justify-between items-start gap-2">
                <div className="flex flex-col">
                  <span className="font-bold text-slate-100 text-sm leading-tight">{station.name}</span>
                  <span className="text-[9px] text-slate-400 font-mono mt-0.5">{station.lat.toFixed(2)}°N, {station.lon.toFixed(2)}°E</span>
                </div>
                <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider font-mono ${markerColorClass}`}>
                  {station.status}
                </span>
              </div>
              <p className="text-[10px] text-slate-300 leading-relaxed font-sans">{station.desc}</p>
              {station.status !== "maintenance" && (
                <div className="flex items-center gap-1.5 text-[9px] text-cyan-400 font-mono mt-1 leading-none">
                  <span className="flex h-1.5 w-1.5 rounded-full bg-cyan-400 animate-ping"></span>
                  <span>240KM COMPOSITE RANGE OVERLAY ACTIVE</span>
                </div>
              )}
            </div>
          );
        })() : (
          <div className="border border-dashed border-slate-800 rounded-2xl p-4 flex flex-col items-center justify-center text-center gap-2 text-slate-500 py-6">
            <Info className="h-6 w-6 text-slate-600" />
            <div className="flex flex-col">
              <span className="text-[11px] font-bold text-slate-400">Station Inspector</span>
              <span className="text-[9px] mt-0.5">Click or hover any station marker on the map to inspect telemetry data</span>
            </div>
          </div>
        )}

        {/* Spectral Theme Presets selection */}
        <div className="flex flex-col gap-3 border-t border-slate-800/60 pt-4">
          <div className="flex items-center gap-2">
            <Palette className="h-4 w-4 text-cyan-400" />
            <span className="text-slate-400 font-mono text-[10px] font-bold uppercase tracking-widest">Spectral Presets</span>
          </div>
          
          <div className="flex flex-col gap-2">
            {[
              { id: "custom", label: "Custom Smooth", colors: ["#075163", "#31ab12", "#dcbae6"] },
              { id: "default", label: "Default PAGASA", colors: ["#1d4ed8", "#facc15", "#dc2626"] },
              { id: "storm", label: "Storm Core", colors: ["#1e3a8a", "#d97706", "#dc2626"] },
              { id: "vaporwave", label: "Vaporwave Neon", colors: ["#1c1533", "#00f0ff", "#ff007f"] },
              { id: "retro", label: "Retro Phosphor", colors: ["#041f0f", "#15803d", "#86efac"] }
            ].map((themeItem) => (
              <button
                key={themeItem.id}
                onClick={() => {
                  setIsPlaying(false);
                  setColorTheme(themeItem.id);
                }}
                className={`w-full p-2.5 rounded-xl border flex items-center justify-between transition-all cursor-pointer text-left active:scale-[0.98] ${
                  colorTheme === themeItem.id
                    ? "bg-cyan-500/10 border-cyan-500/50 shadow-md"
                    : "bg-slate-950/60 border-slate-800/60 hover:bg-slate-900/80 hover:border-slate-700"
                }`}
              >
                <span className={`text-[11px] font-bold ${colorTheme === themeItem.id ? "text-cyan-400" : "text-slate-350"}`}>
                  {themeItem.label}
                </span>
                
                {/* Swatches indicator */}
                <div className="flex gap-0.5">
                  {themeItem.colors.map((c, idx) => (
                    <span
                      key={idx}
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: c }}
                    ></span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Network Stations status list */}
        <div className="flex flex-col gap-2.5 border-t border-slate-800/60 pt-4 flex-grow overflow-hidden">
          <span className="text-slate-400 font-mono text-[10px] font-bold uppercase tracking-widest">Radar Network Status</span>
          
          <div className="flex-grow overflow-y-auto pr-1 flex flex-col gap-1.5 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
            {stations.map((station) => {
              const isSelected = selectedStationId === station.id;
              let textStatusColor = "text-slate-500";
              let dotStatusColor = "bg-slate-500";
              
              if (station.status === "online") {
                textStatusColor = "text-cyan-400";
                dotStatusColor = "bg-cyan-500";
              } else if (station.status === "maintenance") {
                textStatusColor = "text-red-400";
                dotStatusColor = "bg-red-500";
              } else if (station.status === "standby") {
                textStatusColor = "text-yellow-400";
                dotStatusColor = "bg-yellow-500";
              }

              return (
                <div
                  key={station.id}
                  onClick={() => setSelectedStationId(selectedStationId === station.id ? null : station.id)}
                  className={`flex items-center justify-between p-2 rounded-lg border transition-all cursor-pointer ${
                    isSelected
                      ? "bg-slate-800 border-slate-700"
                      : "bg-slate-950/40 border-transparent hover:border-slate-800/60"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${dotStatusColor} ${station.status === "online" ? "animate-pulse" : ""}`}></span>
                    <span className="text-[10px] font-semibold text-slate-300">{station.name.replace(" Doppler Radar", "").replace(" Station", "")}</span>
                  </div>
                  <span className={`text-[8px] font-bold font-mono tracking-wider uppercase ${textStatusColor}`}>
                    {station.status}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
};

export default StationInspector;
