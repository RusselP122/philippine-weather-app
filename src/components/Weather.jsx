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
  Star,
  Compass,
  Zap,
  Info,
  Clock,
  Sparkles
} from "lucide-react";
import PH_LOCATIONS from "../data/ph_locations";

const OPENWEATHERMAP_API_KEY = "138ee97bc2df4029270f36075b709726";

// --- Helper Functions ---
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
  return date.toLocaleDateString("en-US", { weekday: "short" });
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
  if (uv <= 2) return { level: "Low", color: "text-emerald-400", bg: "bg-emerald-500/10" };
  if (uv <= 5) return { level: "Moderate", color: "text-yellow-400", bg: "bg-yellow-500/10" };
  if (uv <= 7) return { level: "High", color: "text-orange-400", bg: "bg-orange-500/10" };
  if (uv <= 10) return { level: "Very High", color: "text-red-400", bg: "bg-red-500/10" };
  return { level: "Extreme", color: "text-purple-400", bg: "bg-purple-500/10" };
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
  let c = 0, e = 0, jd = 0, b = 0;
  
  if (month < 3) {
    year--;
    month += 12;
  }
  ++month;
  c = 365.25 * year;
  e = 30.6 * month;
  jd = c + e + day - 694039.09;
  jd /= 29.5305882;
  b = Math.floor(jd);
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
  return { label: phases[b], illumination: Math.round(Math.sin(jd * Math.PI) * 100) };
};

const generateWeeklyInsight = (daily, unit = "c") => {
  if (!daily || daily.length === 0) return "No forecast data available.";

  const rainyDays = daily.filter((d) => d.precipProb >= 50);
  const hotDays = daily.filter((d) => d.hi >= 32);

  let insight = "";
  if (rainyDays.length >= 3) {
    insight = "Expect a wet week ahead with frequent rain. Keeping an umbrella handy is highly recommended.";
  } else if (rainyDays.length > 0) {
    insight = `There's a chance of rain on ${formatDayLabel(rainyDays[0].date, 0).replace("Today", "today")}. Otherwise, mostly dry conditions expected.`;
  } else {
    insight = "It looks like a dry, pleasant week ahead. Great for outdoor plans and activities.";
  }

  if (hotDays.length >= 3) {
    insight += " Temperatures will be high—stay hydrated and minimize midday sun exposure.";
  } else if (daily[0] && daily[0].hi < 25) {
    insight += " Conditions will be relatively cool and extremely comfortable.";
  }

  return insight;
};

const isWithinPhilippines = (lat, lon) => {
  if (typeof lat !== "number" || typeof lon !== "number") return false;
  return lat >= 4.5 && lat <= 21.5 && lon >= 116 && lon <= 127;
};

function getAqiInfo(aqi) {
  if (aqi === 1) return { label: "Good", message: "Air is clean and poses little or no risk.", color: "text-emerald-400", barColor: "bg-emerald-500" };
  if (aqi === 2) return { label: "Fair", message: "Air quality is acceptable for the general public.", color: "text-yellow-400", barColor: "bg-yellow-500" };
  if (aqi === 3) return { label: "Moderate", message: "Sensitive groups may experience mild symptoms.", color: "text-orange-400", barColor: "bg-orange-500" };
  if (aqi === 4) return { label: "Poor", message: "Everyone may begin to experience minor health effects.", color: "text-red-400", barColor: "bg-red-500" };
  if (aqi === 5) return { label: "Very Poor", message: "Health alert. The entire population is affected.", color: "text-purple-400", barColor: "bg-purple-500" };
  return { label: "Unknown", message: "", color: "text-slate-400", barColor: "bg-slate-500" };
}

const Weather = () => {
  const [selectedId, setSelectedId] = useState("manila");
  const [current, setCurrent] = useState(null);
  const [hourly, setHourly] = useState([]);
  const [daily, setDaily] = useState([]);
  const [cloudCoverNow, setCloudCoverNow] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [unit, setUnit] = useState("c"); // "c" or "f"
  const [favorites, setFavorites] = useState([]);
  const [customLocations, setCustomLocations] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  const [locationError, setLocationError] = useState(null);
  const [recentSearches, setRecentSearches] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Load Favorites from LocalStorage
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

  // Load Recent Searches
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

  // Fetch Weather Data
  useEffect(() => {
    const allLocations = [...PH_LOCATIONS, ...favorites, ...customLocations];
    const loc =
      allLocations.find((l) => l.id === selectedId) || allLocations[0] || PH_LOCATIONS[0];

    if (!loc) return;

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

        const sunrise = new Date(currentData.sys.sunrise * 1000).toISOString();
        const sunset = new Date(currentData.sys.sunset * 1000).toISOString();

        // Prepare Hourly
        const hourlyItems = forecastData.list.slice(0, 8).map((item) => ({
          time: new Date(item.dt * 1000).toISOString(),
          temp: item.main.temp,
          precipProb: Math.round((item.pop || 0) * 100),
          rainMm: item.rain && typeof item.rain["3h"] === "number" ? item.rain["3h"] : 0,
          weatherMain: Array.isArray(item.weather) && item.weather[0] ? item.weather[0].main : "",
        }));
        setHourly(hourlyItems);

        // Group Daily Forecast
        const dailyMap = {};
        forecastData.list.forEach((item) => {
          const dateKey = item.dt_txt.split(" ")[0];
          if (!dailyMap[dateKey]) {
            dailyMap[dateKey] = {
              temps: [],
              pops: [],
              date: new Date(item.dt * 1000).toISOString(),
              weatherIcon: Array.isArray(item.weather) && item.weather[0] ? item.weather[0].main : "Clear",
            };
          }
          dailyMap[dateKey].temps.push(item.main.temp);
          dailyMap[dateKey].pops.push(item.pop || 0);
        });

        const dailyEntries = Object.entries(dailyMap);
        const dailyItems = dailyEntries.slice(0, 5).map(([dateKey, d]) => {
          const maxTemp = Math.max(...d.temps);
          const minTemp = Math.min(...d.temps);
          const avgPop = d.pops.length > 0 ? d.pops.reduce((sum, v) => sum + v, 0) / d.pops.length : 0;
          return {
            date: d.date,
            dateKey,
            hi: maxTemp,
            lo: minTemp,
            precipProb: Math.round(avgPop * 100),
            condition: d.weatherIcon,
          };
        });
        setDaily(dailyItems);

        const todayKeyUtc = new Date().toISOString().split("T")[0];
        const todayItem = dailyItems.find((d) => d.dateKey === todayKeyUtc) || dailyItems[0] || null;

        let pressureTrend = null;
        let pressureDelta = null;
        if (
          typeof currentData.main.pressure === "number" &&
          forecastData.list[0] &&
          typeof forecastData.list[0].main?.pressure === "number"
        ) {
          const futurePressure = forecastData.list[0].main.pressure;
          pressureDelta = futurePressure - currentData.main.pressure;
          if (pressureDelta >= 1) pressureTrend = "rising";
          else if (pressureDelta <= -1) pressureTrend = "falling";
          else pressureTrend = "steady";
        }

        const currentRainMm =
          (currentData.rain && (currentData.rain["1h"] || currentData.rain["3h"])) ||
          (hourlyItems[0] ? hourlyItems[0].rainMm : 0);

        const aqiInfo = getAqiInfo(aqiIndex);

        setCurrent({
          locationName: loc.name,
          temp: currentData.main.temp,
          feelsLike: currentData.main.feels_like || currentData.main.temp,
          windSpeed: Math.round((currentData.wind.speed || 0) * 3.6),
          windDir: currentData.wind.deg,
          time: new Date(currentData.dt * 1000).toISOString(),
          hi: todayItem ? todayItem.hi : currentData.main.temp,
          lo: todayItem ? todayItem.lo : currentData.main.temp,
          precipProb: todayItem ? todayItem.precipProb : 0,
          pressure: currentData.main.pressure,
          humidity: currentData.main.humidity,
          pressureTrend,
          pressureDelta,
          rainMm: currentRainMm,
          visibility: currentData.visibility ? (currentData.visibility / 1000).toFixed(1) : null,
          dewPoint: currentData.main.temp && currentData.main.humidity
            ? currentData.main.temp - ((100 - currentData.main.humidity) / 5)
            : null,
          cloudCover: currentClouds,
          uvIndex: Math.min(11, Math.max(0, Math.round((currentData.main.temp - 15) / 3))),
          aqiIndex: aqiIndex,
          aqiLabel: aqiInfo.label,
          aqiMessage: aqiInfo.message,
          aqiColor: aqiInfo.color,
          aqiBarColor: aqiInfo.barColor,
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

  // Conversion Helper
  const displayTemp = (tempC) => {
    if (typeof tempC !== "number") return "";
    if (unit === "f") {
      return `${Math.round((tempC * 9) / 5 + 32)}°F`;
    }
    return `${Math.round(tempC)}°C`;
  };

  const rawTempNum = (tempC) => {
    if (typeof tempC !== "number") return 0;
    if (unit === "f") {
      return Math.round((tempC * 9) / 5 + 32);
    }
    return Math.round(tempC);
  };

  // Dynamic Background Gradient
  let premiumBg = "from-slate-950 via-slate-900 to-indigo-950";
  if (current) {
    const isNight = new Date(current.time).getHours() >= 18 || new Date(current.time).getHours() < 6;
    if (current.precipProb >= 50) premiumBg = "from-slate-950 via-slate-900 to-sky-950";
    else if (isNight) premiumBg = "from-slate-950 via-slate-900 to-indigo-950";
    else premiumBg = "from-blue-900 via-indigo-950 to-slate-950";
  }

  // Geocoding direct search
  const handleSearchSubmit = async (event) => {
    event.preventDefault();
    const query = searchQuery.trim();
    if (!query) return;
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
      if (!resp.ok) throw new Error(`Geocoding HTTP ${resp.status}`);
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
        if (prev.some((loc) => loc.id === id)) return prev;
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
      setLocationError("Geolocation is not supported in this browser.");
      return;
    }
    setGeoLoading(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        if (!isWithinPhilippines(latitude, longitude)) {
          setLocationError("Only coordinates inside the Philippines are supported.");
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
        setLocationError("Permission denied or location lookup timed out.");
        setGeoLoading(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleToggleFavorite = () => {
    const all = [...PH_LOCATIONS, ...favorites, ...customLocations];
    const loc = all.find((l) => l.id === selectedId);
    if (!loc) return;
    
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

  // Sunset & Sunrise SVG progress calculator
  const sunProgressInfo = useMemo(() => {
    if (!current) return { arcPercent: 0, daylight: false };
    const rise = new Date(current.sunrise).getTime();
    const set = new Date(current.sunset).getTime();
    const now = new Date(current.time).getTime();
    
    if (now >= rise && now <= set) {
      const pct = (now - rise) / (set - rise);
      return { arcPercent: pct, daylight: true };
    }
    return { arcPercent: 0, daylight: false };
  }, [current]);

  const weatherDisplayIcon = (condition) => {
    const term = String(condition || "").toLowerCase();
    if (term.includes("rain") || term.includes("drizzle")) return "🌧️";
    if (term.includes("cloud")) return "☁️";
    if (term.includes("thunder") || term.includes("storm")) return "⛈️";
    return "☀️";
  };

  return (
    <div className={`min-h-screen bg-gradient-to-br ${premiumBg} p-4 md:p-8 flex justify-center items-start font-sans text-slate-800 transition-all duration-1000 relative overflow-hidden`}>
      <style>{`
        @keyframes twinkle {
          0%, 100% { opacity: 0.2; transform: scale(0.8); }
          50% { opacity: 0.8; transform: scale(1.2); }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(-8px) rotate(1deg); }
        }
        @keyframes raindrop {
          0% { transform: translateY(-30px); opacity: 0; }
          40% { opacity: 0.8; }
          100% { transform: translateY(80px); opacity: 0; }
        }
        .star-particle {
          animation: twinkle 4s infinite ease-in-out;
        }
        .rain-drop {
          animation: raindrop 2.2s infinite linear;
        }
        .animate-float-slow {
          animation: float 6s infinite ease-in-out;
        }
        .scrollbar-none::-webkit-scrollbar {
          display: none;
        }
        .custom-glow-card {
          background: rgba(255, 255, 255, 0.05);
          backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
      `}</style>

      {/* Decorative Particle Overlays based on active weather state */}
      {current && (
        <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
          {current.precipProb >= 50 ? (
            // Immersive Rain particle drops
            Array.from({ length: 24 }).map((_, i) => (
              <div 
                key={i} 
                className="absolute w-0.5 h-3 bg-blue-300/40 rounded-full rain-drop"
                style={{ 
                  left: `${Math.random() * 100}%`, 
                  top: `${Math.random() * 40}%`, 
                  animationDelay: `${Math.random() * 2}s`,
                  animationDuration: `${1.5 + Math.random() * 1}s`
                }}
              />
            ))
          ) : (
            // Immersive starry night overlay
            Array.from({ length: 20 }).map((_, i) => (
              <div 
                key={i} 
                className="absolute w-1 h-1 bg-white rounded-full star-particle"
                style={{ 
                  left: `${Math.random() * 100}%`, 
                  top: `${Math.random() * 80}%`, 
                  animationDelay: `${Math.random() * 3}s` 
                }}
              />
            ))
          )}
        </div>
      )}

      {/* Main Container Card */}
      <div className="relative z-10 max-w-6xl w-full bg-slate-900/60 backdrop-blur-2xl border border-white/5 shadow-2xl rounded-3xl overflow-hidden flex flex-col lg:flex-row transition-all duration-300">
        
        {loading ? (
          <div className="flex w-full h-[550px] items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-700 border-t-sky-500"></div>
              <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Loading Weather Systems...</p>
            </div>
          </div>
        ) : error ? (
          <div className="w-full flex items-center justify-center p-10 h-96">
            <div className="rounded-3xl bg-red-950/20 backdrop-blur-md p-8 text-center border border-red-500/20 shadow-xl max-w-md">
              <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-3" />
              <p className="text-red-300 font-semibold text-sm">{error}</p>
              <button onClick={() => setSelectedId("manila")} className="mt-4 px-4 py-2 bg-slate-800 text-white rounded-xl text-xs font-bold border border-white/5 cursor-pointer">Reset Location</button>
            </div>
          </div>
        ) : current ? (
          <>
            {/* LEFT HERO PANEL - Glowing visual conditions summary */}
            <div className="w-full lg:w-[35%] p-6 md:p-8 flex flex-col justify-between relative overflow-hidden bg-slate-950/50 border-b lg:border-b-0 lg:border-r border-white/5">
              <div className="absolute top-0 right-0 w-64 h-64 bg-sky-500/10 rounded-full blur-3xl pointer-events-none"></div>

              {/* Pin & Switch Header */}
              <div className="flex items-center justify-between z-10">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4.5 w-4.5 text-sky-400" />
                  <span className="text-xs font-black uppercase tracking-widest text-slate-400">PH Forecast</span>
                </div>
                
                <div className="flex items-center gap-2.5">
                  <button 
                    onClick={handleToggleFavorite}
                    className={`p-2 rounded-xl transition-all cursor-pointer border ${
                      isCurrentFavorite 
                        ? "bg-amber-500/20 border-amber-500/40 text-amber-400 scale-105" 
                        : "bg-slate-900/60 border-white/5 text-slate-400 hover:text-white"
                    }`}
                    title={isCurrentFavorite ? "Unpin Favorite" : "Pin Favorite"}
                  >
                    <Star className="w-4 h-4 fill-current" />
                  </button>
                  <button 
                    onClick={handleUseMyLocation} 
                    className="p-2 rounded-xl bg-slate-900/60 border border-white/5 hover:border-slate-500 text-slate-400 hover:text-white transition-all cursor-pointer"
                    title="Find My Location"
                  >
                    <Compass className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Visual Display Condition Icon */}
              <div className="flex justify-center items-center py-10 z-10 relative h-56 animate-float-slow">
                {current.precipProb >= 50 ? (
                  <div className="relative w-40 h-40 flex justify-center items-center">
                    <div className="absolute w-24 h-24 bg-sky-500/15 rounded-full blur-2xl"></div>
                    <svg className="w-28 h-28 text-slate-400 drop-shadow-xl" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6.62 10.79c-.44-.04-.88-.04-1.32.01A4.5 4.5 0 005.25 19.5h12.5a4.001 4.001 0 002.828-6.828 4.001 4.001 0 00-5.803-1.282 5.5 5.5 0 00-8.155-2.602z" />
                    </svg>
                    <div className="absolute left-10 top-24 w-1.5 h-3 bg-sky-500 rounded-full animate-raindrop"></div>
                    <div className="absolute left-16 top-26 w-1.5 h-3 bg-sky-500 rounded-full animate-raindrop" style={{ animationDelay: "0.4s" }}></div>
                    <div className="absolute left-22 top-24 w-1.5 h-3 bg-sky-500 rounded-full animate-raindrop" style={{ animationDelay: "0.8s" }}></div>
                  </div>
                ) : (new Date(current.time).getHours() >= 18 || new Date(current.time).getHours() < 6) ? (
                  <div className="relative w-40 h-40 flex justify-center items-center">
                    <div className="absolute w-24 h-24 bg-indigo-500/20 rounded-full blur-2xl"></div>
                    <Moon className="w-28 h-28 text-slate-100 drop-shadow-[0_0_15px_rgba(255,255,255,0.4)]" />
                  </div>
                ) : (
                  <div className="relative w-40 h-40 flex justify-center items-center">
                    <div className="absolute w-24 h-24 bg-amber-500/20 rounded-full blur-2xl"></div>
                    <Sun className="w-28 h-28 text-yellow-400 drop-shadow-[0_0_15px_rgba(245,158,11,0.5)] animate-[spin_40s_linear_infinite]" />
                  </div>
                )}
              </div>

              {/* Static readout info */}
              <div className="z-10 text-left">
                <h1 className="text-3xl font-black text-white tracking-tight leading-tight">{selectedLocation.name.split(',')[0]}</h1>
                <p className="text-xs text-slate-400 font-bold tracking-wider mt-1">{selectedLocation.name.includes(',') ? selectedLocation.name.split(',').slice(1).join(',').trim() : "Philippines"}</p>
                
                <div className="my-5 border-t border-white/5 pt-4">
                  <h2 className="text-6xl font-black text-white tracking-tighter leading-none">{displayTemp(current.temp)}</h2>
                  <h3 className="text-lg font-bold text-slate-300/80 capitalize mt-2.5">{describeConditions(current, current.cloudCover)}</h3>
                </div>

                <div className="flex flex-wrap gap-2 text-xs text-slate-300 font-bold">
                  <span className="px-3 py-1 bg-slate-900 border border-white/5 rounded-xl">Feels Like: {displayTemp(current.feelsLike)}</span>
                  <span className="px-3 py-1 bg-slate-900 border border-white/5 rounded-xl">Wind: {current.windSpeed} km/h</span>
                </div>

                <p className="text-[10px] text-slate-500 font-bold mt-4 tracking-wider flex items-center gap-1.5 uppercase">
                  <Clock className="w-3.5 h-3.5" />
                  <span>{current.time ? new Date(current.time).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: true }) : ''} PST</span>
                </p>
              </div>
            </div>

            {/* RIGHT PANEL - Dashboard & interactive features */}
            <div className="w-full lg:w-[65%] p-5 md:p-8 flex flex-col space-y-6 overflow-y-auto max-h-[90vh]">
              
              {/* Header: Favorites bar + Search + C/F toggler */}
              <div className="flex flex-col md:flex-row gap-4 items-center justify-between z-20">
                
                {/* Favorites location quick-switches */}
                <div className="flex items-center gap-2 overflow-x-auto w-full md:w-auto scrollbar-none pb-1">
                  {favorites.length > 0 ? (
                    favorites.map(fav => (
                      <button
                        key={fav.id}
                        onClick={() => setSelectedId(fav.id)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-black tracking-wide shrink-0 transition-all border cursor-pointer ${
                          selectedId === fav.id 
                            ? "bg-sky-500/10 border-sky-500/40 text-sky-400 scale-105" 
                            : "bg-slate-950/60 border-white/5 text-slate-400 hover:text-white"
                        }`}
                      >
                        {fav.name.split(',')[0]}
                      </button>
                    ))
                  ) : (
                    <span className="text-[10px] text-slate-600 font-bold uppercase tracking-widest">Pin cities to favorites</span>
                  )}
                </div>

                {/* Celsius / Fahrenheit Switcher */}
                <div className="flex rounded-xl bg-slate-950 border border-white/5 p-1 shrink-0 ml-auto">
                  <button
                    onClick={() => setUnit("c")}
                    className={`px-3 py-1 rounded-lg text-xs font-black transition-all cursor-pointer ${
                      unit === "c" ? "bg-slate-800 text-sky-400 shadow" : "text-slate-500 hover:text-white"
                    }`}
                  >
                    °C
                  </button>
                  <button
                    onClick={() => setUnit("f")}
                    className={`px-3 py-1 rounded-lg text-xs font-black transition-all cursor-pointer ${
                      unit === "f" ? "bg-slate-800 text-sky-400 shadow" : "text-slate-500 hover:text-white"
                    }`}
                  >
                    °F
                  </button>
                </div>
              </div>

              {/* Search Bar with dropdown */}
              <div className="relative w-full z-30">
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
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                    className="w-full bg-slate-950/80 border border-white/5 text-white font-medium rounded-2xl py-3 px-5 pl-12 focus:outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500 placeholder-slate-500 shadow-inner transition-all text-xs"
                  />
                  <Search className="absolute left-4.5 top-3.5 h-4 w-4 text-slate-500 group-focus-within:text-white transition-colors" />
                  {searchLoading && <div className="absolute right-5 top-3.5 w-4 h-4 border-2 border-sky-400 border-t-transparent rounded-full animate-spin"></div>}
                </div>

                {showSuggestions && searchQuery.length >= 2 && (() => {
                  const q = searchQuery.toLowerCase();
                  const suggestions = PH_LOCATIONS.filter(loc =>
                    loc.name.toLowerCase().includes(q)
                  ).slice(0, 5);
                  return (
                    <ul className="absolute z-[999] mt-1.5 w-full bg-slate-900 border border-white/10 shadow-2xl rounded-2xl overflow-hidden">
                      {suggestions.map((loc) => (
                        <li
                          key={loc.id}
                          onMouseDown={() => {
                            setSelectedId(loc.id);
                            setSearchQuery(loc.name);
                            setShowSuggestions(false);
                            setLocationError(null);
                          }}
                          className="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-slate-800 transition-colors text-slate-200"
                        >
                          <MapPin className="h-4 w-4 text-sky-400 flex-shrink-0" />
                          <span className="font-bold text-xs">{loc.name}</span>
                        </li>
                      ))}
                      {suggestions.length === 0 && (
                        <li className="px-5 py-3 text-xs text-slate-500 italic">No direct match. Press Enter to search on geocode maps.</li>
                      )}
                    </ul>
                  );
                })()}

                {locationError && <p className="mt-2 pl-2 text-xs font-bold text-red-400 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> {locationError}</p>}
              </div>

              {/* Metrics Grid */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                
                {/* AQI Panel */}
                <div className="col-span-2 rounded-3xl bg-slate-950/40 p-4 border border-white/5 flex flex-col justify-between relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-16 h-16 bg-sky-500/5 blur-xl rounded-full"></div>
                  <div className="flex items-center gap-2 text-slate-500 mb-1">
                    <Sparkles className="w-4 h-4 text-emerald-400" />
                    <span className="text-[10px] font-black uppercase tracking-wider">Air Quality (AQI)</span>
                  </div>
                  <div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-black text-white">{current.aqiIndex || "N/A"}</span>
                      <span className={`text-xs font-black ${current.aqiColor || "text-slate-400"}`}>{current.aqiLabel || "Good"}</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-800 rounded-full mt-2 relative overflow-hidden">
                      <div className={`h-full ${current.aqiBarColor || "bg-emerald-500"} rounded-full`} style={{ width: `${(current.aqiIndex || 1) * 20}%` }}></div>
                    </div>
                    <p className="text-[10px] text-slate-500 leading-tight mt-2.5 font-medium">{current.aqiMessage || "Air quality is great."}</p>
                  </div>
                </div>

                {/* Pressure Metric */}
                <div className="col-span-1 rounded-3xl bg-slate-950/40 p-4 border border-white/5 flex flex-col justify-between">
                  <div className="flex items-center gap-2 text-slate-500">
                    <TrendingUp className="w-4 h-4 text-teal-400" />
                    <span className="text-[10px] font-black uppercase tracking-wider">Pressure</span>
                  </div>
                  <div className="mt-2">
                    <span className="text-xl font-black text-white">{current.pressure} <span className="text-[10px] text-slate-500">hPa</span></span>
                    <p className="text-[10px] text-slate-500 font-bold capitalize mt-1">Trend: {current.pressureTrend || "steady"}</p>
                  </div>
                </div>

                {/* Humidity Metric */}
                <div className="col-span-1 rounded-3xl bg-slate-950/40 p-4 border border-white/5 flex flex-col justify-between">
                  <div className="flex items-center gap-2 text-slate-500">
                    <Droplets className="w-4 h-4 text-blue-400" />
                    <span className="text-[10px] font-black uppercase tracking-wider">Humidity</span>
                  </div>
                  <div className="mt-2">
                    <span className="text-xl font-black text-white">{current.humidity}%</span>
                    <p className="text-[10px] text-slate-500 font-bold mt-1">Dew Point: {displayTemp(current.dewPoint)}</p>
                  </div>
                </div>
              </div>

              {/* Sun Path Arc & Moon Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                {/* Sunrise/Sunset ARC Visualizer */}
                <div className="rounded-3xl bg-slate-950/40 p-5 border border-white/5 flex flex-col relative overflow-hidden">
                  <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                    <Sun className="w-4 h-4 text-yellow-400" />
                    <span>Solar Progress Path</span>
                  </h4>
                  
                  <div className="flex items-center justify-between mt-2">
                    <div className="text-left">
                      <p className="text-[10px] text-slate-500 font-bold uppercase">Sunrise</p>
                      <p className="text-xs font-black text-slate-200">{formatLocalTime(current.sunrise)}</p>
                    </div>
                    
                    {/* SVG Progress path */}
                    <div className="relative w-28 h-14 flex items-center justify-center">
                      <svg className="w-full h-full" viewBox="0 0 100 50">
                        {/* Half-arc background */}
                        <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="2.5" strokeDasharray="3,3" />
                        {/* Daylight active arc progress */}
                        {sunProgressInfo.daylight && (
                          <path 
                            d="M 10 50 A 40 40 0 0 1 90 50" 
                            fill="none" 
                            stroke="#eab308" 
                            strokeWidth="2.5" 
                            strokeDasharray="250" 
                            strokeDashoffset={250 - (sunProgressInfo.arcPercent * 125)} 
                          />
                        )}
                      </svg>
                      {/* Floating sun node */}
                      {sunProgressInfo.daylight && (
                        <div 
                          className="absolute w-3 h-3 bg-yellow-400 rounded-full border border-white shadow-[0_0_8px_rgba(234,179,8,1)]"
                          style={{
                            left: `${10 + (sunProgressInfo.arcPercent * 80)}%`,
                            bottom: `${Math.sin(sunProgressInfo.arcPercent * Math.PI) * 75}%`,
                            transform: "translate(-50%, 50%)"
                          }}
                        />
                      )}
                    </div>

                    <div className="text-right">
                      <p className="text-[10px] text-slate-500 font-bold uppercase">Sunset</p>
                      <p className="text-xs font-black text-slate-200">{formatLocalTime(current.sunset)}</p>
                    </div>
                  </div>
                </div>

                {/* Moon Phase Block */}
                <div className="rounded-3xl bg-slate-950/40 p-5 border border-white/5 flex items-center justify-between">
                  <div className="flex flex-col justify-between h-full">
                    <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                      <Moon className="w-4 h-4 text-indigo-400" />
                      <span>Lunar Indicator</span>
                    </h4>
                    <div className="mt-3">
                      <p className="text-base font-black text-white leading-tight">{moonPhase?.label}</p>
                      <p className="text-[10px] text-slate-500 font-bold mt-1">Illumination: {moonPhase?.illumination}%</p>
                    </div>
                  </div>
                  
                  {/* Glowing crescent moon orb */}
                  <div className="w-16 h-16 rounded-full bg-slate-950 border border-white/5 flex items-center justify-center relative shadow-[inset_0_0_10px_rgba(255,255,255,0.05)]">
                    <div className="absolute w-12 h-12 bg-indigo-500/10 rounded-full blur-xl animate-pulse"></div>
                    <Moon className="w-9 h-9 text-slate-200 drop-shadow-[0_0_8px_rgba(255,255,255,0.3)] rotate-12" />
                  </div>
                </div>
              </div>

              {/* Premium 5-Day Outlook (Apple-style range-bars) */}
              <div>
                <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-sky-400" />
                  <span>5-Day Outlook Weather System</span>
                </h4>
                
                <div className="flex flex-col gap-2.5">
                  {daily.map((day, idx) => {
                    const minWeeklyVal = Math.min(...daily.map(d => d.lo));
                    const maxWeeklyVal = Math.max(...daily.map(d => d.hi));
                    
                    // Calc slider range percentage
                    const loPercent = ((day.lo - minWeeklyVal) / (maxWeeklyVal - minWeeklyVal)) * 100;
                    const hiPercent = ((day.hi - minWeeklyVal) / (maxWeeklyVal - minWeeklyVal)) * 100;

                    return (
                      <div key={day.dateKey} className="flex items-center justify-between bg-slate-950/30 border border-white/5 px-4.5 py-3 rounded-2xl text-xs font-semibold text-slate-300">
                        <span className="w-12 font-black text-slate-200">{formatDayLabel(day.date, idx)}</span>
                        
                        <div className="flex items-center gap-2 w-14 justify-center">
                          <span className="text-sm">{weatherDisplayIcon(day.condition)}</span>
                          {day.precipProb >= 30 && (
                            <span className="text-[9px] text-sky-400 font-bold">{day.precipProb}%</span>
                          )}
                        </div>

                        <span className="w-8 text-right font-medium text-slate-500">{rawTempNum(day.lo)}°</span>

                        {/* Visual Range bar slider representing weekly high/low scales */}
                        <div className="flex-1 max-w-[120px] h-1.5 bg-slate-800/80 rounded-full mx-3.5 relative overflow-hidden">
                          <div 
                            className="absolute h-full bg-gradient-to-r from-sky-400 via-amber-400 to-orange-500 rounded-full" 
                            style={{ 
                              left: `${loPercent}%`, 
                              right: `${100 - hiPercent}%` 
                            }}
                          />
                        </div>

                        <span className="w-8 text-left font-black text-slate-200">{rawTempNum(day.hi)}°</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Smart Weekly Insight */}
              <div className="bg-gradient-to-r from-slate-900 to-indigo-950/60 border border-white/5 rounded-3xl p-5 shadow-2xl flex items-start space-x-4">
                <div className="relative w-12 h-12 flex-shrink-0 flex items-center justify-center">
                  <div className="absolute inset-0 bg-yellow-400/25 rounded-full blur-md animate-pulse"></div>
                  <div className="relative w-10 h-10 bg-slate-900 border border-white/10 rounded-full flex items-center justify-center text-xl shadow-lg shadow-black/40">
                    💡
                  </div>
                </div>
                <div className="flex-1">
                  <h5 className="text-white font-black text-sm mb-1 leading-tight">Weekly Smart Insight</h5>
                  <p className="text-xs font-medium text-slate-400 leading-relaxed">
                    {generateWeeklyInsight(daily)}
                  </p>
                </div>
              </div>

              {/* Today's Forecast (Hourly Scroll) */}
              <div>
                <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-indigo-400" />
                  <span>24-Hour Micro Forecast</span>
                </h4>
                
                <div className="flex space-x-3.5 overflow-x-auto pb-2 scrollbar-none snap-x">
                  {hourly.map((h, i) => (
                    <div
                      key={i}
                      className={`flex-shrink-0 w-22 py-4 px-2 rounded-2xl flex flex-col items-center justify-between snap-start border ${
                        i === 0
                          ? "bg-gradient-to-b from-sky-500 to-indigo-600 text-white border-sky-400 shadow-lg shadow-sky-500/20 scale-105"
                          : "bg-slate-950/40 border-white/5 text-slate-300 hover:bg-slate-900/40 transition-all cursor-pointer"
                      }`}
                    >
                      <span className={`text-[10px] font-black uppercase ${i === 0 ? "text-sky-100" : "text-slate-500"}`}>
                        {i === 0 ? "Now" : formatHourLabel(h.time).replace(" ", "")}
                      </span>

                      <div className="relative w-8 h-8 my-3.5 flex items-center justify-center">
                        {h.precipProb >= 50 ? (
                          <>
                            <svg className={`absolute inset-0 ${i === 0 ? "text-sky-200" : "text-sky-400"}`} fill="currentColor" viewBox="0 0 24 24"><path d="M6.62 10.79c-.44-.04-.88-.04-1.32.01A4.5 4.5 0 005.25 19.5h12.5a4.001 4.001 0 002.828-6.828 4.001 4.001 0 00-5.803-1.282 5.5 5.5 0 00-8.155-2.602z" /></svg>
                            <div className="absolute left-2.5 top-5 w-0.5 h-1.5 bg-sky-300 rounded-full animate-raindrop"></div>
                            <div className="absolute left-4.5 top-4 w-0.5 h-1.5 bg-sky-300 rounded-full animate-raindrop" style={{ animationDelay: "0.5s" }}></div>
                          </>
                        ) : (
                          <Sun className={`w-6 h-6 ${i === 0 ? "text-yellow-300" : "text-yellow-500"}`} />
                        )}
                      </div>

                      <span className="text-sm font-black">{displayTemp(h.temp).replace("°C", "°").replace("°F", "°")}</span>
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
