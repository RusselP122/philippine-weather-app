export const minLon = 115.5; // Official PAGASA Composite bounds
export const maxLon = 129.5; // Official PAGASA Composite bounds
export const minLat = 4.0;   // Official PAGASA Composite bounds
export const maxLat = 22.5;  // Official PAGASA Composite bounds
export const canvasWidth = 1020;
export const canvasHeight = 1393;

export const RADAR_STATIONS = [
  { id: "basco", name: "Basco Station", lat: 20.45, lon: 121.97, region: "luzon", status: "online", desc: "Northernmost early warning station monitoring the Luzon Strait and Taiwan region." },
  { id: "aparri", name: "Aparri Station", lat: 18.36, lon: 121.63, region: "luzon", status: "online", desc: "Covers Cagayan Valley & Northern Luzon corridor." },
  { id: "baguio", name: "Baguio Station", lat: 16.41, lon: 120.60, region: "luzon", status: "online", desc: "Monitors Cordillera mountains & Ilocos region." },
  { id: "alaminos", name: "Alaminos Station", lat: 16.15, lon: 119.98, region: "luzon", status: "online", desc: "Monitors the Lingayen Gulf, West Philippine Sea, & Northern Luzon basin." },
  { id: "baler", name: "Baler Station", lat: 15.76, lon: 121.63, region: "luzon", status: "online", desc: "Scans the Pacific Ocean and Sierra Madre mountains for incoming typhoons." },
  { id: "subic", name: "Subic Station", lat: 14.82, lon: 120.27, region: "luzon", status: "online", desc: "Monitors West Philippine Sea & Central Luzon." },
  { id: "tagaytay", name: "Tagaytay Station", lat: 14.13, lon: 120.97, region: "luzon", status: "online", desc: "Key station for Metro Manila, CALABARZON, & Taal region." },
  { id: "daet", name: "Daet Station", lat: 14.12, lon: 122.98, region: "luzon", status: "online", desc: "Tracks storms entering the Bicol peninsula." },
  { id: "virac", name: "Virac Station", lat: 13.58, lon: 124.23, region: "luzon", status: "standby", desc: "Primary early warning station facing the Pacific Ocean." },
  { id: "busuanga", name: "Busuanga Station", lat: 12.18, lon: 120.10, region: "luzon", status: "online", desc: "Covers Northern Palawan & Mindoro Strait." },
  { id: "iloilo", name: "Iloilo Station", lat: 10.70, lon: 122.56, region: "visayas", status: "online", desc: "Covers Western Visayas & Panay Gulf." },
  { id: "cebu", name: "Cebu Station", lat: 10.33, lon: 123.90, region: "visayas", status: "online", desc: "Centrally positioned to scan Central Visayas & Bohol Sea." },
  { id: "guiuan", name: "Guiuan Station", lat: 11.03, lon: 125.72, region: "visayas", status: "maintenance", desc: "Eastern Pacific gateway radar. Rebuilding infrastructure." },
  { id: "hinatuan", name: "Hinatuan Station", lat: 8.37, lon: 126.33, region: "mindanao", status: "online", desc: "Covers Caraga region & Eastern Mindanao sea." },
  { id: "tampakan", name: "Tampakan Station", lat: 6.27, lon: 125.02, region: "mindanao", status: "online", desc: "Monitors SOCCSKSARGEN & Southern Mindanao." },
  { id: "zamboanga", name: "Zamboanga Station", lat: 6.91, lon: 122.06, region: "mindanao", status: "online", desc: "Monitors Zamboanga Peninsula & Sulu Archipelago." }
];
