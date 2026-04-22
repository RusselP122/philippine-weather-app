import React, { useState, useEffect } from 'react';
import { X, SlidersHorizontal, Activity, ArrowDownRight } from 'lucide-react';
import { MapContainer, TileLayer, Polyline, Tooltip, Polygon } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

// PAR boundary coordinates [Lat, Lon]
const PAR_COORDS = [
  [5.0, 115.0],
  [5.0, 135.0],
  [25.0, 135.0],
  [25.0, 120.0],
  [21.0, 120.0],
  [15.0, 115.0],
];

const MONTHS = [
  { value: '01', label: 'January' },
  { value: '02', label: 'February' },
  { value: '03', label: 'March' },
  { value: '04', label: 'April' },
  { value: '05', label: 'May' },
  { value: '06', label: 'June' },
  { value: '07', label: 'July' },
  { value: '08', label: 'August' },
  { value: '09', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

// Helper to get color based on wind speed (knots) using PAGASA scale
const getStormColor = (wind) => {
  if (wind >= 100) return '#ff00ff'; // Super Typhoon (STY)
  if (wind >= 64) return '#ff0000';  // Typhoon (TY)
  if (wind >= 48) return '#ff8000';  // Severe Tropical Storm (STS)
  if (wind >= 34) return '#ffff00';  // Tropical Storm (TS)
  return '#00ffff';                  // Tropical Depression (TD)
};

const TropicalCyclonePrediction = () => {
  const [data, setData] = useState(null);
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(String(now.getFullYear()));
  const [selectedMonth, setSelectedMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const years = Array.from({ length: 13 }, (_, i) => String(2014 + i)).reverse();

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const res = await fetch('/data/historical_tracks.json');
        const json = await res.json();
        setData(json);
      } catch (err) {
        console.error("Failed to load track data", err);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const trackKey = `${selectedYear}-${selectedMonth}`;
  const monthNum = String(parseInt(selectedMonth, 10));
  const currentTracks = data?.tracks?.[trackKey] || { storms: [], stats: { wnp_formation_count: 0, par_entry_count: 0 } };
  const climatology = data?.climatology?.[monthNum] || {
    month_name: '', avg_formation: 0, avg_par_entry: 0,
    formation_range: [0, 0], par_range: [0, 0]
  };

  const selectedMonthLabel = MONTHS.find(m => m.value === selectedMonth)?.label || '';

  // ── Sidebar Content ──
  const SidebarContent = () => (
    <div className="flex-1 overflow-y-auto">
      <div className="p-3 space-y-5">

        {/* ══ Title ══ */}
        <div className="px-1 pt-1 pb-2 border-b border-slate-700/50">
          <h1 className="text-lg font-black text-white leading-tight">Tropical Cyclone<br/><span className="text-cyan-400">History / Prediction</span></h1>
        </div>

        {/* ══ Month & Year Selector ══ */}
        <div>
          <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 px-1">
            🌀 Select Period
          </h2>
          <div className="border-t border-slate-700 pt-3 px-1 space-y-2">
            {/* Month dropdown */}
            <div className="relative">
              <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">Month</label>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-200 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 appearance-none cursor-pointer hover:bg-slate-700 transition-colors shadow-sm"
              >
                {MONTHS.map(m => (
                  <option key={m.value} value={m.value} className="bg-slate-800 text-slate-200">
                    {m.label}
                  </option>
                ))}
              </select>
              <div className="absolute bottom-0 inset-y-auto right-3 h-[38px] flex items-center pointer-events-none">
                <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
            {/* Year dropdown */}
            <div className="relative">
              <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">Year</label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-200 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 appearance-none cursor-pointer hover:bg-slate-700 transition-colors shadow-sm"
              >
                {years.map(y => (
                  <option key={y} value={y} className="bg-slate-800 text-slate-200">
                    {y}
                  </option>
                ))}
              </select>
              <div className="absolute bottom-0 inset-y-auto right-3 h-[38px] flex items-center pointer-events-none">
                <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* ══ Climatological Prediction ══ */}
        <div>
          <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 px-1">
            📊 {selectedMonthLabel} Prediction
          </h2>
          <div className="border-t border-slate-700 pt-3 space-y-3">

            {/* WNP Formation Prediction Card */}
            <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 relative overflow-hidden group hover:border-amber-500/40 transition-colors">
              <div className="absolute -right-3 -top-3 opacity-5 group-hover:opacity-10 transition-opacity">
                <Activity className="h-20 w-20 text-amber-500" />
              </div>
              <h3 className="text-[10px] font-bold text-amber-400 uppercase tracking-widest mb-0.5">WNP Formation Forecast</h3>
              <p className="text-[9px] text-slate-500 mb-3">Expected storms forming in the Western North Pacific</p>
              <div className="flex items-end gap-2 mb-2">
                <span className="text-3xl font-black text-white">{climatology.formation_range[0]}–{climatology.formation_range[1]}</span>
                <span className="text-xs font-medium text-slate-400 mb-0.5">storms</span>
              </div>
              <div className="flex items-center gap-2 text-[10px]">
                <span className="text-slate-500">Avg:</span>
                <span className="text-amber-400 font-bold">{climatology.avg_formation}</span>
                <span className="text-slate-600">|</span>
                <span className="text-slate-500">Actual {selectedYear}:</span>
                <span className="text-white font-bold">{currentTracks.stats.wnp_formation_count}</span>
              </div>
            </div>

            {/* PAR Entry Prediction Card */}
            <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 relative overflow-hidden group hover:border-red-500/40 transition-colors">
              <div className="absolute -right-3 -top-3 opacity-5 group-hover:opacity-10 transition-opacity">
                <ArrowDownRight className="h-20 w-20 text-red-500" />
              </div>
              <h3 className="text-[10px] font-bold text-red-400 uppercase tracking-widest mb-0.5">PAR Entry Forecast</h3>
              <p className="text-[9px] text-slate-500 mb-3">Expected storms crossing into the Philippine Area of Responsibility</p>
              <div className="flex items-end gap-2 mb-2">
                <span className="text-3xl font-black text-white">{climatology.par_range[0]}–{climatology.par_range[1]}</span>
                <span className="text-xs font-medium text-slate-400 mb-0.5">entries</span>
              </div>
              <div className="flex items-center gap-2 text-[10px]">
                <span className="text-slate-500">Avg:</span>
                <span className="text-red-400 font-bold">{climatology.avg_par_entry}</span>
                <span className="text-slate-600">|</span>
                <span className="text-slate-500">Actual {selectedYear}:</span>
                <span className="text-white font-bold">{currentTracks.stats.par_entry_count}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ══ Tracks for this Month ══ */}
        <div>
          <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 px-1">
            🗺️ {selectedMonthLabel} {selectedYear} Tracks
          </h2>
          <div className="border-t border-slate-700 pt-3 pl-1 space-y-1">
            {currentTracks.storms.length === 0 ? (
              <p className="text-[10px] text-slate-500 italic px-2">No storms recorded this month.</p>
            ) : (
              currentTracks.storms.map((storm) => {
                const maxWind = Math.max(...storm.tracks.map(t => t[2]));
                const color = getStormColor(maxWind);
                return (
                  <div key={storm.sid} className="flex items-center gap-2 px-2 py-1">
                    <div className="w-3 h-1 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-[10px] text-slate-300 font-medium">{storm.name}</span>
                    <span className="text-[9px] text-slate-500 ml-auto">{maxWind > 0 ? `${maxWind} kt` : ''}</span>
                    {storm.entered_par && <span className="text-[8px] text-red-400 font-bold">PAR</span>}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ══ Legend ══ */}
        <div>
          <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 px-1">
            🎨 Intensity Legend
          </h2>
          <div className="border-t border-slate-700 pt-3 pl-1 space-y-1.5">
            {[
              { color: '#ff00ff', label: 'Super Typhoon (STY) ≥100 kt' },
              { color: '#ff0000', label: 'Typhoon (TY) 64-99 kt' },
              { color: '#ff8000', label: 'Severe Tropical Storm (STS) 48-63 kt' },
              { color: '#ffff00', label: 'Tropical Storm (TS) 34-47 kt' },
              { color: '#00ffff', label: 'Tropical Depression (TD) <34 kt' },
            ].map((item) => (
              <div key={item.color} className="flex items-center gap-2">
                <div className="w-4 h-1 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="text-[10px] text-slate-400">{item.label}</span>
              </div>
            ))}
            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-700/50">
              <div className="w-4 h-0.5 bg-red-500" />
              <span className="text-[10px] text-slate-400">PAR Boundary</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );

  return (
    <div className="bg-slate-900 text-slate-200 font-sans flex overflow-hidden selection:bg-cyan-500 selection:text-white" style={{ height: "calc(100vh - 64px)" }}>

      {/* ── Mobile Overlay ── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar ── */}
      <aside className={`
        fixed lg:relative top-0 left-0 h-full z-40
        w-72 lg:w-80
        bg-slate-800 border-r border-slate-700
        flex flex-col shadow-2xl flex-shrink-0
        transition-transform duration-300 ease-in-out
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
      `} style={{ marginTop: sidebarOpen ? "0" : undefined }}>

        {/* Mobile close button */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700 lg:hidden">
          <span className="text-sm font-bold text-white">Controls</span>
          <button onClick={() => setSidebarOpen(false)} className="p-1.5 rounded-lg bg-slate-700 text-slate-300 hover:text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <SidebarContent />
      </aside>

      {/* ── Main Map Area ── */}
      <main className="flex-1 relative bg-slate-800 flex flex-col z-10 overflow-hidden">

        {/* Mobile top bar */}
        <div className="flex lg:hidden items-center gap-3 px-3 py-2 bg-slate-900/90 border-b border-slate-700 z-20">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-lg bg-slate-700 text-slate-300 hover:text-white cursor-pointer flex-shrink-0"
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>
          <span className="text-xs font-semibold text-slate-300 truncate">
            {selectedMonthLabel} {selectedYear} · Tropical Cyclone Tracks
          </span>
        </div>

        {/* Map fills remaining space */}
        <div className="absolute inset-0 top-[44px] lg:top-0 z-0">
          {loading && (
            <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-slate-950/50 backdrop-blur-[1px]">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500"></div>
            </div>
          )}

          <MapContainer
            center={[15.0, 130.0]}
            zoom={5}
            minZoom={4}
            zoomControl={true}
            className="h-full w-full"
            maxBounds={[[-90, -180], [90, 180]]}
            maxBoundsViscosity={1.0}
          >
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; CARTO'
              noWrap={true}
              bounds={[[-90, -180], [90, 180]]}
            />

            {/* PAR Boundary — solid red line, no fill */}
            <Polygon
              positions={PAR_COORDS}
              pathOptions={{ color: '#ef4444', weight: 2.5, fill: false, className: 'outline-none' }}
            />

            {/* Storm Tracks */}
            {!loading && currentTracks.storms.map((storm) => {
              const segments = [];
              for (let i = 0; i < storm.tracks.length - 1; i++) {
                const p1 = storm.tracks[i];
                const p2 = storm.tracks[i + 1];
                const color = getStormColor(p1[2]);

                segments.push(
                  <Polyline
                    key={`${storm.sid}-${i}`}
                    positions={[[p1[0], p1[1]], [p2[0], p2[1]]]}
                    pathOptions={{ color: color, weight: storm.entered_par ? 2.5 : 1.5, opacity: 0.8, className: 'outline-none' }}
                  >
                    <Tooltip sticky>
                      <div className="font-bold text-orange-400">{storm.name}</div>
                      <div className="text-xs text-slate-400">Wind: {p1[2]} kts</div>
                    </Tooltip>
                  </Polyline>
                );
              }
              return <React.Fragment key={storm.sid}>{segments}</React.Fragment>;
            })}
          </MapContainer>
        </div>
      </main>
    </div>
  );
};

export default TropicalCyclonePrediction;
