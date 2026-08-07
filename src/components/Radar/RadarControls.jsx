import React from 'react';
import { Settings, X, Loader2, Download, Play } from 'lucide-react';

const RadarControls = ({
  showLeftPanel,
  setShowLeftPanel,
  scale,
  frames,
  activeRegion,
  focusOnRegion,
  playbackFramesCount,
  setPlaybackFramesCount,
  setIsPlaying,
  setIsInteractiveLoading,
  fetchTimeline,
  intervalMs,
  setIntervalMs,
  handleGenerateGif,
  isCompiling,
  compilingMessage,
  compilingProgress,
  handleCompileGif,
  isCreatingGif,
  gifMessage,
  gifProgress
}) => {
  return (
    <div
      className={`absolute left-0 md:left-4 top-20 bottom-0 md:bottom-28 w-full md:w-80 z-45 md:z-30 transition-all duration-300 ease-out flex flex-col pointer-events-auto ${
        showLeftPanel
          ? "translate-x-0 opacity-100"
          : "-translate-x-full md:-translate-x-[110%] opacity-0 pointer-events-none"
      }`}
    >
      <div className="bg-slate-950/95 md:bg-slate-900/80 backdrop-blur-xl border border-slate-800/85 md:rounded-3xl p-5 shadow-2xl flex-grow overflow-y-auto flex flex-col gap-6 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
        
        <div className="flex justify-between items-center border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Settings className="h-4.5 w-4.5 text-cyan-400 animate-pulse" />
            <span className="font-bold tracking-widest text-xs text-slate-300 font-mono uppercase">Control Console</span>
          </div>
          <button
            onClick={() => setShowLeftPanel(false)}
            className="md:hidden text-slate-400 hover:text-white p-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Diagnostics readout */}
        <div className="bg-slate-950/80 border border-slate-800/60 rounded-2xl p-4 flex flex-col gap-2 font-mono text-[10px]">
          <div className="flex justify-between text-cyan-400">
            <span className="font-semibold text-slate-400 uppercase tracking-widest text-[9px]">SYSTEM TEL</span>
            <span className="animate-pulse text-cyan-400">● STABLE</span>
          </div>
          <div className="grid grid-cols-1 gap-1.5 mt-1 text-slate-400">
            <div className="flex justify-between">
              <span>GRID:</span>
              <span className="text-slate-200">EPSG:4326</span>
            </div>
            <div className="flex justify-between">
              <span>ZOOM LEVEL:</span>
              <span className="text-slate-200">{scale.toFixed(1)}x</span>
            </div>
            <div className="flex justify-between">
              <span>FRAMES:</span>
              <span className="text-slate-200">{frames.length} DEPTH</span>
            </div>
            <div className="flex justify-between">
              <span>REFRESH INTR:</span>
              <span className="text-slate-200">3 MIN (AUTO)</span>
            </div>
          </div>
        </div>

        {/* Tactical Region Focus */}
        <div className="flex flex-col gap-2.5">
          <span className="text-slate-400 font-mono text-[10px] font-bold uppercase tracking-widest">Tactical Region Focus</span>
          <div className="grid grid-cols-2 gap-2">
            {[
              { id: "luzon", label: "Luzon Focus" },
              { id: "visayas", label: "Visayas Focus" },
              { id: "mindanao", label: "Mindanao Focus" },
              { id: "all", label: "Full Network" }
            ].map((region) => (
              <button
                key={region.id}
                onClick={() => focusOnRegion(region.id)}
                className={`py-2.5 px-3 text-xs font-bold rounded-xl border transition-all cursor-pointer text-center active:scale-95 ${
                  activeRegion === region.id
                    ? "bg-cyan-600 border-cyan-500 text-white shadow-lg shadow-cyan-900/30"
                    : "bg-slate-950/60 border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-900/80 hover:border-slate-700"
                }`}
              >
                {region.label}
              </button>
            ))}
          </div>
        </div>

        {/* Temporal depth and delay */}
        <div className="flex flex-col gap-4 border-t border-slate-800/60 pt-4">
          {/* Temporal Frame Depth */}
          <div className="flex flex-col gap-2">
            <span className="text-slate-400 font-mono text-[10px] font-bold uppercase tracking-widest">Temporal Frame Depth</span>
            <div className="grid grid-cols-3 gap-1.5 bg-slate-950/80 p-1 rounded-xl border border-slate-800/60">
              {[16, 24, 36].map((num) => (
                <button
                  key={num}
                  onClick={() => {
                    if (playbackFramesCount !== num) {
                      setIsPlaying(false);
                      setPlaybackFramesCount(num);
                      setIsInteractiveLoading(true);
                      setTimeout(() => {
                        fetchTimeline(true, num);
                      }, 50);
                    }
                  }}
                  className={`py-1.5 px-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer active:scale-95 text-center ${
                    playbackFramesCount === num
                      ? "bg-cyan-600 text-white shadow-md"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
                  }`}
                >
                  {num} F
                </button>
              ))}
            </div>
          </div>

          {/* Playback Scan Delay */}
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <span className="text-slate-400 font-mono text-[10px] font-bold uppercase tracking-widest">Scan Delay</span>
              <span className="text-xs font-mono font-bold text-cyan-400">{intervalMs} ms</span>
            </div>
            <div className="flex bg-slate-950/80 border border-slate-800/60 rounded-xl p-1 items-center justify-between">
              <button
                onClick={() => setIntervalMs(Math.max(100, intervalMs - 100))}
                className="h-8 w-8 rounded-lg bg-slate-900 hover:bg-slate-800 flex items-center justify-center text-slate-400 font-bold transition-colors cursor-pointer active:scale-95"
              >
                -
              </button>
              <input
                type="range"
                min="100"
                max="2000"
                step="100"
                value={intervalMs}
                onChange={(e) => setIntervalMs(parseInt(e.target.value, 10))}
                className="flex-grow mx-3 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer focus:outline-none accent-cyan-400"
              />
              <button
                onClick={() => setIntervalMs(Math.min(2000, intervalMs + 100))}
                className="h-8 w-8 rounded-lg bg-slate-900 hover:bg-slate-800 flex items-center justify-center text-slate-400 font-bold transition-colors cursor-pointer active:scale-95"
              >
                +
              </button>
            </div>
          </div>
        </div>

        {/* Telemetry compiler / Compile radar animation loop */}
        <div className="mt-auto border-t border-slate-800/60 pt-4 flex flex-col gap-3">
          <span className="text-slate-400 font-mono text-[10px] font-bold uppercase tracking-widest">Telemetry Exporter</span>
          <button
            onClick={handleGenerateGif}
            disabled={frames.length === 0 || isCompiling || isCreatingGif}
            className={`w-full py-3 px-4 rounded-xl font-bold text-xs tracking-wider uppercase flex items-center justify-center gap-2 transition-all border active:scale-95 ${
              frames.length === 0 || isCompiling || isCreatingGif
                ? "bg-slate-950/40 text-slate-500 border-slate-900 cursor-not-allowed opacity-50"
                : "bg-cyan-600 hover:bg-cyan-500 text-white border-cyan-500 shadow-md shadow-cyan-900/20 cursor-pointer"
            }`}
          >
            {isCompiling ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
                Capturing...
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Capture Radar Frame
              </>
            )}
          </button>

          {isCompiling && (
            <div className="bg-slate-950/80 border border-slate-800/40 rounded-xl p-3 flex flex-col gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex justify-between items-center text-[9px] font-mono leading-none">
                <span className="text-cyan-400 font-bold">{compilingMessage}</span>
                <span className="text-slate-400">{compilingProgress}%</span>
              </div>
              <div className="w-full bg-slate-900 rounded-full h-1 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-cyan-500 to-indigo-500 h-full rounded-full transition-all duration-300"
                  style={{ width: `${compilingProgress}%` }}
                ></div>
              </div>
            </div>
          )}

          <button
            onClick={handleCompileGif}
            disabled={frames.length === 0 || isCreatingGif || isCompiling}
            className={`w-full py-3 px-4 rounded-xl font-bold text-xs tracking-wider uppercase flex items-center justify-center gap-2 transition-all border active:scale-95 ${
              frames.length === 0 || isCreatingGif || isCompiling
                ? "bg-slate-950/40 text-slate-500 border-slate-900 cursor-not-allowed opacity-50"
                : "bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-500 shadow-md shadow-indigo-900/20 cursor-pointer"
            }`}
          >
            {isCreatingGif ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
                Building Loop...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 fill-current text-indigo-400" />
                Compile Radar Loop
              </>
            )}
          </button>

          {isCreatingGif && (
            <div className="bg-slate-950/80 border border-slate-800/40 rounded-xl p-3 flex flex-col gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex justify-between items-center text-[9px] font-mono leading-none">
                <span className="text-indigo-400 font-bold">{gifMessage}</span>
                <span className="text-slate-400">{gifProgress}%</span>
              </div>
              <div className="w-full bg-slate-900 rounded-full h-1 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-indigo-500 to-cyan-500 h-full rounded-full transition-all duration-300"
                  style={{ width: `${gifProgress}%` }}
                ></div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RadarControls;
