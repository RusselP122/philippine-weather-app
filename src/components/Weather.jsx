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
  const [showSuggestions, setShowSuggestions] = useState(false);

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

  const nowIcon = current && current.precipProb >= 50
    ? <div className="text-4xl text-sky-400 drop-shadow-lg">🌧️</div>
    : <div className="text-4xl text-yellow-500 drop-shadow-lg">☀️</div>;

  return (
    <div className={`min-h-screen ${premiumBg} p-4 md:p-10 flex justify-center items-center font-sans text-slate-800 transition-colors duration-1000`}>
      {/* Background noise/texture overlay for added premium aesthetic */}
      <div className="fixed inset-0 z-0 opacity-[0.03] pointer-events-none mix-blend-overlay" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='1'/%3E%3C/svg%3E")` }}></div>

      <div className="max-w-6xl w-full bg-white/30 backdrop-blur-2xl border border-white/50 shadow-2xl shadow-indigo-500/10 rounded-[2.5rem] overflow-hidden flex flex-col lg:flex-row relative z-10 transition-all duration-500">

        {loading ? (
          <div className="flex w-full h-96 items-center justify-center">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-300 border-t-indigo-500 drop-shadow-lg"></div>
          </div>
        ) : error ? (
          <div className="w-full flex items-center justify-center p-10 h-96">
            <div className="rounded-3xl bg-red-500/10 backdrop-blur-md p-8 text-center border border-red-500/20 shadow-xl">
              <p className="text-red-600 font-semibold">{error}</p>
            </div>
          </div>
        ) : current ? (
          <>
            {/* LEFT PANEL - Current Conditions */}
            <div className="w-full lg:w-1/3 p-8 lg:p-10 flex flex-col justify-between relative overflow-hidden bg-white/40 border-r border-white/50">
              <div className="z-10">
                <div className="flex items-center justify-between">
                  <h1 className="text-3xl font-bold tracking-tight text-slate-900 drop-shadow-sm">{selectedLocation.name.split(',')[0]}</h1>
                  <button onClick={handleUseMyLocation} className="text-xl cursor-pointer hover:scale-110 transition-transform bg-white/50 p-2 rounded-full shadow-sm border border-white/60" title="Use My Location">
                    <MapPin className="h-5 w-5 text-indigo-600" />
                  </button>
                </div>
                <p className="text-sm font-medium text-slate-600 mt-2">{selectedLocation.name.includes(',') ? selectedLocation.name.split(',').slice(1).join(',').trim() : "Philippines"}</p>
                <p className="text-xs text-slate-500 mt-1">{formatLocalDate(current.time)}</p>
              </div>

              <div className="flex justify-center items-center py-12 z-10 relative h-64">
                {/* Dynamic Hero Icon based on conditions */}
                {current.precipProb >= 50 ? (
                  <>
                    <div className="absolute w-32 h-32 bg-sky-400 rounded-full blur-3xl opacity-30 animate-pulse"></div>
                    <div className="relative w-40 h-40 flex justify-center items-center">
                      <svg className="w-32 h-32 text-slate-400 drop-shadow-xl animate-float" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M6.62 10.79c-.44-.04-.88-.04-1.32.01A4.5 4.5 0 005.25 19.5h12.5a4.001 4.001 0 002.828-6.828 4.001 4.001 0 00-5.803-1.282 5.5 5.5 0 00-8.155-2.602z" />
                      </svg>
                      <div className="absolute left-10 top-24 w-1.5 h-3 bg-blue-500/80 rounded-full animate-raindrop"></div>
                      <div className="absolute left-16 top-26 w-1.5 h-3 bg-blue-500/80 rounded-full animate-raindrop" style={{ animationDelay: "0.4s" }}></div>
                      <div className="absolute left-22 top-24 w-1.5 h-3 bg-blue-500/80 rounded-full animate-raindrop" style={{ animationDelay: "0.8s" }}></div>
                      <div className="absolute left-28 top-28 w-1.5 h-3 bg-blue-500/80 rounded-full animate-raindrop" style={{ animationDelay: "0.2s" }}></div>
                    </div>
                  </>
                ) : (current.time && (new Date(current.time).getHours() >= 18 || new Date(current.time).getHours() < 6)) ? (
                  // Night time clear
                  <>
                    <div className="absolute w-32 h-32 bg-indigo-300 rounded-full blur-3xl opacity-40 animate-pulse"></div>
                    <div className="relative w-40 h-40 flex justify-center items-center">
                      <svg className="w-32 h-32 text-indigo-200 drop-shadow-[0_0_15px_rgba(199,210,254,0.6)] animate-rock" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"></path>
                      </svg>
                      <div className="absolute top-4 right-4 w-2 h-2 bg-white rounded-full animate-pulse blur-[1px]"></div>
                      <div className="absolute bottom-8 left-4 w-1.5 h-1.5 bg-white rounded-full animate-pulse blur-[1px]" style={{ animationDelay: "1s" }}></div>
                    </div>
                  </>
                ) : (
                  // Day time clear/partly cloudy
                  <>
                    <div className="absolute w-32 h-32 bg-yellow-300 rounded-full blur-3xl opacity-40 animate-pulse"></div>
                    <div className="relative w-40 h-40">
                      <svg className="absolute top-2 right-2 w-28 h-28 text-yellow-400 drop-shadow-lg animate-[spin_20s_linear_infinite]" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2.25a.75.75 0 01.75.75v2.25a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75zM7.5 12a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM18.894 6.166a.75.75 0 00-1.06-1.06l-1.591 1.59a.75.75 0 101.06 1.061l1.591-1.59zM21.75 12a.75.75 0 01-.75.75h-2.25a.75.75 0 010-1.5H21a.75.75 0 01.75.75zM17.834 18.894a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 10-1.061 1.06l1.59 1.591zM12 18.75a.75.75 0 01.75.75V21a.75.75 0 01-1.5 0v-1.5a.75.75 0 01.75-.75zM6.166 18.894a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 10-1.061 1.06l1.59 1.591zM2.25 12a.75.75 0 01.75-.75H5.25a.75.75 0 010 1.5H3a.75.75 0 01-.75-.75zM6.166 5.106a.75.75 0 00-1.06 1.06l1.591 1.59a.75.75 0 101.06-1.061l-1.591-1.59z" />
                      </svg>
                      {current.cloudCover >= 20 && (
                        <svg className="absolute bottom-2 left-0 w-32 h-32 text-white drop-shadow-xl animate-float" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M6.62 10.79c-.44-.04-.88-.04-1.32.01A4.5 4.5 0 005.25 19.5h12.5a4.001 4.001 0 002.828-6.828 4.001 4.001 0 00-5.803-1.282 5.5 5.5 0 00-8.155-2.602z" />
                        </svg>
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className="z-10 text-center lg:text-left">
                <h2 className="text-7xl font-black text-slate-800 tracking-tighter mb-1 drop-shadow-sm">{current.temp}°</h2>
                <h3 className="text-2xl font-bold text-slate-700/90">{describeConditions(current, current.cloudCover)}</h3>
                <div className="mt-5 flex flex-wrap justify-center lg:justify-start gap-3">
                  <span className="px-4 py-1.5 bg-white/50 backdrop-blur-md rounded-full text-xs font-bold text-slate-700 shadow-sm border border-white/60">H: {current.hi}° L: {current.lo}°</span>
                  <span className="px-4 py-1.5 bg-white/50 backdrop-blur-md rounded-full text-xs font-bold text-slate-700 shadow-sm border border-white/60">Feels like {current.feelsLike}°</span>
                </div>
              </div>
            </div>

            {/* RIGHT PANEL - Details & Forecast */}
            <div className="w-full lg:w-2/3 p-6 lg:p-10 flex flex-col space-y-8 bg-gradient-to-br from-white/10 to-transparent">

              {/* Top Bar: Search with Autocomplete */}
              <div className="relative w-full">
                <div className="relative group">
                  <input
                    type="text"
                    placeholder="Search any Philippine city..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setShowSuggestions(true);
                      setLocationError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        setShowSuggestions(false);
                        handleSearchSubmit(e);
                      }
                      if (e.key === 'Escape') setShowSuggestions(false);
                    }}
                    onFocus={() => searchQuery.length >= 2 && setShowSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                    className="w-full bg-white/60 border border-white/70 text-slate-800 font-medium rounded-2xl py-3 px-5 pl-14 focus:outline-none focus:ring-2 focus:ring-indigo-400 placeholder-slate-500 shadow-sm backdrop-blur-md transition-all"
                  />
                  <Search className="absolute left-5 top-3.5 h-5 w-5 text-indigo-500 opacity-70 group-focus-within:opacity-100 transition-opacity" />
                  {searchLoading && <div className="absolute right-5 top-3.5 w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>}
                </div>

                {/* Autocomplete Dropdown */}
                {showSuggestions && searchQuery.length >= 2 && (() => {
                  const q = searchQuery.toLowerCase();
                  const suggestions = PH_LOCATIONS.filter(loc =>
                    loc.name.toLowerCase().includes(q)
                  ).slice(0, 8);
                  return suggestions.length > 0 ? (
                    <ul className="absolute z-50 mt-2 w-full bg-white/90 backdrop-blur-xl border border-white/80 shadow-2xl rounded-2xl overflow-hidden">
                      {suggestions.map((loc) => (
                        <li
                          key={loc.id}
                          onMouseDown={() => {
                            setSelectedId(loc.id);
                            setSearchQuery(loc.name);
                            setShowSuggestions(false);
                            setLocationError(null);
                          }}
                          className="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-indigo-50 transition-colors text-slate-800"
                        >
                          <MapPin className="h-4 w-4 text-indigo-400 flex-shrink-0" />
                          <span className="font-semibold text-sm">{loc.name}</span>
                        </li>
                      ))}
                      {suggestions.length === 0 && (
                        <li className="px-5 py-3 text-sm text-slate-500 italic">No results. Press Enter to search online.</li>
                      )}
                    </ul>
                  ) : null;
                })()}

                {locationError && <p className="mt-2 pl-2 text-xs font-semibold text-red-500">{locationError}</p>}
              </div>

              {/* Air Conditions */}
              <div>
                <h4 className="text-xs font-black text-indigo-900/40 uppercase tracking-widest mb-4">Air Conditions</h4>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-5">
                  <div className="bg-white/30 backdrop-blur-md border border-white/50 p-5 rounded-3xl shadow-sm hover:shadow-md hover:bg-white/40 transition-all duration-300">
                    <div className="flex items-center gap-2 text-indigo-500 mb-2 font-semibold">
                      <Thermometer className="h-4 w-4" /> <span className="text-sm">Real Feel</span>
                    </div>
                    <p className="text-3xl font-black text-slate-800">{current.feelsLike}°</p>
                  </div>
                  <div className="bg-white/30 backdrop-blur-md border border-white/50 p-5 rounded-3xl shadow-sm hover:shadow-md hover:bg-white/40 transition-all duration-300">
                    <div className="flex items-center gap-2 text-sky-500 mb-2 font-semibold">
                      <Wind className="h-4 w-4" /> <span className="text-sm">Wind</span>
                    </div>
                    <p className="text-3xl font-black text-slate-800">{current.windSpeed} <span className="text-sm font-bold text-slate-500">km/h</span></p>
                  </div>
                  <div className="bg-white/30 backdrop-blur-md border border-white/50 p-5 rounded-3xl shadow-sm hover:shadow-md hover:bg-white/40 transition-all duration-300">
                    <div className="flex items-center gap-2 text-blue-500 mb-2 font-semibold">
                      <Droplets className="h-4 w-4" /> <span className="text-sm">Precipitation</span>
                    </div>
                    <p className="text-3xl font-black text-slate-800">{current.precipProb}%</p>
                  </div>
                  <div className="bg-white/30 backdrop-blur-md border border-white/50 p-5 rounded-3xl shadow-sm hover:shadow-md hover:bg-white/40 transition-all duration-300">
                    <div className="flex items-center gap-2 text-orange-500 mb-2 font-semibold">
                      <Sun className="h-4 w-4" /> <span className="text-sm">UV Index</span>
                    </div>
                    <p className="text-3xl font-black text-slate-800">{current.uvIndex} <span className={`text-sm font-bold ${getUVLevel(current.uvIndex).color.replace('text-', 'text-opacity-80 text-')}`}>{getUVLevel(current.uvIndex).level}</span></p>
                  </div>
                  <div className="bg-white/30 backdrop-blur-md border border-white/50 p-5 rounded-3xl shadow-sm hover:shadow-md hover:bg-white/40 transition-all duration-300">
                    <div className="flex items-center gap-2 text-emerald-600 mb-2 font-semibold">
                      <Eye className="h-4 w-4" /> <span className="text-sm">Visibility</span>
                    </div>
                    <p className="text-3xl font-black text-slate-800">{current.visibility} <span className="text-sm font-bold text-slate-500">km</span></p>
                  </div>
                  <div className="bg-white/30 backdrop-blur-md border border-white/50 p-5 rounded-3xl shadow-sm hover:shadow-md hover:bg-white/40 transition-all duration-300">
                    <div className="flex items-center gap-2 text-teal-500 mb-2 font-semibold">
                      <CloudRain className="h-4 w-4" /> <span className="text-sm">Humidity</span>
                    </div>
                    <p className="text-3xl font-black text-slate-800">{current.humidity} <span className="text-sm font-bold text-slate-500">%</span></p>
                  </div>
                </div>
              </div>

              {/* Sun & Moon */}
              <div>
                <h4 className="text-xs font-black text-indigo-900/40 uppercase tracking-widest mb-4">Sun & Moon</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  <div className="bg-white/30 backdrop-blur-md border border-white/50 p-5 rounded-3xl shadow-sm flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold text-indigo-500 mb-1">Sunrise</p>
                      <p className="text-xl font-black text-slate-800">{formatLocalTime(current.sunrise)}</p>
                    </div>
                    <div className="w-14 h-14 relative overflow-hidden flex flex-col justify-end border-b-2 border-indigo-200 pb-1">
                      <svg className="w-10 h-10 text-yellow-500 animate-rise mx-auto drop-shadow-md" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.25a.75.75 0 01.75.75v2.25a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75zM7.5 12a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM18.894 6.166a.75.75 0 00-1.06-1.06l-1.591 1.59a.75.75 0 101.06 1.061l1.591-1.59zM21.75 12a.75.75 0 01-.75.75h-2.25a.75.75 0 010-1.5H21a.75.75 0 01.75.75zM17.834 18.894a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 10-1.061 1.06l1.59 1.591zM12 18.75a.75.75 0 01.75.75V21a.75.75 0 01-1.5 0v-1.5a.75.75 0 01.75-.75zM6.166 18.894a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 10-1.061 1.06l1.59 1.591zM2.25 12a.75.75 0 01.75-.75H5.25a.75.75 0 010 1.5H3a.75.75 0 01-.75-.75zM6.166 5.106a.75.75 0 00-1.06 1.06l1.591 1.59a.75.75 0 101.06-1.061l-1.591-1.59z" /></svg>
                    </div>
                  </div>
                  <div className="bg-white/30 backdrop-blur-md border border-white/50 p-5 rounded-3xl shadow-sm flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold text-orange-500 mb-1">Sunset</p>
                      <p className="text-xl font-black text-slate-800">{formatLocalTime(current.sunset)}</p>
                    </div>
                    <div className="w-14 h-14 relative overflow-hidden flex flex-col justify-end border-b-2 border-orange-200 pb-1">
                      <svg className="w-10 h-10 text-orange-500 animate-set mx-auto drop-shadow-md" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.25a.75.75 0 01.75.75v2.25a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75zM7.5 12a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM18.894 6.166a.75.75 0 00-1.06-1.06l-1.591 1.59a.75.75 0 101.06 1.061l1.591-1.59zM21.75 12a.75.75 0 01-.75.75h-2.25a.75.75 0 010-1.5H21a.75.75 0 01.75.75zM17.834 18.894a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 10-1.061 1.06l1.59 1.591zM12 18.75a.75.75 0 01.75.75V21a.75.75 0 01-1.5 0v-1.5a.75.75 0 01.75-.75zM6.166 18.894a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 10-1.061 1.06l1.59 1.591zM2.25 12a.75.75 0 01.75-.75H5.25a.75.75 0 010 1.5H3a.75.75 0 01-.75-.75zM6.166 5.106a.75.75 0 00-1.06 1.06l1.591 1.59a.75.75 0 101.06-1.061l-1.591-1.59z" /></svg>
                    </div>
                  </div>
                  <div className="bg-gradient-to-br from-slate-800 to-slate-950 border border-slate-700 p-5 rounded-3xl shadow-md flex items-center justify-between overflow-hidden relative group">
                    <div className="absolute inset-0 opacity-40">
                      <div className="w-1 h-1 bg-white rounded-full absolute top-3 left-5 animate-pulse"></div>
                      <div className="w-1.5 h-1.5 bg-white rounded-full absolute bottom-4 right-10 animate-pulse" style={{ animationDelay: "1s" }}></div>
                      <div className="w-1 h-1 bg-white rounded-full absolute top-8 right-4 animate-pulse" style={{ animationDelay: "0.5s" }}></div>
                    </div>
                    <div className="z-10 text-white">
                      <p className="text-sm text-indigo-300 font-bold mb-1">Moon Phase</p>
                      <p className="text-lg lg:text-base xl:text-lg font-black text-slate-50 leading-tight">
                        {moonPhase?.label.split(' ').map((word, i) => <React.Fragment key={i}>{word}<br /></React.Fragment>)}
                      </p>
                    </div>
                    <div className="relative w-14 h-14 flex justify-center items-center z-10">
                      <div className="absolute inset-0 bg-blue-400 blur-xl opacity-20 rounded-full"></div>
                      <svg className="w-12 h-12 text-slate-100 drop-shadow-[0_0_10px_rgba(255,255,255,0.8)] animate-rock" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"></path>
                      </svg>
                    </div>
                  </div>
                </div>
              </div>

              {/* Weekly Insight */}
              <div>
                <h4 className="text-xs font-black text-indigo-900/40 uppercase tracking-widest mb-4">Weekly Insight</h4>
                <div className="bg-gradient-to-r from-white/70 to-white/40 border border-white/80 rounded-3xl p-6 shadow-sm flex items-start space-x-5 backdrop-blur-xl">
                  <div className="relative w-14 h-14 flex-shrink-0 flex items-center justify-center">
                    <div className="absolute inset-0 bg-yellow-400 rounded-full blur-md opacity-50 animate-pulse"></div>
                    <div className="relative w-12 h-12 bg-gradient-to-br from-yellow-300 to-orange-400 rounded-full shadow-md border border-white flex items-center justify-center text-white text-xl">
                      💡
                    </div>
                  </div>
                  <div className="flex-1">
                    <h5 className="text-slate-800 font-black text-lg mb-1 leading-tight">Smart Forecast Summary</h5>
                    <p className="text-sm font-medium text-slate-600 leading-relaxed">
                      {generateWeeklyInsight(daily)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Today's Forecast (Hourly Scroll) */}
              <div>
                <h4 className="text-xs font-black text-indigo-900/40 uppercase tracking-widest mb-4">Today's Forecast</h4>
                <div className="flex space-x-4 overflow-x-auto pb-4 scrollbar-hide snap-x px-1">
                  {hourly.map((h, i) => (
                    <div
                      key={i}
                      className={`flex-shrink-0 w-28 py-5 px-2 rounded-full flex flex-col items-center justify-between shadow-sm snap-start border ${i === 0
                        ? "bg-gradient-to-b from-indigo-500 to-purple-600 text-white border-indigo-400 shadow-indigo-500/30 shadow-lg scale-105 transform origin-bottom"
                        : "bg-white/50 border-white/70 text-slate-800 hover:bg-white/70 transition-colors"
                        }`}
                    >
                      <span className={`text-sm font-bold ${i === 0 ? "text-indigo-100" : "text-slate-500"}`}>
                        {i === 0 ? "Now" : formatHourLabel(h.time)}
                      </span>

                      <div className="relative w-10 h-10 my-4 flex items-center justify-center">
                        {h.precipProb >= 50 ? (
                          <>
                            <svg className={`absolute inset-0 ${i === 0 ? "text-indigo-200" : "text-slate-400"}`} fill="currentColor" viewBox="0 0 24 24"><path d="M6.62 10.79c-.44-.04-.88-.04-1.32.01A4.5 4.5 0 005.25 19.5h12.5a4.001 4.001 0 002.828-6.828 4.001 4.001 0 00-5.803-1.282 5.5 5.5 0 00-8.155-2.602z" /></svg>
                            <div className={`absolute left-3 top-6 w-1 h-2 ${i === 0 ? "bg-white" : "bg-blue-400"} rounded-full animate-raindrop`}></div>
                            <div className={`absolute left-6 top-5 w-1 h-2 ${i === 0 ? "bg-white" : "bg-blue-400"} rounded-full animate-raindrop`} style={{ animationDelay: "0.5s" }}></div>
                          </>
                        ) : (
                          <svg className={`w-8 h-8 ${i === 0 ? "text-yellow-300" : "text-yellow-500"} ${i === 0 ? "animate-[spin_8s_linear_infinite]" : ""}`} fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.25a.75.75 0 01.75.75v2.25a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75zM7.5 12a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM18.894 6.166a.75.75 0 00-1.06-1.06l-1.591 1.59a.75.75 0 101.06 1.061l1.591-1.59zM21.75 12a.75.75 0 01-.75.75h-2.25a.75.75 0 010-1.5H21a.75.75 0 01.75.75zM17.834 18.894a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 10-1.061 1.06l1.59 1.591zM12 18.75a.75.75 0 01.75.75V21a.75.75 0 01-1.5 0v-1.5a.75.75 0 01.75-.75zM6.166 18.894a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 10-1.061 1.06l1.59 1.591zM2.25 12a.75.75 0 01.75-.75H5.25a.75.75 0 010 1.5H3a.75.75 0 01-.75-.75zM6.166 5.106a.75.75 0 00-1.06 1.06l1.591 1.59a.75.75 0 101.06-1.061l-1.591-1.59z" /></svg>
                        )}
                      </div>

                      <span className="text-2xl font-black">{h.temp}°</span>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </>
        ) : null}

      </div>
    </div>
  );
};

export default Weather;
