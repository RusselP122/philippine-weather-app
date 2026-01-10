import React, { useEffect, useState } from "react";
import { Cloud, CloudRain, Droplets, Eye, Moon, Sun, Thermometer, TrendingDown, TrendingUp, Wind, AlertTriangle, Umbrella, Car, Navigation } from "lucide-react";

const PH_LOCATIONS = [
  { id: "manila", name: "Manila", lat: 14.5995, lon: 120.9842 },
  { id: "cebu", name: "Cebu City", lat: 10.3157, lon: 123.8854 },
  { id: "davao", name: "Davao City", lat: 7.1907, lon: 125.4553 },
  { id: "baguio", name: "Baguio City", lat: 16.4023, lon: 120.596 },
];

const OPENWEATHERMAP_API_KEY = "138ee97bc2df4029270f36075b709726";

function formatHourLabel(isoTime) {
  if (!isoTime) return "";
  const d = new Date(isoTime);
  return d.toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: undefined,
    hour12: true,
    timeZone: "Asia/Manila",
  });
}

function formatDayLabel(isoDate, index) {
  if (!isoDate) return "";
  const d = new Date(isoDate);
  if (index === 0) return "Today";
  if (index === 1) return "Tomorrow";
  return d.toLocaleDateString("en-PH", {
    weekday: "short",
  });
}

function formatLocalDate(isoTime) {
  if (!isoTime) return "";
  const d = new Date(isoTime);
  return d.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone: "Asia/Manila",
  });
}

function formatLocalTime(isoTime) {
  if (!isoTime) return "";
  const d = new Date(isoTime);
  return d.toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: "Asia/Manila",
  });
}

function describeConditions(current, cloudCover) {
  if (!current) return "";
  const hasRain = typeof current.precipProb === "number" && current.precipProb >= 40;
  if (hasRain && cloudCover >= 60) return "Rainy";
  if (hasRain) return "Chance of rain";
  if (cloudCover >= 80) return "Cloudy";
  if (cloudCover >= 40) return "Partly cloudy";
  return "Mostly clear";
}

function formatTemp(tempC, unit) {
  if (typeof tempC !== "number") return "";
  if (unit === "f") {
    return Math.round((tempC * 9) / 5 + 32);
  }
  return Math.round(tempC);
}

function getTempPercent(temp, min, max) {
  if (
    typeof temp !== "number" ||
    typeof min !== "number" ||
    typeof max !== "number" ||
    !Number.isFinite(min) ||
    !Number.isFinite(max)
  ) {
    return 0;
  }
  if (max === min) {
    return 50;
  }
  const pct = ((temp - min) / (max - min)) * 100;
  if (pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
}

function isWithinPhilippines(lat, lon) {
  if (typeof lat !== "number" || typeof lon !== "number") return false;
  const withinLat = lat >= 4 && lat <= 22;
  const withinLon = lon >= 116 && lon <= 127.5;
  return withinLat && withinLon;
}

function getMoonPhaseInfo(isoTime) {
  if (!isoTime) {
    return { label: "", illumination: 0 };
  }
  const date = new Date(isoTime);
  if (Number.isNaN(date.getTime())) {
    return { label: "", illumination: 0 };
  }
  const synodicMonth = 29.53058867;
  const reference = new Date("2000-01-06T18:14:00Z");
  const daysSince = (date.getTime() - reference.getTime()) / 86400000;
  const normalized = ((daysSince % synodicMonth) + synodicMonth) % synodicMonth;
  const phase = normalized;
  let label;
  if (phase < 1.84566) label = "New Moon";
  else if (phase < 5.53699) label = "Waxing Crescent";
  else if (phase < 9.22831) label = "First Quarter";
  else if (phase < 12.91963) label = "Waxing Gibbous";
  else if (phase < 16.61096) label = "Full Moon";
  else if (phase < 20.30228) label = "Waning Gibbous";
  else if (phase < 23.99361) label = "Last Quarter";
  else if (phase < 27.68493) label = "Waning Crescent";
  else label = "New Moon";
  const illumination = Math.max(0, Math.min(1, phase / synodicMonth));
  return { label, illumination };
}

function getMoonPhaseEmoji(label) {
  switch (label) {
    case "New Moon":
      return "🌑";
    case "Waxing Crescent":
      return "🌒";
    case "First Quarter":
      return "🌓";
    case "Waxing Gibbous":
      return "🌔";
    case "Full Moon":
      return "🌕";
    case "Waning Gibbous":
      return "🌖";
    case "Last Quarter":
      return "🌗";
    case "Waning Crescent":
      return "🌘";
    default:
      return "🌑";
  }
}

function getUVLevel(uvIndex) {
  if (typeof uvIndex !== "number") return { level: "Unknown", color: "slate" };
  if (uvIndex <= 2) return { level: "Low", color: "green" };
  if (uvIndex <= 5) return { level: "Moderate", color: "yellow" };
  if (uvIndex <= 7) return { level: "High", color: "orange" };
  if (uvIndex <= 10) return { level: "Very High", color: "red" };
  return { level: "Extreme", color: "purple" };
}

function getAqiInfo(aqiIndex) {
  if (typeof aqiIndex !== "number") {
    return {
      label: "Unknown",
      message: "Air quality data is not available.",
    };
  }
  switch (aqiIndex) {
    case 1:
      return {
        label: "Good",
        message: "Air quality is good. Outdoor activities are safe for most people.",
      };
    case 2:
      return {
        label: "Fair",
        message: "Air quality is acceptable. Very sensitive people may notice minor effects.",
      };
    case 3:
      return {
        label: "Moderate",
        message: "Sensitive groups may experience mild irritation outdoors.",
      };
    case 4:
      return {
        label: "Poor",
        message: "Sensitive groups should limit time outdoors and heavy exertion.",
      };
    case 5:
      return {
        label: "Very Poor",
        message: "Everyone may feel stronger effects. Consider staying indoors.",
      };
    default:
      return {
        label: "Unknown",
        message: "Air quality data is not available.",
      };
  }
}

function getRainType(precipMm) {
  if (typeof precipMm !== "number" || precipMm === 0) return { type: "None", icon: "☀️" };
  if (precipMm < 2.5) return { type: "Light rain", icon: "🌦️" };
  if (precipMm < 10) return { type: "Moderate rain", icon: "🌧️" };
  if (precipMm < 50) return { type: "Heavy rain", icon: "⛈️" };
  return { type: "Torrential rain", icon: "🌧️" };
}

function getVisibilityLevel(visibilityKm) {
  if (typeof visibilityKm !== "number") return "Unknown";
  if (visibilityKm >= 10) return "Excellent";
  if (visibilityKm >= 5) return "Good";
  if (visibilityKm >= 2) return "Moderate";
  if (visibilityKm >= 1) return "Poor";
  return "Very Poor";
}

function generateWeatherImpact(current, cloudCover) {
  const impacts = [];
  if (current.precipProb >= 60) {
    impacts.push({ icon: Umbrella, text: "High chance of rain: bring an umbrella.", color: "cyan" });
  } else if (current.precipProb >= 30) {
    impacts.push({ icon: Umbrella, text: "Possible rain: consider an umbrella.", color: "sky" });
  }
  if (current.visibility && current.visibility < 5) {
    impacts.push({ icon: Car, text: "Low visibility: drive carefully.", color: "amber" });
  }
  if (current.humidity && current.humidity >= 80) {
    impacts.push({ icon: Droplets, text: "Humid conditions may feel warmer.", color: "emerald" });
  } else if (current.humidity && current.humidity <= 30) {
    impacts.push({ icon: Wind, text: "Dry air: stay hydrated.", color: "blue" });
  }
  if (current.temp >= 32) {
    impacts.push({ icon: Sun, text: "Very hot: avoid prolonged sun exposure.", color: "orange" });
  } else if (current.temp <= 20) {
    impacts.push({ icon: Cloud, text: "Cool weather: light jacket recommended.", color: "slate" });
  }
  if (current.uvIndex && current.uvIndex >= 6) {
    impacts.push({ icon: AlertTriangle, text: "High UV: use sunscreen.", color: "red" });
  }
  if (current.pressureTrend === "rising") {
    impacts.push({ icon: TrendingUp, text: "Rising pressure: improving weather.", color: "green" });
  } else if (current.pressureTrend === "falling") {
    impacts.push({ icon: TrendingDown, text: "Falling pressure: worsening weather.", color: "red" });
  }
  return impacts;
}

function generateWeeklyInsight(daily, unit) {
  if (!daily || daily.length === 0) return "";
  const days = daily.slice(0, 5);
  const labels = days.map((d, idx) => formatDayLabel(d.date, idx));

  const avgPrecip =
    days.reduce((sum, d) => sum + (typeof d.precipProb === "number" ? d.precipProb : 0), 0) /
    days.length;

  const rainy = days
    .map((d, idx) => ({ d, idx }))
    .filter((x) => (x.d.precipProb || 0) >= 60);

  const first = days[0];
  const last = days[days.length - 1];
  const tempTrend =
    typeof last.hi === "number" && typeof first.hi === "number" ? last.hi - first.hi : 0;

  const hiValues = days
    .map((d) => d.hi)
    .filter((v) => typeof v === "number");

  const parts = [];

  if (rainy.length >= 1) {
    const main = rainy[0];
    const label = labels[main.idx] || "mid-week";
    parts.push(`Expect scattered to frequent rain around ${label}.`);
  } else if (avgPrecip < 30) {
    parts.push("Mostly dry conditions with only isolated showers.");
  } else {
    parts.push("Scattered showers possible on several days.");
  }

  if (tempTrend >= 2) {
    parts.push("Temperatures trend a bit warmer toward the end of the period.");
  } else if (tempTrend <= -2) {
    parts.push("Temperatures trend slightly cooler later in the week.");
  }

  if (hiValues.length) {
    const maxHi = Math.max(...hiValues);
    const minHi = Math.min(...hiValues);
    if (maxHi >= 33) {
      parts.push("At least one day may feel hot and humid; stay hydrated if outdoors.");
    } else if (minHi <= 24) {
      parts.push("Some periods may feel cooler, especially at night or early morning.");
    }
  }

  return parts.join(" ");
}

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
  const [timelineHoverIndex, setTimelineHoverIndex] = useState(null);

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
  const unitSymbol = unit === "c" ? "C" : "F";
  const isCurrentFavorite = favorites.some((f) => f.id === selectedId);
  const hourlyTempRange =
    hourly && hourly.length > 0
      ? {
          min: Math.min(...hourly.map((h) => h.temp)),
          max: Math.max(...hourly.map((h) => h.temp)),
        }
      : null;

  const hasFavorites = favorites && favorites.length > 0;
  const hasRecentSearches = recentSearches && recentSearches.length > 0;

  const suggestionOptions =
    searchQuery && searchQuery.length >= 2
      ? Array.from(
          new Set(
            [...PH_LOCATIONS, ...favorites, ...customLocations]
              .map((loc) => loc.name)
              .filter((name) =>
                typeof name === "string"
                  ? name.toLowerCase().includes(searchQuery.toLowerCase())
                  : false
              )
          )
        ).slice(0, 6)
      : [];
  const tempTimelineData =
    hourly && hourly.length > 1
      ? (() => {
          const temps = hourly.map((h) => h.temp).filter((t) => typeof t === "number");
          if (!temps.length) return [];
          const minT = Math.min(...temps);
          const maxT = Math.max(...temps);
          const range = maxT - minT || 1;
          const len = hourly.length;
          return hourly
            .map((h, idx) => {
              if (typeof h.temp !== "number") return null;
              const x = len === 1 ? 0 : (idx / (len - 1)) * 100;
              const norm = (h.temp - minT) / range;
              const y = 90 - norm * 70;
              return {
                x,
                y,
                temp: h.temp,
                timeLabel: formatHourLabel(h.time),
              };
            })
            .filter(Boolean);
        })()
      : [];

  const tempTimelinePoints =
    tempTimelineData && tempTimelineData.length > 1
      ? tempTimelineData.map((p) => `${p.x},${p.y}`).join(" ")
      : "";

  let backgroundClass = "bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950";
  if (current) {
    const date = new Date(current.time);
    const hourPh = parseInt(
      date.toLocaleTimeString("en-PH", {
        hour: "2-digit",
        hour12: false,
        timeZone: "Asia/Manila",
      }),
      10
    );
    const isNight = Number.isFinite(hourPh) && (hourPh >= 18 || hourPh < 6);
    const precip = typeof current.precipProb === "number" ? current.precipProb : 0;
    const clouds =
      typeof current.cloudCover === "number"
        ? current.cloudCover
        : typeof cloudCoverNow === "number"
        ? cloudCoverNow
        : 0;

    if (precip >= 60) {
      backgroundClass = isNight
        ? "bg-gradient-to-br from-slate-950 via-sky-950 to-slate-900"
        : "bg-gradient-to-br from-sky-900 via-slate-900 to-slate-950";
    } else if (clouds >= 70) {
      backgroundClass = isNight
        ? "bg-gradient-to-br from-slate-950 via-slate-800 to-slate-950"
        : "bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950";
    } else if (isNight) {
      backgroundClass = "bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950";
    } else {
      backgroundClass = "bg-gradient-to-br from-sky-900 via-slate-900 to-slate-950";
    }
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

  const dailyTempRange =
    daily && daily.length > 0
      ? (() => {
          const temps = [];
          daily.forEach((d) => {
            if (typeof d.lo === "number") temps.push(d.lo);
            if (typeof d.hi === "number") temps.push(d.hi);
          });
          if (!temps.length) return null;
          return {
            min: Math.min(...temps),
            max: Math.max(...temps),
          };
        })()
      : null;

  const moonPhase = current ? getMoonPhaseInfo(current.time) : null;

  return (
    <div className={`min-h-screen ${backgroundClass} text-slate-50 flex flex-col`}>
      <div className="max-w-6xl mx-auto w-full px-4 py-8 md:px-8 md:py-12">
        <header className="mb-10 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-[0.4em] text-slate-500 font-medium">Local Weather</p>
            <h1 className="text-3xl font-bold tracking-tight text-slate-50 md:text-4xl bg-gradient-to-r from-slate-50 to-slate-300 bg-clip-text text-transparent">
              Philippine Weather
            </h1>
            <p className="text-sm text-slate-400 max-w-md">
              Real-time conditions, hourly forecasts, and daily outlook for major Philippine cities.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4 bg-slate-900/50 backdrop-blur-sm rounded-2xl px-5 py-3 border border-slate-800/50">
            <div className="flex flex-1 flex-col gap-2">
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-400 font-medium">Location</span>
                <select
                  value={selectedId}
                  onChange={(e) => setSelectedId(e.target.value)}
                  className="rounded-xl border border-slate-700/50 bg-slate-800/50 backdrop-blur-sm px-4 py-2.5 text-sm text-slate-100 font-medium cursor-pointer hover:bg-slate-800 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                >
                  {allLocations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleToggleFavorite}
                  className={
                    "rounded-full border px-3 py-1 text-[11px] font-medium transition-colors " +
                    (isCurrentFavorite
                      ? "border-emerald-400 bg-emerald-500/10 text-emerald-300"
                      : "border-slate-700/70 bg-slate-900/40 text-slate-300 hover:border-emerald-400 hover:text-emerald-200")
                  }
                >
                  {isCurrentFavorite ? "Saved" : "Save"}
                </button>
              </div>
              <form
                onSubmit={handleSearchSubmit}
                className="flex items-center gap-2 text-[11px] text-slate-400"
              >
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search city (e.g. Quezon City)"
                  className="flex-1 rounded-lg border border-slate-700/60 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500/60"
                />
                <button
                  type="submit"
                  disabled={searchLoading || geoLoading}
                  className="rounded-full border border-sky-500/60 bg-sky-500/10 px-3 py-1.5 text-[11px] font-medium text-sky-300 hover:bg-sky-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {searchLoading ? "Searching..." : "Search"}
                </button>
                <button
                  type="button"
                  onClick={handleUseMyLocation}
                  disabled={geoLoading || searchLoading}
                  className="group flex items-center gap-1 rounded-full border border-slate-700/70 bg-slate-900/40 px-3 py-1.5 text-[11px] font-medium text-slate-300 hover:border-sky-500/40 hover:text-sky-200 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <Navigation
                    className={
                      "h-3.5 w-3.5 text-sky-300 " +
                      (geoLoading
                        ? "motion-safe:animate-spin"
                        : "motion-safe:group-hover:animate-pulse")
                    }
                  />
                  <span>{geoLoading ? "Locating..." : "Use my location"}</span>
                </button>
              </form>
              {suggestionOptions.length > 0 && (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                  <span className="uppercase tracking-[0.2em] text-slate-500">Suggestions</span>
                  {suggestionOptions.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setSearchQuery(name)}
                      className="rounded-full border border-slate-700/70 bg-slate-900/40 px-2.5 py-1 hover:border-sky-500/40 hover:text-sky-200 transition-colors"
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
              {hasFavorites && (
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                  <span className="uppercase tracking-[0.2em] text-slate-500">Favorites</span>
                  {favorites.map((fav) => (
                    <button
                      key={fav.id}
                      type="button"
                      onClick={() => setSelectedId(fav.id)}
                      className={
                        "rounded-full border px-3 py-1 transition-colors " +
                        (fav.id === selectedId
                          ? "border-sky-400 bg-sky-500/10 text-sky-300"
                          : "border-slate-700/70 bg-slate-900/40 text-slate-300 hover:border-sky-500/40 hover:text-sky-200")
                      }
                    >
                      {fav.name}
                    </button>
                  ))}
                </div>
              )}
              {hasRecentSearches && (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                  <span className="uppercase tracking-[0.2em] text-slate-500">Recent</span>
                  {recentSearches.map((term) => (
                    <button
                      key={term}
                      type="button"
                      onClick={() => setSearchQuery(term)}
                      className="rounded-full border border-slate-700/70 bg-slate-900/40 px-2.5 py-1 hover:border-sky-500/40 hover:text-sky-200 transition-colors"
                    >
                      {term}
                    </button>
                  ))}
                </div>
              )}
              {locationError && (
                <p className="text-[11px] text-red-300">
                  {locationError}
                </p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 text-[11px] font-medium text-slate-400">
              <span className="uppercase tracking-[0.2em] text-slate-500">Units</span>
              <button
                type="button"
                onClick={() => setUnit("c")}
                className={
                  "px-2 py-1 rounded-full border transition-colors text-xs " +
                  (unit === "c"
                    ? "border-sky-400 bg-sky-500/10 text-sky-300"
                    : "border-transparent text-slate-400 hover:border-slate-600 hover:bg-slate-800/70")
                }
              >
                °C
              </button>
              <button
                type="button"
                onClick={() => setUnit("f")}
                className={
                  "px-2 py-1 rounded-full border transition-colors text-xs " +
                  (unit === "f"
                    ? "border-sky-400 bg-sky-500/10 text-sky-300"
                    : "border-transparent text-slate-400 hover:border-slate-600 hover:bg-slate-800/70")
                }
              >
                °F
              </button>
            </div>
          </div>
        </header>

        {loading ? (
          <div className="space-y-6">
            <div className="rounded-3xl border border-slate-800/60 bg-gradient-to-br from-slate-900/80 to-slate-900/40 backdrop-blur-xl p-6 md:p-8 animate-pulse">
              <div className="flex items-center gap-6">
                <div className="h-16 w-16 rounded-full bg-slate-800/80" />
                <div className="flex-1 space-y-3">
                  <div className="h-3 w-24 rounded-full bg-slate-800/80" />
                  <div className="h-8 w-32 rounded-full bg-slate-800/80" />
                  <div className="h-3 w-40 rounded-full bg-slate-800/70" />
                  <div className="h-2 w-32 rounded-full bg-slate-900/70" />
                </div>
              </div>
              <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="h-16 rounded-2xl bg-slate-900/80" />
                <div className="h-16 rounded-2xl bg-slate-900/80" />
                <div className="h-16 rounded-2xl bg-slate-900/80" />
                <div className="h-16 rounded-2xl bg-slate-900/80" />
              </div>
            </div>

            <div className="rounded-3xl border border-slate-800/60 bg-gradient-to-br from-slate-900/80 to-slate-900/40 backdrop-blur-xl p-5 animate-pulse">
              <div className="mb-4 h-3 w-32 rounded-full bg-slate-800/80" />
              <div className="flex gap-3 overflow-hidden">
                {Array.from({ length: 6 }).map((_, idx) => (
                  <div
                    key={idx}
                    className="flex min-w-[70px] flex-col items-center gap-2 rounded-2xl bg-slate-900/70 px-3 py-3"
                  >
                    <div className="h-2 w-10 rounded-full bg-slate-800/80" />
                    <div className="h-4 w-6 rounded-full bg-slate-800/80" />
                    <div className="h-2 w-8 rounded-full bg-slate-900/80" />
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-800/60 bg-gradient-to-br from-slate-900/80 to-slate-900/40 backdrop-blur-xl p-5 animate-pulse">
              <div className="mb-4 h-3 w-32 rounded-full bg-slate-800/80" />
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-2xl bg-slate-900/70 px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-3 w-16 rounded-full bg-slate-800/80" />
                      <div className="h-2 w-10 rounded-full bg-slate-900/80" />
                    </div>
                    <div className="h-3 w-12 rounded-full bg-slate-800/80" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : error ? (
          <div className="rounded-3xl border border-red-500/40 bg-gradient-to-br from-red-900/40 to-red-900/20 backdrop-blur-sm px-6 py-5 text-sm text-red-100 shadow-lg shadow-red-900/20">
            <p className="font-medium">{error}</p>
          </div>
        ) : current ? (
          <>
            {/* Top current conditions card */}
            <section className="mb-10 grid gap-8 rounded-3xl border border-slate-800/50 bg-gradient-to-br from-slate-900/80 via-slate-900/50 to-slate-900/30 backdrop-blur-xl p-8 md:grid-cols-[2fr,1.5fr] shadow-2xl shadow-slate-950/50 hover:shadow-sky-900/10 transition-all duration-300">
              <div className="mb-4 flex justify-end text-xs text-slate-400">
                <div className="flex flex-col items-end">
                  <span className="font-semibold text-slate-100">Current weather</span>
                  <span className="mt-0.5 text-[11px] text-slate-500">
                    {formatLocalTime(current.time)}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-8">
                <div className="relative flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-br from-sky-500/20 to-blue-500/10 text-sky-300 shadow-lg shadow-sky-500/20">
                  {cloudCoverNow >= 60 ? (
                    <Cloud className="h-12 w-12 motion-safe:animate-pulse" />
                  ) : (
                    <Sun className="h-12 w-12 motion-safe:animate-pulse" />
                  )}
                  <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-sky-400/10 to-transparent blur-xl" />
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-slate-400 font-medium tracking-wide">
                    {selectedLocation.name}
                  </p>
                  <div className="flex items-end gap-3">
                    <p className="text-6xl font-bold leading-none text-slate-50 drop-shadow-[0_4px_8px_rgba(0,0,0,0.6)]">
                      {formatTemp(current.temp, unit)}
                      <span className="align-top text-3xl">°{unitSymbol}</span>
                    </p>
                    <p className="text-base text-slate-300 mb-2 font-semibold drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">
                      H: {formatTemp(current.hi, unit)}°{unitSymbol} L: {formatTemp(current.lo, unit)}°{unitSymbol}
                    </p>
                  </div>
                  <p className="text-base text-slate-300 font-medium">
                    {describeConditions(current, cloudCoverNow)}
                  </p>
                  <p className="text-sm text-slate-400">
                    {current.precipProb}% chance of rain today
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-slate-800/60 to-slate-900/40 backdrop-blur-sm px-5 py-4 border border-slate-700/30 hover:border-sky-500/30 transition-all duration-300 group">
                  <span className="rounded-xl bg-gradient-to-br from-sky-500/20 to-sky-600/10 p-3 text-sky-300 group-hover:scale-110 transition-transform duration-300">
                    <Thermometer className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Feels like</p>
                    <p className="text-lg font-bold text-slate-50 drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">{formatTemp(current.feelsLike, unit)}°{unitSymbol}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-slate-800/60 to-slate-900/40 backdrop-blur-sm px-5 py-4 border border-slate-700/30 hover:border-emerald-500/30 transition-all duration-300 group">
                  <span className="rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 p-3 text-emerald-300 group-hover:scale-110 transition-transform duration-300">
                    <Wind className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Wind</p>
                    <p className="text-lg font-bold text-slate-50 drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">{current.windSpeed} km/h</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-slate-800/60 to-slate-900/40 backdrop-blur-sm px-5 py-4 border border-slate-700/30 hover:border-cyan-500/30 transition-all duration-300 group">
                  <span className="rounded-xl bg-gradient-to-br from-cyan-500/20 to-cyan-600/10 p-3 text-cyan-300 group-hover:scale-110 transition-transform duration-300 motion-safe:animate-pulse">
                    <Droplets className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Rain today</p>
                    <p className="text-lg font-bold text-slate-50 drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">{current.precipProb}%</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {getRainType(current.rainMm).type}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-slate-800/60 to-slate-900/40 backdrop-blur-sm px-5 py-4 border border-slate-700/30 hover:border-amber-500/30 transition-all duration-300 group">
                  <span className="rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-600/10 p-3 text-amber-300 group-hover:scale-110 transition-transform duration-300">
                    <Sun className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Sun</p>
                    <p className="text-xs font-bold text-slate-50">
                      {new Date(current.sunrise).toLocaleTimeString("en-PH", {
                        hour: "numeric",
                        minute: "2-digit",
                        hour12: true,
                        timeZone: "Asia/Manila",
                      })}
                      {" "}/
                      {" "}
                      {new Date(current.sunset).toLocaleTimeString("en-PH", {
                        hour: "numeric",
                        minute: "2-digit",
                        hour12: true,
                        timeZone: "Asia/Manila",
                      })}
                    </p>
                  </div>
                </div>
                {(typeof current.humidity === "number" || typeof current.pressure === "number") && (
                  <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-slate-800/60 to-slate-900/40 backdrop-blur-sm px-5 py-4 border border-slate-700/30 hover:border-cyan-400/30 transition-all duration-300 group">
                    <span className="rounded-xl bg-gradient-to-br from-cyan-500/20 to-cyan-600/10 p-3 text-cyan-300 group-hover:scale-110 transition-transform duration-300">
                      <Droplets className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Humidity / Pressure</p>
                      <p className="text-xs font-semibold text-slate-200">
                        {typeof current.humidity === "number" ? `${current.humidity}%` : "–"}
                        {" "}
                        ·
                        {" "}
                        {typeof current.pressure === "number" ? `${current.pressure} hPa` : "–"}
                      </p>
                      {current.pressureTrend && (
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Pressure {current.pressureTrend}
                          {typeof current.pressureDelta === "number" && Math.abs(current.pressureDelta) >= 1
                            ? ` (${current.pressureDelta > 0 ? "+" : ""}${current.pressureDelta.toFixed(1)} hPa)`
                            : ""}
                        </p>
                      )}
                    </div>
                  </div>
                )}
                {moonPhase && moonPhase.label && (
                  <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-slate-800/60 to-slate-900/40 backdrop-blur-sm px-5 py-4 border border-slate-700/30 hover:border-indigo-500/30 transition-all duration-300 group">
                    <span className="rounded-xl bg-gradient-to-br from-indigo-500/20 to-indigo-600/10 p-3 text-indigo-300 group-hover:scale-110 transition-transform duration-300">
                      <Moon className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Moon phase</p>
                      <p className="text-xs font-semibold text-slate-200">
                        {getMoonPhaseEmoji(moonPhase.label)} {moonPhase.label}
                      </p>
                    </div>
                  </div>
                )}
                {typeof current.uvIndex === "number" && (
                  <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-slate-800/60 to-slate-900/40 backdrop-blur-sm px-5 py-4 border border-slate-700/30 hover:border-orange-500/30 transition-all duration-300 group">
                    <span className="rounded-xl bg-gradient-to-br from-orange-500/20 to-orange-600/10 p-3 text-orange-300 group-hover:scale-110 transition-transform duration-300">
                      <Sun className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">UV Index</p>
                      <p className="text-xs font-semibold text-slate-200">
                        {current.uvIndex} — {getUVLevel(current.uvIndex).level}
                      </p>
                    </div>
                  </div>
                )}
                {current.visibility && (
                  <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-slate-800/60 to-slate-900/40 backdrop-blur-sm px-5 py-4 border border-slate-700/30 hover:border-blue-500/30 transition-all duration-300 group">
                    <span className="rounded-xl bg-gradient-to-br from-blue-500/20 to-blue-600/10 p-3 text-blue-300 group-hover:scale-110 transition-transform duration-300 motion-safe:animate-pulse">
                      <Eye className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Visibility</p>
                      <p className="text-xs font-semibold text-slate-200">
                        {current.visibility} km — {getVisibilityLevel(parseFloat(current.visibility))}
                      </p>
                    </div>
                  </div>
                )}
                {typeof current.dewPoint === "number" && (
                  <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-slate-800/60 to-slate-900/40 backdrop-blur-sm px-5 py-4 border border-slate-700/30 hover:border-teal-500/30 transition-all duration-300 group">
                    <span className="rounded-xl bg-gradient-to-br from-teal-500/20 to-teal-600/10 p-3 text-teal-300 group-hover:scale-110 transition-transform duration-300 motion-safe:animate-pulse">
                      <Droplets className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Dew Point</p>
                      <p className="text-lg font-bold text-slate-50 drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">{formatTemp(current.dewPoint, unit)}°{unitSymbol}</p>
                    </div>
                  </div>
                )}
                {typeof current.cloudCover === "number" && (
                  <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-slate-800/60 to-slate-900/40 backdrop-blur-sm px-5 py-4 border border-slate-700/30 hover:border-slate-400/30 transition-all duration-300 group">
                    <span className="rounded-xl bg-gradient-to-br from-slate-500/20 to-slate-600/10 p-3 text-slate-300 group-hover:scale-110 transition-transform duration-300">
                      <Cloud className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Cloud Cover</p>
                      <p className="text-lg font-bold text-slate-50 drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">{current.cloudCover}%</p>
                    </div>
                  </div>
                )}
                {typeof current.aqiIndex === "number" && (
                  <div className="flex items-start sm:items-center gap-3 sm:gap-4 rounded-2xl bg-gradient-to-br from-slate-800/60 to-slate-900/40 backdrop-blur-sm px-5 py-4 border border-slate-700/30 hover:border-emerald-400/30 transition-all duration-300 group">
                    <span className="rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 p-3 text-emerald-300 group-hover:scale-110 transition-transform duration-300">
                      <Wind className="h-5 w-5" />
                    </span>
                    <div className="max-w-[12rem] sm:max-w-none">
                      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Air Quality</p>
                      <p className="text-xs font-semibold text-slate-100">
                        {current.aqiLabel} (AQI {current.aqiIndex})
                      </p>
                      <p className="text-[10px] sm:text-[11px] text-slate-300 mt-0.5 leading-snug break-words">
                        {current.aqiMessage}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </section>

            {generateWeatherImpact(current, cloudCoverNow).length > 0 && (
              <section className="mb-10 rounded-3xl border border-slate-800/50 bg-gradient-to-br from-slate-900/70 to-slate-900/30 backdrop-blur-xl p-6 shadow-xl shadow-slate-950/50">
                <div className="flex items-center gap-2 mb-5">
                  <div className="h-1 w-1 rounded-full bg-emerald-400 animate-pulse" />
                  <p className="text-xs uppercase tracking-[0.35em] text-slate-400 font-semibold">Weather Impact</p>
                </div>
                <div className="space-y-3">
                  {generateWeatherImpact(current, cloudCoverNow).map((impact, idx) => {
                    const IconComponent = impact.icon;
                    return (
                      <div
                        key={idx}
                        className="flex items-center gap-4 rounded-2xl bg-gradient-to-r from-slate-800/60 to-slate-900/40 backdrop-blur-sm px-5 py-4 border border-slate-700/30 hover:border-emerald-500/40 transition-all duration-300"
                      >
                        <span className={`rounded-xl bg-gradient-to-br from-${impact.color}-500/20 to-${impact.color}-600/10 p-3 text-${impact.color}-300`}>
                          <IconComponent className="h-5 w-5" />
                        </span>
                        <p className="text-sm text-slate-200 drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]">{impact.text}</p>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Hourly strip */}
            <section className="mb-10 rounded-3xl border border-slate-800/50 bg-gradient-to-br from-slate-900/70 to-slate-900/30 backdrop-blur-xl p-6 shadow-xl shadow-slate-950/50">
              <div className="flex items-center gap-2 mb-5">
                <div className="h-1 w-1 rounded-full bg-sky-400 animate-pulse" />
                <p className="text-xs uppercase tracking-[0.35em] text-slate-400 font-semibold">Hourly Forecast</p>
              </div>
              <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
                {hourly.map((h, idx) => {
                  const barHeight =
                    hourlyTempRange && Number.isFinite(hourlyTempRange.min) && Number.isFinite(hourlyTempRange.max)
                      ? getTempPercent(h.temp, hourlyTempRange.min, hourlyTempRange.max)
                      : 0;
                  const rainInfo = getRainType(h.rainMm);
                  const prev = idx > 0 ? hourly[idx - 1] : null;
                  const delta = prev ? h.precipProb - prev.precipProb : 0;
                  let trendIcon = null;
                  let trendColor = "text-slate-400";
                  if (delta > 5) {
                    trendIcon = <TrendingUp className="h-3 w-3" />;
                    trendColor = "text-emerald-400";
                  } else if (delta < -5) {
                    trendIcon = <TrendingDown className="h-3 w-3" />;
                    trendColor = "text-sky-400";
                  }
                  const probClass =
                    h.precipProb >= 70
                      ? "text-sky-300 font-semibold"
                      : h.precipProb >= 40
                      ? "text-sky-200"
                      : "text-slate-400";
                  return (
                    <div
                      key={h.time}
                      className="min-w-[95px] flex flex-col items-center rounded-2xl bg-gradient-to-br from-slate-800/60 to-slate-900/40 backdrop-blur-sm px-4 py-4 text-xs text-slate-300 border border-slate-700/30 hover:border-sky-500/40 hover:scale-105 transition-all duration-300 shadow-lg hover:shadow-sky-500/10"
                      style={{ animationDelay: `${idx * 50}ms` }}
                    >
                      <p className="mb-2 text-[11px] text-slate-400 font-medium">{formatHourLabel(h.time)}</p>
                      <p className="mb-1 text-2xl font-bold text-slate-50 drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]">{formatTemp(h.temp, unit)}°{unitSymbol}</p>
                      <div className="mb-2 flex flex-col items-center gap-1">
                        <div className="flex items-center gap-1">
                          <span className="text-base leading-none">
                            {rainInfo.icon}
                          </span>
                          <span className={`text-[11px] ${probClass}`}>
                            {h.precipProb}%
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400">
                          {rainInfo.type}
                        </p>
                        {trendIcon && (
                          <div className={`flex items-center gap-1 text-[10px] ${trendColor}`}>
                            {trendIcon}
                            <span>{delta > 0 ? "Increasing" : "Decreasing"}</span>
                          </div>
                        )}
                      </div>
                      <div className="mt-1 h-10 w-1.5 rounded-full bg-slate-800/80 overflow-hidden">
                        <div
                          className="w-full rounded-full bg-gradient-to-t from-sky-500 to-emerald-400"
                          style={{ height: `${barHeight}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {tempTimelinePoints && tempTimelineData && tempTimelineData.length > 0 && (
                <div className="mt-6">
                  <div className="mb-2 text-[10px] uppercase tracking-[0.25em] text-slate-500 font-medium">
                    Today Temperature Timeline
                  </div>
                  <div className="relative h-32 rounded-2xl bg-slate-900/70 border border-slate-800 overflow-hidden">
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,#38bdf8_0,transparent_55%)] opacity-30" />
                    <svg
                      viewBox="0 0 100 100"
                      className="relative h-full w-full cursor-crosshair"
                      onMouseLeave={() => setTimelineHoverIndex(null)}
                    >
                      <polyline
                        points={tempTimelinePoints}
                        fill="none"
                        stroke="#22d3ee"
                        strokeWidth="1.5"
                        className="drop-shadow-[0_0_8px_rgba(56,189,248,0.75)]"
                      />
                      {tempTimelineData.map((p, idx) => (
                        <circle
                          key={idx}
                          cx={p.x}
                          cy={p.y}
                          r={timelineHoverIndex === idx ? 2.2 : 1.4}
                          fill="#22d3ee"
                          className="transition-all duration-150"
                          onMouseEnter={() => setTimelineHoverIndex(idx)}
                          onClick={() => setTimelineHoverIndex(idx)}
                        />
                      ))}
                      {timelineHoverIndex !== null && tempTimelineData[timelineHoverIndex] && (
                        <g>
                          <line
                            x1={tempTimelineData[timelineHoverIndex].x}
                            x2={tempTimelineData[timelineHoverIndex].x}
                            y1={tempTimelineData[timelineHoverIndex].y}
                            y2={100}
                            stroke="#0ea5e9"
                            strokeWidth="0.5"
                            strokeDasharray="2,2"
                          />
                        </g>
                      )}
                    </svg>
                    {timelineHoverIndex !== null && tempTimelineData[timelineHoverIndex] && (
                      <div className="pointer-events-none absolute top-2 left-3 rounded-xl bg-slate-900/90 border border-sky-500/40 px-3 py-1.5 text-[11px] text-slate-100 shadow-lg shadow-sky-900/30">
                        <div className="font-semibold">
                          {formatTemp(tempTimelineData[timelineHoverIndex].temp, unit)}°{unitSymbol}
                        </div>
                        <div className="text-[10px] text-slate-300">
                          {tempTimelineData[timelineHoverIndex].timeLabel}
                        </div>
                      </div>
                    )}
                    <div className="pointer-events-none absolute bottom-1 left-3 right-3 flex justify-between text-[10px] text-slate-400">
                      <span>
                        {tempTimelineData[0] ? tempTimelineData[0].timeLabel : ""}
                      </span>
                      <span>
                        {tempTimelineData[tempTimelineData.length - 1]
                          ? tempTimelineData[tempTimelineData.length - 1].timeLabel
                          : ""}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* Daily forecast */}
            <section className="rounded-3xl border border-slate-800/50 bg-gradient-to-br from-slate-900/70 to-slate-900/30 backdrop-blur-xl p-6 shadow-xl shadow-slate-950/50">
              <div className="flex items-center gap-2 mb-5">
                <div className="h-1 w-1 rounded-full bg-sky-400 animate-pulse" />
                <p className="text-xs uppercase tracking-[0.35em] text-slate-400 font-semibold">5-Day Forecast</p>
              </div>
              <div className="space-y-3 text-sm">
                {daily.map((d, idx) => (
                  <div
                    key={d.date}
                    className="flex items-center justify-between rounded-2xl bg-gradient-to-r from-slate-800/60 to-slate-900/40 backdrop-blur-sm px-5 py-4 border border-slate-700/30 hover:border-sky-500/40 hover:scale-[1.02] transition-all duration-300 shadow-lg hover:shadow-sky-500/10 group"
                  >
                    <div className="flex items-center gap-5 flex-1">
                      <span className="w-24 text-slate-200 font-semibold group-hover:text-sky-300 transition-colors">
                        {formatDayLabel(d.date, idx)}
                      </span>
                      <div className="flex items-center gap-2">
                        <Droplets className="h-3.5 w-3.5 text-sky-400" />
                        <span className="text-xs text-sky-300 font-medium">
                          {d.precipProb}%
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-base">
                      <span className="text-slate-50 font-bold">{formatTemp(d.hi, unit)}°{unitSymbol}</span>
                      <div className="h-1 w-8 rounded-full bg-gradient-to-r from-slate-400 to-slate-600" />
                      <span className="text-slate-400 font-semibold">{formatTemp(d.lo, unit)}°{unitSymbol}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 text-xs md:text-sm text-slate-300">
                <p className="font-semibold text-slate-100 mb-1">Weekly insight</p>
                <p>
                  {generateWeeklyInsight(daily, unit) || "Forecast pattern not available."}
                </p>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
};

export default Weather;
