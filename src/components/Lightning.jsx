import React, { useState, useEffect, useMemo, useRef } from "react";
import { io } from "socket.io-client";
import {
  Zap,
  RefreshCw,
  Info,
  MapPin,
  Maximize2,
  ShieldAlert,
  Sliders,
  Radio,
  Timer,
  Globe,
  Layers,
  Sparkles,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Activity,
  Wifi,
  WifiOff,
  Database
} from "lucide-react";

const LIGHTNING_URL = "/api/lightning?token=uvNBtXqdMnd3T80OTGjmEY9c3UEjAlOCajt2AoEu&parameter=ten_minute_frequency";

// Robust Philippine Standard Time (UTC+8) manual parser to guarantee accurate browser-independent absolute relative age calculations
const parsePHDateToMs = (dateStr) => {
  if (!dateStr) return 0;
  try {
    const parts = dateStr.trim().split(" ");
    if (parts.length !== 2) return 0;
    const dateParts = parts[0].split("-");
    const timeParts = parts[1].split(":");
    if (dateParts.length !== 3 || timeParts.length !== 3) return 0;

    const year = parseInt(dateParts[0], 10);
    const month = parseInt(dateParts[1], 10) - 1;
    const day = parseInt(dateParts[2], 10);
    const hour = parseInt(timeParts[0], 10);
    const minute = parseInt(timeParts[1], 10);
    const second = parseInt(timeParts[2], 10);

    // PH time is UTC+8, so subtract 8 hours to get UTC representation
    return Date.UTC(year, month, day, hour - 8, minute, second);
  } catch (e) {
    return 0;
  }
};

const getStrikeColor = (ageMs) => {
  const ageMin = ageMs / 60000;
  if (ageMin <= 5) return "#ef4444"; // Bright red
  if (ageMin <= 10) return "#f97316"; // Orange
  if (ageMin <= 20) return "#eab308"; // Yellow
  if (ageMin <= 30) return "#84cc16"; // Light green
  if (ageMin <= 40) return "#22c55e"; // Green
  if (ageMin <= 50) return "#06b6d4"; // Cyan
  if (ageMin <= 90) return "#3b82f6"; // Blue
  return null;
};

const getAgeRangeLabel = (val) => {
  if (val === 1) return "Live (<1m)";
  return `${val}m`;
};

const Lightning = () => {
  const [geoData, setGeoData] = useState(null);
  const [lightningData, setLightningData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState("Disconnected");
  const [activeRegion, setActiveRegion] = useState("All");
  const [timeRange, setTimeRange] = useState(90); // default to show all 90 mins
  const [selectedAgeCategory, setSelectedAgeCategory] = useState(null); // '0-5' | '5-10' | '10-20' | '20-30' | '30-40' | '40-50' | '50-90' | null
  const [hoveredStrike, setHoveredStrike] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [showLabels, setShowLabels] = useState(false);
  const [isMobileCollapsed, setIsMobileCollapsed] = useState(true);
  const [nowTime, setNowTime] = useState(Date.now());

  // Zoom and Pan States
  const [zoomScale, setZoomScale] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const mapContainerRef = useRef(null);
  const canvasRef = useRef(null);
  const strikeBufferRef = useRef([]);

  // 1. Dynamic bounds and projection mapping logic
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
    ) {
      return "Mindanao";
    }
    return "Luzon";
  };

  const mapData = useMemo(() => {
    if (!geoData) return null;

    let minLon = 180, maxLon = -180;
    let minLat = 90, maxLat = -90;

    // Scan coordinates to find strict bounding box limits
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

    geoData.features.forEach((f) => {
      findBounds(f.geometry.coordinates);
    });

    // Dynamic projection function inside useMemo
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

    // Calculate strict bounding box enclosing each island group (matching WeatherAdvisory)
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

    // Extract overlay paths for Laguna de Bay, Taal Lake, and Taal Volcano to mask colors
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

    let taalLakePath = "";
    let taalVolcanoPath = "";
    if (batangasFeature && batangasFeature.geometry.type === "MultiPolygon") {
      const coords = batangasFeature.geometry.coordinates;
      if (coords[2] && coords[2][1]) {
        taalLakePath = projectRing(coords[2][1]);
      }
      if (coords[3] && coords[3][0]) {
        taalVolcanoPath = projectRing(coords[3][0]);
      }
    }

    let lagunaDeBayPath = "";
    if (lagunaFeature && lagunaFeature.geometry.type === "Polygon") {
      const coords = lagunaFeature.geometry.coordinates;
      if (coords[2]) {
        lagunaDeBayPath = projectRing(coords[2]);
      }
    }

    return {
      features: projectedFeatures,
      bounds,
      canvasWidth,
      canvasHeight,
      lagunaDeBayPath,
      taalLakePath,
      taalVolcanoPath,
      project: localProject
    };
  }, [geoData]);

  const project = mapData?.project || ((lon, lat) => {
    // Fallback static projection
    const minLon = 114.0;
    const maxLon = 128.0;
    const minLat = 4.0;
    const maxLat = 22.0;
    const x = ((lon - minLon) / (maxLon - minLon)) * canvasWidth;
    const y = ((maxLat - lat) / (maxLat - minLat)) * canvasHeight;
    return [x, y];
  });

  const projectedStrikes = useMemo(() => {
    return lightningData.map(s => {
      const [x, y] = project(s.lon, s.lat);
      return { ...s, x, y };
    });
  }, [lightningData, project]);

  // Active regional viewBox selection
  const activeViewBox = useMemo(() => {
    if (!mapData) return "0 0 1000 1400";
    const b = mapData.bounds[activeRegion];
    if (!b) return "0 0 1000 1400";
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    return `${b.minX.toFixed(1)} ${b.minY.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`;
  }, [mapData, activeRegion]);

  // Map mouse coordinate projection handler
  const handleSvgMouseMove = (e) => {
    if (isDragging) {
      handleMouseMove(e);
      return;
    }

    const svg = e.currentTarget;
    const group = svg.querySelector("g");
    if (!group || filteredStrikes.length === 0) return;

    // Track mouse position relative to map container for tooltip placement
    const containerRect = mapContainerRef.current?.getBoundingClientRect();
    if (containerRect) {
      setTooltipPos({
        x: e.clientX - containerRect.left,
        y: e.clientY - containerRect.top
      });
    }

    const point = svg.createSVGPoint();
    point.x = e.clientX;
    point.y = e.clientY;

    try {
      const svgPoint = point.matrixTransform(group.getScreenCTM().inverse());
      
      let closest = null;
      let minDist = Math.max(4, 18 / zoomScale); // Keep hover threshold constant on screen!

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
    } catch (err) {
      // Fallback
    }
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const scaleFactor = 0.15;
    const nextScale = e.deltaY < 0 ? zoomScale + scaleFactor : zoomScale - scaleFactor;
    setZoomScale(Math.min(6, Math.max(1, nextScale)));
  };

  const handleMouseDown = (e) => {
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

  const handleTouchStart = (e) => {
    if (e.touches.length < 1) return;
    setIsDragging(true);
    setDragStart({ x: e.touches[0].clientX - panOffset.x, y: e.touches[0].clientY - panOffset.y });
  };

  const handleTouchMove = (e) => {
    if (!isDragging || e.touches.length < 1) return;
    setPanOffset({
      x: e.touches[0].clientX - dragStart.x,
      y: e.touches[0].clientY - dragStart.y
    });
  };

  // Reset manual zoom/pan when activeRegion is changed
  useEffect(() => {
    setZoomScale(1);
    setPanOffset({ x: 0, y: 0 });
  }, [activeRegion]);

  // Load boundaries
  useEffect(() => {
    fetch("/data/ph_provinces.json")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load maps");
        return res.json();
      })
      .then((data) => setGeoData(data))
      .catch((err) => console.error("Error loading boundaries:", err));
  }, []);

  const parseStrike = (item) => {
    const lat = parseFloat(item.latitude !== undefined ? item.latitude : item.lat);
    const lon = parseFloat(item.longitude !== undefined ? item.longitude : item.lon);
    if (isNaN(lat) || isNaN(lon)) return null;

    let timeMs = Date.now();
    if (item.time !== undefined) {
      timeMs = typeof item.time === 'number' ? item.time : new Date(item.time).getTime();
    } else if (item.observed_at !== undefined) {
      timeMs = parsePHDateToMs(item.observed_at);
    }

    if (isNaN(timeMs)) timeMs = Date.now();

    return {
      id: `strike-${timeMs}-${lat.toFixed(4)}-${lon.toFixed(4)}-${Math.random()}`,
      lat,
      lon,
      amplitude: parseFloat(item.peakCurrent !== undefined ? item.peakCurrent : (item.amplitude || 0)),
      height: parseFloat(item.icHeight !== undefined ? item.icHeight : (item.height || 0)),
      observedAtMs: timeMs
    };
  };

  // REST API seed data loader (loads recent strikes on mount)
  const fetchInitialLightning = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${LIGHTNING_URL}&cachebust=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const rawList = json && json.data ? json.data : [];

      const parsed = rawList
        .map(item => parseStrike(item))
        .filter(item => item !== null);

      strikeBufferRef.current = [...parsed, ...strikeBufferRef.current];
      
      const now = Date.now();
      const cutoff = now - (90 * 60 * 1000);
      
      setLightningData(
        strikeBufferRef.current
          .filter(s => s.observedAtMs >= cutoff)
          .sort((a, b) => b.observedAtMs - a.observedAtMs)
      );
    } catch (err) {
      console.error("Failed to load initial lightning strikes:", err);
      setError("Unable to load initial lightning strikes.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInitialLightning();
  }, []);

  // Socket.io real-time listener
  useEffect(() => {
    const socket = io(window.location.origin, {
      path: "/socket.io/",
      transports: ["polling", "websocket"]
    });

    socket.on("connect", () => {
      setConnectionStatus("Connected");
    });

    socket.on("connect_error", () => {
      setConnectionStatus("Reconnecting");
    });

    socket.on("disconnect", () => {
      setConnectionStatus("Disconnected");
    });

    socket.on("lx.data", (payload) => {
      const items = Array.isArray(payload) ? payload : [payload];
      const parsedItems = items
        .map(item => parseStrike(item))
        .filter(item => item !== null);

      if (parsedItems.length > 0) {
        strikeBufferRef.current.push(...parsedItems);
      }
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Throttled buffer flush & memory prune loop (runs every 1 second)
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setNowTime(now);
      const cutoff = now - (90 * 60 * 1000);

      // Prune in-memory buffer ref
      strikeBufferRef.current = strikeBufferRef.current.filter(
        s => s.observedAtMs >= cutoff
      );

      // Flush to state
      setLightningData(prev => {
        const activePrev = prev.filter(s => s.observedAtMs >= cutoff);
        const newItems = strikeBufferRef.current;

        const existingKeys = new Set(activePrev.map(s => `${s.observedAtMs}-${s.lat.toFixed(4)}-${s.lon.toFixed(4)}`));
        const uniqueNew = newItems.filter(s => {
          const key = `${s.observedAtMs}-${s.lat.toFixed(4)}-${s.lon.toFixed(4)}`;
          if (existingKeys.has(key)) return false;
          existingKeys.add(key);
          return true;
        });

        if (uniqueNew.length === 0 && activePrev.length === prev.length) {
          return prev;
        }

        return [...uniqueNew, ...activePrev].sort((a, b) => b.observedAtMs - a.observedAtMs);
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Virtual timeline reference point based on the latest strike in our buffer (to handle feed latency or system clock drift)
  const latestStrikeTime = useMemo(() => {
    if (lightningData.length === 0) return Date.now();
    return Math.max(...lightningData.map(s => s.observedAtMs));
  }, [lightningData]);

  // Filter strikes based on selected timeRange & activeRegion
  const filteredStrikes = useMemo(() => {
    const cutoff = latestStrikeTime - (timeRange * 60 * 1000);
    return projectedStrikes.filter((s) => {
      if (s.observedAtMs < cutoff) return false;
      
      if (activeRegion !== "All" && mapData) {
        const b = mapData.bounds[activeRegion];
        if (s.x < b.minX || s.x > b.maxX || s.y < b.minY || s.y > b.maxY) {
          return false;
        }
      }
      return true;
    });
  }, [projectedStrikes, timeRange, activeRegion, mapData, latestStrikeTime]);

  // Compute counts for all selectors
  const rangeCounts = useMemo(() => {
    const counts = { 1: 0, 5: 0, 10: 0, 20: 0, 30: 0, 40: 0, 50: 0, 90: 0 };
    projectedStrikes.forEach(s => {
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
  }, [projectedStrikes, latestStrikeTime]);

  // General statistics block
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
      totalInMemory: lightningData.length
    };
  }, [filteredStrikes, lightningData, mapData]);

  // Canvas drawing effect
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    // Set internal backing store dimensions scaled by device pixel ratio
    canvas.width = 1000 * dpr;
    canvas.height = 1400 * dpr;

    // Scale context back to normal coordinates (0-1000, 0-1400)
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, 1000, 1400);

    filteredStrikes.forEach(s => {
      const ageMs = latestStrikeTime - s.observedAtMs;
      const color = getStrikeColor(ageMs);
      if (!color) return;

      const ageMin = ageMs / 60000;

      // Adjust draw radius relative to current map zoom scale
      const baseRadius = ageMs <= 300000 ? 5.5 : 3.5;
      const radius = Math.max(0.7, baseRadius / zoomScale);

      // Disable shadow blur for halos to maintain drawing performance
      ctx.shadowBlur = 0;

      // Draw multi-layered glow for recent strikes (<= 15 minutes)
      if (ageMin <= 15) {
        // Outer halo (very wide and transparent)
        ctx.beginPath();
        ctx.arc(s.x, s.y, radius * 3.5, 0, 2 * Math.PI);
        ctx.fillStyle = color + "1a"; // ~10% opacity
        ctx.fill();

        // Mid glow ring (medium width and semi-transparent)
        ctx.beginPath();
        ctx.arc(s.x, s.y, radius * 2.0, 0, 2 * Math.PI);
        ctx.fillStyle = color + "4d"; // ~30% opacity
        ctx.fill();
      }

      // Main inner core circle
      ctx.beginPath();
      ctx.arc(s.x, s.y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = ageMin <= 3 ? "#ffffff" : color; // White hot center for extremely fresh strikes!
      
      // Native canvas glow/shadow effect (only for recent strikes <= 5 mins)
      if (ageMs <= 300000) {
        ctx.shadowBlur = Math.max(3, 12 / zoomScale);
        ctx.shadowColor = color;
      } else {
        ctx.shadowBlur = 0;
      }
      ctx.fill();

      // UI/UX Improvement: Draw a glowing target ring around the hovered strike
      if (hoveredStrike && hoveredStrike.id === s.id) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, radius * 4.0, 0, 2 * Math.PI);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = Math.max(0.8, 2.0 / zoomScale);
        ctx.shadowBlur = Math.max(5, 16 / zoomScale);
        ctx.shadowColor = color;
        ctx.stroke();
      }

      // Reset shadow blur for the next iteration
      ctx.shadowBlur = 0;
    });
  }, [filteredStrikes, zoomScale, latestStrikeTime, hoveredStrike]);

  // Active Warning Zones
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
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist <= 48) {
          provHits[feat.name].count++;
        }
      });
    });

    return Object.values(provHits)
      .filter(p => p.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [mapData, filteredStrikes]);

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

        {/* Dynamic Zooming Map */}
        {mapData ? (
          <svg
            className={`w-auto h-full max-h-full max-w-full aspect-[1000/1400] relative z-10 select-none transition-all ${
              isDragging ? "cursor-grabbing" : "cursor-grab"
            }`}
            viewBox={activeViewBox}
            style={{
              filter: "drop-shadow(0 25px 50px rgba(0, 0, 0, 0.75))",
            }}
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
                {mapData.features.map((feature) => {
                  return (
                    <path
                      key={feature.id}
                      d={feature.d}
                      fill="#334155"
                      stroke="rgba(15, 23, 42, 0.4)"
                      strokeWidth="0.8"
                      strokeLinejoin="round"
                      className="transition-all duration-200 hover:fill-[#142035] hover:stroke-sky-500/70 hover:stroke-[1.3px]"
                    />
                  );
                })}
              </g>

              {/* Uncolored Overlays to cover warning colors/background in Laguna de Bay and Taal Volcano */}
              <g pointerEvents="none">
                {mapData.lagunaDeBayPath && (
                  <path d={mapData.lagunaDeBayPath} fill="#000000" stroke="#223049" strokeWidth={0.85} />
                )}
                {mapData.taalLakePath && (
                  <path d={mapData.taalLakePath} fill="#000000" stroke="#223049" strokeWidth={0.85} />
                )}
                {mapData.taalVolcanoPath && (
                  <path d={mapData.taalVolcanoPath} fill="#000000" stroke="#223049" strokeWidth={0.85} />
                )}
              </g>

              {/* Pulsing severe lightning alert circles at centroids */}
              <g className="pointer-events-none">
                {activeWarningZones.slice(0, 3).map((feat) => {
                  if (!feat.centroid) return null;
                  return (
                    <g key={`warn-${feat.name}`} transform={`translate(${feat.centroid[0]}, ${feat.centroid[1]})`}>
                      <circle
                        r={Math.max(12, 35 / zoomScale)}
                        fill="none"
                        stroke="#ef4444"
                        strokeWidth={Math.max(0.5, 1.5 / zoomScale)}
                        opacity="0.4"
                        className="animate-ping"
                        style={{ transformOrigin: "center" }}
                      />
                      <circle
                        r={Math.max(4, 10 / zoomScale)}
                        fill="#ef4444"
                        opacity="0.75"
                        className="animate-pulse"
                      />
                    </g>
                  );
                })}
              </g>

              {/* Canvas overlaid rendering for high performance */}
              <foreignObject x="0" y="0" width="1000" height="1400" className="pointer-events-none">
                <canvas
                  ref={canvasRef}
                  width="1000"
                  height="1400"
                  className="w-full h-full pointer-events-none"
                />
              </foreignObject>

              {/* Centroid indicators if labels toggled */}
              {showLabels && (
                <g className="pointer-events-none select-none font-mono">
                  {mapData.features.map((feat) => (
                    <g key={`lbl-${feat.id}`} transform={`translate(${feat.centroid[0]}, ${feat.centroid[1]})`}>
                      <text
                        y="3"
                        textAnchor="middle"
                        fill="rgba(100, 116, 139, 0.4)"
                        fontSize="7"
                        fontWeight="bold"
                      >
                        {feat.name}
                      </text>
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
              <button
                onClick={() => setZoomScale(Math.min(6, zoomScale + 0.5))}
                className="px-2.5 py-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 transition-all font-black text-xs cursor-pointer"
                title="Zoom In"
              >
                ＋
              </button>
              <button
                onClick={() => setZoomScale(Math.max(1, zoomScale - 0.5))}
                className="px-2.5 py-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 transition-all font-black text-xs cursor-pointer"
                title="Zoom Out"
              >
                －
              </button>
              <button
                onClick={() => { setZoomScale(1); setPanOffset({ x: 0, y: 0 }); }}
                className="px-2.5 py-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 transition-all font-black text-[10px] cursor-pointer"
                title="Reset Map Zoom"
              >
                ⟲
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 pointer-events-auto">
            {/* Show labels */}
            <button
              onClick={() => setShowLabels(!showLabels)}
              className={`p-2 rounded-xl text-xs font-semibold backdrop-blur-md border shadow-lg flex items-center justify-center gap-1.5 transition-all duration-300 cursor-pointer ${
                showLabels
                  ? "bg-sky-600/80 text-white border-sky-500"
                  : "bg-slate-950/80 text-slate-400 border-slate-800 hover:bg-slate-900/80"
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
                <h3 className="font-extrabold text-slate-100 text-[11px] tracking-wide uppercase">
                  Lightning Discharge
                </h3>
                <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                  {(latestStrikeTime - hoveredStrike.observedAtMs) < 60000 
                    ? `Live ${Math.round((latestStrikeTime - hoveredStrike.observedAtMs) / 1000)}s ago`
                    : `${Math.floor((latestStrikeTime - hoveredStrike.observedAtMs) / 60000)}m ago`}
                </p>
              </div>
              <Zap className="w-3.5 h-3.5 text-amber-400" />
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

      {/* ── SIDEBAR PANEL (TECHNICAL LIGHTNING MONITOR STYLE) ── */}
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
                    className="p-2.5 rounded-xl border bg-slate-950/20 border-slate-900 flex justify-between items-center transition-all hover:bg-slate-900/10"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.7)]" />
                      <div>
                        <span className="text-xs font-black text-white">{feat.name}</span>
                        <span className="text-[9px] text-slate-500 block uppercase tracking-wider font-mono">
                          {feat.group} • {feat.region.split("(")[0].trim()}
                        </span>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-[10px] font-black text-amber-400">
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
                {filteredStrikes.slice(0, 15).map((s) => {
                  const ageMs = latestStrikeTime - s.observedAtMs;
                  const color = getStrikeColor(ageMs) || "#475569";
                  return (
                    <div
                      key={s.id}
                      className="p-2 rounded-lg border border-slate-900 bg-slate-950/20 flex justify-between items-center hover:border-slate-800 transition-all"
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
                    </div>
                  );
                })}
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

    </div>
  );
};

export default Lightning;
