// Lightning Data Processing Worker
// Offloads heavy array manipulations, parsing, deduplication, and geometric projections

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

    return Date.UTC(year, month, day, hour - 8, minute, second);
  } catch (e) {
    return 0;
  }
};

let strikeBuffer = [];
let params = {
  timeRange: 90, // minutes
  activeRegion: "All",
  mapInfo: null // { bounds, minLon, maxLon, minLat, maxLat, canvasWidth, canvasHeight }
};

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
    // Generate a reproducible key to prevent duplicates
    key: `${timeMs}-${lat.toFixed(4)}-${lon.toFixed(4)}`,
    id: `strike-${timeMs}-${lat.toFixed(4)}-${lon.toFixed(4)}-${Math.random()}`,
    lat,
    lon,
    amplitude: parseFloat(item.peakCurrent !== undefined ? item.peakCurrent : (item.amplitude || 0)),
    height: parseFloat(item.icHeight !== undefined ? item.icHeight : (item.height || 0)),
    observedAtMs: timeMs
  };
};

const processStrikes = () => {
  const now = Date.now();
  const memoryCutoff = now - (90 * 60 * 1000); // hard limit 90 mins

  // 1. Prune memory
  strikeBuffer = strikeBuffer.filter(s => s.observedAtMs >= memoryCutoff);

  const latestStrikeTime = strikeBuffer.length > 0 ? Math.max(...strikeBuffer.map(s => s.observedAtMs)) : now;
  const filterCutoff = latestStrikeTime - (params.timeRange * 60 * 1000);

  const filtered = [];
  
  for (let i = 0; i < strikeBuffer.length; i++) {
    const s = strikeBuffer[i];
    
    // Time filter
    if (s.observedAtMs < filterCutoff) continue;

    // Coordinate Projection
    let x = 0, y = 0;
    if (params.mapInfo) {
      const { minLon, maxLon, minLat, maxLat, canvasWidth, canvasHeight } = params.mapInfo;
      x = ((s.lon - minLon) / (maxLon - minLon)) * canvasWidth;
      y = ((maxLat - s.lat) / (maxLat - minLat)) * canvasHeight;
      s.x = x;
      s.y = y;

      // Region filter
      if (params.activeRegion !== "All" && params.mapInfo.bounds) {
        const b = params.mapInfo.bounds[params.activeRegion];
        if (b) {
          if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) {
            continue;
          }
        }
      }
    } else {
      // Fallback projection
      x = ((s.lon - 114.0) / (128.0 - 114.0)) * 1000;
      y = ((22.0 - s.lat) / (22.0 - 4.0)) * 1400;
      s.x = x;
      s.y = y;
    }

    filtered.push(s);
  }

  // Sort by time descending (newest first)
  filtered.sort((a, b) => b.observedAtMs - a.observedAtMs);

  postMessage({
    type: 'UPDATE',
    filteredStrikes: filtered,
    totalInMemory: strikeBuffer.length,
    latestStrikeTime
  });
};

self.onmessage = (e) => {
  const { type, payload } = e.data;

  if (type === 'ADD_STRIKES') {
    const items = Array.isArray(payload) ? payload : [payload];
    const newParsed = [];
    items.forEach(item => {
      const p = parseStrike(item);
      if (p) newParsed.push(p);
    });

    if (newParsed.length > 0) {
      // Deduplicate before adding
      const existingKeys = new Set(strikeBuffer.map(s => s.key));
      const uniqueNew = newParsed.filter(s => {
        if (existingKeys.has(s.key)) return false;
        existingKeys.add(s.key);
        return true;
      });
      strikeBuffer.push(...uniqueNew);
      processStrikes();
    }
  } else if (type === 'SET_PARAMS') {
    params = { ...params, ...payload };
    processStrikes();
  }
};

// Automatic 1-second maintenance loop
setInterval(processStrikes, 1000);
