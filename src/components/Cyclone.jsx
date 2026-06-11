import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MapContainer, TileLayer, LayersControl, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { getStormDisplayName } from "../utils/stormNaming";

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

// Core storm, PAR, country borders, and radar logic wired into the Leaflet map.
const CycloneMapLogic = () => {
  const map = useMap();

  useEffect(() => {
    if (!map) return;

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

    const to10MinWindKmH = (wind1MinKnots) => {
      const tenMinKnots = (wind1MinKnots || 0) * 0.88;
      const tenMinKmh = tenMinKnots * 1.852;
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
      stormLayer.clearLayers();
      stormMarkers = {};

      const sizeMap = {
        LPA: [48, 48],
        TD: [48, 48],
        TS: [48, 48],
        STS: [48, 48],
        TY: [48, 48],
        STY: [48, 48],
      };

      data.forEach((storm) => {
        const parts = storm.interp_sector_file.split(/\s+/);
        if (parts.length < 12) {
          console.error(
            "Invalid interp_sector_file format for storm:",
            storm.atcf_id
          );
          return;
        }
        const stormName = parts[1];
        const dateStr = parts[2];
        const timeStr = parts[3];
        const latitude = parseFloat(parts[4]);
        const longitude = parseFloat(parts[5]);
        const winds1MinKnots = parseFloat(parts[8]);
        const pressure = parseFloat(parts[9]);
        const speed = parseFloat(parts[10]);
        const direction = parseFloat(parts[11]);

        const year = dateStr.substring(0, 4);
        const month = dateStr.substring(4, 6);
        const day = dateStr.substring(6, 8);
        const hour = timeStr.substring(0, 2);
        const minute = timeStr.substring(2, 4);
        const baseTime = new Date(
          `${year}-${month}-${day}T${hour}:${minute}:00Z`
        ).getTime();

        const winds10MinKph = to10MinWindKmH(winds1MinKnots);
        const categoryInfo = getStormCategory(winds10MinKph);
        const rawName = stormName || storm.atcf_id || "Tropical Disturbance";
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
            <div class="popup-tail relative z-20 w-[270px] sm:w-80 bg-slate-900/90 backdrop-blur-md border border-slate-700 shadow-[0_10px_40px_rgba(0,0,0,0.5)] rounded-2xl p-3.5 sm:p-5">
                
                <div class="border-b border-slate-700/60 pb-2 sm:pb-3 flex justify-between items-start">
                    <div>
                        <div class="inline-flex items-center gap-1 px-1.5 py-0.5 sm:gap-1.5 sm:px-2 sm:py-1 rounded bg-slate-800 text-[8px] sm:text-[10px] font-bold uppercase tracking-wider border border-slate-700 mb-1.5 sm:mb-2" style="color: ${categoryInfo.color}; border-color: ${categoryInfo.color}40; background: ${categoryInfo.color}10;">
                            <span class="w-1.5 h-1.5 rounded-full animate-pulse shadow-[0_0_5px_currentColor]" style="background-color: ${categoryInfo.color};"></span>
                            ${categoryInfo.category}
                        </div>
                        <h3 class="text-lg sm:text-2xl font-black text-white tracking-tight leading-tight">${displayName}</h3>
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-2 sm:gap-3 py-3 sm:py-4">
                    <div class="bg-slate-950/50 rounded-xl p-2 sm:p-3 border border-slate-800 hover:border-slate-600 transition-colors">
                        <div class="text-slate-400 text-[9px] sm:text-[11px] uppercase tracking-wider mb-1 flex items-center gap-1 font-medium">
                            <span class="text-blue-400">💨</span> Wind (10m)
                        </div>
                        <div class="text-white font-bold text-sm sm:text-lg">${winds10MinKph} <span class="text-[10px] sm:text-xs text-slate-500 font-normal">km/h</span></div>
                    </div>
                    
                    <div class="bg-slate-950/50 rounded-xl p-2 sm:p-3 border border-slate-800 hover:border-slate-600 transition-colors">
                        <div class="text-slate-400 text-[9px] sm:text-[11px] uppercase tracking-wider mb-1 flex items-center gap-1 font-medium">
                            <span class="text-rose-400">🌪️</span> Max Gust
                        </div>
                        <div class="text-white font-bold text-sm sm:text-lg">${gustKph} <span class="text-[10px] sm:text-xs text-slate-500 font-normal">km/h</span></div>
                    </div>
                    
                    <div class="bg-slate-950/50 rounded-xl p-2 sm:p-3 border border-slate-800 hover:border-slate-600 transition-colors">
                        <div class="text-slate-400 text-[9px] sm:text-[11px] uppercase tracking-wider mb-1 flex items-center gap-1 font-medium">
                            <span class="text-emerald-400">⏲️</span> Pressure
                        </div>
                        <div class="text-white font-bold text-sm sm:text-lg">${pressure} <span class="text-[10px] sm:text-xs text-slate-500 font-normal">hPa</span></div>
                    </div>
                    
                    <div class="bg-slate-950/50 rounded-xl p-2 sm:p-3 border border-slate-800 hover:border-slate-600 transition-colors">
                        <div class="text-slate-400 text-[9px] sm:text-[11px] uppercase tracking-wider mb-1 flex items-center gap-1 font-medium">
                            <span class="text-amber-400">📍</span> Location
                        </div>
                        <div class="text-white font-bold text-[10px] sm:text-sm mt-0.5 sm:mt-1 tracking-wide leading-tight" id="popup-location-text">${latitude.toFixed(2)}°N,<br class="sm:hidden"/> ${longitude.toFixed(2)}°E</div>
                    </div>
                </div>
                ${movementHtml ? `<div class="bg-slate-950/50 rounded-xl p-2 sm:p-3 border border-slate-800 mb-2 sm:mb-3 text-[11px] sm:text-sm text-slate-300">
                  <span class="text-slate-400">🧭</span> ${movementHtml.replace(/<[^>]+>/g, '')}
                </div>` : ''}
                <div class="border-t border-slate-700/60 pt-2 sm:pt-3 flex items-center justify-between">
                    <div class="flex flex-col">
                        <span class="text-[8px] sm:text-[9px] text-slate-500 uppercase tracking-widest font-bold">Last Updated</span>
                        <span class="text-[10px] sm:text-xs text-slate-400">${new Date(storm.last_updated).toLocaleString()}</span>
                    </div>
                </div>

            </div>
          `,
          { maxWidth: 350, className: "custom-storm-popup" }
        );

        marker.addTo(stormLayer);

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

    async function fetchZoomEarthTimestamps() {
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
        frames.unshift({
          time: Math.floor(current.getTime() / 1000),
          path: current.toISOString(),   // used as cache key
          zoomEarthTime: new Date(current.getTime()),
          isZoomEarth: true,
        });
        current.setUTCMinutes(current.getUTCMinutes() - intervalMinutes);
      }
      return frames;
    }

    async function fetchInfraredTimestamps() {
      const serverTime = await fetchServerTime();
      const frames = [];
      const intervalMinutes = 10;
      const historyHours = 3;
      const lagMinutes = 60;

      let current = new Date(serverTime.getTime());
      const minutes = current.getUTCMinutes();
      current.setUTCMinutes(minutes - (minutes % intervalMinutes), 0, 0);
      current.setUTCMinutes(current.getUTCMinutes() - lagMinutes);

      const totalFrames = (historyHours * 60) / intervalMinutes;
      for (let i = 0; i < totalFrames; i++) {
        frames.unshift({
          time: Math.floor(current.getTime() / 1000),
          path: `ir_${current.toISOString()}`,
          irTime: new Date(current.getTime()),
          isInfrared: true,
        });
        current.setUTCMinutes(current.getUTCMinutes() - intervalMinutes);
      }
      return frames;
    }

    function startLoadingTile() {
      loadingTilesCount++;
    }
    function finishLoadingTile() {
      setTimeout(() => loadedTilesCount++, 250);
    }
    function isTilesLoading() {
      return loadingTilesCount > loadedTilesCount;
    }

    function addLayer(frame) {
      if (!radarLayers[frame.path]) {
        let source;

        if (frame.isZoomEarth) {
          // Build Zoom Earth true-color Himawari tile URL (direct — no CORS proxy needed for img tiles)
          const d = frame.zoomEarthTime || new Date(frame.time * 1000);
          const year = d.getUTCFullYear();
          const month = String(d.getUTCMonth() + 1).padStart(2, "0");
          const day = String(d.getUTCDate()).padStart(2, "0");
          const hour = String(d.getUTCHours()).padStart(2, "0");
          const minute = String(d.getUTCMinutes()).padStart(2, "0");
          // Zoom Earth uses {z}/{y}/{x} tile order (lat/lon reversed from standard)
          const zeUrl = `/api/zoom-earth/geocolor/himawari/${year}-${month}-${day}/${hour}${minute}/{z}/{y}/{x}.jpg`;
          source = new L.TileLayer(zeUrl, {
            tileSize: 256,
            opacity: 0.01,
            zIndex: frame.time,
            maxNativeZoom: 7,
            maxZoom: 18,
            minZoom: 2,
            noWrap: true,
            errorTileUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
          });
        } else if (frame.isInfrared) {
          // Meteored IR satellite tiles via wsrv.nl proxy
          const irUrl = `https://wsrv.nl/?url=services-c.meteored.com/img/tiles/viewer/satellite/{z}/{x}/{y}/${frame.time}_ir@2x.jpg`;
          source = new L.TileLayer(irUrl, {
            tileSize: 512,
            zoomOffset: -1,
            opacity: 0.01,
            zIndex: frame.time,
            maxNativeZoom: 7,
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

      // 2. Nuclear Option: Scan all map layers and remove any untracked RainViewer tiles
      map.eachLayer((layer) => {
        if (layer instanceof L.TileLayer) {
          // efficient check for RainViewer domain in the tile URL template
          const url = layer._url || (layer.options && layer.options.url) || "";
          if (url.includes("rainviewer.com")) {
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

      // Check if kind is one of the OWM layers
      if (["precip", "pressure", "wind"].includes(kind)) {
        if (btnPlay) btnPlay.style.display = 'none'; // Hide play button for static layers

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
          if (loadingIndicator) loadingIndicator.classList.add("hidden");
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
          if (loadingIndicator) loadingIndicator.classList.add("hidden");
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
const EnsembleLayerLogic = ({ data }) => {
  const map = useMap();
  useEffect(() => {
    if (!map || !data) return;

    const layerGroup = L.layerGroup().addTo(map);

    // Cone Polygon
    if (data.cone_polygon && data.cone_polygon.length > 0) {
      // Leaflet uses [lat, lon], while data is [lon, lat]
      const latLngs = data.cone_polygon.map(p => [p[1], p[0]]);
      L.polygon(latLngs, {
        color: '#ffffff',
        weight: 1.5,
        opacity: 0.6,
        fillColor: '#ffffff',
        fillOpacity: 0.15
      }).addTo(layerGroup);
    }

    // Past Track
    if (data.history && data.history.length > 1) {
      const pts = data.history.map(p => [p.lat, p.lon]);
      L.polyline(pts, {
        color: '#ffffff',
        weight: 4,
        opacity: 0.9,
        lineJoin: 'round'
      }).addTo(layerGroup);
      L.polyline(pts, {
        color: '#000000',
        weight: 2.5,
        opacity: 0.9,
        lineJoin: 'round'
      }).addTo(layerGroup);
    }

    // Forecast Track
    if (data.forecast && data.forecast.length > 1) {
      const pts = data.forecast.map(p => [p.lat, p.lon]);
      L.polyline(pts, {
        color: '#ffffff',
        weight: 3.5,
        opacity: 0.8,
        lineJoin: 'round',
        dashArray: '6, 6'
      }).addTo(layerGroup);
      L.polyline(pts, {
        color: '#404040',
        weight: 2,
        opacity: 0.9,
        lineJoin: 'round',
        dashArray: '6, 6'
      }).addTo(layerGroup);
    }

    // Connecting line (history to forecast)
    if (data.history?.length && data.forecast?.length) {
      const pt1 = [data.history[data.history.length - 1].lat, data.history[data.history.length - 1].lon];
      const pt2 = [data.forecast[0].lat, data.forecast[0].lon];
      L.polyline([pt1, pt2], {
        color: '#888888',
        weight: 2,
        opacity: 0.8,
        dashArray: '4, 4'
      }).addTo(layerGroup);
    }

    // Wind kt -> color mapping
    const windColor = (kt) => {
      if (kt < 25) return "#3498DB";
      if (kt < 34) return "#2ECC71";
      if (kt < 48) return "#F1C40F";
      if (kt < 64) return "#E67E22";
      if (kt < 100) return "#A83232";
      return "#5B0E2D";
    };

    // Past track dots
    if (data.history) {
      data.history.forEach(p => {
        L.circleMarker([p.lat, p.lon], {
          radius: 3.5,
          color: '#ffffff',
          weight: 1,
          fillColor: '#000000',
          fillOpacity: 1
        }).addTo(layerGroup);
      });
    }

    // Forecast track dots
    if (data.forecast) {
      data.forecast.forEach(p => {
        const marker = L.circleMarker([p.lat, p.lon], {
          radius: 5,
          color: '#ffffff',
          weight: 1,
          fillColor: windColor(p.wind_kt),
          fillOpacity: 1
        }).addTo(layerGroup);

        marker.bindTooltip(
          `<div style="font-family: monospace; font-weight: bold; font-size: 11px;">T+${p.lead_time_hours}h</div>
           <div style="font-size: 10px;">Wind: ${p.wind_kt}kt</div>`,
          { direction: 'right', offset: [5, 0], opacity: 0.9 }
        );
      });
    }

    if (data.cone_polygon && data.cone_polygon.length > 0) {
      const bounds = L.latLngBounds(data.cone_polygon.map(p => [p[1], p[0]]));
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 6 });
    }

    return () => {
      layerGroup.remove();
    };
  }, [map, data]);

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
                summary: `Active FNV3 ensemble track ID ${tc.track_id} centered at ${tc.center[0].toFixed(2)}°N, ${tc.center[1].toFixed(2)}°E.`,
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

const Cyclone = () => {
  const center = [12.8797, 121.774]; // Approx center of the Philippines
  const [isFullscreen, setIsFullscreen] = useState(false);
  const wrapperRef = useRef(null);

  const toggleFullscreen = () => {
    setIsFullscreen((prev) => !prev);
  };

  const [showEnsemble, setShowEnsemble] = useState(true);
  const [showOutlookWeek1, setShowOutlookWeek1] = useState(false);
  const [showOutlookWeek2, setShowOutlookWeek2] = useState(false);
  const [selectedArea, setSelectedArea] = useState(null);

  const [showStrikeProb, setShowStrikeProb] = useState(false);
  const [strikeVariable, setStrikeVariable] = useState("34_knot_strike_probability");
  const [strikeDay, setStrikeDay] = useState(15);
  const [strikeMeta, setStrikeMeta] = useState(null);
  const [isStrikePlaying, setIsStrikePlaying] = useState(false);
  const [showTimelineControls, setShowTimelineControls] = useState(true);
  const [isLegendOpen, setIsLegendOpen] = useState(() => {
    if (typeof window !== "undefined") {
      return window.innerWidth >= 768;
    }
    return true;
  });

  // ── Ensemble Track JSON ──────────────────────────────────────────────────────
  const [ensembleData, setEnsembleData] = useState(null);
  useEffect(() => {
    fetch("/data/ensemble_tracks.json")
      .then(r => r.json())
      .then(d => setEnsembleData(d))
      .catch(() => setEnsembleData(null));
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

          <LeafletCustomControl position="topleft">
            {(ensembleData && showEnsemble) && (() => {
              const legend = [
                { label: "Super Typhoon", color: "#5B0E2D" },
                { label: "Typhoon", color: "#A83232" },
                { label: "Severe Tropical Storm", color: "#E67E22" },
                { label: "Tropical Storm", color: "#F1C40F" },
                { label: "Tropical Depression", color: "#2ECC71" },
                { label: "Low Pressure Area", color: "#3498DB" },
                { label: "Past Track", color: "#000000" },
              ];

              return (
                <div className="mt-2 rounded-xl border border-slate-700/60 bg-slate-950/85 backdrop-blur-md shadow-xl overflow-hidden w-[180px] sm:w-[200px] pointer-events-auto">
                  <button
                    onClick={() => setIsLegendOpen(!isLegendOpen)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-1.5 border-b border-slate-700/50 bg-slate-900/70 hover:bg-slate-800/80 transition-colors text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold text-slate-200">Legend</span>
                      <span className="text-[9px] font-mono text-cyan-400 font-bold bg-cyan-950/50 px-1.5 py-0.5 rounded border border-cyan-800/30">{ensembleData.storm_name}</span>
                    </div>
                    <span className="text-slate-400 text-xs">{isLegendOpen ? "▾" : "▸"}</span>
                  </button>
                  {isLegendOpen && (
                    <div className="p-3 bg-slate-900/40 animate-in fade-in slide-in-from-top-1 duration-200">
                      <div className="flex flex-col gap-1.5">
                        {legend.map(c => (
                          <div key={c.label} className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 border border-white/20" style={{ background: c.color }} />
                            <span className="text-[9px] text-slate-350 font-mono tracking-tight">{c.label}</span>
                          </div>
                        ))}
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-2.5 rounded flex-shrink-0 bg-white/15 border border-white/25" />
                          <span className="text-[9px] text-slate-355 font-mono tracking-tight">Cone</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </LeafletCustomControl>

          <LeafletCustomControl position="topright">
            <div id="radar-controls-container" className="flex flex-col items-end">
              <button
                id="btn-layers-toggle"
                onClick={() => {
                  const controls = document.getElementById("radar-controls-panel");
                  if (controls) {
                    controls.classList.toggle("hidden");
                  }
                }}
                className="mb-2 flex h-[34px] w-[34px] items-center justify-center rounded-[4px] bg-white text-slate-800 shadow-[0_1px_5px_rgba(0,0,0,0.65)] hover:bg-[#f4f4f4] transition-colors cursor-pointer"
                title="Toggle Weather Layers"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 2 7 12 12 22 7 12 2" />
                  <polyline points="2 17 12 22 22 17" />
                  <polyline points="2 12 12 17 22 12" />
                </svg>
              </button>
              <div
                id="radar-controls-panel"
                className="hidden flex flex-col gap-2 rounded-lg bg-slate-900/90 p-3 backdrop-blur-sm border border-slate-700 shadow-xl w-32 mr-[10px]"
              >
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-700 pb-1 mb-1 text-center">
                  Weather Layers
                </span>
                <button
                  id="btn-radar"
                  className="rounded px-2 py-1 text-xs font-medium text-slate-100 transition hover:bg-slate-700 text-left cursor-pointer"
                >
                  Radar
                </button>
                <button
                  id="btn-satellite"
                  className="rounded px-2 py-1 text-xs font-medium text-slate-100 transition hover:bg-slate-700 text-left cursor-pointer"
                >
                  Satellite
                </button>
                <button
                  id="btn-both"
                  className="rounded px-2 py-1 text-xs font-medium text-slate-100 transition hover:bg-slate-700 text-left cursor-pointer"
                >
                  Both
                </button>
                <button
                  id="btn-infrared"
                  className="rounded px-2 py-1 text-xs font-medium text-slate-100 transition hover:bg-slate-700 text-left cursor-pointer"
                >
                  Infrared
                </button>
                <div className="h-px bg-slate-700 my-1"></div>
                <button
                  id="btn-precip"
                  className="rounded px-2 py-1 text-xs font-medium text-slate-100 transition hover:bg-slate-700 active text-left cursor-pointer"
                >
                  Precip
                </button>
                <button
                  id="btn-pressure"
                  className="rounded px-2 py-1 text-xs font-medium text-slate-100 transition hover:bg-slate-700 active text-left cursor-pointer"
                >
                  Pressure
                </button>
                <button
                  id="btn-wind"
                  className="rounded px-2 py-1 text-xs font-medium text-slate-100 transition hover:bg-slate-700 active text-left cursor-pointer"
                >
                  Wind
                </button>
                <div className="h-px bg-slate-700 my-1"></div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const nextVal = !showEnsemble;
                    setShowEnsemble(nextVal);
                    if (nextVal) {
                      setShowOutlookWeek1(false);
                      setShowOutlookWeek2(false);
                      setShowStrikeProb(false);
                    }
                  }}
                  className={`rounded px-2 py-1 text-xs font-medium text-left cursor-pointer transition ${showEnsemble ? "bg-cyan-900/60 text-cyan-100 outline outline-1 outline-cyan-500/50" : "text-slate-100 hover:bg-slate-700"
                    }`}
                >
                  Forecast Track
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const nextVal = !showOutlookWeek1;
                    setShowOutlookWeek1(nextVal);
                    if (nextVal) {
                      setShowEnsemble(false);
                      setShowOutlookWeek2(false);
                      setShowStrikeProb(false);
                    }
                  }}
                  className={`rounded px-2 py-1 text-xs font-medium text-left cursor-pointer transition ${showOutlookWeek1 ? "bg-cyan-900/60 text-cyan-100 outline outline-1 outline-cyan-500/50" : "text-slate-100 hover:bg-slate-700"
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
                      setShowEnsemble(false);
                      setShowOutlookWeek1(false);
                      setShowStrikeProb(false);
                    }
                  }}
                  className={`rounded px-2 py-1 text-xs font-medium text-left cursor-pointer transition ${showOutlookWeek2 ? "bg-amber-900/60 text-amber-100 outline outline-1 outline-amber-500/50" : "text-slate-100 hover:bg-slate-700"
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
                      setShowEnsemble(false);
                      setShowOutlookWeek1(false);
                      setShowOutlookWeek2(false);
                    }
                  }}
                  className={`rounded px-2 py-1 text-xs font-medium text-left cursor-pointer transition ${showStrikeProb ? "bg-cyan-900/60 text-cyan-100 outline outline-1 outline-cyan-500/50" : "text-slate-100 hover:bg-slate-700"
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
            <CycloneMapLogic />
          </LeafletCustomControl>

          <EnsembleLayerLogic data={showEnsemble ? ensembleData : null} />
          <OutlookLayerLogic data={showOutlookWeek1 ? outlookWeek1Data : null} onSelectArea={setSelectedArea} week={1} />
          <OutlookLayerLogic data={showOutlookWeek2 ? outlookWeek2Data : null} onSelectArea={setSelectedArea} week={2} />
          {showStrikeProb && (
            <StrikeProbabilityLayerLogic
              variable={strikeVariable}
              day={strikeDay}
              onLoadMeta={setStrikeMeta}
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
            {/* Strike Probability Gradient Bar Legend at the top of the dock */}
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
