// GarbinWx Public API Service Proxy for Common Alerting Protocol (CAP) Alerts
// Direct, read-only feed of near real-time weather alerts issued by PAGASA.

let memoryCache = {
  data: null,
  expiresAt: 0,
};

const GARBINWX_ALERTS_URL = "https://data.garbinwx.org/api/cap-alerts.json";
const CACHE_TTL_MS = 60 * 1000; // 60-second caching to prevent API abuse

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const now = Date.now();

    // Serve from memory cache if valid
    if (memoryCache.data && now < memoryCache.expiresAt) {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
      res.setHeader("X-Cache", "HIT");
      return res.status(200).json(memoryCache.data);
    }

    // Fetch from GarbinWx Public API
    const response = await fetch(GARBINWX_ALERTS_URL, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "PhilippineWeatherApp/2.0 (contact@garbinwx.org)",
      },
    });

    if (!response.ok) {
      throw new Error(`GarbinWx API returned HTTP ${response.status}`);
    }

    const data = await response.json();

    // Sanitize alerts: filter any potential rogue script tags or placeholder notes
    if (data && data.data && Array.isArray(data.data.alert_data)) {
      data.data.alert_data = data.data.alert_data.filter((a) => {
        if (!a) return false;
        const h = String(a.headline || "");
        const m = String(a.message || "");
        if (h.includes("<script") || m.includes("<script")) return false;
        if (a.event === "NOTE" && a.subtype === "NOTE") return false;
        return true;
      });
      data.data.alert_count = data.data.alert_data.length;
    }

    // Update in-memory cache
    memoryCache = {
      data,
      expiresAt: now + CACHE_TTL_MS,
    };

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
    res.setHeader("X-Cache", "MISS");
    return res.status(200).json(data);
  } catch (error) {
    console.error("GarbinWx CAP Alerts Fetch Error:", error);

    // If cache has stale data, return it instead of failing
    if (memoryCache.data) {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("X-Cache", "STALE");
      return res.status(200).json(memoryCache.data);
    }

    res.setHeader("Content-Type", "application/json");
    return res.status(200).json({
      success: false,
      data: { alert_data: [], alert_count: 0 },
      error: error.message,
    });
  }
}
