// Official GarbinWx Nationwide Doppler Radar Composite Bounds
// GeoJSON / Leaflet coordinate bounding box in [minLon, minLat, maxLon, maxLat] order:
export const minLon = 115.41549141305251;
export const minLat = 3.801613036809332;
export const maxLon = 129.51730887177652;
export const maxLat = 22.45850950564088;

export const canvasWidth = 1020;
export const canvasHeight = 1393;

// Official GarbinWx Reflectivity (DBZ) Color Scale (1 to 66+ dBZ)
export const HEX_COLORS_DBZ = [
  '#535353',  // 1 dBZ
  '#5b5b5b',  // 2
  '#606060',  // 3
  '#6e6e6e',  // 4
  '#797979',  // 5
  '#828282',  // 6
  '#8a8a8a',  // 7
  '#939393',  // 8
  '#9b9b9b',  // 9
  '#a1a1a1',  // 10 
  '#aaaaaa',  // 11
  '#b9b9b9',  // 12
  '#c1c1c1',  // 13
  '#c8c8c8',  // 14
  '#cecece',  // 15 
  '#00ff00',  // 16
  '#00f500',  // 17
  '#00e600',  // 18
  '#00dc00',  // 19
  '#00d200',  // 20 
  '#00c800',  // 21
  '#00be00',  // 22
  '#00b400',  // 23
  '#00aa00',  // 24
  '#00a000',  // 25 
  '#009600',  // 26
  '#32aa00',  // 27
  '#64be00',  // 28
  '#96d200',  // 29
  '#cdeb00',  // 30 
  '#ffff00',  // 31
  '#fff500',  // 32
  '#ffe600',  // 33
  '#ffdc00',  // 34
  '#ffd200',  // 35 
  '#ffc800',  // 36
  '#ffb900',  // 37
  '#ffaa00',  // 38
  '#ff9600',  // 39
  '#ff8700',  // 40 
  '#ff7800',  // 41
  '#ff5f00',  // 42
  '#ff4600',  // 43
  '#ff3200',  // 44
  '#ff1900',  // 45 
  '#ff0000',  // 46
  '#ff0000',  // 47
  '#e60000',  // 48
  '#dc0000',  // 49
  '#d20000',  // 50 
  '#c80000',  // 51
  '#be0000',  // 52
  '#b40000',  // 53
  '#aa0000',  // 54
  '#a00000',  // 55 
  '#960000',  // 56
  '#aa0032',  // 57
  '#be0064',  // 58
  '#d70096',  // 59
  '#eb00cd',  // 60 
  '#ff00ff',  // 61
  '#eb00ff',  // 62
  '#d200ff',  // 63
  '#be00ff',  // 64
  '#aa00ff',  // 65 
  '#9600ff'   // 66+ dBZ
];

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
