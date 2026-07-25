import React, { useEffect, useState, useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Thermometer, Wind, CloudRain, Droplets, Map as MapIcon, Table, RefreshCw, AlertTriangle, Search, ArrowLeft } from 'lucide-react';
import { WMO_STATIONS } from '../data/wmo_stations';

const PH_BOUNDS = [
    [4.5, 116.8], // Southwest
    [21.5, 127.0]  // Northeast
];

// Custom Leaflet Popup Styles
const POPUP_CSS = `
  .custom-popup .leaflet-popup-content-wrapper {
    background: #ffffff !important;
    color: #0f172a !important;
    border-radius: 12px !important;
    padding: 2px !important;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1) !important;
  }
  .custom-popup .leaflet-popup-content {
    margin: 0 !important;
    min-width: 200px !important;
  }
  .custom-popup .leaflet-popup-tip {
    background: #ffffff !important;
  }
  .custom-popup .leaflet-popup-close-button {
    color: #94a3b8 !important;
    padding: 8px 8px 0 0 !important;
  }
`;

// Handles initial fitBounds to ensure responsiveness on all devices
const MapBoundsHandler = ({ bounds }) => {
    const map = useMap();
    useEffect(() => {
        if (bounds) {
            // Use fitBounds to make sure the whole PH is visible initially
            map.fitBounds(bounds, { padding: [10, 10] });
            // Then lock the bounds so they can't pan too far away
            map.setMaxBounds(bounds);
        }
    }, [bounds, map]);
    return null;
};

// Handles smooth transitions when selecting a station
const MapController = ({ center, zoom }) => {
    const map = useMap();
    useEffect(() => {
        if (center) {
            map.flyTo(center, zoom, {
                duration: 2,
                easeLinearity: 0.25
            });
        }
    }, [center, zoom, map]);
    return null;
};

const DailySynoptic = () => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [lastUpdated, setLastUpdated] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [viewMode, setViewMode] = useState('split'); // 'split', 'map', 'table'
    const [selectedStation, setSelectedStation] = useState(null);
    const [sortConfig, setSortConfig] = useState({ key: 'tmax', direction: 'desc' });

    const [reportTime, setReportTime] = useState(null);

    const handleSort = (key) => {
        let direction = 'desc';
        if (sortConfig.key === key && sortConfig.direction === 'desc') {
            direction = 'asc';
        }
        setSortConfig({ key, direction });
    };

    const fetchData = async () => {
        setLoading(true);
        setError(null);
        try {
            const today = new Date();
            const year = today.getFullYear();
            const month = today.getMonth() + 1;
            const day = today.getDate();
            const hour = today.getHours();

            // Fetching Ogimet Daily Summary
            const url = `/api/ogimet/gsynext?lang=en&state=Phil&rank=100&ano=${year}&mes=${month}&day=${day}&hora=${hour}&min=0`;

            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            const text = await response.text();
            let { stations, timeInfo } = parseOgimetHtml(text);

            // Fallback logic for early morning empty data
            if (stations.length === 0) {
                const yesterday = new Date(today);
                yesterday.setDate(yesterday.getDate() - 1);
                const yYear = yesterday.getFullYear();
                const yMonth = yesterday.getMonth() + 1;
                const yDay = yesterday.getDate();

                const fallbackUrl = `/api/ogimet/gsynext?lang=en&state=Phil&rank=100&ano=${yYear}&mes=${yMonth}&day=${yDay}&hora=23&min=0`;
                const fallbackResp = await fetch(fallbackUrl);
                const fallbackText = await fallbackResp.text();
                const result = parseOgimetHtml(fallbackText);
                stations = result.stations;
                timeInfo = result.timeInfo;
            }

            // Merge with Coordinates
            const enrichedData = stations.map(station => {
                const coords = WMO_STATIONS[station.id];
                return {
                    ...station,
                    lat: coords ? coords.lat : null,
                    lon: coords ? coords.lon : null,
                    hasCoords: !!coords
                };
            });

            setData(enrichedData);
            setReportTime(timeInfo);
            setLastUpdated(new Date());

        } catch (err) {
            console.error("Failed to fetch Ogimet data:", err);
            setError("Unable to load synoptic reports. Please try again later.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const parseOgimetHtml = (html) => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const stationMap = {};

        const getDataFromTable = (anchorName, field) => {
            const anchor = doc.querySelector(`a[name="${anchorName}"]`);
            if (!anchor) return;
            const table = anchor.closest('table');
            if (!table) return;

            const rows = table.querySelectorAll('tr');
            rows.forEach(row => {
                const cells = row.querySelectorAll('td');
                if (cells.length >= 3) {
                    const nameCell = cells[1];
                    const valueCell = cells[2];
                    if (!nameCell || !valueCell) return;

                    let name = nameCell.textContent.trim().replace(" (Philippines)", "").trim();
                    let valueText = valueCell.textContent.trim();
                    const match = valueText.match(/(-?\d+\.\d+)/);

                    if (match && name) {
                        const val = parseFloat(match[1]);

                        if (!stationMap[name]) {
                            const link = nameCell.querySelector('a');
                            const href = link ? link.getAttribute('href') : '';
                            const idMatch = href.match(/ind=(\d+)/);
                            const id = idMatch ? idMatch[1] : name;

                            stationMap[name] = {
                                id: id,
                                name: name,
                                tmax: null, tmin: null, tmean: null,
                                rain: null, gust: null
                            };
                        }
                        stationMap[name][field] = val;
                    }
                }
            });
        };

        // Parse all fields requested
        getDataFromTable('tmax', 'tmax');
        getDataFromTable('tmin', 'tmin');
        getDataFromTable('tmedu', 'tmean');
        getDataFromTable('R24', 'rain');
        getDataFromTable('Gust', 'gust');

        // Try to extract report time from header
        // Typically: "01/22/2026 at 19:00 UTC" inside h4
        const header = doc.querySelector('h4');
        let timeInfo = null;
        if (header) {
            let text = header.textContent.trim();
            // Clean up if needed, though usually it's just the date string
            timeInfo = text;
        }
        return { stations: Object.values(stationMap), timeInfo };
    };

    const filteredData = useMemo(() => {
        let result = data.filter(item =>
            item.name.toLowerCase().includes(searchTerm.toLowerCase())
        );

        if (sortConfig.key) {
            result.sort((a, b) => {
                const valA = a[sortConfig.key];
                const valB = b[sortConfig.key];

                // Handle nulls (always at bottom)
                if (valA === null && valB === null) return 0;
                if (valA === null) return 1;
                if (valB === null) return -1;

                if (valA < valB) {
                    return sortConfig.direction === 'asc' ? -1 : 1;
                }
                if (valA > valB) {
                    return sortConfig.direction === 'asc' ? 1 : -1;
                }
                return 0;
            });
        }
        return result;
    }, [data, searchTerm, sortConfig]);

    // Map markers color logic
    const getMarkerColor = (tmax) => {
        if (!tmax) return '#94a3b8'; // gray
        if (tmax >= 35) return '#ef4444'; // red
        if (tmax >= 30) return '#f97316'; // orange
        if (tmax >= 25) return '#eab308'; // yellow
        return '#3b82f6'; // blue
    };

    return (
        <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col font-sans">
            <style>{POPUP_CSS}</style>
            <div className="w-full max-w-7xl mx-auto px-4 py-6 md:px-6 lg:px-8 h-full flex flex-col">
                {/* Header */}
                <header className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors mb-2 cursor-pointer" onClick={() => window.location.href = '/'}>
                            <ArrowLeft className="h-4 w-4" />
                            <span className="text-xs font-medium uppercase tracking-wider">Back to Dashboard</span>
                        </div>
                        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                            Daily Synoptic Reports
                            <span className="text-xs font-normal text-slate-500 border border-slate-700 px-2 py-0.5 rounded-full">Official WMO Data</span>
                        </h1>
                        <p className="text-slate-400 text-sm mt-1 flex items-center gap-2">
                            {reportTime ? (
                                <span className="text-orange-400 font-medium">Updated: {reportTime}</span>
                            ) : (
                                "Real-time observations from PAGASA synoptic stations."
                            )}
                        </p>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="relative hidden md:block">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                            <input
                                type="text"
                                placeholder="Search stations..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="bg-slate-900 border border-slate-700 text-slate-200 text-sm rounded-lg py-2 pl-9 pr-4 w-64 focus:outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50"
                            />
                        </div>
                        <button
                            onClick={fetchData}
                            disabled={loading}
                            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors disabled:opacity-50"
                        >
                            <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                </header>

                {/* View Toggles (Mobile mainly) */}
                <div className="md:hidden flex gap-2 mb-4">
                    <button onClick={() => setViewMode('map')} className={`flex-1 py-2 text-sm font-medium rounded-lg ${viewMode === 'map' ? 'bg-orange-600 text-white' : 'bg-slate-800 text-slate-400'}`}>Map</button>
                    <button onClick={() => setViewMode('table')} className={`flex-1 py-2 text-sm font-medium rounded-lg ${viewMode === 'table' ? 'bg-orange-600 text-white' : 'bg-slate-800 text-slate-400'}`}>List</button>
                </div>

                {/* Main Content Grid */}
                <div className="flex-grow grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-200px)] min-h-[600px]">

                    {/* Map Section */}
                    <div className={`lg:col-span-2 bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden relative ${viewMode === 'table' ? 'hidden lg:block' : 'block'}`}>
                        <MapContainer
                            center={[12.8797, 121.774]}
                            zoom={5} // Start slightly more zoomed out
                            minZoom={4} // Allow zooming out more for mobile to fit everything
                            maxZoom={11}
                            scrollWheelZoom={true}
                            className="h-full w-full bg-slate-950"
                            maxBounds={PH_BOUNDS}
                            maxBoundsViscosity={0.8}
                        >
                            <MapBoundsHandler bounds={PH_BOUNDS} />
                            <TileLayer
                                attribution='&copy; CARTO'
                                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                            />

                            {selectedStation && (
                                <MapController center={[selectedStation.lat, selectedStation.lon]} zoom={9} />
                            )}

                            {filteredData.filter(s => s.hasCoords).map(station => (
                                <CircleMarker
                                    key={station.id}
                                    center={[station.lat, station.lon]}
                                    pathOptions={{
                                        color: getMarkerColor(station.tmax),
                                        fillColor: getMarkerColor(station.tmax),
                                        fillOpacity: 0.7,
                                        weight: 1 // border width
                                    }}
                                    radius={selectedStation?.id === station.id ? 8 : 5}
                                    eventHandlers={{
                                        click: () => setSelectedStation(station)
                                    }}
                                >
                                    <Popup className="custom-popup">
                                        <div className="p-3">
                                            <h3 className="font-bold text-slate-900 text-sm mb-2 border-b border-slate-100 pb-1">{station.name}</h3>
                                            <div className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-xs">
                                                <span className="text-slate-500 font-medium">Temperature Max:</span>
                                                <span className="font-mono font-bold text-slate-900">{station.tmax ?? '-'}°C</span>

                                                <span className="text-slate-500 font-medium">Temperature Min:</span>
                                                <span className="font-mono font-bold text-slate-900">{station.tmin ?? '-'}°C</span>

                                                <span className="text-slate-500 font-medium">24h Rainfall:</span>
                                                <span className="font-mono font-bold text-blue-600">{station.rain ?? '0'} mm</span>

                                                <span className="text-slate-500 font-medium">Wind Gust:</span>
                                                <span className="font-mono font-bold text-amber-600">{station.gust ?? '-'} km/h</span>
                                            </div>
                                        </div>
                                    </Popup>
                                </CircleMarker>
                            ))}
                        </MapContainer>

                        {/* Legend Overlay */}
                        <div className="absolute bottom-4 left-4 bg-slate-900/90 backdrop-blur border border-slate-700 p-3 rounded-lg text-xs shadow-xl z-[1000]">
                            <h4 className="font-bold text-slate-300 mb-2">Max Temp (°C)</h4>
                            <div className="flex flex-col gap-1.5">
                                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-red-500"></span> <span>≥ 35 (Hot)</span></div>
                                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-orange-500"></span> <span>30 - 34.9</span></div>
                                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-yellow-500"></span> <span>25 - 29.9</span></div>
                                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-blue-500"></span> <span>&lt; 25 (Cool)</span></div>
                            </div>
                        </div>
                    </div>

                    {/* Table Section */}
                    <div className={`lg:col-span-1 bg-slate-900/50 border border-slate-800 rounded-2xl flex flex-col overflow-hidden ${viewMode === 'map' ? 'hidden lg:flex' : 'flex'}`}>
                        <div className="p-4 border-b border-slate-800 bg-slate-900 flex flex-col gap-3">
                            <div className="flex justify-between items-center">
                                <h2 className="font-semibold text-slate-200">Station Data</h2>
                                <span className="text-xs text-slate-500 bg-slate-800 px-2 py-1 rounded-full">{filteredData.length} Stations</span>
                            </div>

                            {/* Sort Controls */}
                            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                                {[
                                    { key: 'tmax', label: 'Max' },
                                    { key: 'tmin', label: 'Min' },
                                    { key: 'rain', label: 'Rain' },
                                    { key: 'gust', label: 'Gust' }
                                ].map(({ key, label }) => (
                                    <button
                                        key={key}
                                        onClick={() => handleSort(key)}
                                        className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all whitespace-nowrap ${sortConfig.key === key
                                            ? 'bg-orange-500/10 border-orange-500/50 text-orange-400'
                                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                                            }`}
                                    >
                                        <div className="flex items-center justify-center gap-1">
                                            {label}
                                            {sortConfig.key === key && (
                                                <span className="text-[10px]">{sortConfig.direction === 'desc' ? '↓' : '↑'}</span>
                                            )}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
                            {loading ? (
                                <div className="flex items-center justify-center h-40">
                                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-orange-500"></div>
                                </div>
                            ) : filteredData.length === 0 ? (
                                <div className="text-center py-10 text-slate-500 text-sm">No stations found.</div>
                            ) : (
                                <div className="space-y-2">
                                    {filteredData.map((station) => (
                                        <div
                                            key={station.id}
                                            onClick={() => setSelectedStation(station)}
                                            className={`p-3 rounded-xl border transition-all cursor-pointer hover:border-orange-500/50 hover:bg-slate-800 ${selectedStation?.id === station.id ? 'bg-slate-800 border-orange-500 ring-1 ring-orange-500/20' : 'bg-slate-900 border-slate-800'}`}
                                        >
                                            <div className="flex justify-between items-start mb-2">
                                                <span className="font-medium text-slate-200 text-sm">{station.name}</span>
                                                <span className="text-[10px] text-slate-500 font-mono">#{station.id}</span>
                                            </div>

                                            <div className="grid grid-cols-4 gap-2 text-center">
                                                <div className="bg-slate-950/50 rounded p-1">
                                                    <div className="text-[10px] text-slate-500 uppercase">Max</div>
                                                    <div className={`text-sm font-bold ${station.tmax >= 35 ? 'text-red-400' : 'text-slate-200'}`}>{station.tmax ?? '-'}°</div>
                                                </div>
                                                <div className="bg-slate-950/50 rounded p-1">
                                                    <div className="text-[10px] text-slate-500 uppercase">Min</div>
                                                    <div className="text-sm font-bold text-sky-200">{station.tmin ?? '-'}°</div>
                                                </div>
                                                <div className="bg-slate-950/50 rounded p-1">
                                                    <div className="text-[10px] text-slate-500 uppercase">Rain</div>
                                                    <div className="text-sm font-bold text-blue-300">{station.rain ?? '0'}</div>
                                                </div>
                                                <div className="bg-slate-950/50 rounded p-1">
                                                    <div className="text-[10px] text-slate-500 uppercase">Gust</div>
                                                    <div className="text-sm font-bold text-amber-200">{station.gust ?? '-'}</div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DailySynoptic;
