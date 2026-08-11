import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MapContainer, TileLayer, LayersControl, useMap, ImageOverlay } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { getStormDisplayName } from "../utils/stormNaming";
import * as turf from "@turf/turf";

const { BaseLayer, Overlay } = LayersControl;

const OWM_API_KEY = "138ee97bc2df4029270f36075b709726";
const precipLayer = `https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=${OWM_API_KEY}`;
const pressureLayer = `https://tile.openweathermap.org/map/pressure_new/{z}/{x}/{y}.png?appid=${OWM_API_KEY}`;
const windLayer = `https://tile.openweathermap.org/map/wind_new/{z}/{x}/{y}.png?appid=${OWM_API_KEY}`;

const PAR_POLYGON = [
  [5.0, 115.0],
  [15.0, 115.0],
  [21.0, 120.0],
  [25.0, 120.0],
  [25.0, 135.0],
  [5.0, 135.0],
  [5.0, 115.0],
];

function isInsidePar(lat, lon) {
  let inside = false;
  for (let i = 0, j = PAR_POLYGON.length - 1; i < PAR_POLYGON.length; j = i++) {
    const yi = PAR_POLYGON[i][0];
    const xi = PAR_POLYGON[i][1];
    const yj = PAR_POLYGON[j][0];
    const xj = PAR_POLYGON[j][1];

    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0000001) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Helper: Custom Leaflet Control to stack seamlessly with other controls
const LeafletCustomControl = ({ position, children }) => {
  const map = useMap();
  const [container, setContainer] = useState(null);

  useEffect(() => {
    if (!map) return;
    const control = L.control({ position });
    const div = L.DomUtil.create("div", "leaflet-custom-control"); // base class

    control.onAdd = () => {
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);
      return div;
    };

    control.addTo(map);
    setContainer(div);

    return () => {
      control.remove();
    };
  }, [map, position]);

  if (!container) return null;
  return createPortal(children, container);
};

// Helper component that forces the Leaflet map to recalculate its size
// whenever fullscreen mode is toggled, so tiles and controls render correctly.
const ResizeOnFullscreen = ({ isFullscreen }) => {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    if (isFullscreen) {
      container.style.height = "100vh";
      container.style.width = "100vw";
    } else {
      container.style.height = ""; // Reset to CSS class control
      container.style.width = "";
    }

    const timeout = setTimeout(() => {
      map.invalidateSize();
    }, 200);

    return () => clearTimeout(timeout);
  }, [isFullscreen, map]);

  return null;
};

// Helper to decode obfuscated base64 CSV data
function decodeObfuscatedData(base64Str, key = 0xAA) {
  const binaryStr = atob(base64Str);
  const decryptedBytes = new Uint8Array(binaryStr.length);
  if (typeof key === "string") {
    const keyBytes = new TextEncoder().encode(key);
    for (let i = 0; i < binaryStr.length; i++) {
      decryptedBytes[i] = binaryStr.charCodeAt(i) ^ keyBytes[i % keyBytes.length];
    }
  } else {
    for (let i = 0; i < binaryStr.length; i++) {
      decryptedBytes[i] = binaryStr.charCodeAt(i) ^ key;
    }
  }
  return new TextDecoder().decode(decryptedBytes);
}

// Helper to parse CSV data
function parseCSV(text) {
  const lines = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter(l => l.trim() && !l.startsWith("#"));
  if (lines.length < 2) return { rows: [], cols: [] };
  const cols = lines[0].split(",").map(h => h.trim().toLowerCase());
  const rows = lines.slice(1).map(line => {
    const vals = line.split(",");
    const row = {};
    cols.forEach((h, i) => { row[h] = vals[i]?.trim(); });
    return row;
  });
  return { rows, cols };
}

// Core storm, PAR, country borders, and radar logic wired into the Leaflet map.
const CycloneMapLogic = ({
  showHistoryTrack,
  showEnsemble,
  setActiveWeatherLayer,
  setShowWeatherNextPrecip,
  setShowWeatherNextWind,
  setIsWeatherNextPlaying,
  setWeatherNextHour,
  setShowStrikeProb,
  setShowOutlookWeek1,
  setShowOutlookWeek2,
  setAtcfPositions
}) => {
  const map = useMap();
  const historyTrackGroupRef = useRef(null);
  const forecastTrackGroupRef = useRef(null);

  useEffect(() => {
    if (!map || !historyTrackGroupRef.current) return;
    if (showHistoryTrack) {
      if (!map.hasLayer(historyTrackGroupRef.current)) {
        historyTrackGroupRef.current.addTo(map);
      }
    } else {
      if (map.hasLayer(historyTrackGroupRef.current)) {
        map.removeLayer(historyTrackGroupRef.current);
      }
    }
  }, [showHistoryTrack, map]);

  useEffect(() => {
    if (!map || !forecastTrackGroupRef.current) return;
    if (showEnsemble) {
      if (!map.hasLayer(forecastTrackGroupRef.current)) {
        forecastTrackGroupRef.current.addTo(map);
      }
    } else {
      if (map.hasLayer(forecastTrackGroupRef.current)) {
        map.removeLayer(forecastTrackGroupRef.current);
      }
    }
  }, [showEnsemble, map]);

  useEffect(() => {
    if (!map) return;

    if (!historyTrackGroupRef.current) {
      historyTrackGroupRef.current = L.layerGroup();
    }
    if (showHistoryTrack) {
      historyTrackGroupRef.current.addTo(map);
    }

    if (!forecastTrackGroupRef.current) {
      forecastTrackGroupRef.current = L.layerGroup();
    }
    if (showEnsemble) {
      forecastTrackGroupRef.current.addTo(map);
    }

    const radarControls = document.getElementById("radar-controls");
    const timestampEl = document.getElementById("radar-timestamp");
    const loadingIndicator = document.getElementById("cyclone-loading");
    const btnRadar = document.getElementById("btn-radar");
    const btnSatellite = document.getElementById("btn-satellite");
    const btnBoth = document.getElementById("btn-both");

    const btnPlay = document.getElementById("btn-play");

    if (!radarControls || !timestampEl || !loadingIndicator) {
      return;
    }

    // Create custom pane for boundaries (above weather layers but below markers/popups)
    const BOUNDARIES_PANE = "boundariesPane";
    if (!map.getPane(BOUNDARIES_PANE)) {
      map.createPane(BOUNDARIES_PANE);
      map.getPane(BOUNDARIES_PANE).style.zIndex = 550;
    }

    // Create custom pane for WeatherNext (above tiles, below boundaries & tracks)
    const WEATHERNEXT_PANE = "weathernextPane";
    if (!map.getPane(WEATHERNEXT_PANE)) {
      map.createPane(WEATHERNEXT_PANE);
      map.getPane(WEATHERNEXT_PANE).style.zIndex = 450;
    }

    // Create custom pane for storm tracks (above boundaries but below markerPane)
    const TRACKS_PANE = "tracksPane";
    if (!map.getPane(TRACKS_PANE)) {
      map.createPane(TRACKS_PANE);
      map.getPane(TRACKS_PANE).style.zIndex = 590;
    }

    // Country borders style
    const countryStyle = {
      pane: BOUNDARIES_PANE,
      color: "#FFD700",
      weight: 1.2,
      opacity: 0.65,
      fillOpacity: 0,
    };

    // Load Country Borders (Public GeoJSON)
    fetch(
      "https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson"
    )
      .then((response) => response.json())
      .then((data) => L.geoJSON(data, { style: countryStyle, pane: BOUNDARIES_PANE }).addTo(map))
      .catch((error) =>
        console.error("Error loading country borders:", error)
      );

    // Philippine Province boundaries style
    const provinceStyle = {
      pane: BOUNDARIES_PANE,
      color: "rgba(255, 255, 255, 0.7)", // Crisp white borders overlaying the strike probabilities
      weight: 0.7,
      opacity: 1,
      fillOpacity: 0,
    };

    // Load PH Province boundaries
    fetch("/data/ph_provinces.json")
      .then((response) => response.json())
      .then((data) => L.geoJSON(data, { style: provinceStyle, pane: BOUNDARIES_PANE }).addTo(map))
      .catch((error) =>
        console.error("Error loading Philippine province boundaries:", error)
      );

    // PAR Boundary (Philippine Area of Responsibility)
    const parGeoJSON = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [115.0, 5.0],
            [115.0, 15.0],
            [120.0, 21.0],
            [120.0, 25.0],
            [135.0, 25.0],
            [135.0, 5.0],
            [115.0, 5.0],
          ],
        ],
      },
    };

    const parLayer = L.geoJSON(parGeoJSON, {
      style: { color: "#ef4444", weight: 2, fillOpacity: 0 },
    }).addTo(map);

    // Storm Tracking
    const stormLayer = L.layerGroup().addTo(map);
    let stormMarkers = {};
    let currentSessionId = 0;

    const to10MinWindKmH = (wind1MinKnots) => {
      const tenMinKmh = (wind1MinKnots || 0) * 1.852;
      return Math.round(tenMinKmh / 5) * 5;
    };

    const toGustKmH = (tenMinWindKmh) => {
      const gust = (tenMinWindKmh || 0) * 1.4;
      return Math.round(gust / 5) * 5;
    };

    function getStormCategory(winds10MinKph) {
      if (winds10MinKph < 39) {
        return {
          category: "LOW PRESSURE AREA (LPA)",
          color: "#9ab3c5",
          abbrev: "LPA",
        };
      } else if (winds10MinKph <= 61) {
        return {
          category: "TROPICAL DEPRESSION (TD)",
          color: "#7cb5ec",
          abbrev: "TD",
        };
      } else if (winds10MinKph <= 88) {
        return {
          category: "TROPICAL STORM (TS)",
          color: "#90ed7d",
          abbrev: "TS",
        };
      } else if (winds10MinKph <= 117) {
        return {
          category: "SEVERE TROPICAL STORM (STS)",
          color: "#f7a35c",
          abbrev: "STS",
        };
      } else if (winds10MinKph <= 184) {
        return { category: "TYPHOON (TY)", color: "#f45b5b", abbrev: "TY" };
      } else {
        return {
          category: "SUPER TYPHOON (STY)",
          color: "#aa0000",
          abbrev: "STY",
        };
      }
    }

    function getCardinalDirection(deg) {
      const directions = [
        "N",
        "NNE",
        "NE",
        "ENE",
        "E",
        "ESE",
        "SE",
        "SSE",
        "S",
        "SSW",
        "SW",
        "WSW",
        "W",
        "WNW",
        "NW",
        "NNW",
      ];
      const index = Math.floor((deg + 11.25) / 22.5) % 16;
      return directions[index];
    }

    function getIconHtml(abbrev) {
      switch (abbrev) {
        case 'LPA':
          return `
            <div class="relative w-full h-full flex items-center justify-center">
              <div class="absolute w-[80%] h-[80%] bg-slate-900/90 border border-slate-700/50 rounded-full shadow-[0_0_10px_rgba(0,0,0,0.5)]"></div>
              <div class="absolute inset-0 rounded-full" style="background: radial-gradient(circle, rgba(100,116,139,0.4) 0%, transparent 70%);"></div>
              <div class="absolute w-[80%] h-[80%] border-2 border-slate-400 border-y-transparent rounded-full" style="animation: cy-cw 8s linear infinite;"></div>
              <div class="absolute w-[50%] h-[50%] rounded-full border border-dashed border-slate-300" style="animation: cy-ccw 10s linear infinite;"></div>
              <div class="absolute z-10 text-[0.65rem] font-black text-slate-100">L</div>
            </div>`;
        case 'TD':
          return `
            <div class="relative w-full h-full flex items-center justify-center">
              <div class="absolute w-[85%] h-[85%] bg-slate-900/90 border border-slate-700/50 rounded-full shadow-[0_0_10px_rgba(0,0,0,0.5)]"></div>
              <div class="absolute inset-0 rounded-full" style="background: radial-gradient(circle, rgba(59,130,246,0.4) 0%, transparent 70%);"></div>
              <div class="absolute w-[85%] h-[85%] border-2 border-blue-400/80 border-y-transparent rounded-full" style="animation: cy-cw 5s linear infinite;"></div>
              <div class="absolute w-[55%] h-[55%] border-[1.5px] border-blue-300 border-x-transparent rounded-full" style="animation: cy-ccw 3s linear infinite;"></div>
              <div class="absolute z-10 text-[0.65rem] font-black text-blue-100 drop-shadow-[0_0_5px_rgba(96,165,250,0.8)]">TD</div>
            </div>`;
        case 'TS':
          return `
            <div class="relative w-full h-full flex items-center justify-center">
              <div class="absolute w-[85%] h-[85%] bg-slate-900/90 border border-slate-700/50 rounded-full shadow-[0_0_10px_rgba(0,0,0,0.5)]"></div>
              <div class="absolute inset-0 rounded-full" style="background: radial-gradient(circle, rgba(16,185,129,0.4) 0%, transparent 70%);"></div>
              <div class="absolute w-[85%] h-[85%] border-[3px] border-emerald-400/80 border-r-transparent border-l-transparent rounded-full" style="animation: cy-cw 3s linear infinite;"></div>
              <div class="absolute w-[60%] h-[60%] border-2 border-emerald-300 border-t-transparent border-b-transparent rounded-full" style="animation: cy-ccw 2s linear infinite;"></div>
              <div class="absolute z-10 text-[0.65rem] font-black text-emerald-100 drop-shadow-[0_0_5px_rgba(52,211,153,0.8)]">TS</div>
            </div>`;
        case 'STS':
          return `
            <div class="relative w-full h-full flex items-center justify-center">
              <div class="absolute w-[90%] h-[90%] bg-slate-900/90 border border-slate-700/50 rounded-full shadow-[0_0_10px_rgba(0,0,0,0.5)]"></div>
              <div class="absolute inset-0 rounded-full" style="background: radial-gradient(circle, rgba(245,158,11,0.4) 0%, transparent 70%);"></div>
              <div class="absolute w-[90%] h-[90%] border-[4px] border-amber-400/90 border-y-transparent rounded-full" style="animation: cy-cw 1.5s linear infinite;"></div>
              <div class="absolute w-[65%] h-[65%] border-[3px] border-amber-300 border-x-transparent rounded-full" style="animation: cy-ccw 1s linear infinite;"></div>
              <div class="absolute z-10 text-[0.55rem] font-black text-amber-100 drop-shadow-[0_0_8px_rgba(251,191,36,0.8)]">STS</div>
            </div>`;
        case 'TY':
          return `
            <div class="relative w-full h-full flex items-center justify-center">
              <div class="absolute w-[90%] h-[90%] bg-slate-900/90 border border-slate-700/50 rounded-full shadow-[0_0_10px_rgba(0,0,0,0.5)]"></div>
              <div class="absolute inset-0 rounded-full animate-pulse" style="background: radial-gradient(circle, rgba(249,115,22,0.5) 0%, transparent 70%);"></div>
              <div class="absolute w-[90%] h-[90%] border-[4px] border-orange-500/90 border-t-transparent border-b-transparent rounded-full" style="animation: cy-cw 0.8s linear infinite;"></div>
              <div class="absolute w-[65%] h-[65%] border-[3px] border-orange-400 border-r-transparent border-l-transparent rounded-full" style="animation: cy-ccw 0.5s linear infinite;"></div>
              <div class="absolute z-10 text-[0.65rem] font-black text-orange-100 drop-shadow-[0_0_10px_rgba(251,146,60,1)]">TY</div>
            </div>`;
        case 'STY':
          return `
            <div class="relative w-full h-full flex items-center justify-center">
              <div class="absolute w-[95%] h-[95%] bg-slate-900/90 border border-slate-700/50 rounded-full shadow-[0_0_10px_rgba(0,0,0,0.5)]"></div>
              <div class="absolute inset-0 rounded-full animate-pulse" style="background: radial-gradient(circle, rgba(217,70,239,0.6) 0%, transparent 70%);"></div>
              <div class="absolute w-[110%] h-[110%] border border-fuchsia-500 rounded-full opacity-30" style="animation: cy-ping 1.5s ease-out infinite;"></div>
              <div class="absolute w-[95%] h-[95%] border-[5px] border-fuchsia-500 border-t-transparent border-b-transparent rounded-full" style="animation: cy-cw 0.4s linear infinite;"></div>
              <div class="absolute w-[70%] h-[70%] border-[4px] border-fuchsia-400 border-r-transparent border-l-transparent rounded-full" style="animation: cy-ccw 0.25s linear infinite;"></div>
              <div class="absolute z-10 text-[0.55rem] font-black text-white drop-shadow-[0_0_15px_rgba(255,255,255,1)]">STY</div>
            </div>`;
        default:
          return `<div class="w-full h-full bg-slate-500 rounded-full"></div>`;
      }
    }

    function updateStormPositions(overrideTime) {
      // If animating and this is an automatic interval update (no overrideTime), skip it
      if (!overrideTime && animationTimer) return;

      const now = overrideTime || Date.now();
      for (let id in stormMarkers) {
        const s = stormMarkers[id];
        if (
          !isNaN(s.speed) &&
          s.speed > 0 &&
          !isNaN(s.direction) &&
          s.direction >= 0
        ) {
          const dt_hours = (now - s.baseTime) / (3600 * 1000);
          const distance_nm = s.speed * dt_hours;
          const rad = (s.direction * Math.PI) / 180;
          const delta_lat = (distance_nm * Math.cos(rad)) / 60;
          const delta_lon =
            (distance_nm * Math.sin(rad)) /
            (60 * Math.cos((s.baseLat * Math.PI) / 180));
          const newLat = s.baseLat + delta_lat;
          const newLon = s.baseLon + delta_lon;
          s.marker.setLatLng([newLat, newLon]);

          const popupContent = s.marker
            .getPopup()
            .getContent()
            .replace(
              /id="popup-location-text">[\s\S]*?<\/div>/,
              `id="popup-location-text">${newLat.toFixed(2)}°N,<br class="sm:hidden"/> ${newLon.toFixed(2)}°E</div>`
            );
          s.marker.setPopupContent(popupContent);
        }
      }
    }

    function updateSliderUI() {
      const slider = document.getElementById("radar-slider");
      if (slider) {
        if (displayMode === "precip" || displayMode === "wind") {
          return;
        }
        slider.max = (mapFrames.length > 0 ? mapFrames.length - 1 : 0).toString();
        if (slider.value !== animationPosition.toString()) {
          slider.value = animationPosition.toString();
        }
        if (mapFrames.length > 0) {
          slider.removeAttribute("disabled");
          slider.style.opacity = "1";
        } else {
          slider.setAttribute("disabled", "true");
          slider.style.opacity = "0.5";
        }
      }
    }

    function processStormData(data) {
      const sessionId = ++currentSessionId;
      stormLayer.clearLayers();
      if (historyTrackGroupRef.current) {
        historyTrackGroupRef.current.clearLayers();
      }
      if (forecastTrackGroupRef.current) {
        forecastTrackGroupRef.current.clearLayers();
      }
      stormMarkers = {};

      const sizeMap = {
        LPA: [48, 48],
        TD: [48, 48],
        TS: [48, 48],
        STS: [48, 48],
        TY: [48, 48],
        STY: [48, 48],
      };

      const posMap = {};
      data.forEach((storm) => {
        const parts = storm.interp_sector_file ? storm.interp_sector_file.split(/\s+/) : [];
        const stormName = parts[1] || storm.storm_name || storm.atcf_id || "Tropical Disturbance";
        const dateStr = parts[2] || "";
        const timeStr = parts[3] || "";
        const latitude = !isNaN(parseFloat(parts[4])) ? parseFloat(parts[4]) : storm.latitude;
        const longitude = !isNaN(parseFloat(parts[5])) ? parseFloat(parts[5]) : storm.longitude;
        if (latitude === undefined || longitude === undefined || isNaN(latitude) || isNaN(longitude)) {
          console.error("Invalid coordinates for storm:", storm.atcf_id);
          return;
        }

        if (storm.atcf_id) {
          const sId = storm.atcf_id.toUpperCase();
          posMap[sId] = { lat: latitude, lon: longitude };
          const numMatch = sId.match(/\d+/);
          if (numMatch) {
            posMap[numMatch[0]] = { lat: latitude, lon: longitude };
          }
        }
        if (storm.long_atcf_id) {
          posMap[storm.long_atcf_id.toUpperCase()] = { lat: latitude, lon: longitude };
        }

        const winds1MinKnots = !isNaN(parseFloat(parts[8])) ? parseFloat(parts[8]) : (storm.winds || 0);
        const pressure = !isNaN(parseFloat(parts[9])) ? parseFloat(parts[9]) : (storm.pressure || NaN);
        const speed = !isNaN(parseFloat(parts[10])) ? parseFloat(parts[10]) : (storm.movespeed || 0);
        const direction = !isNaN(parseFloat(parts[11])) ? parseFloat(parts[11]) : (storm.movedir || 0);

        let baseTime;
        if (dateStr && timeStr && dateStr.length >= 8 && timeStr.length >= 4) {
          const year = dateStr.substring(0, 4);
          const month = dateStr.substring(4, 6);
          const day = dateStr.substring(6, 8);
          const hour = timeStr.substring(0, 2);
          const minute = timeStr.substring(2, 4);
          baseTime = new Date(`${year}-${month}-${day}T${hour}:${minute}:00Z`).getTime();
        } else {
          baseTime = storm.analysis_time ? new Date(storm.analysis_time).getTime() : (storm.last_updated ? new Date(storm.last_updated).getTime() : Date.now());
        }

        const winds10MinKph = to10MinWindKmH(winds1MinKnots);
        const categoryInfo = getStormCategory(winds10MinKph);
        const rawName = stormName;
        const insidePar = isInsidePar(latitude, longitude);
        const { displayName } = getStormDisplayName(rawName, categoryInfo.abbrev, insidePar, storm.atcf_id);
        const gustKph = toGustKmH(winds10MinKph);
        const categoryClass = categoryInfo.abbrev.toLowerCase();
        const iconSize = sizeMap[categoryInfo.abbrev] || [32, 32];
        const iconAnchor = [iconSize[0] / 2, iconSize[1] / 2];

        const marker = L.marker([latitude, longitude], {
          icon: L.divIcon({
            className: `storm-marker ${categoryClass}`,
            html: getIconHtml(categoryInfo.abbrev),
            iconSize: iconSize,
            iconAnchor: iconAnchor,
            popupAnchor: [0, -iconSize[1] / 2 - 10],
          }),
        });

        let movementHtml = "";
        if (
          !isNaN(speed) &&
          speed > 0 &&
          !isNaN(direction) &&
          direction >= 0 &&
          direction <= 360
        ) {
          const speedKmh = Math.round(speed * 1.852);
          const directionStr = getCardinalDirection(direction);
          movementHtml = `<p><strong>Movement:</strong> ${directionStr} at ${speedKmh} km/h</p>`;
        }

        marker.bindPopup(
          `
            <div class="relative z-20 w-[250px] sm:w-[340px] bg-slate-900/95 backdrop-blur-md rounded-2xl p-3 sm:p-5 border border-slate-800" style="border-top: 4px solid ${categoryInfo.color};">
                <div class="absolute -top-12 -right-12 w-24 h-24 bg-white/5 rounded-full blur-2xl pointer-events-none"></div>
                
                <div class="flex items-center gap-3 sm:gap-5">
                    <!-- Left Column: Circular HUD Wind Gauge -->
                    <div class="flex-shrink-0 flex flex-col items-center justify-center w-16 h-16 sm:w-24 sm:h-24 rounded-full border-[3px] sm:border-4 relative" style="border-color: ${categoryInfo.color}30; background: ${categoryInfo.color}05;">
                      <div class="absolute inset-0 rounded-full border-[3px] sm:border-4 border-transparent" style="border-top-color: ${categoryInfo.color}; border-right-color: ${categoryInfo.color}; transform: rotate(-45deg);"></div>
                      <span class="text-lg sm:text-3xl font-black text-white leading-none">${winds10MinKph}</span>
                      <span class="text-[7px] sm:text-[10px] text-slate-400 font-bold tracking-wider uppercase mt-0.5 sm:mt-1">km/h</span>
                      <span class="hidden sm:inline text-[6px] sm:text-[7px] text-slate-500 uppercase tracking-widest mt-0.5">Sustained</span>
                    </div>

                    <!-- Right Column: Meteorological Details -->
                    <div class="flex-grow space-y-1 sm:space-y-2 min-w-0">
                        <h3 class="text-sm sm:text-lg font-black text-white tracking-tight leading-tight truncate">${displayName}</h3>

                        <div class="space-y-0.5 sm:space-y-1 text-[9px] sm:text-xs text-slate-300 font-medium">
                            <div class="flex justify-between border-b border-slate-800 pb-0.5">
                                <span class="text-slate-500 flex items-center gap-1.5">
                                    <svg class="w-2.5 h-2.5 text-rose-400" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"></path></svg>
                                    Gusts
                                </span>
                                <span class="font-bold text-slate-200">${gustKph} km/h</span>
                            </div>
                            <div class="flex justify-between border-b border-slate-800 pb-0.5">
                                <span class="text-slate-500 flex items-center gap-1.5">
                                    <svg class="w-2.5 h-2.5 text-emerald-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><path stroke-linecap="round" stroke-linejoin="round" d="M12 7v5l3 3"></path></svg>
                                    Pressure
                                </span>
                                <span class="font-bold text-slate-200">${pressure} hPa</span>
                            </div>
                            <div class="flex justify-between border-b border-slate-800 pb-0.5">
                                <span class="text-slate-500 flex items-center gap-1.5">
                                    <svg class="w-2.5 h-2.5 text-amber-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 2a8 8 0 0 0-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 0 0-8-8zm0 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"></path></svg>
                                    Location
                                </span>
                                <span class="font-bold text-slate-200 font-mono text-[8px] sm:text-[10px]" id="popup-location-text">${latitude.toFixed(2)}°N, ${longitude.toFixed(2)}°E</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-slate-500 flex items-center gap-1.5">
                                    <svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="color: ${categoryInfo.color};"><path stroke-linecap="round" stroke-linejoin="round" d="M9.5 14.5l-5-5 10-10H20v5.5l-10.5 10.5zM16 8h.01"></path></svg>
                                    Category
                                </span>
                                <span class="font-bold text-[8px] sm:text-[10px] text-right ml-auto pl-2" style="color: ${categoryInfo.color};">${categoryInfo.category}</span>
                            </div>
                        </div>
                    </div>
                </div>

                ${movementHtml ? `
                <div class="bg-slate-950/50 rounded-xl p-1.5 border border-slate-800/60 mt-2 flex items-center gap-1.5 text-[9px] sm:text-xs text-slate-300 font-medium hover:border-slate-700/60 transition-colors duration-300">
                  <svg class="w-2.5 h-2.5 text-indigo-400 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon></svg>
                  <span class="truncate">${movementHtml.replace(/<[^>]+>/g, '')}</span>
                </div>` : ''}
                
                <div class="w-full h-[1px] bg-slate-800/80 my-2"></div>
                
                <div class="flex items-center justify-between text-[7px] sm:text-[9px]">
                    <span class="text-slate-500 uppercase tracking-wider font-bold">Last Updated</span>
                    <span class="text-slate-400 font-medium">${new Date(storm.last_updated).toLocaleString()}</span>
                </div>

            </div>
          `,
          { maxWidth: 350, className: "custom-storm-popup" }
        );

        marker.addTo(stormLayer);

        // Fetch and draw historical track line and coordinates from JSON files
        const longId = (storm.long_atcf_id || "").toUpperCase();
        const shortId = (storm.atcf_id || "").toUpperCase();
        const trackId = (longId || shortId).toUpperCase();

        const isStormMatch = (tData) => {
          if (!tData) return false;
          const tcTrackId = (tData.track_id || "").toUpperCase();
          if (tcTrackId === longId || tcTrackId === shortId) return true;

          const num1 = tcTrackId.match(/\d+/)?.[0];
          const num2 = longId.match(/\d+/)?.[0] || shortId.match(/\d+/)?.[0];
          if (num1 && num2 && num1 === num2) return true;

          const lastPt = tData.latest || (tData.history && tData.history[tData.history.length - 1]);
          if (lastPt && typeof lastPt.lat === "number" && typeof lastPt.lon === "number") {
            const dLat = Math.abs(lastPt.lat - latitude);
            const dLon = Math.abs(lastPt.lon - longitude);
            if (dLat < 3.5 && dLon < 3.5) return true;
          }
          return false;
        };

        const loadTrackData = async () => {
          const endpoints = [];
          if (longId) endpoints.push(`/data/tc_positions_${longId}.json`);
          if (shortId && shortId !== longId) endpoints.push(`/data/tc_positions_${shortId}.json`);
          endpoints.push(`/data/tc_positions_latest.json`);

          for (const ep of endpoints) {
            try {
              const res = await fetch(ep);
              if (res.ok) {
                const contentType = res.headers.get("content-type");
                if (!contentType || contentType.includes("application/json")) {
                  const tData = await res.json();
                  if (isStormMatch(tData)) {
                    return tData;
                  }
                }
              }
            } catch (e) { }
          }
          return null;
        };

        loadTrackData()
          .then((trackData) => {
            if (!trackData || sessionId !== currentSessionId) return;
            const historyPoints = trackData.history || [];
            if (historyPoints.length === 0) return;

            // Filter out history point if it overlaps/is too close to current ATCF position to prevent duplicate marker
            const filteredHistory = historyPoints.filter(p => {
              return Math.abs(p.lat - latitude) > 0.05 || Math.abs(p.lon - longitude) > 0.05;
            });

            const latlngs = filteredHistory.map((p) => [p.lat, p.lon]);
            // Append current real-time ATCF coordinate to connect the line seamlessly to current storm marker
            latlngs.push([latitude, longitude]);

            // Draw polyline track
            if (historyTrackGroupRef.current) {
              L.polyline(latlngs, {
                color: "#ffffff", // High-contrast white line for overlay
                weight: 2,
                opacity: 0.65,
                dashArray: "6, 8",
                pane: TRACKS_PANE,
              }).addTo(historyTrackGroupRef.current);
            }

            // Draw category color-coded circles for historical coordinates
            filteredHistory.forEach((point) => {
              const winds10MinKph = to10MinWindKmH(point.wind_kt || (point.wind_kmh / 1.852));
              const categoryInfo = getStormCategory(winds10MinKph);
              const catName = categoryInfo.category;
              const color = categoryInfo.color;
              const abbrev = categoryInfo.abbrev;

              let bgClass = "bg-blue-500";
              let textClass = "text-white";

              if (abbrev === "STY") {
                bgClass = "bg-rose-600";
                textClass = "text-white";
              } else if (abbrev === "STS") {
                bgClass = "bg-orange-500";
                textClass = "text-white";
              } else if (abbrev === "TS") {
                bgClass = "bg-amber-400";
                textClass = "text-slate-950";
              } else if (abbrev === "TD") {
                bgClass = "bg-emerald-500";
                textClass = "text-white";
              } else if (abbrev === "TY") {
                bgClass = "bg-red-500";
                textClass = "text-white";
              }

              if (historyTrackGroupRef.current) {
                const circle = L.marker([point.lat, point.lon], {
                  icon: L.divIcon({
                    className: "history-dot-marker",
                    html: `<div class="w-5.5 h-5.5 rounded-full ${bgClass} border border-slate-900/40 ${textClass} flex items-center justify-center shadow-[0_2px_8px_rgba(0,0,0,0.8)] transition-transform hover:scale-125 duration-200">
                             <span class="text-[7.5px] font-black tracking-tighter uppercase leading-none">${abbrev}</span>
                           </div>`,
                    iconSize: [22, 22],
                    iconAnchor: [11, 11],
                  }),
                  pane: TRACKS_PANE,
                }).addTo(historyTrackGroupRef.current);

                circle.bindTooltip(
                  `<div class="font-sans text-xs bg-slate-950/95 backdrop-blur-md text-slate-200 border border-slate-800 rounded-xl p-3 shadow-[0_10px_25px_rgba(0,0,0,0.5)] leading-snug w-[180px]">
                    <div class="font-black mb-0.5" style="color: ${color};">${catName}</div>
                    <div class="text-[9px] text-slate-500 font-bold mb-1.5">${point.cycle}</div>
                    <div class="space-y-0.5 border-t border-slate-800/80 pt-1.5 text-[10px]">
                      <div class="flex justify-between"><span class="text-slate-500 font-medium">Position:</span><span class="font-bold text-slate-300">${point.lat.toFixed(1)}°N, ${point.lon.toFixed(1)}°E</span></div>
                      <div class="flex justify-between"><span class="text-slate-500 font-medium">Winds:</span><span class="font-bold text-slate-300">${winds10MinKph} km/h</span></div>
                      <div class="flex justify-between"><span class="text-slate-500 font-medium">Pressure:</span><span class="font-bold text-slate-300">${point.pressure_hpa} hPa</span></div>
                    </div>
                  </div>`,
                  {
                    direction: "top",
                    opacity: 0.98,
                    className: "custom-storm-tooltip",
                  }
                );
              }
            });
          })
          .catch((err) => {
            console.error("Error loading track data for storm:", trackId, err);
          });

        stormMarkers[storm.atcf_id] = {
          marker,
          baseLat: latitude,
          baseLon: longitude,
          baseTime: baseTime,
          speed,
          direction,
          categoryInfo,
          winds10MinKph,
          storm,
        };
      });

      if (typeof setAtcfPositions === "function") {
        setAtcfPositions(posMap);
      }

      if (loadingIndicator) {
        loadingIndicator.classList.add("hidden");
      }

      // Initial update
      updateStormPositions();
    }

    function fetchStormData() {
      if (loadingIndicator) {
        loadingIndicator.classList.remove("hidden");
      }
      const stormRequest = new XMLHttpRequest();
      stormRequest.open("GET", "https://api.knackwx.com/atcf/v2", true);
      stormRequest.onload = function () {
        if (this.status >= 200 && this.status < 400) {
          const data = JSON.parse(this.responseText);
          processStormData(data);
        } else {
          console.error(
            "Error fetching storm data from Knack API. Status:",
            this.status,
            this.statusText
          );
        }
        if (loadingIndicator) {
          loadingIndicator.classList.add("hidden");
        }
      };
      stormRequest.onerror = (err) => {
        console.error("Network error while fetching storm data:", err);
        if (loadingIndicator) {
          loadingIndicator.classList.add("hidden");
        }
      };
      stormRequest.send();
    }

    fetchStormData();

    const stormInterval = setInterval(fetchStormData, 600000);
    const positionInterval = setInterval(() => updateStormPositions(), 10000);

    // Create a custom pane for OWM layers to ensure they are always above base maps
    const OWM_PANE = "owmPane";
    if (!map.getPane(OWM_PANE)) {
      map.createPane(OWM_PANE);
      map.getPane(OWM_PANE).style.zIndex = 500; // Above tilePane (200) and overlayPane (400)
    }

    // OWM Layers
    const owmTiles = {
      precip: new L.TileLayer(precipLayer, { opacity: 0.7, pane: OWM_PANE, maxZoom: 18 }),
      pressure: new L.TileLayer(pressureLayer, { opacity: 0.6, pane: OWM_PANE, maxZoom: 18 }),
      wind: new L.TileLayer(windLayer, { opacity: 0.6, pane: OWM_PANE, maxZoom: 18 }),
    };

    const btnPrecip = document.getElementById("btn-precip");
    const btnPressure = document.getElementById("btn-pressure");
    const btnWind = document.getElementById("btn-wind");

    // RainViewer API & Animation
    let apiData = {};
    let mapFrames = [];
    let lastPastFramePosition = -1;
    let latestFrameIndex = -1;
    let radarLayers = {};
    let satOverlayLayer = null; // for Radar + Satellite combined mode
    let optionKind = "satellite"; // dataset driving animation: "radar" or "satellite"
    let displayMode = "satellite"; // UI mode: "radar" | "satellite" | "satellite_ir" | "both" | "precip" | "pressure" | "wind"
    const optionTileSize = 256;
    let optionColorScheme = 2;
    const optionSmoothData = 1;
    const optionSnowColors = 1;
    let optionExtension = "webp";
    let animationPosition = 0;
    let animationTimer = false;
    let loadingTilesCount = 0;
    let loadedTilesCount = 0;

    // --- Zoom Earth helpers ---
    async function fetchServerTime() {
      try {
        const resp = await fetch("https://worldtimeapi.org/api/timezone/Etc/UTC");
        if (resp.ok) {
          const data = await resp.json();
          const parsed = new Date(data.utc_datetime);
          if (!isNaN(parsed.getTime())) return parsed;
        }
      } catch (_) { }
      return new Date(); // fallback to local time
    }

    function parseJMATimestamp(ts) {
      const year = parseInt(ts.slice(0, 4), 10);
      const month = parseInt(ts.slice(4, 6), 10) - 1;
      const day = parseInt(ts.slice(6, 8), 10);
      const hour = parseInt(ts.slice(8, 10), 10);
      const minute = parseInt(ts.slice(10, 12), 10);
      const second = parseInt(ts.slice(12, 14), 10);
      return new Date(Date.UTC(year, month, day, hour, minute, second));
    }

    async function fetchJMATimestamps() {
      try {
        const resp = await fetch("https://www.jma.go.jp/bosai/himawari/data/satimg/targetTimes_fd.json");
        if (!resp.ok) throw new Error("JMA response not ok");
        const list = await resp.json();

        // Take the latest 18 frames (3 hours of history)
        const latest = list.slice(-18);

        return latest.map((item) => {
          const d = parseJMATimestamp(item.basetime);
          return {
            time: Math.floor(d.getTime() / 1000),
            path: item.basetime, // unique cache key
            jmaTime: d,
            isJMA: true,
          };
        });
      } catch (err) {
        console.error("Failed to fetch JMA timestamps:", err);
        // Fallback: generate calculated frames
        const serverTime = await fetchServerTime();
        const frames = [];
        const intervalMinutes = 10;
        const historyHours = 3;
        const lagMinutes = 30;

        let current = new Date(serverTime.getTime());
        const minutes = current.getUTCMinutes();
        current.setUTCMinutes(minutes - (minutes % intervalMinutes), 0, 0);
        current.setUTCMinutes(current.getUTCMinutes() - lagMinutes);

        const totalFrames = (historyHours * 60) / intervalMinutes;
        for (let i = 0; i < totalFrames; i++) {
          const tsStr = current.getUTCFullYear() +
            String(current.getUTCMonth() + 1).padStart(2, "0") +
            String(current.getUTCDate()).padStart(2, "0") +
            String(current.getUTCHours()).padStart(2, "0") +
            String(current.getUTCMinutes()).padStart(2, "0") +
            "00";
          frames.unshift({
            time: Math.floor(current.getTime() / 1000),
            path: tsStr,
            jmaTime: new Date(current.getTime()),
            isJMA: true,
          });
          current.setUTCMinutes(current.getUTCMinutes() - intervalMinutes);
        }
        return frames;
      }
    }

    async function fetchZoomEarthTimestamps() {
      return fetchJMATimestamps();
    }

    async function fetchInfraredTimestamps() {
      return fetchJMATimestamps();
    }

    function startLoadingTile() {
      loadingTilesCount++;
      const currentLoader = document.getElementById("cyclone-loading");
      if (currentLoader) {
        currentLoader.classList.remove("hidden");
      }
    }
    function finishLoadingTile() {
      setTimeout(() => {
        loadedTilesCount++;
        const currentLoader = document.getElementById("cyclone-loading");
        if (currentLoader && loadedTilesCount >= loadingTilesCount) {
          currentLoader.classList.add("hidden");
        }
      }, 250);
    }
    function isTilesLoading() {
      return loadingTilesCount > loadedTilesCount;
    }

    function addLayer(frame) {
      if (!radarLayers[frame.path]) {
        let source;

        if (frame.isJMA) {
          const d = frame.jmaTime || new Date(frame.time * 1000);
          const year = d.getUTCFullYear();
          const month = String(d.getUTCMonth() + 1).padStart(2, "0");
          const day = String(d.getUTCDate()).padStart(2, "0");
          const hour = String(d.getUTCHours()).padStart(2, "0");
          const minute = String(d.getUTCMinutes()).padStart(2, "0");
          const timestamp = `${year}${month}${day}${hour}${minute}00`;

          let product = "B13/TBB"; // default to Infrared
          if (displayMode === "satellite") {
            // For standard satellite, use true color during the day, infrared at night
            const hrUTC = d.getUTCHours();
            const isNight = hrUTC >= 10 && hrUTC < 22;
            if (!isNight) {
              product = "REP/ETC";
            }
          }

          const jmaUrl = `https://www.jma.go.jp/bosai/himawari/data/satimg/${timestamp}/fd/${timestamp}/${product}/{z}/{x}/{y}.jpg`;
          source = new L.TileLayer(jmaUrl, {
            tileSize: 256,
            opacity: 0.01,
            zIndex: frame.time,
            maxNativeZoom: 5,
            maxZoom: 18,
            minZoom: 2,
            noWrap: true,
            errorTileUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
          });
        } else {
          // RainViewer (radar / infrared)
          const colorScheme =
            optionKind === "satellite"
              ? optionColorScheme == 255 ? 255 : 0
              : optionColorScheme;
          const smooth = optionKind === "satellite" ? 0 : optionSmoothData;
          const snow = optionKind === "satellite" ? 0 : optionSnowColors;
          source = new L.TileLayer(
            `${apiData.host}${frame.path}/${optionTileSize}/{z}/{x}/{y}/${colorScheme}/${smooth}_${snow}.${optionExtension}`,
            { tileSize: optionTileSize, opacity: 0.01, zIndex: frame.time }
          );
        }

        source.on("loading", startLoadingTile);
        source.on("load", finishLoadingTile);
        source.on("remove", finishLoadingTile);
        radarLayers[frame.path] = source;
      }
      if (!map.hasLayer(radarLayers[frame.path])) map.addLayer(radarLayers[frame.path]);
    }

    function changeRadarPosition(position, preloadOnly, force) {
      if (!mapFrames.length) return;
      while (position >= mapFrames.length) position -= mapFrames.length;
      while (position < 0) position += mapFrames.length;

      const currentFrame = mapFrames[animationPosition];
      const nextFrame = mapFrames[position];
      addLayer(nextFrame);

      if (preloadOnly || (isTilesLoading() && !force)) return;

      animationPosition = position;

      // "Ground Truth" update: Iterate all map layers to ensure no ghost layers remain visible
      // This bypasses any potential desync in the radarLayers cache
      map.eachLayer((layer) => {
        // Identify animation layers by their high zIndex (timestamp)
        if (
          layer instanceof L.TileLayer &&
          typeof layer.options.zIndex === "number" &&
          layer.options.zIndex > 1000000000
        ) {
          if (layer.options.zIndex === nextFrame.time) {
            layer.setOpacity(1);
            if (layer._container) layer._container.style.display = "block"; // Force display
          } else {
            layer.setOpacity(0);
            if (layer._container) layer._container.style.display = "none"; // Force hide
          }
        }
      });

      // Sync storm markers with the displayed frame time
      updateStormPositions(nextFrame.time * 1000);

      const pastOrForecast =
        nextFrame.time > Date.now() / 1000 ? "FORECAST" : "PAST";
      timestampEl.innerHTML = `${pastOrForecast}: ${new Date(
        nextFrame.time * 1000
      ).toLocaleString()}`;

      updateSliderUI();
    }

    function showFrame(nextPosition, force) {
      const preloadingDirection =
        nextPosition - animationPosition > 0 ? 1 : -1;
      changeRadarPosition(nextPosition, false, force);
      changeRadarPosition(nextPosition + preloadingDirection, true);
    }

    function stop() {
      if (animationTimer) {
        clearTimeout(animationTimer);
        animationTimer = false;
      }
      if (satOverlayLayer) {
        satOverlayLayer.setOpacity(0.6);
      }
      if (btnPlay) btnPlay.textContent = "Play";
      return true;
    }

    function play() {
      if (!mapFrames.length) return;
      if (btnPlay) btnPlay.textContent = "Stop";
      if (satOverlayLayer) {
        // Hide static satellite overlay while animating past frames
        satOverlayLayer.setOpacity(0.0);
      }

      const endIndex =
        latestFrameIndex > 0 && latestFrameIndex <= mapFrames.length - 1
          ? latestFrameIndex
          : mapFrames.length - 1;
      let next = animationPosition + 1;
      if (next > endIndex || next < 0) {
        next = 0;
      }

      // Force frame change so the current frame advances even if tiles are still loading
      showFrame(next, true);
      animationTimer = setTimeout(play, 500);
    }

    function playStop() {
      if (displayMode === "precip" || displayMode === "wind") {
        setIsWeatherNextPlaying(prev => !prev);
        return;
      }
      // If animation is running, stop it; otherwise start playing
      if (animationTimer) {
        stop();
      } else {
        play();
      }
    }

    function clearRadarLayers() {
      // 1. Clear tracked layers
      for (let key in radarLayers) {
        if (map.hasLayer(radarLayers[key])) {
          map.removeLayer(radarLayers[key]);
        }
      }
      radarLayers = {};
      mapFrames = [];
      latestFrameIndex = -1;
      lastPastFramePosition = -1;

      if (satOverlayLayer) {
        if (map.hasLayer(satOverlayLayer)) map.removeLayer(satOverlayLayer);
        satOverlayLayer = null;
      }
      timestampEl.innerHTML = "";

      // 2. Nuclear Option: Scan all map layers and remove any untracked RainViewer/Himawari tiles
      map.eachLayer((layer) => {
        if (layer instanceof L.TileLayer) {
          const url = layer._url || (layer.options && layer.options.url) || "";
          if (url.includes("rainviewer.com") || url.includes("jma.go.jp")) {
            map.removeLayer(layer);
          }
        }
      });

      // 3. Clear OWM layers
      Object.values(owmTiles).forEach(layer => {
        if (map.hasLayer(layer)) map.removeLayer(layer);
      });
    }

    function initialize(api, kind) {
      clearRadarLayers();
      stop();
      animationPosition = 0;
      updateSliderUI();

      radarControls.style.display = "flex";

      // Toggle WeatherNext layers
      setShowWeatherNextPrecip(kind === "precip");
      setShowWeatherNextWind(kind === "wind");
      setIsWeatherNextPlaying(false);
      setWeatherNextHour(6);

      // Check if kind is one of the OWM layers
      if (["precip", "pressure", "wind"].includes(kind)) {
        if (kind === "precip" || kind === "wind") {
          if (btnPlay) btnPlay.style.display = 'flex'; // Play button allowed for WeatherNext
          const currentLoader = document.getElementById("cyclone-loading");
          if (currentLoader) currentLoader.classList.add("hidden");

          // Disable other forecast layers to avoid overlays overlapping
          setShowStrikeProb(false);
          setShowOutlookWeek1(false);
          setShowOutlookWeek2(false);
          return;
        }

        if (btnPlay) btnPlay.style.display = 'none'; // Hide play button for static pressure layer

        // Force hide loading indicator with fresh lookup
        const currentLoader = document.getElementById("cyclone-loading");
        if (currentLoader) currentLoader.classList.add("hidden");

        const layer = owmTiles[kind];
        if (layer) {
          layer.addTo(map);
        }
        return;
      }

      // Ensure loading indicator is reset for RainViewer if needed, though they manage their own events.
      // But we should probably ensure it's hidden if we are just starting fresh.
      // Actually, keep it simple: the rainviewer callbacks (startLoadingTile) will show it if needed.


      // Otherwise logic for RainViewer
      if (btnPlay) btnPlay.style.display = 'block';

      if (!api) return;

      if (kind === "satellite") {
        // Zoom Earth true-color Himawari satellite tiles
        optionKind = "satellite";
        if (btnPlay) btnPlay.style.display = "block";
        if (loadingIndicator) loadingIndicator.classList.remove("hidden");
        fetchZoomEarthTimestamps().then((frames) => {
          if (loadingIndicator) loadingIndicator.classList.remove("hidden");
          mapFrames = frames;
          lastPastFramePosition = frames.length - 1;
          latestFrameIndex = frames.length - 1;
          animationPosition = latestFrameIndex;
          showFrame(animationPosition, true);
          updateSliderUI();
        });
        return; // async – return early, frames will come from promise
      } else if (kind === "satellite_ir") {
        // Meteored Infrared satellite tiles
        optionKind = "satellite";
        if (btnPlay) btnPlay.style.display = "block";
        if (loadingIndicator) loadingIndicator.classList.remove("hidden");
        fetchInfraredTimestamps().then((frames) => {
          if (loadingIndicator) loadingIndicator.classList.remove("hidden");
          mapFrames = frames;
          lastPastFramePosition = frames.length - 1;
          latestFrameIndex = frames.length - 1;
          animationPosition = latestFrameIndex;
          showFrame(animationPosition, true);
          updateSliderUI();
        });
        return;
      } else if (kind === "radar") {
        // Radar only
        optionKind = "radar";
        // Ensure any satellite overlay is removed when switching to radar-only
        if (satOverlayLayer) {
          map.removeLayer(satOverlayLayer);
          satOverlayLayer = null;
        }
        if (api.radar && api.radar.past && api.radar.past.length) {
          mapFrames = api.radar.past;
          if (api.radar.nowcast) mapFrames = mapFrames.concat(api.radar.nowcast);
          lastPastFramePosition = api.radar.past.length - 1;
          latestFrameIndex = mapFrames.length - 1;
          animationPosition = latestFrameIndex;
          showFrame(animationPosition, true);
          updateSliderUI();
        }
      } else if (kind === "both") {
        // Combined: animate radar, overlay latest satellite infrared frame
        optionKind = "radar";
        if (api.radar && api.radar.past && api.radar.past.length) {
          mapFrames = api.radar.past;
          if (api.radar.nowcast) mapFrames = mapFrames.concat(api.radar.nowcast);
          lastPastFramePosition = api.radar.past.length - 1;
          latestFrameIndex = mapFrames.length - 1;
          // When stopped, we will show latestFrameIndex; animation will loop 0..latestFrameIndex-1
          animationPosition = latestFrameIndex;
          showFrame(animationPosition, true);
          updateSliderUI();
        }
        if (api.satellite && api.satellite.infrared && api.satellite.infrared.length) {
          const latestSat = api.satellite.infrared[api.satellite.infrared.length - 1];
          const colorScheme = optionColorScheme == 255 ? 255 : 0;
          const smooth = 0;
          const snow = 0;
          satOverlayLayer = new L.TileLayer(
            `${apiData.host}${latestSat.path}/${optionTileSize}/{z}/{x}/{y}/${colorScheme}/${smooth}_${snow}.${optionExtension}`,
            { tileSize: optionTileSize, opacity: 0.6, zIndex: latestSat.time - 1 }
          );
          satOverlayLayer.addTo(map);
        }
      }
    }

    function updateButtonStates(mode) {
      const activeClasses = ["bg-sky-500", "text-slate-900", "ring", "ring-sky-400", "ring-offset-1"];
      const inactiveClasses = ["bg-slate-700/80", "text-slate-100", "ring-0", "ring-transparent", "ring-offset-0"];

      function setActive(btn, active) {
        if (!btn) return;
        btn.classList.remove(...active ? inactiveClasses : activeClasses);
        btn.classList.add(...(active ? activeClasses : inactiveClasses));
      }

      setActive(btnRadar, mode === "radar");
      setActive(btnSatellite, mode === "satellite");
      setActive(btnBoth, mode === "both");
      setActive(btnPrecip, mode === "precip");
      setActive(btnPressure, mode === "pressure");
      setActive(btnWind, mode === "wind");

      const btnIR = document.getElementById("btn-infrared");
      setActive(btnIR, mode === "satellite_ir");

    }

    function setKind(kind) {
      displayMode = kind;
      setActiveWeatherLayer(kind);
      updateButtonStates(displayMode);

      // Clear loading state when switching modes (fresh lookup)
      const currentLoader = document.getElementById("cyclone-loading");
      if (currentLoader) currentLoader.classList.add("hidden");

      loadingTilesCount = 0;
      loadedTilesCount = 0;

      initialize(apiData, kind);
    }

    // Fetch RainViewer API data (only needed for Radar / Both modes)
    const apiRequest = new XMLHttpRequest();
    apiRequest.open("GET", "https://api.rainviewer.com/public/weather-maps.json", true);
    apiRequest.onload = () => {
      apiData = JSON.parse(apiRequest.response);
      // Only call setKind if we're not already in satellite mode
      // (satellite mode is self-contained via Zoom Earth/Meteored)
      if (displayMode !== "satellite" && displayMode !== "satellite_ir") {
        setKind(displayMode);
      }
    };
    apiRequest.send();

    // Start satellite immediately; RainViewer data loads in background
    setKind(displayMode);

    // Auto-refresh Zoom Earth satellite frames every 10 minutes.
    // This picks up newly published Himawari frames and updates the timestamp display.
    setInterval(async () => {
      if (displayMode !== "satellite" && displayMode !== "satellite_ir") return; // only refresh in satellite/IR mode
      if (animationTimer) return;              // don't interrupt a playing animation

      const freshFrames = displayMode === "satellite_ir" ? await fetchInfraredTimestamps() : await fetchZoomEarthTimestamps();
      if (!freshFrames.length) return;

      // Check if there's actually a new frame available
      const latestNew = freshFrames[freshFrames.length - 1].time;
      const latestOld = mapFrames.length ? mapFrames[mapFrames.length - 1].time : 0;
      if (latestNew <= latestOld) return; // no new data yet

      // Remove tile layers for frames that are no longer in the new list
      // to avoid stale cached tiles consuming memory
      const freshPaths = new Set(freshFrames.map(f => f.path));
      for (const key in radarLayers) {
        if (!freshPaths.has(key)) {
          if (map.hasLayer(radarLayers[key])) map.removeLayer(radarLayers[key]);
          delete radarLayers[key];
        }
      }

      // Update frame list and jump to the newest frame (also updates timestamp)
      mapFrames = freshFrames;
      lastPastFramePosition = freshFrames.length - 1;
      latestFrameIndex = freshFrames.length - 1;
      animationPosition = latestFrameIndex;
      showFrame(animationPosition, true);
      updateSliderUI();
    }, 600000); // every 10 minutes

    // Also refresh immediately when the user comes back to this browser tab.
    // Chrome throttles setInterval for background tabs, so this ensures the
    // satellite tiles and timestamp are always up-to-date when the tab is focused.
    async function refreshSatelliteIfStale() {
      if (displayMode !== "satellite" && displayMode !== "satellite_ir") return;
      if (animationTimer) return;

      const freshFrames = displayMode === "satellite_ir" ? await fetchInfraredTimestamps() : await fetchZoomEarthTimestamps();
      if (!freshFrames.length) return;

      const latestNew = freshFrames[freshFrames.length - 1].time;
      const latestOld = mapFrames.length ? mapFrames[mapFrames.length - 1].time : 0;
      if (latestNew <= latestOld) return;

      const freshPaths = new Set(freshFrames.map(f => f.path));
      for (const key in radarLayers) {
        if (!freshPaths.has(key)) {
          if (map.hasLayer(radarLayers[key])) map.removeLayer(radarLayers[key]);
          delete radarLayers[key];
        }
      }

      mapFrames = freshFrames;
      lastPastFramePosition = freshFrames.length - 1;
      latestFrameIndex = freshFrames.length - 1;
      animationPosition = latestFrameIndex;
      showFrame(animationPosition, true);
      updateSliderUI();
    }

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        refreshSatelliteIfStale();
      }
    });

    document.onkeydown = (e) => {
      e = e || window.event;
      switch (e.which || e.keyCode) {
        case 37:
          stop();
          showFrame(animationPosition - 1, true);
          break;
        case 39:
          stop();
          showFrame(animationPosition + 1, true);
          break;
        default:
          return;
      }
      e.preventDefault();
      return false;
    };

    if (btnRadar) {
      btnRadar.addEventListener("click", () => setKind("radar"));
    }
    if (btnSatellite) {
      btnSatellite.addEventListener("click", () => setKind("satellite"));
    }
    if (btnBoth) {
      btnBoth.addEventListener("click", () => setKind("both"));
    }
    if (btnPrecip) {
      btnPrecip.addEventListener("click", () => setKind("precip"));
    }
    if (btnPressure) {
      btnPressure.addEventListener("click", () => setKind("pressure"));
    }
    if (btnWind) {
      btnWind.addEventListener("click", () => setKind("wind"));
    }
    const btnInfrared = document.getElementById("btn-infrared");
    if (btnInfrared) {
      btnInfrared.addEventListener("click", () => setKind("satellite_ir"));
    }

    if (btnPlay) {
      btnPlay.addEventListener("click", () => playStop());
    }

    const slider = document.getElementById("radar-slider");
    const onSliderInput = (e) => {
      stop();
      const pos = parseInt(e.target.value, 10);
      if (displayMode === "precip" || displayMode === "wind") {
        setIsWeatherNextPlaying(false);
        setWeatherNextHour(pos);
        return;
      }
      showFrame(pos, true);
    };
    if (slider) {
      slider.addEventListener("input", onSliderInput);
      slider.addEventListener("change", onSliderInput);
    }

    const sliderDock = document.querySelector(".timeline-dock");
    const blockDrag = (e) => {
      e.stopPropagation();
    };
    if (sliderDock) {
      L.DomEvent.disableClickPropagation(sliderDock);
      L.DomEvent.disableScrollPropagation(sliderDock);
      sliderDock.addEventListener("mousedown", blockDrag);
      sliderDock.addEventListener("touchstart", blockDrag, { passive: true });
      sliderDock.addEventListener("pointerdown", blockDrag);
    }

    return () => {
      clearInterval(stormInterval);
      clearInterval(positionInterval);
      document.onkeydown = null;
      map.removeLayer(stormLayer);
      map.removeLayer(parLayer);
      if (historyTrackGroupRef.current) {
        map.removeLayer(historyTrackGroupRef.current);
      }
      if (forecastTrackGroupRef.current) {
        map.removeLayer(forecastTrackGroupRef.current);
      }
      clearRadarLayers();
      if (slider) {
        slider.removeEventListener("input", onSliderInput);
        slider.removeEventListener("change", onSliderInput);
      }
      if (sliderDock) {
        sliderDock.removeEventListener("mousedown", blockDrag);
        sliderDock.removeEventListener("touchstart", blockDrag);
        sliderDock.removeEventListener("pointerdown", blockDrag);
      }
      if (btnRadar) btnRadar.replaceWith(btnRadar.cloneNode(true));
      if (btnSatellite) btnSatellite.replaceWith(btnSatellite.cloneNode(true));
      if (btnBoth) btnBoth.replaceWith(btnBoth.cloneNode(true));
      if (btnPrecip) btnPrecip.replaceWith(btnPrecip.cloneNode(true));
      if (btnPressure) btnPressure.replaceWith(btnPressure.cloneNode(true));
      if (btnWind) btnWind.replaceWith(btnWind.cloneNode(true));
      const btnIRCleanup = document.getElementById("btn-infrared");
      if (btnIRCleanup) btnIRCleanup.replaceWith(btnIRCleanup.cloneNode(true));

      if (btnPlay) btnPlay.replaceWith(btnPlay.cloneNode(true));
    };
  }, [map]);

  return null;
};

// Leaflet control for toggling fullscreen, shown alongside zoom/layer controls.
const FullscreenControl = ({ isFullscreen, onToggle }) => {
  const map = useMap();

  useEffect(() => {
    const FullscreenButton = L.Control.extend({
      onAdd() {
        const container = L.DomUtil.create(
          "div",
          "leaflet-bar leaflet-control leaflet-control-fullscreen"
        );
        const link = L.DomUtil.create("a", "", container);
        link.href = "#";
        link.title = "Toggle fullscreen";
        link.innerHTML = isFullscreen ? "⤢" : "⤢";

        L.DomEvent.on(link, "click", (e) => {
          L.DomEvent.preventDefault(e);
          onToggle();
        });

        return container;
      },
    });

    const control = new FullscreenButton({ position: "topleft" });
    control.addTo(map);

    return () => {
      control.remove();
    };
  }, [map, onToggle, isFullscreen]);

  return null;
};

// Map overlay layer for Ensemble Forecast
const EnsembleLayerLogic = ({ ensembleTracks, pairedTracks, atcfPositions }) => {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    if (!ensembleTracks && !pairedTracks) return;

    const layerGroup = L.layerGroup().addTo(map);

    const TRACKS_PANE = "tracksPane";
    if (!map.getPane(TRACKS_PANE)) {
      map.createPane(TRACKS_PANE);
      map.getPane(TRACKS_PANE).style.zIndex = 590;
    }

    const to10MinWindKmH = (kt) => {
      return kt * 1.852;
    };

    const windColor = (w) => {
      if (w < 39) return "#3498DB";
      if (w < 62) return "#2ECC71";
      if (w < 89) return "#F1C40F";
      if (w < 118) return "#E67E22";
      if (w < 185) return "#A83232";
      return "#FF007F";
    };

    const getStormCategory = (windKmh) => {
      if (windKmh < 39) return { category: "Low Pressure Area", color: "#3498DB" };
      if (windKmh < 62) return { category: "Tropical Depression", color: "#2ECC71" };
      if (windKmh < 89) return { category: "Tropical Storm", color: "#F1C40F" };
      if (windKmh < 118) return { category: "Severe Tropical Storm", color: "#E67E22" };
      if (windKmh < 185) return { category: "Typhoon", color: "#A83232" };
      return { category: "Super Typhoon", color: "#FF007F" };
    };

    const findAtcfPos = (trackId, points) => {
      if (!atcfPositions) return null;
      if (trackId) {
        const tidUpper = trackId.toUpperCase();
        if (atcfPositions[tidUpper]) return atcfPositions[tidUpper];

        const keys = Object.keys(atcfPositions);
        let matchKey = keys.find(
          (k) => k === tidUpper || k.includes(tidUpper) || tidUpper.includes(k)
        );
        if (matchKey) return atcfPositions[matchKey];

        const numMatch = tidUpper.match(/(\d{2})W?/);
        if (numMatch) {
          const num = numMatch[1];
          matchKey = keys.find((k) => {
            const kNum = k.match(/(\d{2})/)?.[1];
            return kNum === num;
          });
          if (matchKey) return atcfPositions[matchKey];
        }
      }

      // Spatial proximity match for nearby active storm (< 10.0 deg)
      if (points && points.length > 0) {
        const startPt = points[0];
        const keys = Object.keys(atcfPositions);
        let closestPos = null;
        let minDist = 10.0; // max 10.0 deg (~1000km)
        keys.forEach((k) => {
          const pos = atcfPositions[k];
          if (pos && typeof pos.lat === "number" && typeof pos.lon === "number") {
            const dLat = Math.abs(pos.lat - startPt.lat);
            const dLon = Math.abs(pos.lon - startPt.lon);
            const dist = Math.sqrt(dLat * dLat + dLon * dLon);
            if (dist < minDist) {
              minDist = dist;
              closestPos = pos;
            }
          }
        });
        if (closestPos) return closestPos;
      }

      return null;
    };

    // 1. Render all ensemble tracks (spaghetti tracks)
    if (ensembleTracks && ensembleTracks.length > 0) {
      ensembleTracks.forEach((t) => {
        const atcfPos = findAtcfPos(t.trackId, t.points);
        let sortedPoints = [...t.points]
          .filter((p) => Math.abs(p.leadH - 6) > 0.01)
          .sort((a, b) => a.leadH - b.leadH);

        const startPt = sortedPoints[0];
        const isAtcfClose = atcfPos && startPt &&
          Math.abs(atcfPos.lat - startPt.lat) < 2.5 &&
          Math.abs(atcfPos.lon - startPt.lon) < 2.5;

        if (isAtcfClose) {
          sortedPoints = sortedPoints.filter(
            (p) => p.leadH !== 0 && (Math.abs(p.lat - atcfPos.lat) > 0.05 || Math.abs(p.lon - atcfPos.lon) > 0.05)
          );
        }

        const latLngs = [];
        if (isAtcfClose) {
          latLngs.push([atcfPos.lat, atcfPos.lon]);
        }
        sortedPoints.forEach((p) => latLngs.push([p.lat, p.lon]));

        for (let i = 0; i < latLngs.length - 1; i++) {
          const p1 = latLngs[i];
          const p2 = latLngs[i + 1];

          // Skip drawing segment if distance between consecutive points is abnormally large (> 4 degrees)
          const dLat = Math.abs(p1[0] - p2[0]);
          const dLon = Math.abs(p1[1] - p2[1]);
          if (dLat > 4.0 || dLon > 4.0) continue;

          const refPt = sortedPoints[Math.min(i, sortedPoints.length - 1)] || { windKt: 0 };
          const windKmh = to10MinWindKmH(refPt.windKt);
          const ptColor = windColor(windKmh);
          L.polyline([p1, p2], {
            color: ptColor,
            weight: 1.0,
            opacity: 1.22,
            lineJoin: "round",
            pane: TRACKS_PANE,
          }).addTo(layerGroup);
        }
      });
    }

    // 2. Render all paired tracks (deterministic base/control runs)
    if (pairedTracks && pairedTracks.length > 0) {
      const NHC_RADII_KM = {
        0: 0.1,
        12: 48,
        24: 74,
        36: 102,
        48: 130,
        72: 195,
        96: 278,
        120: 361,
      };

      const getNhcRadius = (h) => {
        const keys = Object.keys(NHC_RADII_KM).map(Number).sort((a, b) => a - b);
        if (h <= 0) return 0.1;
        if (h >= 120) {
          const rate = (NHC_RADII_KM[120] - NHC_RADII_KM[96]) / 24;
          return NHC_RADII_KM[120] + (h - 120) * rate;
        }
        for (let i = 0; i < keys.length - 1; i++) {
          const h1 = keys[i];
          const h2 = keys[i + 1];
          if (h >= h1 && h <= h2) {
            const fraction = (h - h1) / (h2 - h1);
            return NHC_RADII_KM[h1] + fraction * (NHC_RADII_KM[h2] - NHC_RADII_KM[h1]);
          }
        }
        return 0.1;
      };

      pairedTracks.forEach((t) => {
        const atcfPos = findAtcfPos(t.trackId, t.points);
        let sortedPoints = [...t.points]
          .filter((p) => !isNaN(p.lat) && !isNaN(p.lon))
          .sort((a, b) => a.leadH - b.leadH);

        const startPt = t.points.find((p) => p.leadH === 0) || sortedPoints[0];
        const isAtcfClose = atcfPos && startPt &&
          Math.abs(atcfPos.lat - startPt.lat) < 10.0 &&
          Math.abs(atcfPos.lon - startPt.lon) < 10.0;

        if (isAtcfClose) {
          sortedPoints = sortedPoints.filter(
            (p) => (Math.abs(p.lat - atcfPos.lat) > 0.05 || Math.abs(p.lon - atcfPos.lon) > 0.05)
          );
        }
        if (sortedPoints.length === 0 && !isAtcfClose) return;

        const latLngs = [];
        if (isAtcfClose) {
          latLngs.push([atcfPos.lat, atcfPos.lon]);
        }
        sortedPoints.forEach((p) => latLngs.push([p.lat, p.lon]));

        // Draw cone polygon starting directly at atcfPos
        const coneCircles = [];
        if (isAtcfClose) {
          coneCircles.push(turf.circle([atcfPos.lon, atcfPos.lat], 0.1, { steps: 36, units: "kilometers" }));
        }
        sortedPoints.forEach((p) => {
          const R_km = getNhcRadius(p.leadH);
          coneCircles.push(turf.circle([p.lon, p.lat], R_km, { steps: 36, units: "kilometers" }));
        });

        let coneGeom = null;
        if (coneCircles.length > 0) {
          const capsules = [];
          if (coneCircles.length === 1) {
            capsules.push(coneCircles[0]);
          } else {
            for (let i = 0; i < coneCircles.length - 1; i++) {
              const fc = turf.featureCollection([coneCircles[i], coneCircles[i + 1]]);
              const capsule = turf.convex(fc);
              if (capsule) capsules.push(capsule);
            }
          }
          try {
            coneGeom = turf.union(turf.featureCollection(capsules));
          } catch (e) {
            try {
              coneGeom = capsules.reduce((acc, curr) => turf.union(acc, curr));
            } catch (e2) {
              console.warn("Turf union failed in EnsembleLayerLogic", e2);
            }
          }
        }

        if (coneGeom) {
          L.geoJSON(coneGeom, {
            style: {
              color: "#38bdf8",
              weight: 2.0,
              dashArray: "6, 6",
              fillColor: "#0284c7",
              fillOpacity: 0.35,
              lineCap: "round",
              lineJoin: "round",
              pane: TRACKS_PANE,
            },
          }).addTo(layerGroup);
        }

        // Draw solid polyline backdrop
        L.polyline(latLngs, {
          color: "#000000",
          weight: 4.0,
          opacity: 0.8,
          lineJoin: "round",
          pane: TRACKS_PANE,
        }).addTo(layerGroup);

        // Draw colored segment-by-segment line on top
        for (let i = 0; i < latLngs.length - 1; i++) {
          const p1 = latLngs[i];
          const p2 = latLngs[i + 1];

          // Skip drawing segment if distance between consecutive points is abnormally large (> 4 degrees)
          const dLat = Math.abs(p1[0] - p2[0]);
          const dLon = Math.abs(p1[1] - p2[1]);
          if (dLat > 4.0 || dLon > 4.0) continue;

          const refPt = sortedPoints[Math.min(i, sortedPoints.length - 1)] || { windKt: 0 };
          const windKmh = to10MinWindKmH(refPt.windKt);
          const ptColor = windColor(windKmh);
          L.polyline([p1, p2], {
            color: ptColor,
            weight: 2.2,
            opacity: 0.98,
            lineJoin: "round",
            pane: TRACKS_PANE,
          }).addTo(layerGroup);
        }

        // Draw step dot markers
        sortedPoints.forEach((p) => {
          const windKmh = to10MinWindKmH(p.windKt);
          const categoryInfo = getStormCategory(windKmh);

          const marker = L.circleMarker([p.lat, p.lon], {
            radius: 4.5,
            color: "#ffffff",
            weight: 1,
            fillColor: categoryInfo.color,
            fillOpacity: 1,
            pane: TRACKS_PANE,
          }).addTo(layerGroup);

          marker.bindTooltip(
            `<div class="font-sans text-xs bg-slate-950/95 backdrop-blur-md text-slate-200 border border-slate-800 rounded-xl p-3 shadow-[0_10px_25px_rgba(0,0,0,0.5)] leading-snug w-[230px]">
              <div class="font-black mb-0.5" style="color: ${categoryInfo.color};">${categoryInfo.category} (Forecast)</div>
              <div class="text-[9px] text-slate-500 font-bold mb-1.5">${t.trackId} T+${p.leadH}h</div>
              <div class="space-y-0.5 border-t border-slate-800/80 pt-1.5 text-[10px]">
                <div class="flex justify-between"><span class="text-slate-500 font-medium">Position:</span><span class="font-bold text-slate-300">${p.lat.toFixed(1)}°N, ${p.lon.toFixed(1)}°E</span></div>
                <div class="flex justify-between"><span class="text-slate-500 font-medium">Winds:</span><span class="font-bold text-slate-300">${Math.round(windKmh)} km/h</span></div>
                <div class="flex justify-between"><span class="text-slate-500 font-medium">Pressure:</span><span class="font-bold text-slate-300">${Math.round(p.pressure)} hPa</span></div>
              </div>
            </div>`,
            { direction: "right", offset: [5, 0], opacity: 0.98, className: "custom-storm-tooltip" }
          );
        });
      });
    }

    return () => {
      layerGroup.remove();
    };
  }, [map, ensembleTracks, pairedTracks, atcfPositions]);

  return null;
};

// Map overlay layer for Tropical Weather Outlook (Week 1 & 2)
const OutlookLayerLogic = ({ data, onSelectArea, week }) => {
  const map = useMap();
  useEffect(() => {
    if (!map || !data) return;

    const layerGroup = L.layerGroup().addTo(map);

    // Active TCs in Outlook
    if (data.active_tcs && data.active_tcs.length > 0) {
      data.active_tcs.forEach(tc => {
        if (tc.polygons && tc.polygons.length > 0) {
          tc.polygons.forEach(coords => {
            const poly = L.polygon(coords, {
              color: tc.color,
              weight: 2.5,
              opacity: 0.8,
              fillColor: tc.color,
              fillOpacity: 0.25,
            });

            poly.on('mouseover', () => {
              poly.setStyle({
                fillOpacity: 0.4,
                weight: 3.5
              });
            });

            poly.on('mouseout', () => {
              poly.setStyle({
                fillOpacity: 0.25,
                weight: 2.5
              });
            });

            poly.on('click', (e) => {
              L.DomEvent.stopPropagation(e);
              onSelectArea({
                id: tc.track_id,
                isTC: true,
                week: week,
                color: tc.color,
                label: tc.label || "Active Tropical Cyclone Area",
                summary: `Active WNC ensemble track ID ${tc.track_id} centered at ${tc.center[0].toFixed(2)}°N, ${tc.center[1].toFixed(2)}°E.`,
                initialization: data.initialization
              });
            });

            poly.addTo(layerGroup);
          });
        }
      });
    }

    // Development Areas
    if (data.areas && data.areas.length > 0) {
      data.areas.forEach(area => {
        if (area.polygons && area.polygons.length > 0) {
          area.polygons.forEach(coords => {
            const poly = L.polygon(coords, {
              color: area.color,
              weight: 2,
              opacity: 0.8,
              fillColor: area.color,
              fillOpacity: 0.3,
              dashArray: '5, 5'
            });

            poly.on('mouseover', () => {
              poly.setStyle({
                fillOpacity: 0.45,
                weight: 3,
                dashArray: ''
              });
            });

            poly.on('mouseout', () => {
              poly.setStyle({
                fillOpacity: 0.3,
                weight: 2,
                dashArray: '5, 5'
              });
            });

            poly.on('click', (e) => {
              L.DomEvent.stopPropagation(e);
              onSelectArea({
                id: area.id,
                week: week,
                probability_2day: area.probability_2day,
                probability_7day: area.probability_7day,
                category_2day: area.category_2day,
                category_7day: area.category_7day,
                color: area.color,
                stage: area.stage,
                summary: area.summary,
                initialization: data.initialization
              });
            });

            poly.addTo(layerGroup);
          });
        }
      });
    }

    return () => {
      layerGroup.remove();
    };
  }, [map, data, onSelectArea, week]);

  return null;
};

// Map overlay layer for Strike Probability
const StrikeProbabilityLayerLogic = ({ variable, day, onLoadMeta }) => {
  const map = useMap();
  const layerGroupRef = useRef(null);

  useEffect(() => {
    fetch('/data/strike_prob/meta.json')
      .then(res => res.json())
      .then(onLoadMeta)
      .catch(() => { });
  }, [onLoadMeta]);

  useEffect(() => {
    if (!map || !variable || !day) return;

    if (!layerGroupRef.current) {
      layerGroupRef.current = L.layerGroup().addTo(map);
    }
    const layerGroup = layerGroupRef.current;
    layerGroup.clearLayers();

    const getColor = (val) => {
      if (val < 0.05) return null;
      if (val < 0.10) return "#1d4ed8"; // Royal Blue instead of slate gray
      if (val < 0.20) return "#38bdf8";
      if (val < 0.30) return "#34d399";
      if (val < 0.50) return "#facc15";
      if (val < 0.70) return "#f97316";
      return "#dc2626";
    };
    const getFillOpacity = (val) => {
      if (val < 0.10) return 0.40; // Increased opacity to make it more visible
      return 0.60;
    };

    const THRESHOLD_COLORS = {
      "0.3": { color: "#facc15", label: "30%" },
      "0.5": { color: "#f97316", label: "50%" },
      "0.7": { color: "#dc2626", label: "70%" },
    };

    const url = `/data/strike_prob/${variable}_day${day}.json`;
    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error("Not found");
        return res.json();
      })
      .then(geojsonData => {
        if (geojsonData.features && geojsonData.features.length > 0) {
          L.geoJSON(geojsonData, {
            style: (feature) => {
              const title = feature.properties.title || "";
              const lower = parseFloat(title.split("-")[0].trim());
              const fillCol = getColor(isNaN(lower) ? 0 : lower);
              if (!fillCol) return { fillOpacity: 0, weight: 0, opacity: 0 };

              return {
                fillColor: fillCol,
                fillOpacity: getFillOpacity(isNaN(lower) ? 0 : lower),
                color: "rgba(0,0,0,0.08)",
                weight: 0.3,
                opacity: 1.0
              };
            },
            onEachFeature: (feature, layer) => {
              const title = feature.properties.title || "";
              const lower = parseFloat(title.split("-")[0].trim());
              const upper = parseFloat((title.split("-")[1] || "").trim());

              const pctLow = isNaN(lower) ? "?" : (lower * 100).toFixed(0);
              const pctHigh = isNaN(upper) ? "?" : Math.min(upper * 100, 80).toFixed(0);
              const label = pctHigh === "?" ? pctLow + "%" : pctLow + "–" + pctHigh + "%";

              layer.bindTooltip(
                `<div style='font-family:monospace;font-size:12px;padding:2px 6px'>
                  <strong>${label} probability</strong>
                </div>`,
                { sticky: true, opacity: 0.9, direction: "top" }
              );

              const key = isNaN(lower) ? "" : lower.toFixed(1);
              if (THRESHOLD_COLORS[key]) {
                const t = THRESHOLD_COLORS[key];
                layer.setStyle({
                  color: t.color,
                  weight: 1.5,
                  opacity: 0.9,
                  dashArray: "4 3"
                });
              }
            }
          }).addTo(layerGroup);
        }
      })
      .catch(() => { });

  }, [map, variable, day]);

  useEffect(() => {
    return () => {
      if (layerGroupRef.current && map) {
        map.removeLayer(layerGroupRef.current);
        layerGroupRef.current = null;
      }
    };
  }, [map]);

  return null;
};

// Map click listener to clear selected area
const MapClickHandler = ({ onMapClick }) => {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const onClick = () => {
      onMapClick();
    };
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
  }, [map, onMapClick]);
  return null;
};

const getBadgeColor = (prob) => {
  if (prob < 20) return "#475569"; // Gray
  if (prob < 40) return "#eab308"; // Yellow (Low)
  if (prob <= 60) return "#f97316"; // Orange (Medium)
  return "#ef4444"; // Red (High)
};

const STRIKE_LABELS = {
  "track_probability": "Track Probability",
  "34_knot_strike_probability": "≥34kt Strike Probability (TS)",
  "50_knot_strike_probability": "≥50kt Strike Probability (STS)",
  "64_knot_strike_probability": "≥64kt Strike Probability (TY)",
};

const Cyclone = () => {
  const center = [12.8797, 121.774]; // Approx center of the Philippines
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showWeatherPanel, setShowWeatherPanel] = useState(false);
  const [showStormPanel, setShowStormPanel] = useState(false);
  const [showForecastPanel, setShowForecastPanel] = useState(false);
  const wrapperRef = useRef(null);

  const toggleFullscreen = () => {
    setIsFullscreen((prev) => !prev);
  };

  const [showHistoryTrack, setShowHistoryTrack] = useState(true);
  const [showForecastTrack, setShowForecastTrack] = useState(true);
  const [showEnsemble, setShowEnsemble] = useState(false);
  const [showOutlookWeek1, setShowOutlookWeek1] = useState(false);
  const [showOutlookWeek2, setShowOutlookWeek2] = useState(false);
  const [selectedArea, setSelectedArea] = useState(null);

  const [showStrikeProb, setShowStrikeProb] = useState(false);
  const [strikeVariable, setStrikeVariable] = useState("track_probability");
  const [strikeDay, setStrikeDay] = useState(15);
  const [strikeMeta, setStrikeMeta] = useState(null);
  const [isStrikePlaying, setIsStrikePlaying] = useState(false);
  const [showTimelineControls, setShowTimelineControls] = useState(true);

  // WeatherNext 2 overlay states
  const [activeWeatherLayer, setActiveWeatherLayer] = useState("satellite");
  const [showWeatherNextPrecip, setShowWeatherNextPrecip] = useState(false);
  const [showWeatherNextWind, setShowWeatherNextWind] = useState(false);
  const [weatherNextHour, setWeatherNextHour] = useState(6);
  const [isWeatherNextPlaying, setIsWeatherNextPlaying] = useState(false);
  const [weatherNextMeta, setWeatherNextMeta] = useState(null);

  useEffect(() => {
    fetch("/data/precip_mslp_weathernext_meta.json")
      .then((res) => {
        if (!res.ok) throw new Error("Metadata not found");
        return res.json();
      })
      .then((data) => setWeatherNextMeta(data))
      .catch((err) => console.error("Error loading WeatherNext metadata:", err));
  }, []);

  // WeatherNext animation playback loop
  useEffect(() => {
    let interval;
    if (isWeatherNextPlaying && (activeWeatherLayer === "precip" || activeWeatherLayer === "wind")) {
      interval = setInterval(() => {
        setWeatherNextHour((prev) => {
          if (prev >= 360) return 6;
          return prev + 6;
        });
      }, 800);
    }
    return () => clearInterval(interval);
  }, [isWeatherNextPlaying, activeWeatherLayer]);

  // Sync WeatherNext slider & timestamp UI
  useEffect(() => {
    if (activeWeatherLayer === "precip" || activeWeatherLayer === "wind") {
      const slider = document.getElementById("radar-slider");
      if (slider) {
        slider.min = "6";
        slider.max = "360";
        slider.step = "6";
        slider.value = weatherNextHour.toString();
        slider.removeAttribute("disabled");
        slider.style.opacity = "1";
      }

      const playBtn = document.getElementById("btn-play");
      if (playBtn) {
        playBtn.textContent = isWeatherNextPlaying ? "Stop" : "Play";
      }

      // Update timestamp text
      const timestampEl = document.getElementById("radar-timestamp");
      if (timestampEl && weatherNextMeta) {
        const runTimeClean = weatherNextMeta.run_time.replace(" UTC", "");
        const base = new Date(runTimeClean + "Z");
        if (!isNaN(base.getTime())) {
          const valid = new Date(base.getTime() + weatherNextHour * 3600 * 1000);
          const timeFmt = valid.toISOString().replace("T", " ").substring(0, 16) + " UTC";
          timestampEl.innerText = `Forecast Hour: +${weatherNextHour}h (Valid: ${timeFmt})`;
        }
      }
    }
  }, [weatherNextHour, isWeatherNextPlaying, weatherNextMeta, activeWeatherLayer]);

  // Reset WeatherNext if Forecast panels are activated
  useEffect(() => {
    if (showStrikeProb || showOutlookWeek1 || showOutlookWeek2) {
      setShowWeatherNextPrecip(false);
      setShowWeatherNextWind(false);
      setIsWeatherNextPlaying(false);
      if (activeWeatherLayer === "precip" || activeWeatherLayer === "wind") {
        const btnSat = document.getElementById("btn-satellite");
        if (btnSat) btnSat.click();
      }
    }
  }, [showStrikeProb, showOutlookWeek1, showOutlookWeek2, activeWeatherLayer]);
  const [isLegendOpen, setIsLegendOpen] = useState(() => {
    if (typeof window !== "undefined") {
      return window.innerWidth >= 768;
    }
    return true;
  });

  // ── Global FNV3 base/paired Tracks ───────────────────────────────────────────
  const [fnv3EnsembleData, setFnv3EnsembleData] = useState(null);
  const [fnv3PairedData, setFnv3PairedData] = useState(null);
  const [atcfPositions, setAtcfPositions] = useState({});

  useEffect(() => {
    // Fetch and parse fnv3p2_latest.dat
    fetch(`/data/fnv3p2_latest.dat?t=${Date.now()}`)
      .then((res) => {
        if (!res.ok) throw new Error("fnv3p2_latest.dat not found");
        return res.text();
      })
      .then((encCsv) => {
        const csvText = decodeObfuscatedData(encCsv, 0xAA);
        const { rows } = parseCSV(csvText);

        // Group by (track_id, sample)
        const groups = {};
        rows.forEach(r => {
          const tid = (r.track_id || "").trim();
          const sample = (r.sample || "").trim();
          if (!tid || !sample) return;
          const key = `${tid}_${sample}`;
          if (!groups[key]) {
            groups[key] = {
              trackId: tid,
              sample: sample,
              points: []
            };
          }
          let leadH = parseFloat(r.lead_time_hours);
          if (isNaN(leadH) || r.lead_time_hours === undefined) {
            const str = r.lead_time || "";
            const parts = str.match(/(?:(\d+)\s+days\s+)?(\d+):(\d+):(\d+)/);
            if (parts) {
              const d = parseInt(parts[1] || 0);
              const h = parseInt(parts[2] || 0);
              leadH = d * 24 + h;
            }
          }
          groups[key].points.push({
            leadH,
            lat: parseFloat(r.lat),
            lon: parseFloat(r.lon),
            windKt: parseFloat(r.maximum_sustained_wind_speed_knots || r.wind_kt || 0),
            pressure: parseFloat(r.minimum_sea_level_pressure_hpa || r.pressure || 0)
          });
        });

        const parsedTracks = Object.values(groups).map(g => {
          g.points.sort((a, b) => a.leadH - b.leadH);
          return {
            trackId: g.trackId,
            sample: g.sample,
            points: g.points.filter(p => !isNaN(p.lat) && !isNaN(p.lon))
          };
        }).filter(t => {
          if (t.points.length === 0) return false;
          const firstPoint = t.points[0];
          // Western Pacific bounds: lat -5 to 45, lon 100 to 180
          return firstPoint.lat >= -5 && firstPoint.lat <= 45 && firstPoint.lon >= 100 && firstPoint.lon <= 180;
        });

        setFnv3EnsembleData(parsedTracks);
      })
      .catch((err) => console.error("Error loading fnv3p2_latest.dat:", err));

    // Fetch and parse fnv3p2_paired_latest.dat
    fetch(`/data/fnv3p2_paired_latest.dat?t=${Date.now()}`)
      .then((res) => {
        if (!res.ok) throw new Error("fnv3p2_paired_latest.dat not found");
        return res.text();
      })
      .then((encCsv) => {
        const csvText = decodeObfuscatedData(encCsv, 0xAA);
        const { rows } = parseCSV(csvText);

        // Group by track_id
        const groups = {};
        rows.forEach(r => {
          const tid = (r.track_id || "").trim();
          if (!tid) return;
          if (!groups[tid]) {
            groups[tid] = {
              trackId: tid,
              points: []
            };
          }
          let leadH = parseFloat(r.lead_time_hours);
          if (isNaN(leadH) || r.lead_time_hours === undefined) {
            const str = r.lead_time || "";
            const parts = str.match(/(?:(\d+)\s+days\s+)?(\d+):(\d+):(\d+)/);
            if (parts) {
              const d = parseInt(parts[1] || 0);
              const h = parseInt(parts[2] || 0);
              leadH = d * 24 + h;
            }
          }
          groups[tid].points.push({
            leadH,
            lat: parseFloat(r.lat),
            lon: parseFloat(r.lon),
            windKt: parseFloat(r.maximum_sustained_wind_speed_knots || r.wind_kt || 0),
            pressure: parseFloat(r.minimum_sea_level_pressure_hpa || r.pressure || 0)
          });
        });

        const parsedTracks = Object.values(groups).map(g => {
          g.points.sort((a, b) => a.leadH - b.leadH);
          return {
            trackId: g.trackId,
            points: g.points.filter(p => !isNaN(p.lat) && !isNaN(p.lon))
          };
        }).filter(t => {
          if (t.points.length === 0) return false;
          const firstPoint = t.points[0];
          // Western Pacific bounds: lat -5 to 45, lon 100 to 180
          return firstPoint.lat >= -5 && firstPoint.lat <= 45 && firstPoint.lon >= 100 && firstPoint.lon <= 180;
        });

        setFnv3PairedData(parsedTracks);
      })
      .catch((err) => console.error("Error loading fnv3p2_paired_latest.dat:", err));
  }, []);

  // ── Outlook JSONs ──────────────────────────────────────────────────────
  const [outlookWeek1Data, setOutlookWeek1Data] = useState(null);
  const [outlookWeek2Data, setOutlookWeek2Data] = useState(null);

  useEffect(() => {
    fetch("/data/tropical_outlook_week1.json")
      .then(r => r.json())
      .then(d => setOutlookWeek1Data(d))
      .catch(() => setOutlookWeek1Data(null));

    fetch("/data/tropical_outlook_week2.json")
      .then(r => r.json())
      .then(d => setOutlookWeek2Data(d))
      .catch(() => setOutlookWeek2Data(null));
  }, []);

  // Wind kt → category color (matches enemble.py palette)
  const windColor = (kt) => {
    if (kt < 25) return "#3498DB";
    if (kt < 34) return "#2ECC71";
    if (kt < 48) return "#F1C40F";
    if (kt < 64) return "#E67E22";
    if (kt < 100) return "#A83232";
    return "#5B0E2D";
  };


  useEffect(() => {
    let interval;
    if (isStrikePlaying && showStrikeProb) {
      interval = setInterval(() => {
        setStrikeDay((prev) => {
          if (prev >= 15) {
            return 1;
          }
          return prev + 1;
        });
      }, 800);
    }
    return () => clearInterval(interval);
  }, [isStrikePlaying, showStrikeProb]);

  const formatStrikeTime = (meta, day) => {
    if (!meta) return `Forecast: +${day * 24}h (Day ${day})`;
    const parts = meta.init_date.split("_");
    if (parts.length !== 3) return `Forecast: +${day * 24}h (Day ${day})`;
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]) - 1;
    const date = parseInt(parts[2]);
    const hour = parseInt(meta.init_hour);

    const baseDate = new Date(Date.UTC(year, month, date, hour, 0, 0));
    const forecastDate = new Date(baseDate.getTime() + day * 24 * 3600 * 1000);

    const options = {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short'
    };

    return `Init: ${baseDate.toLocaleString('en-US', { ...options, timeZone: 'UTC' })} | Forecast: ${forecastDate.toLocaleString('en-US', { ...options, timeZone: 'UTC' })} (+${day * 24}h)`;
  };

  useEffect(() => {
    document.body.style.overflow = isFullscreen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isFullscreen]);

  return (
    <div className="w-full h-[calc(100vh-57px)] flex flex-col bg-slate-950 text-slate-100 overflow-hidden relative select-none">
      <div
        ref={wrapperRef}
        className={
          isFullscreen
            ? "fixed inset-0 z-[9999] bg-black w-screen h-screen m-0 p-0 block"
            : "relative w-full h-full flex-grow"
        }
        style={isFullscreen ? {} : { isolation: "isolate" }}
      >
        <MapContainer
          center={center}
          zoom={5}
          scrollWheelZoom={true}
          worldCopyJump={false}
          maxBounds={[[-20.0, 90.0], [50.0, 180.0]]}
          maxBoundsViscosity={1.0}
          minZoom={4}
          className="w-full h-full"
          style={{ height: "100%", width: "100%" }}
        >
          <ResizeOnFullscreen isFullscreen={isFullscreen} />
          <FullscreenControl
            isFullscreen={isFullscreen}
            onToggle={toggleFullscreen}
          />
          <LayersControl position="topleft">
            <BaseLayer name="Satellite">
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution="&copy; OpenStreetMap contributors"
              />
            </BaseLayer>
            <BaseLayer checked name="Dark Matter">
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                attribution='&copy; <a href="https://carto.com/attributions">CARTO</a>'
              />
            </BaseLayer>
            <BaseLayer name="OpenStreetMap">
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              />
            </BaseLayer>
          </LayersControl>


          <LeafletCustomControl position="topright">
            <div id="radar-controls-container" className="flex flex-col items-end gap-2">
              {/* Weather Layers Toggle Button */}
              <button
                id="btn-layers-toggle"
                onClick={() => {
                  setShowWeatherPanel(!showWeatherPanel);
                  setShowStormPanel(false);
                  setShowForecastPanel(false);
                }}
                className={`flex h-[34px] w-[34px] items-center justify-center rounded-[4px] shadow-[0_1px_5px_rgba(0,0,0,0.65)] hover:bg-[#f4f4f4] transition-colors cursor-pointer ${showWeatherPanel ? "bg-cyan-900 text-white hover:bg-cyan-950" : "bg-white text-slate-800"
                  }`}
                title="Toggle Weather Layers"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 2 7 12 12 22 7 12 2" />
                  <polyline points="2 17 12 22 22 17" />
                  <polyline points="2 12 12 17 22 12" />
                </svg>
              </button>

              {/* Weather Layers Panel */}
              <div
                id="radar-controls-panel"
                className={`${showWeatherPanel ? "" : "hidden"} flex flex-col gap-1.5 sm:gap-2 rounded-lg bg-slate-900/90 p-2 sm:p-3 backdrop-blur-sm border border-slate-700 shadow-xl w-[140px] sm:w-[155px] mr-[10px] max-h-[50vh] sm:max-h-[75vh] overflow-y-auto weather-panel-scrollbar select-none text-left`}
              >
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-700 pb-1 mb-1 text-center">
                  Weather Layers
                </span>
                <button
                  id="btn-radar"
                  className="rounded px-2 py-1 text-[10px] sm:text-xs font-medium text-slate-100 transition hover:bg-slate-700 text-left cursor-pointer"
                >
                  Radar
                </button>
                <button
                  id="btn-satellite"
                  className="rounded px-2 py-1 text-[10px] sm:text-xs font-medium text-slate-100 transition hover:bg-slate-700 text-left cursor-pointer"
                >
                  Satellite
                </button>
                <button
                  id="btn-both"
                  className="rounded px-2 py-1 text-[10px] sm:text-xs font-medium text-slate-100 transition hover:bg-slate-700 text-left cursor-pointer"
                >
                  Both
                </button>
                <button
                  id="btn-infrared"
                  className="rounded px-2 py-1 text-[10px] sm:text-xs font-medium text-slate-100 transition hover:bg-slate-700 text-left cursor-pointer"
                >
                  Infrared
                </button>
                <div className="h-px bg-slate-700 my-1"></div>
                <button
                  id="btn-precip"
                  className="rounded px-2 py-1 text-[10px] sm:text-xs font-medium text-slate-100 transition hover:bg-slate-700 active text-left cursor-pointer"
                >
                  Precip
                </button>
                <button
                  id="btn-pressure"
                  className="rounded px-2 py-1 text-[10px] sm:text-xs font-medium text-slate-100 transition hover:bg-slate-700 active text-left cursor-pointer"
                >
                  Pressure
                </button>
                <button
                  id="btn-wind"
                  className="rounded px-2 py-1 text-[10px] sm:text-xs font-medium text-slate-100 transition hover:bg-slate-700 active text-left cursor-pointer"
                >
                  Wind
                </button>
              </div>

              {/* Storm Tracks Toggle Button */}
              <button
                id="btn-storm-toggle"
                onClick={() => {
                  setShowStormPanel(!showStormPanel);
                  setShowWeatherPanel(false);
                  setShowForecastPanel(false);
                }}
                className={`flex h-[34px] w-[34px] items-center justify-center rounded-[4px] shadow-[0_1px_5px_rgba(0,0,0,0.65)] hover:bg-[#f4f4f4] transition-colors cursor-pointer ${showStormPanel ? "bg-cyan-900 text-white hover:bg-cyan-950" : "bg-white text-slate-800"
                  }`}
                title="Toggle Storm Tracks"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a10 10 0 1 0 10 10" />
                  <path d="M12 6a6 6 0 1 0 6 6" />
                  <path d="M12 10a2 2 0 1 0 2 2" />
                </svg>
              </button>

              {/* Storm Tracks Panel */}
              <div
                id="storm-controls-panel"
                className={`${showStormPanel ? "" : "hidden"} flex flex-col gap-1.5 sm:gap-2 rounded-lg bg-slate-900/90 p-2 sm:p-3 backdrop-blur-sm border border-slate-700 shadow-xl w-[140px] sm:w-[155px] mr-[10px] max-h-[50vh] sm:max-h-[75vh] overflow-y-auto weather-panel-scrollbar select-none text-left`}
              >
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-700 pb-1 mb-1 text-center">
                  Storm Tracks
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowHistoryTrack(!showHistoryTrack);
                  }}
                  className={`rounded px-2 py-1 text-[10px] sm:text-xs font-medium text-left cursor-pointer transition ${showHistoryTrack ? "bg-cyan-900/60 text-cyan-100 outline outline-1 outline-cyan-500/50" : "text-slate-100 hover:bg-slate-700"
                    }`}
                >
                  History Track
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowForecastTrack(!showForecastTrack);
                  }}
                  className={`rounded px-2 py-1 text-[10px] sm:text-xs font-medium text-left cursor-pointer transition ${showForecastTrack ? "bg-cyan-900/60 text-cyan-100 outline outline-1 outline-cyan-500/50" : "text-slate-100 hover:bg-slate-700"
                    }`}
                >
                  Forecast Track
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowEnsemble(!showEnsemble);
                  }}
                  className={`rounded px-2 py-1 text-[10px] sm:text-xs font-medium text-left cursor-pointer transition ${showEnsemble ? "bg-cyan-900/60 text-cyan-100 outline outline-1 outline-cyan-500/50" : "text-slate-100 hover:bg-slate-700"
                    }`}
                >
                  Ensemble Tracks
                </button>
              </div>

              {/* Forecast Layers Toggle Button */}
              <button
                id="btn-forecast-toggle"
                onClick={() => {
                  setShowForecastPanel(!showForecastPanel);
                  setShowWeatherPanel(false);
                  setShowStormPanel(false);
                }}
                className={`flex h-[34px] w-[34px] items-center justify-center rounded-[4px] shadow-[0_1px_5px_rgba(0,0,0,0.65)] hover:bg-[#f4f4f4] transition-colors cursor-pointer ${showForecastPanel ? "bg-cyan-900 text-white hover:bg-cyan-950" : "bg-white text-slate-800"
                  }`}
                title="Toggle Forecast Layers"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 3v18h18" />
                  <path d="m19 9-5 5-4-4-3 3" />
                </svg>
              </button>

              {/* Forecast Layers Panel */}
              <div
                id="forecast-controls-panel"
                className={`${showForecastPanel ? "" : "hidden"} flex flex-col gap-1.5 sm:gap-2 rounded-lg bg-slate-900/90 p-2 sm:p-3 backdrop-blur-sm border border-slate-700 shadow-xl w-[140px] sm:w-[155px] mr-[10px] max-h-[50vh] sm:max-h-[75vh] overflow-y-auto weather-panel-scrollbar select-none text-left`}
              >
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-700 pb-1 mb-1 text-center">
                  Forecast Layers
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const nextVal = !showOutlookWeek1;
                    setShowOutlookWeek1(nextVal);
                    if (nextVal) {
                      setShowOutlookWeek2(false);
                      setShowStrikeProb(false);
                    }
                  }}
                  className={`rounded px-2 py-1 text-[10px] sm:text-xs font-medium text-left cursor-pointer transition ${showOutlookWeek1 ? "bg-cyan-900/60 text-cyan-100 outline outline-1 outline-cyan-500/50" : "text-slate-100 hover:bg-slate-700"
                    }`}
                >
                  7-Day Outlook
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const nextVal = !showOutlookWeek2;
                    setShowOutlookWeek2(nextVal);
                    if (nextVal) {
                      setShowOutlookWeek1(false);
                      setShowStrikeProb(false);
                    }
                  }}
                  className={`rounded px-2 py-1 text-[10px] sm:text-xs font-medium text-left cursor-pointer transition ${showOutlookWeek2 ? "bg-amber-900/60 text-amber-100 outline outline-1 outline-amber-500/50" : "text-slate-100 hover:bg-slate-700"
                    }`}
                >
                  Week 2 Outlook
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const nextVal = !showStrikeProb;
                    setShowStrikeProb(nextVal);
                    if (nextVal) {
                      setShowOutlookWeek1(false);
                      setShowOutlookWeek2(false);
                      setStrikeVariable("track_probability");
                    }
                  }}
                  className={`rounded px-2 py-1 text-[10px] sm:text-xs font-medium text-left cursor-pointer transition ${showStrikeProb ? "bg-cyan-900/60 text-cyan-100 outline outline-1 outline-cyan-500/50" : "text-slate-100 hover:bg-slate-700"
                    }`}
                >
                  Strike Probability
                </button>
                {showStrikeProb && (
                  <div className="flex flex-col gap-1 pl-3 mt-1 border-l border-cyan-800/40">
                    {[
                      { id: "track_probability", label: "Track Prob" },
                      { id: "34_knot_strike_probability", label: "≥34kt (TS)" },
                      { id: "50_knot_strike_probability", label: "≥50kt (STS)" },
                      { id: "64_knot_strike_probability", label: "≥64kt (TY)" },
                    ].map(opt => (
                      <button
                        key={opt.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setStrikeVariable(opt.id);
                        }}
                        className={`text-[10px] py-0.5 px-1.5 rounded text-left transition ${strikeVariable === opt.id
                          ? "bg-cyan-950 text-cyan-400 font-bold border border-cyan-800/30"
                          : "text-slate-400 hover:text-slate-200"
                          }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Hidden div to maintain id reference logic */}
              <div id="radar-controls" className="hidden"></div>
            </div>
            <CycloneMapLogic
              showHistoryTrack={showHistoryTrack}
              showEnsemble={showEnsemble}
              setActiveWeatherLayer={setActiveWeatherLayer}
              setShowWeatherNextPrecip={setShowWeatherNextPrecip}
              setShowWeatherNextWind={setShowWeatherNextWind}
              setIsWeatherNextPlaying={setIsWeatherNextPlaying}
              setWeatherNextHour={setWeatherNextHour}
              setShowStrikeProb={setShowStrikeProb}
              setShowOutlookWeek1={setShowOutlookWeek1}
              setShowOutlookWeek2={setShowOutlookWeek2}
              setAtcfPositions={setAtcfPositions}
            />
          </LeafletCustomControl>

          <EnsembleLayerLogic ensembleTracks={showEnsemble ? fnv3EnsembleData : null} pairedTracks={showForecastTrack ? fnv3PairedData : null} atcfPositions={atcfPositions} />
          <OutlookLayerLogic data={showOutlookWeek1 ? outlookWeek1Data : null} onSelectArea={setSelectedArea} week={1} />
          <OutlookLayerLogic data={showOutlookWeek2 ? outlookWeek2Data : null} onSelectArea={setSelectedArea} week={2} />
          {showStrikeProb && (
            <StrikeProbabilityLayerLogic
              variable={strikeVariable}
              day={strikeDay}
              onLoadMeta={setStrikeMeta}
            />
          )}
          {showWeatherNextPrecip && (
            <ImageOverlay
              key={`precip_${weatherNextHour}`}
              url={`/images/precip_mslp_weathernext_overlay/precip_mslp_${String(weatherNextHour).padStart(3, "0")}.png`}
              bounds={[[2.0, 112.0], [28.0, 140.0]]}
              opacity={0}
              pane="weathernextPane"
              eventHandlers={{
                load: (e) => {
                  const img = e.target.getElement();
                  if (img) {
                    img.style.transition = "opacity 0.2s ease-in-out";
                    img.style.opacity = 0.75;
                  }
                }
              }}
            />
          )}
          {showWeatherNextWind && (
            <ImageOverlay
              key={`wind_${weatherNextHour}`}
              url={`/images/wind_weathernext_overlay/wind_weathernext_${String(weatherNextHour).padStart(3, "0")}.png`}
              bounds={[[2.0, 112.0], [28.0, 140.0]]}
              opacity={0}
              pane="weathernextPane"
              eventHandlers={{
                load: (e) => {
                  const img = e.target.getElement();
                  if (img) {
                    img.style.transition = "opacity 0.2s ease-in-out";
                    img.style.opacity = 0.75;
                  }
                }
              }}
            />
          )}
          <MapClickHandler onMapClick={() => setSelectedArea(null)} />
        </MapContainer>

        {/* Unified Glassmorphic Timeline Seek Bar Dock for Strike Probability */}
        {(showStrikeProb && showTimelineControls) && (
          <div
            className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[92%] max-w-3xl z-[500] flex flex-col rounded-2xl bg-slate-950/85 backdrop-blur-lg border border-slate-700/80 p-3 sm:p-4 shadow-[0_12px_40px_rgba(0,0,0,0.6)] timeline-dock"
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {/* Active variable name display and variable switcher tabs */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mb-3 bg-slate-900/40 p-2 rounded-xl border border-slate-800/50">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-cyan-400 uppercase tracking-widest font-bold px-2 py-0.5 rounded bg-cyan-950/80 border border-cyan-800/40 select-none">
                  Active Layer
                </span>
                <span className="text-xs font-semibold text-slate-100">
                  {STRIKE_LABELS[strikeVariable] || strikeVariable}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {[
                  { id: "track_probability", label: "Track Prob" },
                  { id: "34_knot_strike_probability", label: "≥34kt (TS)" },
                  { id: "50_knot_strike_probability", label: "≥50kt (STS)" },
                  { id: "64_knot_strike_probability", label: "≥64kt (TY)" },
                ].map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => setStrikeVariable(opt.id)}
                    className={`text-[10px] sm:text-xs py-1 px-2.5 rounded-lg transition-all duration-200 font-semibold cursor-pointer border ${strikeVariable === opt.id
                      ? "bg-cyan-500/25 text-cyan-200 border-cyan-400/40 shadow-[0_0_8px_rgba(34,211,238,0.2)]"
                      : "text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-800/40"
                      }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Strike Probability Gradient Bar Legend inside the dock */}
            <div className="w-full flex flex-col px-1 mb-3">
              <div
                className="h-1.5 w-full rounded-full"
                style={{ background: "linear-gradient(to right, #1d4ed8, #38bdf8, #34d399, #facc15, #f97316, #dc2626)" }}
              />
              <div className="flex justify-between text-[8px] sm:text-[9px] text-slate-400 font-mono mt-1 px-0.5">
                <span>5% Prob</span>
                <span className="text-yellow-400">30% (Watch)</span>
                <span className="text-orange-400">50% (High)</span>
                <span className="text-red-400">70% (Dominant)</span>
                <span>80%+</span>
              </div>
            </div>

            <div className="flex w-full items-center justify-between mb-2 sm:mb-3 px-1">
              <button
                onClick={() => {
                  if (!isStrikePlaying && strikeDay >= 15) setStrikeDay(1);
                  setIsStrikePlaying(!isStrikePlaying);
                }}
                className="flex items-center justify-center gap-1.5 min-w-[85px] rounded-lg bg-cyan-600 hover:bg-cyan-500 px-4 py-1.5 sm:py-2 text-[10px] sm:text-xs font-bold uppercase tracking-widest text-white shadow-lg transition active:scale-95 border border-cyan-500/50 cursor-pointer"
              >
                {isStrikePlaying ? "Stop" : "Play"}
              </button>

              <div
                className="text-[10px] sm:text-xs text-cyan-300 font-mono font-semibold tracking-wide flex-1 text-center truncate px-2 block"
              >
                {formatStrikeTime(strikeMeta, strikeDay)}
              </div>

              {/* Hide Dock Button */}
              <button
                onClick={() => setShowTimelineControls(false)}
                className="flex items-center justify-center rounded-lg p-1.5 sm:p-2 text-xs transition cursor-pointer flex-shrink-0 text-slate-400 hover:text-white hover:bg-slate-800/60"
                title="Hide Timeline Dock"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                  <line x1="1" y1="1" x2="23" y2="23"></line>
                </svg>
              </button>
            </div>

            <div className="w-full flex flex-col px-1 relative">
              <div className="flex justify-between text-[9px] text-slate-500 font-mono mb-1 px-1">
                <span>Init</span>
                <span>Day 3 (+72h)</span>
                <span>Day 6 (+144h)</span>
                <span>Day 9 (+216h)</span>
                <span>Day 12 (+288h)</span>
                <span>Day 15 (+360h)</span>
              </div>
              <input
                type="range"
                min="1"
                max="15"
                step="1"
                value={strikeDay}
                onChange={(e) => {
                  setIsStrikePlaying(false);
                  setStrikeDay(parseInt(e.target.value));
                }}
                className="w-full h-2 rounded-lg bg-slate-800 appearance-none cursor-pointer accent-cyan-500 hover:accent-cyan-400 focus:outline-none transition"
              />
            </div>
          </div>
        )}

        {/* Unified Glassmorphic Timeline Seek Bar Dock */}
        <div
          className={`absolute bottom-6 left-1/2 -translate-x-1/2 w-[92%] max-w-3xl z-[500] flex-col rounded-2xl bg-slate-950/85 backdrop-blur-lg border border-slate-700/80 p-3 sm:p-4 shadow-[0_12px_40px_rgba(0,0,0,0.6)] timeline-dock ${(!showStrikeProb && showTimelineControls) ? "flex" : "hidden"
            }`}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {/* WeatherNext Precip Legend */}
          {activeWeatherLayer === "precip" && (
            <div className="w-full flex flex-col px-1 mb-3">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 select-none text-left">
                6-hr Precipitation Legend (mm)
              </div>
              <div className="h-2 w-full rounded flex overflow-hidden border border-slate-700/50">
                <div className="flex-1 bg-[#dbe9f6]" title="0.5-1 mm" />
                <div className="flex-1 bg-[#a6cbe3]" title="1-2 mm" />
                <div className="flex-1 bg-[#5ba3d0]" title="2-5 mm" />
                <div className="flex-1 bg-[#227abb]" title="5-8 mm" />
                <div className="flex-1 bg-[#4ac15e]" title="8-12 mm" />
                <div className="flex-1 bg-[#2ea946]" title="12-18 mm" />
                <div className="flex-1 bg-[#1a862f]" title="18-25 mm" />
                <div className="flex-1 bg-[#ffdb00]" title="25-35 mm" />
                <div className="flex-1 bg-[#f7a800]" title="35-45 mm" />
                <div className="flex-1 bg-[#ea7200]" title="45-55 mm" />
                <div className="flex-1 bg-[#df4000]" title="55-70 mm" />
                <div className="flex-1 bg-[#d41c00]" title="70-85 mm" />
                <div className="flex-1 bg-[#b40047]" title="85-100 mm" />
                <div className="flex-1 bg-[#c432b4]" title="100-150 mm" />
                <div className="flex-1 bg-[#4b0082]" title=">150 mm" />
              </div>
              <div className="flex justify-between text-[8px] sm:text-[9px] text-slate-400 font-mono mt-1 px-0.5">
                <span>0.5 mm (Light)</span>
                <span>12 mm (Moderate)</span>
                <span>35 mm (Heavy)</span>
                <span>85 mm (Very Heavy)</span>
                <span>150mm+ (Extreme)</span>
              </div>
            </div>
          )}

          {/* WeatherNext Wind Legend */}
          {activeWeatherLayer === "wind" && (
            <div className="w-full flex flex-col px-1 mb-3">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 select-none text-left">
                10m Wind Speed Legend (kph)
              </div>
              <div className="h-2 w-full rounded flex overflow-hidden border border-slate-700/50">
                <div className="flex-1 bg-[#ffffff]" title="0.5-1.5 kph" />
                <div className="flex-1 bg-[#93c5fd]" title="10-30 kph" />
                <div className="flex-1 bg-[#3b82f6]" title="30-40 kph" />
                <div className="flex-1 bg-[#22c55e]" title="40-50 kph" />
                <div className="flex-1 bg-[#eab308]" title="50-60 kph" />
                <div className="flex-1 bg-[#f97316]" title="60-80 kph" />
                <div className="flex-1 bg-[#ef4444]" title="80-100 kph" />
                <div className="flex-1 bg-[#dc2626]" title="100-150 kph" />
                <div className="flex-1 bg-[#a855f7]" title="150-185 kph" />
                <div className="flex-1 bg-[#7e22ce]" title="185-220 kph" />
                <div className="flex-1 bg-[#4b0082]" title=">220 kph" />
              </div>
              <div className="flex justify-between text-[8px] sm:text-[9px] text-slate-400 font-mono mt-1 px-0.5">
                <span>10 kph (Light)</span>
                <span>40 kph (Moderate)</span>
                <span>80 kph (Strong)</span>
                <span>120 kph (Destructive)</span>
                <span>220kph+ (Super Typhoon)</span>
              </div>
            </div>
          )}
          <div className="flex w-full items-center justify-between mb-2 sm:mb-3 px-1">
            <button
              id="btn-play"
              className="flex items-center justify-center gap-1.5 min-w-[85px] rounded-lg bg-emerald-600 hover:bg-emerald-500 px-4 py-1.5 sm:py-2 text-[10px] sm:text-xs font-bold uppercase tracking-widest text-white shadow-lg transition active:scale-95 border border-emerald-500/50 cursor-pointer"
            >
              Play
            </button>

            <div
              id="radar-timestamp"
              className="text-xs sm:text-sm text-emerald-300 font-mono font-semibold tracking-wide flex-1 text-center truncate px-2 block"
            >
              Select layers to start
            </div>

            {/* Hide Dock Button */}
            <button
              onClick={() => setShowTimelineControls(false)}
              className="flex items-center justify-center rounded-lg p-1.5 sm:p-2 text-xs transition cursor-pointer flex-shrink-0 text-slate-400 hover:text-white hover:bg-slate-800/60"
              title="Hide Timeline Dock"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                <line x1="1" y1="1" x2="23" y2="23"></line>
              </svg>
            </button>
          </div>

          <div className="w-full flex items-center px-1">
            <input
              type="range"
              id="radar-slider"
              className="w-full h-2 rounded-lg bg-slate-800 appearance-none cursor-pointer accent-emerald-500 hover:accent-emerald-400 focus:outline-none transition"
            />
          </div>
        </div>

        {/* Show Timeline Dock Button (when hidden) */}
        {!showTimelineControls && (
          <button
            onClick={() => setShowTimelineControls(true)}
            className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[500] flex items-center gap-2 rounded-full bg-slate-950/85 backdrop-blur-lg border border-slate-700/80 px-4 py-2 shadow-[0_8px_20px_rgba(0,0,0,0.5)] text-slate-300 hover:text-white hover:bg-slate-900 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            <span className="text-xs font-semibold uppercase tracking-wider">Show Timeline</span>
          </button>
        )}

        {/* Floating NHC-Style Selected Area Card */}
        {selectedArea && (
          <div className="absolute top-24 left-16 z-[1000] w-[290px] sm:w-[330px] rounded-2xl border border-slate-700/80 bg-slate-950/90 p-4 shadow-[0_12px_40px_rgba(0,0,0,0.6)] backdrop-blur-md animate-in fade-in slide-in-from-top-4 duration-200 animate-out fade-out slide-out-to-top-4">
            {/* Close Button */}
            <button
              onClick={() => setSelectedArea(null)}
              className="absolute top-3.5 right-3.5 text-slate-400 hover:text-white transition-colors cursor-pointer text-base font-bold bg-slate-900 hover:bg-slate-800 border border-slate-700/50 rounded-full w-6 h-6 flex items-center justify-center shadow-md"
              title="Close Panel"
            >
              ✕
            </button>

            {selectedArea.isTC ? (
              <div className="pr-4">
                <h3 className="text-sm font-black text-white mb-1 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 animate-pulse bg-pink-500 shadow-[0_0_8px_#ec4899]" />
                  {selectedArea.label}
                </h3>
                {selectedArea.initialization && (
                  <div className="text-[9px] text-slate-400 font-mono mb-2">
                    Forecast Init: {selectedArea.initialization}
                  </div>
                )}
                <div className="text-[10px] text-pink-400 font-mono font-bold uppercase tracking-wider mb-2">
                  Active System (Week {selectedArea.week})
                </div>
                <div className="mt-3 flex items-start gap-2 bg-slate-900/60 border border-slate-800/80 rounded-xl p-2.5 text-[11px] leading-relaxed text-slate-350">
                  <span className="text-pink-400 mt-0.5 flex-shrink-0">🌀</span>
                  <div className="text-slate-350">{selectedArea.summary}</div>
                </div>
              </div>
            ) : (
              <div className="pr-4">
                <h3 className="text-sm font-black text-white mb-1.5 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: selectedArea.color }} />
                  Disturbance {selectedArea.id}
                </h3>
                {selectedArea.initialization && (
                  <div className="text-[9px] text-slate-450 font-mono mb-2">
                    Forecast Init: {selectedArea.initialization}
                  </div>
                )}

                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-2">
                  Potential development Area:
                </div>

                <div className="flex flex-col gap-2">
                  {/* Badge Row */}
                  <div className="flex items-center gap-2">
                    {/* 2-Day / Days 8-9 Badge */}
                    <div className="flex-1 bg-slate-900/80 border border-slate-800/60 rounded-xl p-2 text-center">
                      <div className="text-[9px] text-slate-400 font-semibold mb-1">
                        {selectedArea.week === 1 ? "In 48 Hours" : "In Days 8-9"}
                      </div>
                      <div className="inline-flex items-center justify-center font-bold px-2 py-0.5 rounded text-[11px] font-mono text-white shadow-sm" style={{ backgroundColor: getBadgeColor(selectedArea.probability_2day) }}>
                        {selectedArea.probability_2day}%
                      </div>
                    </div>

                    {/* 7-Day / Week 2 Badge */}
                    <div className="flex-1 bg-slate-900/80 border border-slate-800/60 rounded-xl p-2 text-center">
                      <div className="text-[9px] text-slate-400 font-semibold mb-1">
                        {selectedArea.week === 1 ? "In 7 Days" : "In Week 2"}
                      </div>
                      <div className="inline-flex items-center justify-center font-bold px-2 py-0.5 rounded text-[11px] font-mono text-white shadow-sm" style={{ backgroundColor: getBadgeColor(selectedArea.probability_7day) }}>
                        {selectedArea.probability_7day}%
                      </div>
                    </div>
                  </div>

                  {/* Warning Details Row */}
                  <div className="mt-2 flex items-start gap-2 bg-slate-900/60 border border-slate-800/80 rounded-xl p-2.5 text-[11px] leading-relaxed text-slate-350">
                    <span className="text-amber-500 mt-0.5 flex-shrink-0">⚠️</span>
                    <div>
                      <div className="font-semibold text-slate-200 mb-0.5">Latest Warnings and Information</div>
                      <div className="text-[10.5px] text-slate-350">{selectedArea.summary}</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <div id="cyclone-loading" className="absolute top-1/2 left-1/2 z-[1000] -translate-x-1/2 -translate-y-1/2 transform rounded-lg bg-slate-950/90 px-4 py-2 text-sm text-white shadow-2xl border border-slate-700 flex items-center gap-2 hidden">
          <svg className="animate-spin h-4 w-4 text-sky-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          Loading data...
        </div>
      </div>
    </div>
  );
};

export default Cyclone;
