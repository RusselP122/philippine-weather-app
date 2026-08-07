import React, { useState, useEffect, useMemo, useRef } from "react";
import { io } from "socket.io-client";
import { Radio, Layers } from "lucide-react";
import LightningPanel from "./Lightning/LightningPanel";
import LightningWorker from "../workers/lightningWorker?worker";
import { getStrikeColor } from "../data/lightningConfig";

const LIGHTNING_URL = "/api/lightning?token=uvNBtXqdMnd3T80OTGjmEY9c3UEjAlOCajt2AoEu&parameter=ten_minute_frequency";

const Lightning = () => {
  const [geoData, setGeoData] = useState(null);
  const [filteredStrikes, setFilteredStrikes] = useState([]);
  const [totalInMemory, setTotalInMemory] = useState(0);
  const [latestStrikeTime, setLatestStrikeTime] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState("Disconnected");
  const [activeRegion, setActiveRegion] = useState("All");
  const [timeRange, setTimeRange] = useState(90);
  const [selectedAgeCategory, setSelectedAgeCategory] = useState(null);
  const [hoveredStrike, setHoveredStrike] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [showLabels, setShowLabels] = useState(false);
  const [isMobileCollapsed, setIsMobileCollapsed] = useState(true);

  // Zoom and Pan States
  const [zoomScale, setZoomScale] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const mapContainerRef = useRef(null);
  const canvasRef = useRef(null);
  const workerRef = useRef(null);
  const hoverThrottleRef = useRef(null);

  const canvasWidth = 1000;
  const canvasHeight = 1400;

  const getIslandGroup = (region) => {
    if (!region) return "Luzon";
    const r = region.toLowerCase();
    if (r.includes("visayas")) return "Visayas";
    if (
      r.includes("zamboanga") ||
      r.includes("mindanao") ||
      r.includes("davao") ||
      r.includes("soccsksargen") ||
      r.includes("caraga") ||
      r.includes("bangsamoro") ||
      r.includes("muslim")
    ) return "Mindanao";
    return "Luzon";
  };

  const mapData = useMemo(() => {
    if (!geoData) return null;

    let minLon = 180, maxLon = -180;
    let minLat = 90, maxLat = -90;

    const findBounds = (c) => {
      if (typeof c[0] === 'number') {
        const [lon, lat] = c;
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      } else {
        c.forEach(findBounds);
      }
    };

    geoData.features.forEach((f) => findBounds(f.geometry.coordinates));

    const localProject = (lon, lat) => {
      const x = ((lon - minLon) / (maxLon - minLon)) * canvasWidth;
      const y = ((maxLat - lat) / (maxLat - minLat)) * canvasHeight;
      return [x, y];
    };

    const projectedFeatures = geoData.features.map((f) => {
      const provName = f.properties.PROV_NAME || f.properties.PROVINCE || f.properties.NAME_1 || f.properties.name || "Unknown";
      const region = f.properties.REGION || "";
      const group = getIslandGroup(region);

      const generateD = (coords, type) => {
        if (type === "Polygon") {
          return coords.map(ring => {
            return ring.map((coord, index) => {
              const [x, y] = localProject(coord[0], coord[1]);
              return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
            }).join(' ') + ' Z';
          }).join(' ');
        } else if (type === "MultiPolygon") {
          return coords.map(poly => {
            return poly.map(ring => {
              return ring.map((coord, index) => {
                const [x, y] = localProject(coord[0], coord[1]);
                return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
              }).join(' ') + ' Z';
            }).join(' ');
          }).join(' ');
        }
        return "";
      };

      const d = generateD(f.geometry.coordinates, f.geometry.type);

      let sumX = 0, sumY = 0, count = 0;
      const getCentroid = (c) => {
        if (typeof c[0] === 'number') {
          const [lon, lat] = c;
          const [x, y] = localProject(lon, lat);
          sumX += x;
          sumY += y;
          count++;
        } else {
          c.forEach(getCentroid);
        }
      };
      getCentroid(f.geometry.coordinates);

      return {
        id: f.properties.ID_1 || provName,
        name: provName,
        region,
        group,
        d,
        centroid: count > 0 ? [sumX / count, sumY / count] : [canvasWidth / 2, canvasHeight / 2]
      };
    });

    const bounds = {
      All: { minX: 0, maxX: 1000, minY: 0, maxY: canvasHeight },
      Luzon: { minX: canvasWidth, maxX: 0, minY: canvasHeight, maxY: 0 },
      Visayas: { minX: canvasWidth, maxX: 0, minY: canvasHeight, maxY: 0 },
      Mindanao: { minX: canvasWidth, maxX: 0, minY: canvasHeight, maxY: 0 }
    };

    projectedFeatures.forEach((f) => {
      const g = f.group;
      const originalFeature = geoData.features.find(
        (orig) =>
          (orig.properties.ID_1 || orig.properties.PROV_NAME || orig.properties.PROVINCE || orig.properties.NAME_1) === f.id ||
          orig.properties.PROV_NAME === f.name
      );

      if (originalFeature) {
        const updateBounds = (c) => {
          if (typeof c[0] === 'number') {
            const [lon, lat] = c;
            const [x, y] = localProject(lon, lat);
            if (x < bounds[g].minX) bounds[g].minX = x;
            if (x > bounds[g].maxX) bounds[g].maxX = x;
            if (y < bounds[g].minY) bounds[g].minY = y;
            if (y > bounds[g].maxY) bounds[g].maxY = y;
          } else {
            c.forEach(updateBounds);
          }
        };
        updateBounds(originalFeature.geometry.coordinates);
      }
    });

    Object.keys(bounds).forEach((key) => {
      if (key === "All") return;
      const b = bounds[key];
      const w = b.maxX - b.minX;
      const h = b.maxY - b.minY;
      const padX = w * 0.08;
      const padY = h * 0.08;
      bounds[key] = {
        minX: Math.max(0, b.minX - padX),
        maxX: Math.min(canvasWidth, b.maxX + padX),
        minY: Math.max(0, b.minY - padY),
        maxY: Math.min(canvasHeight, b.maxY + padY)
      };
    });

    // Batangas / Laguna lakes overlays
    const batangasFeature = geoData.features.find(f => {
      const name = f.properties.PROV_NAME || f.properties.PROVINCE || f.properties.NAME_1 || f.properties.name || "";
      return name === "Batangas";
    });
    const lagunaFeature = geoData.features.find(f => {
      const name = f.properties.PROV_NAME || f.properties.PROVINCE || f.properties.NAME_1 || f.properties.name || "";
      return name === "Laguna";
    });

    const projectRing = (ring) => {
      return ring.map((coord, index) => {
        const [x, y] = localProject(coord[0], coord[1]);
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ') + ' Z';
    };

    let taalLakePath = "", taalVolcanoPath = "", lagunaDeBayPath = "";
    if (batangasFeature && batangasFeature.geometry.type === "MultiPolygon") {
      const coords = batangasFeature.geometry.coordinates;
      if (coords[2] && coords[2][1]) taalLakePath = projectRing(coords[2][1]);
      if (coords[3] && coords[3][0]) taalVolcanoPath = projectRing(coords[3][0]);
    }
    if (lagunaFeature && lagunaFeature.geometry.type === "Polygon") {
      const coords = lagunaFeature.geometry.coordinates;
      if (coords[2]) lagunaDeBayPath = projectRing(coords[2]);
    }

    return {
      features: projectedFeatures,
      bounds,
      canvasWidth,
      canvasHeight,
      minLon, maxLon, minLat, maxLat,
      lagunaDeBayPath,
      taalLakePath,
      taalVolcanoPath,
      project: localProject
    };
  }, [geoData]);

  const project = mapData?.project || ((lon, lat) => {
    const minLon = 114.0, maxLon = 128.0, minLat = 4.0, maxLat = 22.0;
    const x = ((lon - minLon) / (maxLon - minLon)) * canvasWidth;
    const y = ((maxLat - lat) / (maxLat - minLat)) * canvasHeight;
    return [x, y];
  });

  // Load geoData bounds
  useEffect(() => {
    fetch("/data/ph_provinces.json")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load maps");
        return res.json();
      })
      .then((data) => setGeoData(data))
      .catch((err) => console.error("Error loading boundaries:", err));
  }, []);

  // Initialize Web Worker and networking
  useEffect(() => {
    workerRef.current = new LightningWorker();
    
    workerRef.current.onmessage = (e) => {
      if (e.data.type === 'UPDATE') {
        setFilteredStrikes(e.data.filteredStrikes);
        setTotalInMemory(e.data.totalInMemory);
        setLatestStrikeTime(e.data.latestStrikeTime);
      }
    };

    const fetchInitialLightning = async () => {
      try {
        setLoading(true);
        const res = await fetch(`${LIGHTNING_URL}&cachebust=${Date.now()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const rawList = json && json.data ? json.data : [];
        if (workerRef.current) workerRef.current.postMessage({ type: 'ADD_STRIKES', payload: rawList });
      } catch (err) {
        console.error("Failed to load initial lightning strikes:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchInitialLightning();

    const socket = io(window.location.origin, {
      path: "/socket.io/",
      transports: ["polling", "websocket"]
    });

    socket.on("connect", () => setConnectionStatus("Connected"));
    socket.on("connect_error", () => setConnectionStatus("Reconnecting"));
    socket.on("disconnect", () => setConnectionStatus("Disconnected"));
    socket.on("lx.data", (payload) => {
      if (workerRef.current) workerRef.current.postMessage({ type: 'ADD_STRIKES', payload });
    });

    return () => {
      if (workerRef.current) workerRef.current.terminate();
      socket.disconnect();
    };
  }, []);

  // Send params to Web Worker whenever they change
  useEffect(() => {
    if (workerRef.current) {
      const payload = { timeRange, activeRegion };
      if (mapData) {
        payload.mapInfo = {
          bounds: mapData.bounds,
          minLon: mapData.minLon,
          maxLon: mapData.maxLon,
          minLat: mapData.minLat,
          maxLat: mapData.maxLat,
          canvasWidth,
          canvasHeight
        };
      }
      workerRef.current.postMessage({ type: 'SET_PARAMS', payload });
    }
  }, [mapData, activeRegion, timeRange]);

  const activeViewBox = useMemo(() => {
    if (!mapData) return "0 0 1000 1400";
    const b = mapData.bounds[activeRegion];
    if (!b) return "0 0 1000 1400";
    return `${b.minX.toFixed(1)} ${b.minY.toFixed(1)} ${(b.maxX - b.minX).toFixed(1)} ${(b.maxY - b.minY).toFixed(1)}`;
  }, [mapData, activeRegion]);

  const rangeCounts = useMemo(() => {
    const counts = { 1: 0, 5: 0, 10: 0, 20: 0, 30: 0, 40: 0, 50: 0, 90: 0 };
    filteredStrikes.forEach(s => {
      const ageMin = (latestStrikeTime - s.observedAtMs) / 60000;
      if (ageMin <= 1) counts[1]++;
      if (ageMin <= 5) counts[5]++;
      if (ageMin <= 10) counts[10]++;
      if (ageMin <= 20) counts[20]++;
      if (ageMin <= 30) counts[30]++;
      if (ageMin <= 40) counts[40]++;
      if (ageMin <= 50) counts[50]++;
      if (ageMin <= 90) counts[90]++;
    });
    return counts;
  }, [filteredStrikes, latestStrikeTime]);

  const stats = useMemo(() => {
    let maxAmp = 0;
    const regionCounts = { Luzon: 0, Visayas: 0, Mindanao: 0 };
    filteredStrikes.forEach(s => {
      const absAmp = Math.abs(s.amplitude);
      if (absAmp > maxAmp) maxAmp = absAmp;
      if (mapData) {
        ["Luzon", "Visayas", "Mindanao"].forEach(r => {
          const b = mapData.bounds[r];
          if (b && s.x >= b.minX && s.x <= b.maxX && s.y >= b.minY && s.y <= b.maxY) {
            regionCounts[r]++;
          }
        });
      }
    });
    let mostActive = "None";
    let maxHits = 0;
    Object.keys(regionCounts).forEach(r => {
      if (regionCounts[r] > maxHits) {
        maxHits = regionCounts[r];
        mostActive = r;
      }
    });
    return {
      totalVisible: filteredStrikes.length,
      maxAmplitude: maxAmp,
      mostActiveRegion: mostActive,
      totalInMemory
    };
  }, [filteredStrikes, totalInMemory, mapData]);

  const activeWarningZones = useMemo(() => {
    if (!mapData || filteredStrikes.length === 0) return [];
    const provHits = {};
    mapData.features.forEach((feature) => {
      provHits[feature.name] = {
        name: feature.name,
        group: feature.group,
        region: feature.region,
        count: 0,
        centroid: feature.centroid
      };
    });
    filteredStrikes.forEach((s) => {
      mapData.features.forEach((feat) => {
        if (!feat.centroid) return;
        const dx = s.x - feat.centroid[0];
        const dy = s.y - feat.centroid[1];
        if (Math.sqrt(dx * dx + dy * dy) <= 48) {
          provHits[feat.name].count++;
        }
      });
    });
    return Object.values(provHits).filter(p => p.count > 0).sort((a, b) => b.count - a.count).slice(0, 5);
  }, [mapData, filteredStrikes]);

  const handleSvgMouseMove = (e) => {
    if (isDragging) {
      handleMouseMove(e);
      return;
    }
    const svg = e.currentTarget;
    const group = svg.querySelector("g");
    if (!group || filteredStrikes.length === 0) return;

    const containerRect = mapContainerRef.current?.getBoundingClientRect();
    if (containerRect) {
      setTooltipPos({ x: e.clientX - containerRect.left, y: e.clientY - containerRect.top });
    }

    const point = svg.createSVGPoint();
    point.x = e.clientX;
    point.y = e.clientY;
    const svgPoint = point.matrixTransform(group.getScreenCTM().inverse());

    if (hoverThrottleRef.current) return;
    hoverThrottleRef.current = requestAnimationFrame(() => {
      let closest = null;
      let minDist = Math.max(4, 18 / zoomScale);
      filteredStrikes.forEach(s => {
        const dx = s.x - svgPoint.x;
        const dy = s.y - svgPoint.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minDist) {
          minDist = dist;
          closest = s;
        }
      });
      setHoveredStrike(closest);
      hoverThrottleRef.current = null;
    });
  };

  const handleWheel = (e) => {
    e.preventDefault();
    setZoomScale(Math.min(6, Math.max(1, e.deltaY < 0 ? zoomScale + 0.15 : zoomScale - 0.15)));
  };
  const handleMouseDown = (e) => { setIsDragging(true); setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y }); };
  const handleMouseMove = (e) => { if (isDragging) setPanOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }); };
  const handleMouseUp = () => setIsDragging(false);
  const handleTouchStart = (e) => { if (e.touches.length > 0) { setIsDragging(true); setDragStart({ x: e.touches[0].clientX - panOffset.x, y: e.touches[0].clientY - panOffset.y }); } };
  const handleTouchMove = (e) => { if (isDragging && e.touches.length > 0) setPanOffset({ x: e.touches[0].clientX - dragStart.x, y: e.touches[0].clientY - dragStart.y }); };

  useEffect(() => { setZoomScale(1); setPanOffset({ x: 0, y: 0 }); }, [activeRegion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = 1000 * dpr;
    canvas.height = 1400 * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, 1000, 1400);

    filteredStrikes.forEach(s => {
      const ageMs = latestStrikeTime - s.observedAtMs;
      const color = getStrikeColor(ageMs);
      if (!color) return;

      const ageMin = ageMs / 60000;
      if (selectedAgeCategory) {
        let inCat = false;
        if (selectedAgeCategory === '0-5' && ageMin <= 5) inCat = true;
        if (selectedAgeCategory === '5-10' && ageMin > 5 && ageMin <= 10) inCat = true;
        if (selectedAgeCategory === '10-20' && ageMin > 10 && ageMin <= 20) inCat = true;
        if (selectedAgeCategory === '20-30' && ageMin > 20 && ageMin <= 30) inCat = true;
        if (selectedAgeCategory === '30-40' && ageMin > 30 && ageMin <= 40) inCat = true;
        if (selectedAgeCategory === '40-50' && ageMin > 40 && ageMin <= 50) inCat = true;
        if (selectedAgeCategory === '50-90' && ageMin > 50 && ageMin <= 90) inCat = true;
        if (!inCat) return;
      }

      const radius = Math.max(0.7, (ageMs <= 300000 ? 5.5 : 3.5) / zoomScale);
      ctx.shadowBlur = 0;

      if (ageMin <= 15) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, radius * 3.5, 0, 2 * Math.PI);
        ctx.fillStyle = color + "1a";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(s.x, s.y, radius * 2.0, 0, 2 * Math.PI);
        ctx.fillStyle = color + "4d";
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(s.x, s.y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = ageMin <= 3 ? "#ffffff" : color;
      
      if (ageMs <= 300000) {
        ctx.shadowBlur = Math.max(3, 12 / zoomScale);
        ctx.shadowColor = color;
      }
      ctx.fill();

      if (hoveredStrike && hoveredStrike.id === s.id) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, radius * 4.0, 0, 2 * Math.PI);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = Math.max(0.8, 2.0 / zoomScale);
        ctx.shadowBlur = Math.max(5, 16 / zoomScale);
        ctx.shadowColor = color;
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    });
  }, [filteredStrikes, zoomScale, latestStrikeTime, hoveredStrike, selectedAgeCategory]);

  return (
    <div className="relative h-[calc(100vh-64px)] w-full bg-slate-950 font-sans overflow-hidden flex flex-col md:flex-row">
      <style>{`
        .bg-grid {
            background-image: linear-gradient(to right, rgba(51, 65, 85, 0.15) 1px, transparent 1px),
                              linear-gradient(to bottom, rgba(51, 65, 85, 0.15) 1px, transparent 1px);
            background-size: 80px 80px;
        }
      `}</style>

      {/* ── MAP CONTAINER ── */}
      <div
        ref={mapContainerRef}
        className={`relative w-full transition-all duration-500 ease-in-out bg-black overflow-hidden flex items-center justify-center border-b md:border-b-0 border-slate-900 ${
          isMobileCollapsed ? "h-[calc(100vh-120px)]" : "h-[40vh]"
        } md:h-full md:flex-1`}
      >
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_center,rgba(15,23,42,0.3)_0%,rgba(0,0,0,1)_95%)] bg-grid" />

        {mapData ? (
          <svg
            className={`w-auto h-full max-h-full max-w-full aspect-[1000/1400] relative z-10 select-none transition-all ${
              isDragging ? "cursor-grabbing" : "cursor-grab"
            }`}
            viewBox={activeViewBox}
            style={{ filter: "drop-shadow(0 25px 50px rgba(0, 0, 0, 0.75))" }}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleSvgMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => { handleMouseUp(); setHoveredStrike(null); }}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleMouseUp}
          >
            <g
              style={{
                transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomScale})`,
                transformOrigin: "50% 50%",
                transition: isDragging ? "none" : "transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)"
              }}
            >
              {/* Lat/Lon Grid lines behind landmasses */}
              <g stroke="#223049" strokeWidth="0.5" strokeDasharray="3 3" opacity="0.25" className="pointer-events-none">
                {[5, 10, 15, 20].map(lat => {
                  const [_, y] = project(114, lat);
                  return <line key={`lat-${lat}`} x1="0" y1={y} x2="1000" y2={y} />;
                })}
                {[115, 120, 125].map(lon => {
                  const [x, _] = project(lon, 4);
                  return <line key={`lon-${lon}`} x1={x} y1="0" x2={x} y2="1400" />;
                })}
              </g>

              {/* Grid labels */}
              <g fill="rgba(100, 116, 139, 0.35)" fontSize="8.5" fontFamily="monospace" className="select-none pointer-events-none">
                {[5, 10, 15, 20].map(lat => {
                  const [_, y] = project(114.3, lat);
                  return <text key={`lat-lbl-${lat}`} x="8" y={y - 4}>{lat}°N</text>;
                })}
                {[115, 120, 125].map(lon => {
                  const [x, _] = project(lon, 21.6);
                  return <text key={`lon-lbl-${lon}`} x={x + 4} y="20">{lon}°E</text>;
                })}
              </g>

              {/* Base provinces */}
              <g opacity="0.95">
                {mapData.features.map((feature) => (
                  <path
                    key={feature.id}
                    d={feature.d}
                    fill="#334155"
                    stroke="rgba(15, 23, 42, 0.4)"
                    strokeWidth="0.8"
                    strokeLinejoin="round"
                    className="transition-all duration-200 hover:fill-[#142035] hover:stroke-sky-500/70 hover:stroke-[1.3px]"
                  />
                ))}
              </g>

              {/* Uncolored Overlays to cover warning colors/background in Laguna de Bay and Taal Volcano */}
              <g pointerEvents="none">
                {mapData.lagunaDeBayPath && <path d={mapData.lagunaDeBayPath} fill="#000000" stroke="#223049" strokeWidth={0.85} />}
                {mapData.taalLakePath && <path d={mapData.taalLakePath} fill="#000000" stroke="#223049" strokeWidth={0.85} />}
                {mapData.taalVolcanoPath && <path d={mapData.taalVolcanoPath} fill="#000000" stroke="#223049" strokeWidth={0.85} />}
              </g>

              {/* Pulsing severe lightning alert circles at centroids */}
              <g className="pointer-events-none">
                {activeWarningZones.slice(0, 3).map((feat) => {
                  if (!feat.centroid) return null;
                  return (
                    <g key={`warn-${feat.name}`} transform={`translate(${feat.centroid[0]}, ${feat.centroid[1]})`}>
                      <circle r={Math.max(12, 35 / zoomScale)} fill="none" stroke="#ef4444" strokeWidth={Math.max(0.5, 1.5 / zoomScale)} opacity="0.4" className="animate-ping" style={{ transformOrigin: "center" }} />
                      <circle r={Math.max(4, 10 / zoomScale)} fill="#ef4444" opacity="0.75" className="animate-pulse" />
                    </g>
                  );
                })}
              </g>

              {/* Canvas overlaid rendering for high performance */}
              <foreignObject x="0" y="0" width="1000" height="1400" className="pointer-events-none">
                <canvas ref={canvasRef} width="1000" height="1400" className="w-full h-full pointer-events-none" />
              </foreignObject>

              {/* Centroid indicators if labels toggled */}
              {showLabels && (
                <g className="pointer-events-none select-none font-mono">
                  {mapData.features.map((feat) => (
                    <g key={`lbl-${feat.id}`} transform={`translate(${feat.centroid[0]}, ${feat.centroid[1]})`}>
                      <text y="3" textAnchor="middle" fill="rgba(100, 116, 139, 0.4)" fontSize="7" fontWeight="bold">{feat.name}</text>
                    </g>
                  ))}
                </g>
              )}
            </g>
          </svg>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3">
            <Radio className="w-10 h-10 text-sky-400 animate-pulse" />
            <span className="text-slate-500 font-mono text-xs">Generating coordinate projection matrices...</span>
          </div>
        )}

        {/* Controllers */}
        <div className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between gap-3 pointer-events-none flex-wrap">
          <div className="flex gap-2 pointer-events-auto">
            {/* Island selection */}
            <div className="bg-slate-950/80 backdrop-blur-md p-1 rounded-xl border border-slate-800/80 shadow-2xl flex gap-1">
              {["All", "Luzon", "Visayas", "Mindanao"].map((region) => (
                <button
                  key={region}
                  onClick={() => setActiveRegion(region)}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-bold tracking-wide uppercase transition-all duration-300 cursor-pointer ${
                    activeRegion === region
                      ? "bg-sky-500 text-slate-950 font-black shadow-md shadow-sky-550/20"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/50"
                  }`}
                >
                  {region}
                </button>
              ))}
            </div>

            {/* Manual Zoom Controls */}
            <div className="bg-slate-950/80 backdrop-blur-md p-1 rounded-xl border border-slate-800/80 shadow-2xl flex gap-1">
              <button onClick={() => setZoomScale(Math.min(6, zoomScale + 0.5))} className="px-2.5 py-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 transition-all font-black text-xs cursor-pointer" title="Zoom In">＋</button>
              <button onClick={() => setZoomScale(Math.max(1, zoomScale - 0.5))} className="px-2.5 py-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 transition-all font-black text-xs cursor-pointer" title="Zoom Out">－</button>
              <button onClick={() => { setZoomScale(1); setPanOffset({ x: 0, y: 0 }); }} className="px-2.5 py-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 transition-all font-black text-[10px] cursor-pointer" title="Reset Map Zoom">⟲</button>
            </div>
          </div>

          <div className="flex items-center gap-2 pointer-events-auto">
            <button
              onClick={() => setShowLabels(!showLabels)}
              className={`p-2 rounded-xl text-xs font-semibold backdrop-blur-md border shadow-lg flex items-center justify-center gap-1.5 transition-all duration-300 cursor-pointer ${
                showLabels ? "bg-sky-600/80 text-white border-sky-500" : "bg-slate-950/80 text-slate-400 border-slate-800 hover:bg-slate-900/80"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{showLabels ? "Hide Map Labels" : "Show Map Labels"}</span>
            </button>
          </div>
        </div>

        {/* ── TOOLTIP (DESKTOP) ── */}
        {hoveredStrike && (
          <div
            className="hidden md:flex absolute z-50 pointer-events-none w-60 rounded-xl border border-slate-800 bg-slate-950/95 p-3.5 text-slate-200 shadow-2xl backdrop-blur-lg flex flex-col gap-2 transition-opacity"
            style={{
              left: tooltipPos.x + 15,
              top: tooltipPos.y + 15,
              transform: tooltipPos.x > (mapContainerRef.current?.getBoundingClientRect().width - 260 || 700) ? 'translateX(-110%)' : 'none'
            }}
          >
            <div className="flex justify-between items-start border-b border-slate-900 pb-2">
              <div>
                <h3 className="font-extrabold text-slate-100 text-[11px] tracking-wide uppercase">Lightning Discharge</h3>
                <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                  {(latestStrikeTime - hoveredStrike.observedAtMs) < 60000 
                    ? `Live ${Math.round((latestStrikeTime - hoveredStrike.observedAtMs) / 1000)}s ago`
                    : `${Math.floor((latestStrikeTime - hoveredStrike.observedAtMs) / 60000)}m ago`}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-[9.5px] font-mono leading-relaxed">
              <div className="bg-slate-900/40 p-1.5 rounded border border-slate-850">
                <span className="text-slate-500 block">Peak Current:</span>
                <span className="text-white font-bold">{hoveredStrike.amplitude.toFixed(1)} A</span>
              </div>
              <div className="bg-slate-900/40 p-1.5 rounded border border-slate-850">
                <span className="text-slate-500 block">Altitude:</span>
                <span className="text-white font-bold">{(hoveredStrike.height / 1000).toFixed(1)} km</span>
              </div>
              <div className="bg-slate-900/40 p-1.5 rounded border border-slate-850">
                <span className="text-slate-500 block">Latitude:</span>
                <span className="text-white font-bold">{hoveredStrike.lat.toFixed(4)}°N</span>
              </div>
              <div className="bg-slate-900/40 p-1.5 rounded border border-slate-850">
                <span className="text-slate-500 block">Longitude:</span>
                <span className="text-white font-bold">{hoveredStrike.lon.toFixed(4)}°E</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <LightningPanel
        isMobileCollapsed={isMobileCollapsed}
        setIsMobileCollapsed={setIsMobileCollapsed}
        connectionStatus={connectionStatus}
        stats={stats}
        timeRange={timeRange}
        setTimeRange={setTimeRange}
        rangeCounts={rangeCounts}
        filteredStrikes={filteredStrikes}
        latestStrikeTime={latestStrikeTime}
        activeWarningZones={activeWarningZones}
        selectedAgeCategory={selectedAgeCategory}
        setSelectedAgeCategory={setSelectedAgeCategory}
      />
    </div>
  );
};

export default Lightning;
