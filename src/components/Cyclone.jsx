import React, { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, LayersControl, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { getStormDisplayName } from "../utils/stormNaming";

const { BaseLayer } = LayersControl;

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

    // Country borders style
    const countryStyle = {
      color: "#334155",
      weight: 1,
      opacity: 0.6,
      fillOpacity: 0,
    };

    // Load Country Borders (Public GeoJSON)
    fetch(
      "https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson"
    )
      .then((response) => response.json())
      .then((data) => L.geoJSON(data, { style: countryStyle }).addTo(map))
      .catch((error) =>
        console.error("Error loading country borders:", error)
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
              /<p><strong>Location:<\/strong> \d+\.\d+°N, \d+\.\d+°E<\/p>/,
              `<p><strong>Location:<\/strong> ${newLat.toFixed(
                2
              )}°N, ${newLon.toFixed(2)}°E<\/p>`
            );
          s.marker.setPopupContent(popupContent);
        }
      }
    }

    function processStormData(data) {
      stormLayer.clearLayers();
      stormMarkers = {};

      const sizeMap = {
        LPA: [28, 28],
        TD: [28, 28],
        TS: [32, 32],
        STS: [36, 36],
        TY: [40, 40],
        STY: [46, 46],
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
            html: `
              <div class="relative rounded-full shadow-md ring-2 ring-offset-[2px] ring-offset-slate-900" style="background:${categoryInfo.color
              };">
                <div class="flex h-8 w-8 items-center justify-center text-[11px] font-semibold text-slate-900">
                  ${categoryInfo.abbrev}
                </div>
              </div>
            `,
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
                    <div class="p-4 bg-white/90 dark:bg-gray-800/90 rounded-lg shadow-md">
                        <h3 style="color: ${categoryInfo.color
          }; margin-bottom: 0.5rem; font-size: 1.125rem; font-weight: 600;">
                            ${displayName}
                        </h3>
                        <div class="text-sm space-y-1 text-gray-700 dark:text-gray-300">
                            <p><strong>Category:</strong> ${categoryInfo.category
          }</p>
                            <p><strong>10-min Sustained Wind:</strong> ${winds10MinKph} km/h</p>
                            <p><strong>Estimated Max Gust:</strong> ${gustKph} km/h</p>
                            <p><strong>Pressure:</strong> ${pressure} hPa</p>
                            <p><strong>Location:</strong> ${latitude.toFixed(
            2
          )}°N, ${longitude.toFixed(2)}°E</p>
                            ${movementHtml}
                        </div>
                        <hr class="my-2 border-gray-200 dark:border-gray-700">
                        <p class="text-xs text-gray-500 dark:text-gray-400">Last updated: ${new Date(
            storm.last_updated
          ).toLocaleString()}</p>
                    </div>
                `,
          { maxWidth: 300, className: "storm-tooltip" }
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

      if (data.length > 0) {
        const first = data[0];
        const parts = first.interp_sector_file.split(/\s+/);
        if (parts.length >= 6) {
          const lat = parseFloat(parts[4]);
          const lon = parseFloat(parts[5]);
          if (!isNaN(lat) && !isNaN(lon)) {
            map.panTo([lat, lon]);
          }
        }
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

    // RainViewer API & Animation
    let apiData = {};
    let mapFrames = [];
    let lastPastFramePosition = -1;
    let latestFrameIndex = -1;
    let radarLayers = {};
    let satOverlayLayer = null; // for Radar + Satellite combined mode
    let optionKind = "satellite"; // dataset driving animation: "radar" or "satellite"
    let displayMode = "satellite"; // UI mode: "radar" | "satellite" | "both" | "none"
    const optionTileSize = 256;
    let optionColorScheme = 2;
    const optionSmoothData = 1;
    const optionSnowColors = 1;
    let optionExtension = "webp";
    let animationPosition = 0;
    let animationTimer = false;
    let loadingTilesCount = 0;
    let loadedTilesCount = 0;

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
        // Follow RainViewer docs: satellite uses different color scheme but same extension
        const colorScheme =
          optionKind === "satellite"
            ? optionColorScheme == 255
              ? 255
              : 0
            : optionColorScheme;
        const smooth = optionKind === "satellite" ? 0 : optionSmoothData;
        const snow = optionKind === "satellite" ? 0 : optionSnowColors;

        const source = new L.TileLayer(
          `${apiData.host}${frame.path}/${optionTileSize}/{z}/{x}/{y}/${colorScheme}/${smooth}_${snow}.${optionExtension}`,
          { tileSize: optionTileSize, opacity: 0.01, zIndex: frame.time }
        );
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
      // Restore latest frame as the current view when stopped
      if (latestFrameIndex >= 0 && latestFrameIndex < mapFrames.length) {
        animationPosition = latestFrameIndex;
        showFrame(animationPosition, true);
      }
      if (satOverlayLayer) {
        satOverlayLayer.setOpacity(0.6);
      }
      if (btnPlay) btnPlay.textContent = "Play";
      // Ensure we switch back to live/latest time for markers
      updateStormPositions();
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
          : mapFrames.length;
      let next = animationPosition + 1;
      if (next >= endIndex || next < 0) {
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
      for (let key in radarLayers) {
        map.removeLayer(radarLayers[key]);
      }
      radarLayers = {};
      mapFrames = [];
      if (satOverlayLayer) {
        map.removeLayer(satOverlayLayer);
        satOverlayLayer = null;
      }
      timestampEl.innerHTML = "";
    }

    function initialize(api, kind) {
      stop();
      clearRadarLayers();
      animationPosition = 0;



      radarControls.style.display = "flex";

      if (!api) return;

      if (kind === "satellite") {
        // Satellite / Infrared only
        optionKind = "satellite";
        if (api.satellite && api.satellite.infrared && api.satellite.infrared.length) {
          mapFrames = api.satellite.infrared;
          lastPastFramePosition = api.satellite.infrared.length - 1;
          latestFrameIndex = mapFrames.length - 1;
          // Start on the latest available frame as the current frame
          animationPosition = latestFrameIndex;
          showFrame(animationPosition, true);
        } else if (api.radar && api.radar.past && api.radar.past.length) {
          console.warn("RainViewer: No satellite infrared frames available, falling back to radar.");
          optionKind = "radar";
          mapFrames = api.radar.past;
          if (api.radar.nowcast) mapFrames = mapFrames.concat(api.radar.nowcast);
          lastPastFramePosition = api.radar.past.length - 1;
          latestFrameIndex = mapFrames.length - 1;
          animationPosition = latestFrameIndex;
          showFrame(animationPosition, true);
        }
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

    }

    function setKind(kind) {
      displayMode = kind;
      updateButtonStates(displayMode);
      initialize(apiData, kind);
    }

    const apiRequest = new XMLHttpRequest();
    apiRequest.open(
      "GET",
      "https://api.rainviewer.com/public/weather-maps.json",
      true
    );
    apiRequest.onload = () => {
      apiData = JSON.parse(apiRequest.response);
      // Initialize with default display mode (satellite/Infrared)
      setKind(displayMode);
    };
    apiRequest.send();

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

    if (btnPlay) {
      btnPlay.addEventListener("click", () => playStop());
    }

    return () => {
      clearInterval(stormInterval);
      clearInterval(positionInterval);
      document.onkeydown = null;
      map.removeLayer(stormLayer);
      map.removeLayer(parLayer);
      clearRadarLayers();
      if (btnRadar) btnRadar.replaceWith(btnRadar.cloneNode(true));
      if (btnSatellite) btnSatellite.replaceWith(btnSatellite.cloneNode(true));
      if (btnBoth) btnBoth.replaceWith(btnBoth.cloneNode(true));

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

const Cyclone = () => {
  const center = [12.8797, 121.774]; // Approx center of the Philippines
  const [isFullscreen, setIsFullscreen] = useState(false);
  const wrapperRef = useRef(null);

  const toggleFullscreen = () => {
    setIsFullscreen((prev) => !prev);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <div className="max-w-6xl mx-auto px-4 py-8 w-full">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight mb-2">
          Tropical Cyclone Track
        </h1>
        <p className="text-sm md:text-base text-slate-400 mb-4 max-w-2xl">
          Interactive map for visualizing tropical cyclone tracks over the
          Philippines.
        </p>
        <div
          ref={wrapperRef}
          className={
            isFullscreen
              ? "fixed inset-0 z-[9999] bg-black w-screen h-screen m-0 p-0 block"
              : "relative rounded-xl overflow-hidden border border-slate-800 shadow-lg bg-slate-900/60"
          }
        >
          <MapContainer
            center={center}
            zoom={5}
            scrollWheelZoom={true}
            className={isFullscreen ? "w-full h-full" : "w-full h-[60vh]"}
            style={{ height: isFullscreen ? "100vh" : "60vh", width: "100%" }}
          >
            <ResizeOnFullscreen isFullscreen={isFullscreen} />
            <FullscreenControl
              isFullscreen={isFullscreen}
              onToggle={toggleFullscreen}
            />
            <LayersControl position="topright">
              <BaseLayer name="Satellite">
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution="&copy; OpenStreetMap contributors"
                />
              </BaseLayer>
              <BaseLayer checked name="Dark Mode">
                <TileLayer
                  url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                  attribution="&copy; OpenStreetMap contributors &copy; Philippine Typhoon/Weather"
                />
              </BaseLayer>
            </LayersControl>
            <CycloneMapLogic />
          </MapContainer>
          <div
            id="cyclone-loading"
            className="pointer-events-none absolute top-4 left-1/2 z-[1200] -translate-x-1/2 rounded-full bg-slate-900/80 px-4 py-1 text-xs font-medium text-sky-300 shadow-lg backdrop-blur-md"
          >
            Loading storm data...
          </div>
          <div
            id="radar-controls"
            className="absolute bottom-4 left-4 z-[1200] flex min-w-[260px] flex-col gap-2 rounded-lg bg-slate-900/85 p-3 text-xs text-slate-100 shadow-lg backdrop-blur-md"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex gap-1">
                <button
                  id="btn-radar"
                  className="rounded-md bg-slate-700/80 px-2 py-1 text-[11px] font-medium hover:bg-slate-600"
                >
                  Radar
                </button>
                <button
                  id="btn-satellite"
                  className="rounded-md bg-sky-500 px-2 py-1 text-[11px] font-medium text-slate-900 ring ring-sky-400 ring-offset-1 hover:bg-sky-400"
                >
                  Infrared
                </button>
                <button
                  id="btn-both"
                  className="rounded-md bg-slate-700/80 px-2 py-1 text-[11px] font-medium hover:bg-slate-600"
                >
                  Radar + Satellite
                </button>

              </div>
              <button
                id="btn-play"
                className="rounded-full border border-slate-600/70 px-2 py-1 text-[11px] hover:bg-slate-700/80"
              >
                Play
              </button>
            </div>
            <div className="flex items-center justify-between gap-2">
              <p
                id="radar-timestamp"
                className="line-clamp-1 text-[11px] text-slate-300"
              ></p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Cyclone;
