import React, { useEffect, useState, useMemo } from "react";
import {
  Cloud,
  CloudRain,
  Droplets,
  Eye,
  Moon,
  Sun,
  Thermometer,
  TrendingDown,
  TrendingUp,
  Wind,
  Navigation,
  MapPin,
  Search,
  ArrowRight,
  Calendar,
  Umbrella,
} from "lucide-react";
import PH_LOCATIONS from "../data/ph_locations";

const OPENWEATHERMAP_API_KEY = "138ee97bc2df4029270f36075b709726";

// --- Helper Functions ---

const key = (index) => `key-${index}`;

const formatHourLabel = (isoDate) => {
  if (!isoDate) return "";
  const date = new Date(isoDate);
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    hour12: true,
  });
};

const formatDayLabel = (isoDate, index) => {
  if (index === 0) return "Today";
  const date = new Date(isoDate);
  return date.toLocaleDateString("en-US", { weekday: "long" });
};

const formatLocalDate = (isoDate) => {
  if (!isoDate) return "";
  return new Date(isoDate).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

const formatLocalTime = (isoDate) => {
  if (!isoDate) return "";
  return new Date(isoDate).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
};

const describeConditions = (current, cloudCover) => {
  if (!current) return "";
  if (current.weatherMain) return current.weatherMain;
  if (current.precipProb >= 50) return "Rainy";
  if (cloudCover >= 80) return "Overcast";
  if (cloudCover >= 50) return "Cloudy";
  if (cloudCover >= 20) return "Partly Cloudy";
  return "Clear Sky";
};

const getUVLevel = (uv) => {
  if (uv <= 2) return { level: "Low", color: "text-emerald-400" };
  if (uv <= 5) return { level: "Moderate", color: "text-yellow-400" };
  if (uv <= 7) return { level: "High", color: "text-orange-400" };
  if (uv <= 10) return { level: "Very High", color: "text-red-400" };
  return { level: "Extreme", color: "text-purple-400" };
};

const getVisibilityLevel = (km) => {
  if (km >= 10) return "Excellent";
  if (km >= 5) return "Good";
  if (km >= 2) return "Moderate";
  if (km >= 1) return "Poor";
  return "Very Poor";
};

const getMoonPhaseInfo = (dateIso) => {
  const date = new Date(dateIso);
  let year = date.getFullYear();
  let month = date.getMonth() + 1;
  const day = date.getDate();
  let c = 0,
    e = 0,
    jd = 0,
    b = 0;
  if (month < 3) {
    year--;
    month += 12;
  }
  ++month;
  c = 365.25 * year;
  e = 30.6 * month;
  jd = c + e + day - 694039.09;
  jd /= 29.5305882;
  b = parseInt(jd);
  jd -= b;
  b = Math.round(jd * 8);
  if (b >= 8) b = 0;

  const phases = [
    "New Moon",
    "Waxing Crescent",
    "First Quarter",
    "Waxing Gibbous",
    "Full Moon",
    "Waning Gibbous",
    "Last Quarter",
    "Waning Crescent",
  ];
  return { label: phases[b], illumination: 0.5 }; // Sim simplified
};

const generateWeeklyInsight = (daily, unit = "c") => {
  if (!daily || daily.length === 0) return "No forecast data available.";

  const rainyDays = daily.filter((d) => d.precipProb >= 50);
  const hotDays = daily.filter((d) => d.hi >= (unit === "c" ? 32 : 89.6));

  let insight = "";
  if (rainyDays.length >= 3) {
    insight = "Expect a wet week ahead with frequent rain. Keeping an umbrella handy is recommended.";
  } else if (rainyDays.length > 0) {
    insight = `There's a chance of rain on ${formatDayLabel(rainyDays[0].date, 0).replace("Today", "today")}. Otherwise, mostly dry conditions expected.`;
  } else {
    insight = "It looks like a dry week ahead. Great for outdoor activities.";
  }

  if (hotDays.length >= 3) {
    insight += " Temperatures will be quite high, so stay hydrated and avoid prolonged sun exposure.";
  } else if (daily[0] && daily[0].hi < (unit === "c" ? 25 : 77)) { // Cool threshold
    insight += " Conditions will be relatively cool and comfortable.";
  }

  return insight;
};

// --- Check Location ---
const isWithinPhilippines = (lat, lon) => {
  if (typeof lat !== "number" || typeof lon !== "number") return false;
  return lat >= 4.5 && lat <= 21.5 && lon >= 116 && lon <= 127;
};

// --- Helper for AQI ---
function getAqiInfo(aqi) {
  if (aqi === 1) return { label: "Good", message: "Air quality is considered satisfactory, and air pollution poses little or no risk.", color: "text-emerald-400" };
  if (aqi === 2) return { label: "Fair", message: "Air quality is acceptable; however, for some pollutants there may be a moderate health concern for a very small number of people who are unusually sensitive to air pollution.", color: "text-yellow-400" };
  if (aqi === 3) return { label: "Moderate", message: "Members of sensitive groups may experience health effects. The general public is not likely to be affected.", color: "text-orange-400" };
  if (aqi === 4) return { label: "Poor", message: "Everyone may begin to experience health effects; members of sensitive groups may experience more serious health effects.", color: "text-red-400" };
  if (aqi === 5) return { label: "Very Poor", message: "Health warnings of emergency conditions. The entire population is more likely to be affected.", color: "text-purple-400" };
  return { label: "Unknown", message: "", color: "text-slate-400" };
}

// --- Sub-Components ---

const WeatherHero = ({ current, locationName }) => {
  if (!current) return null;
  return (
    <div className="relative overflow-hidden rounded-3xl bg-white/5 p-8 text-white ring-1 ring-white/10 backdrop-blur-md">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-slate-300 uppercase tracking-wider mb-1">
            <MapPin className="h-4 w-4 text-sky-400" />
            {locationName}
          </div>
          <div className="text-[10px] text-slate-400 mb-6 font-mono">
            {current.time ? new Date(current.time).toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: 'numeric', hour12: true }) : ''}
          </div>

          <div className="flex items-start">
            <span className="text-8xl font-bold tracking-tighter bg-gradient-to-br from-white to-white/60 bg-clip-text text-transparent">
              {current.temp}°
            </span>
          </div>
          <div className="mt-2 flex items-center gap-4 text-sm font-medium text-slate-200">
            <span>H: {current.hi}°</span>
            <span>L: {current.lo}°</span>
            <span>Feels like {current.feelsLike}°</span>
          </div>
        </div>

        <div className="flex flex-col items-start md:items-end gap-2">
          {current.precipProb >= 30 && (
            <div className="flex items-center gap-2 rounded-full bg-sky-500/20 px-4 py-1.5 text-xs text-sky-200 ring-1 ring-sky-500/30">
              <Umbrella className="h-3.5 w-3.5" />
              <span>{current.precipProb}% Rain Chance</span>
            </div>
          )}
          <div className="text-right">
            <p className="text-xl font-semibold">{current.weatherMain || "Clear"}</p>
            <p className="text-sm text-slate-400">{describeConditions(current, current.cloudCover)}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

const MetricCard = ({ icon: Icon, label, value, subtext, color = "slate", className = "" }) => {
  return (
    <div className={`flex flex-col justify-between rounded-2xl bg-white/5 p-5 backdrop-blur-sm ring-1 ring-white/10 transition-all hover:bg-white/10 ${className}`}>
      <div className="flex items-center gap-2 text-slate-400 mb-2">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <div>
        <div className="text-2xl font-bold text-white">{value}</div>
        {subtext && <div className="mt-1 text-xs text-slate-400">{subtext}</div>}
      </div>
    </div>
  );
};

const BentoGrid = ({ current }) => {
  if (!current) return null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {/* UV Index */}
      <MetricCard
        icon={Sun}
        label="UV Index"
        value={current.uvIndex}
        subtext={getUVLevel(current.uvIndex).level}
        color="amber"
        className="md:col-span-1"
      />

      {/* Wind */}
      <div className="col-span-1 md:col-span-1 rounded-2xl bg-white/5 p-5 backdrop-blur-sm ring-1 ring-white/10 flex flex-col justify-between">
        <div className="flex items-center gap-2 text-slate-400">
          <Wind className="h-4 w-4" />
          <span className="text-xs font-semibold uppercase tracking-wider">Wind</span>
        </div>
        <div className="mt-2">
          <div className="text-2xl font-bold text-white">{current.windSpeed} <span className="text-sm font-normal text-slate-400">km/h</span></div>
          <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
            <Navigation className="h-3 w-3" style={{ transform: `rotate(${current.windDir}deg)` }} />
            <span>{current.windDir}°</span>
          </div>
        </div>
      </div>

      {/* Sunrise / Sunset */}
      <div className="col-span-2 md:col-span-2 rounded-2xl bg-white/5 p-5 backdrop-blur-sm ring-1 ring-white/10 flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-slate-400 mb-1">
            <Sun className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-wider">Sun</span>
          </div>
          <div className="flex gap-8">
            <div>
              <div className="text-xs text-slate-500 mb-1">Sunrise</div>
              <div className="text-lg font-bold text-slate-200">{formatLocalTime(current.sunrise)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-1">Sunset</div>
              <div className="text-lg font-bold text-slate-200">{formatLocalTime(current.sunset)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Humidity */}
      <MetricCard
        icon={Droplets}
        label="Humidity"
        value={`${current.humidity}%`}
        subtext={`Dew Point: ${current.dewPoint}°`}
        color="blue"
      />

      {/* Visibility */}
      <MetricCard
        icon={Eye}
        label="Visibility"
        value={`${current.visibility} km`}
        subtext={getVisibilityLevel(parseFloat(current.visibility))}
        color="emerald"
      />

      {/* Pressure */}
      <MetricCard
        icon={TrendingDown}
        label="Pressure"
        value={`${current.pressure} hPa`}
        subtext={current.pressureTrend === "rising" ? "Rising ↑" : current.pressureTrend === "falling" ? "Falling ↓" : "Steady"}
        color="slate"
      />

      {/* Rain */}
      <MetricCard
        icon={CloudRain}
        label="Rainfall"
        value={`${current.rainMm} mm`}
        subtext="Last 3h"
        color="sky"
      />
    </div>
  );
};

const Weather = () => {
  const [selectedId, setSelectedId] = useState("manila");
  const [current, setCurrent] = useState(null);
  const [hourly, setHourly] = useState([]);
  const [daily, setDaily] = useState([]);
  const [cloudCoverNow, setCloudCoverNow] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [unit, setUnit] = useState("c");
  const [favorites, setFavorites] = useState([]);
  const [customLocations, setCustomLocations] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  const [locationError, setLocationError] = useState(null);
  const [recentSearches, setRecentSearches] = useState([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("phWeatherFavorites");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const filtered = parsed.filter((loc) =>
            isWithinPhilippines(loc && loc.lat, loc && loc.lon)
          );
          setFavorites(filtered);
        }
      }
    } catch (err) {
      console.error("Error loading favorites: ", err);
    }
  }, []);

  useEffect(() => {
    try {
      const storedRecent = localStorage.getItem("phWeatherRecent");
      if (storedRecent) {
        const parsed = JSON.parse(storedRecent);
        if (Array.isArray(parsed)) {
          setRecentSearches(parsed);
        }
      }
    } catch (err) {
      console.error("Error loading recent searches: ", err);
    }
  }, []);

  useEffect(() => {
    const allLocations = [...PH_LOCATIONS, ...favorites, ...customLocations];
    const loc =
      allLocations.find((l) => l.id === selectedId) || allLocations[0] || PH_LOCATIONS[0];

    if (!loc) {
      return;
    }

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        if (!OPENWEATHERMAP_API_KEY) {
          throw new Error("OpenWeatherMap API key is not set.");
        }

        // 1. Fetch Current Weather
        const currentUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${loc.lat}&lon=${loc.lon}&units=metric&appid=${OPENWEATHERMAP_API_KEY}`;
        const currentResp = await fetch(currentUrl);
        if (!currentResp.ok) {
          throw new Error(`Current weather HTTP ${currentResp.status}`);
        }
        const currentData = await currentResp.json();

        // 2. Fetch 5-Day / 3-Hour Forecast
        const forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?lat=${loc.lat}&lon=${loc.lon}&units=metric&appid=${OPENWEATHERMAP_API_KEY}`;
        const forecastResp = await fetch(forecastUrl);
        if (!forecastResp.ok) {
          throw new Error(`Forecast HTTP ${forecastResp.status}`);
        }
        const forecastData = await forecastResp.json();

        let aqiIndex = null;
        try {
          const aqiUrl = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${loc.lat}&lon=${loc.lon}&appid=${OPENWEATHERMAP_API_KEY}`;
          const aqiResp = await fetch(aqiUrl);
          if (aqiResp.ok) {
            const aqiData = await aqiResp.json();
            const firstEntry = Array.isArray(aqiData.list) && aqiData.list[0] ? aqiData.list[0] : null;
            if (firstEntry && typeof firstEntry.main?.aqi === "number") {
              aqiIndex = firstEntry.main.aqi;
            }
          }
        } catch (e) {
          console.error("Error fetching AQI: ", e);
        }

        const currentClouds = typeof currentData.clouds?.all === "number" ? currentData.clouds.all : 0;
        setCloudCoverNow(currentClouds);

        // Use sunrise/sunset from current weather sys
        const sunrise = new Date(currentData.sys.sunrise * 1000).toISOString();
        const sunset = new Date(currentData.sys.sunset * 1000).toISOString();

        // Prepare Hourly (from forecast list, take first ~8 items)
        const hourlyItems = forecastData.list.slice(0, 8).map((item) => ({
          time: new Date(item.dt * 1000).toISOString(),
          temp: Math.round(item.main.temp),
          precipProb: Math.round((item.pop || 0) * 100),
          rainMm:
            item.rain && typeof item.rain["3h"] === "number" ? item.rain["3h"] : 0,
          weatherMain: Array.isArray(item.weather) && item.weather[0]
            ? item.weather[0].main
            : "",
        }));
        setHourly(hourlyItems);

        // Group forecast list by day for Daily Outlook
        const dailyMap = {};
        forecastData.list.forEach((item) => {
          const dateKey = item.dt_txt.split(" ")[0];
          if (!dailyMap[dateKey]) {
            dailyMap[dateKey] = {
              temps: [],
              pops: [],
              date: new Date(item.dt * 1000).toISOString(),
            };
          }
          dailyMap[dateKey].temps.push(item.main.temp);
          dailyMap[dateKey].pops.push(item.pop || 0);
        });

        const dailyEntries = Object.entries(dailyMap);
        const dailyItems = dailyEntries.slice(0, 5).map(([dateKey, d]) => {
          const maxTemp = Math.max(...d.temps);
          const minTemp = Math.min(...d.temps);
          const avgPop =
            d.pops.length > 0 ? d.pops.reduce((sum, v) => sum + v, 0) / d.pops.length : 0;
          return {
            date: d.date,
            dateKey,
            hi: Math.round(maxTemp),
            lo: Math.round(minTemp),
            precipProb: Math.round(avgPop * 100),
          };
        });
        setDaily(dailyItems);

        // Current High/Low/Precip from today's aggregated day if available (UTC day)
        const todayKeyUtc = new Date().toISOString().split("T")[0];
        const todayItem =
          dailyItems.find((d) => d.dateKey === todayKeyUtc) || dailyItems[0] || null;

        let pressureTrend = null;
        let pressureDelta = null;
        if (
          typeof currentData.main.pressure === "number" &&
          forecastData.list[0] &&
          typeof forecastData.list[0].main?.pressure === "number"
        ) {
          const futurePressure = forecastData.list[0].main.pressure;
          pressureDelta = futurePressure - currentData.main.pressure;
          if (pressureDelta >= 1) {
            pressureTrend = "rising";
          } else if (pressureDelta <= -1) {
            pressureTrend = "falling";
          } else {
            pressureTrend = "steady";
          }
        }

        const currentRainMm =
          (currentData.rain && (currentData.rain["1h"] || currentData.rain["3h"])) ||
          (hourlyItems[0] ? hourlyItems[0].rainMm : 0);

        const aqiInfo = getAqiInfo(aqiIndex);

        setCurrent({
          locationName: loc.name,
          temp: Math.round(currentData.main.temp),
          feelsLike: Math.round(currentData.main.feels_like || currentData.main.temp),
          windSpeed: Math.round((currentData.wind.speed || 0) * 3.6), // m/s to km/h
          windDir: currentData.wind.deg,
          time: new Date(currentData.dt * 1000).toISOString(),
          hi: todayItem ? todayItem.hi : Math.round(currentData.main.temp),
          lo: todayItem ? todayItem.lo : Math.round(currentData.main.temp),
          precipProb: todayItem ? todayItem.precipProb : 0,
          pressure: typeof currentData.main.pressure === "number" ? currentData.main.pressure : null,
          humidity: typeof currentData.main.humidity === "number" ? currentData.main.humidity : null,
          pressureTrend,
          pressureDelta,
          rainMm: typeof currentRainMm === "number" ? currentRainMm : 0,
          visibility: currentData.visibility ? (currentData.visibility / 1000).toFixed(1) : null,
          dewPoint: currentData.main.temp && currentData.main.humidity
            ? Math.round(currentData.main.temp - ((100 - currentData.main.humidity) / 5))
            : null,
          cloudCover: currentClouds,
          uvIndex: Math.min(11, Math.max(0, Math.round((currentData.main.temp - 15) / 3))),
          aqiIndex: typeof aqiIndex === "number" ? aqiIndex : null,
          aqiLabel: aqiInfo.label,
          aqiMessage: aqiInfo.message,
          sunrise,
          sunset,
        });
      } catch (err) {
        console.error("Error loading weather: ", err);
        setError("Unable to load weather information right now.");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [selectedId, favorites, customLocations]);

  const allLocations = [...PH_LOCATIONS, ...favorites, ...customLocations];
  const selectedLocation =
    allLocations.find((l) => l.id === selectedId) || allLocations[0] || PH_LOCATIONS[0];
  const isCurrentFavorite = favorites.some((f) => f.id === selectedId);

  const hasFavorites = favorites && favorites.length > 0;
  const hasRecentSearches = recentSearches && recentSearches.length > 0;

  // Updated Background Class logic for premium feel
  let premiumBg = "bg-slate-950";
  if (current) {
    // Dynamic logic for premium glassmorphism background
    const isNight = new Date(current.time).getHours() >= 18 || new Date(current.time).getHours() < 6;
    if (current.precipProb >= 50) premiumBg = "bg-gradient-to-br from-slate-950 via-slate-900 to-sky-950";
    else if (isNight) premiumBg = "bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950";
    else premiumBg = "bg-gradient-to-br from-blue-900 via-sky-900 to-slate-900";
  }

  const handleSearchSubmit = async (event) => {
    event.preventDefault();
    const query = searchQuery.trim();
    if (!query) {
      return;
    }
    if (!OPENWEATHERMAP_API_KEY) {
      setLocationError("Search is unavailable. API key is missing.");
      return;
    }
    try {
      setSearchLoading(true);
      setLocationError(null);
      const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(
        `${query},PH`
      )}&limit=5&appid=${OPENWEATHERMAP_API_KEY}`;
      const resp = await fetch(url);
      if (!resp.ok) {
        throw new Error(`Geocoding HTTP ${resp.status}`);
      }
      const data = await resp.json();
      const match = Array.isArray(data)
        ? data.find((item) => item && item.country === "PH")
        : null;
      if (!match || !isWithinPhilippines(match.lat, match.lon)) {
        setLocationError("No matching Philippine city found.");
        return;
      }
      const id = `geo-${match.lat.toFixed(3)}-${match.lon.toFixed(3)}`;
      const nameParts = [match.name, match.state, match.country].filter(Boolean);
      const newLocation = {
        id,
        name: nameParts.join(", "),
        lat: match.lat,
        lon: match.lon,
      };
      setCustomLocations((prev) => {
        if (prev.some((loc) => loc.id === id)) {
          return prev;
        }
        return [...prev, newLocation];
      });
      setSelectedId(id);

      setRecentSearches((prev) => {
        const next = [query, ...prev.filter((q) => q.toLowerCase() !== query.toLowerCase())].slice(0, 5);
        try {
          localStorage.setItem("phWeatherRecent", JSON.stringify(next));
        } catch (err) {
          console.error("Error saving recent searches: ", err);
        }
        return next;
      });
    } catch (err) {
      console.error("Error searching location: ", err);
      setLocationError("Unable to search for that city right now.");
    } finally {
      setSearchLoading(false);
    }
  };

  const handleUseMyLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationError("Geolocation is not available in this environment.");
      return;
    }
    setGeoLoading(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        if (!isWithinPhilippines(latitude, longitude)) {
          setLocationError("Only locations within the Philippines are supported.");
          setGeoLoading(false);
          return;
        }
        const id = `geo-${latitude.toFixed(3)}-${longitude.toFixed(3)}`;
        const newLocation = {
          id,
          name: "Current location",
          lat: latitude,
          lon: longitude,
        };
        setCustomLocations((prev) => {
          const existing = prev.find((loc) => loc.id === id);
          if (existing) {
            return prev.map((loc) => (loc.id === id ? { ...loc, ...newLocation } : loc));
          }
          return [...prev, newLocation];
        });
        setSelectedId(id);
        setGeoLoading(false);
      },
      (err) => {
        console.error("Error getting geolocation: ", err);
        setLocationError("Unable to access your location.");
        setGeoLoading(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
      }
    );
  };

  const handleToggleFavorite = () => {
    const all = [...PH_LOCATIONS, ...favorites, ...customLocations];
    const loc = all.find((l) => l.id === selectedId);
    if (!loc) {
      return;
    }
    let next;
    if (favorites.some((f) => f.id === loc.id)) {
      next = favorites.filter((f) => f.id !== loc.id);
    } else {
      next = [...favorites, { id: loc.id, name: loc.name, lat: loc.lat, lon: loc.lon }];
    }
    setFavorites(next);
    try {
      localStorage.setItem("phWeatherFavorites", JSON.stringify(next));
    } catch (err) {
      console.error("Error saving favorites: ", err);
    }
  };

  const moonPhase = current ? getMoonPhaseInfo(current.time) : null;

  return (
    <div className={`min-h-screen ${premiumBg} text-slate-50 relative selection:bg-sky-500/30 font-sans`}>
      {/* Background noise/texture overlay */}
      <div className="fixed inset-0 z-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='1'/%3E%3C/svg%3E")` }}></div>

      <div className="relative z-10 max-w-6xl mx-auto px-4 py-8 md:px-8">

        {/* Header */}
        <header className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white mb-1">Philippine Weather</h1>
            <p className="text-sm text-slate-400">Real-time local forecasts.</p>
          </div>

          {/* Unified Search & Actions */}
          <div className="flex items-center gap-3 w-full md:w-auto">
            <div className="relative flex-1 md:w-80 group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 group-focus-within:text-sky-400 transition-colors" />
              <input
                type="text"
                placeholder="Search city..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearchSubmit(e)}
                className="w-full rounded-2xl bg-white/5 border border-white/10 py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:bg-white/10 focus:border-sky-500/50 transition-all"
              />
            </div>

            <button
              onClick={handleUseMyLocation}
              className="p-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 transition-colors"
              title="Use my location"
            >
              <Navigation className={`h-5 w-5 ${geoLoading ? 'animate-spin' : ''}`} />
            </button>

            <div className="relative">
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                className="appearance-none p-2.5 pr-8 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 text-sm focus:outline-none cursor-pointer"
              >
                {allLocations.map((loc) => (
                  <option key={loc.id} value={loc.id} className="bg-slate-900">
                    {loc.name}
                  </option>
                ))}
              </select>
              <ArrowRight className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 pointer-events-none rotate-90" />
            </div>
          </div>
        </header>

        {loading ? (
          <div className="flex h-96 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-700 border-t-sky-400"></div>
          </div>
        ) : error ? (
          <div className="rounded-3xl bg-red-500/10 p-8 text-center border border-red-500/20">
            <p className="text-red-300">{error}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Hero */}
            <WeatherHero current={current} locationName={selectedLocation.name} />

            {/* Hourly Scroll */}
            {hourly.length > 0 && (
              <div className="w-full overflow-x-auto pb-4 scrollbar-hide">
                <div className="flex gap-4 min-w-max">
                  {hourly.map((h, i) => (
                    <div key={i} className="flex flex-col items-center gap-2 rounded-2xl bg-white/5 p-4 border border-white/5 min-w-[5rem] hover:bg-white/10 transition-colors">
                      <span className="text-xs text-slate-400">{i === 0 ? 'Now' : formatHourLabel(h.time)}</span>
                      <div className="text-2xl pt-1">
                        {h.precipProb >= 50 ? '🌧️' : h.temp >= 30 ? '☀️' : '☁️'}
                      </div>
                      <span className="text-lg font-bold">{h.temp}°</span>
                      <span className="text-[10px] text-sky-300 font-medium">{h.precipProb > 0 ? `${h.precipProb}%` : ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Bento Grid */}
            <BentoGrid current={current} />

            {/* Daily Forecast List & Insight */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="rounded-3xl bg-white/5 p-6 ring-1 ring-white/10 backdrop-blur-md">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-2">
                  <Calendar className="h-4 w-4" /> 5-DAY FORECAST
                </h3>
                <div className="space-y-4">
                  {daily.map((d, i) => (
                    <div key={i} className="flex items-center justify-between group hover:bg-white/5 p-2 rounded-lg transition-colors">
                      <span className="w-24 font-medium text-slate-200">{formatDayLabel(d.date, i)}</span>
                      <div className="flex items-center gap-2 text-xs text-sky-300 bg-sky-500/10 px-2 py-1 rounded-full w-16 justify-center">
                        <Droplets className="h-3 w-3" /> {d.precipProb}%
                      </div>
                      <div className="flex flex-1 items-center justify-end gap-3 px-4">
                        <span className="text-sm text-slate-400 w-8 text-right">{d.lo}°</span>
                        <div className="h-1.5 flex-1 rounded-full bg-slate-800 overflow-hidden relative max-w-[8rem]">
                          <div className="absolute inset-y-0 rounded-full bg-gradient-to-r from-sky-500 to-amber-400 opacity-80" style={{ left: '10%', right: '10%' }}></div>
                        </div>
                        <span className="text-sm font-bold text-white w-8 text-right">{d.hi}°</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-3xl bg-white/5 p-6 ring-1 ring-white/10 backdrop-blur-md flex flex-col justify-center">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-4">Weekly Insight</h3>
                <div className="text-slate-300 leading-loose text-lg font-light">
                  "{generateWeeklyInsight(daily)}"
                </div>
                <div className="mt-6 flex items-center gap-3 text-xs text-slate-500">
                  <div className="h-px flex-1 bg-slate-800"></div>
                  <span>AI Summary</span>
                  <div className="h-px flex-1 bg-slate-800"></div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Weather;
