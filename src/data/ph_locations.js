// All Philippine cities and key municipalities organized by region
// Coordinates sourced from standard geographic data
const PH_LOCATIONS = [
    // --- NCR (Metro Manila) ---
    { id: "manila", name: "Manila", lat: 14.5995, lon: 120.9842 },
    { id: "quezon-city", name: "Quezon City", lat: 14.6760, lon: 121.0437 },
    { id: "caloocan", name: "Caloocan", lat: 14.6500, lon: 120.9667 },
    { id: "las-pinas", name: "Las Piñas", lat: 14.4445, lon: 120.9939 },
    { id: "makati", name: "Makati", lat: 14.5547, lon: 121.0244 },
    { id: "malabon", name: "Malabon", lat: 14.6625, lon: 120.9572 },
    { id: "mandaluyong", name: "Mandaluyong", lat: 14.5794, lon: 121.0359 },
    { id: "marikina", name: "Marikina", lat: 14.6507, lon: 121.1029 },
    { id: "muntinlupa", name: "Muntinlupa", lat: 14.4082, lon: 121.0415 },
    { id: "navotas", name: "Navotas", lat: 14.6667, lon: 120.9417 },
    { id: "paranaque", name: "Parañaque", lat: 14.4793, lon: 121.0198 },
    { id: "pasay", name: "Pasay", lat: 14.5378, lon: 121.0014 },
    { id: "pasig", name: "Pasig", lat: 14.5764, lon: 121.0851 },
    { id: "pateros", name: "Pateros", lat: 14.5443, lon: 121.0664 },
    { id: "san-juan", name: "San Juan, Metro Manila", lat: 14.6006, lon: 121.0317 },
    { id: "taguig", name: "Taguig", lat: 14.5176, lon: 121.0509 },
    { id: "valenzuela", name: "Valenzuela", lat: 14.7011, lon: 120.9830 },

    // --- Region I (Ilocos) ---
    { id: "laoag", name: "Laoag", lat: 18.1975, lon: 120.5936 },
    { id: "san-fernando-la-union", name: "San Fernando, La Union", lat: 16.6159, lon: 120.3167 },
    { id: "dagupan", name: "Dagupan", lat: 16.0430, lon: 120.3333 },
    { id: "vigan", name: "Vigan", lat: 17.5747, lon: 120.3869 },
    { id: "batac", name: "Batac", lat: 18.0550, lon: 120.5647 },
    { id: "candon", name: "Candon", lat: 17.1953, lon: 120.4503 },
    { id: "alaminos", name: "Alaminos, Pangasinan", lat: 16.1550, lon: 119.9800 },
    { id: "urdaneta", name: "Urdaneta", lat: 15.9761, lon: 120.5714 },
    { id: "lingayen", name: "Lingayen", lat: 16.0178, lon: 120.2267 },

    // --- Region II (Cagayan Valley) ---
    { id: "tuguegarao", name: "Tuguegarao", lat: 17.6130, lon: 121.7270 },
    { id: "ilagan", name: "Ilagan", lat: 17.1489, lon: 121.8897 },
    { id: "santiago-isabela", name: "Santiago, Isabela", lat: 16.6869, lon: 121.5494 },
    { id: "cauayan", name: "Cauayan", lat: 16.9361, lon: 121.7747 },

    // --- Region III (Central Luzon) ---
    { id: "angeles", name: "Angeles", lat: 15.1450, lon: 120.5888 },
    { id: "san-fernando-pampanga", name: "San Fernando, Pampanga", lat: 15.0289, lon: 120.6978 },
    { id: "olongapo", name: "Olongapo", lat: 14.8333, lon: 120.2833 },
    { id: "malolos", name: "Malolos", lat: 14.8433, lon: 120.8117 },
    { id: "meycauayan", name: "Meycauayan", lat: 14.7350, lon: 120.9606 },
    { id: "san-jose-del-monte", name: "San Jose del Monte", lat: 14.8138, lon: 121.0453 },
    { id: "balanga", name: "Balanga", lat: 14.6833, lon: 120.5333 },
    { id: "cabanatuan", name: "Cabanatuan", lat: 15.4869, lon: 120.9697 },
    { id: "gapan", name: "Gapan", lat: 15.3094, lon: 120.9456 },
    { id: "palayan", name: "Palayan", lat: 15.5444, lon: 121.0839 },
    { id: "tarlac-city", name: "Tarlac City", lat: 15.4878, lon: 120.5960 },

    // --- Region IV-A (CALABARZON) ---
    { id: "antipolo", name: "Antipolo", lat: 14.5864, lon: 121.1760 },
    { id: "bacoor", name: "Bacoor", lat: 14.4580, lon: 120.9347 },
    { id: "batangas-city", name: "Batangas City", lat: 13.7565, lon: 121.0583 },
    { id: "binangonan", name: "Binangonan", lat: 14.4661, lon: 121.1961 },
    { id: "cabuyao", name: "Cabuyao", lat: 14.2694, lon: 121.1258 },
    { id: "calamba", name: "Calamba", lat: 14.2106, lon: 121.1650 },
    { id: "cavite-city", name: "Cavite City", lat: 14.4791, lon: 120.8970 },
    { id: "dasmariñas", name: "Dasmariñas", lat: 14.3294, lon: 120.9367 },
    { id: "general-trias", name: "General Trias", lat: 14.3853, lon: 120.8808 },
    { id: "imus", name: "Imus", lat: 14.4297, lon: 120.9367 },
    { id: "lipa", name: "Lipa", lat: 13.9411, lon: 121.1636 },
    { id: "lucena", name: "Lucena", lat: 13.9322, lon: 121.6178 },
    { id: "san-jose-antipolo", name: "San Jose, Antipolo", lat: 14.6500, lon: 121.2000 },
    { id: "san-pablo", name: "San Pablo", lat: 14.0683, lon: 121.3247 },
    { id: "santa-rosa", name: "Santa Rosa, Laguna", lat: 14.3122, lon: 121.1114 },
    { id: "tanauan", name: "Tanauan", lat: 14.0867, lon: 121.1500 },
    { id: "tayabas", name: "Tayabas", lat: 13.8681, lon: 121.5814 },
    { id: "trece-martires", name: "Trece Martires", lat: 14.2792, lon: 120.8614 },

    // --- Region IV-B (MIMAROPA) ---
    { id: "calapan", name: "Calapan", lat: 13.4119, lon: 121.1803 },
    { id: "puerto-princesa", name: "Puerto Princesa", lat: 9.7392, lon: 118.7353 },
    { id: "san-jose-occidental-mindoro", name: "San Jose, Occidental Mindoro", lat: 12.3508, lon: 121.0694 },

    // --- Region V (Bicol) ---
    { id: "legazpi", name: "Legazpi", lat: 13.1400, lon: 123.7383 },
    { id: "naga-camarines-sur", name: "Naga, Camarines Sur", lat: 13.6192, lon: 123.1814 },
    { id: "iriga", name: "Iriga", lat: 13.4239, lon: 123.4076 },
    { id: "ligao", name: "Ligao", lat: 13.2281, lon: 123.5258 },
    { id: "tabaco", name: "Tabaco", lat: 13.3589, lon: 123.7308 },
    { id: "masbate-city", name: "Masbate City", lat: 12.3706, lon: 123.6197 },
    { id: "sorsogon-city", name: "Sorsogon City", lat: 12.9742, lon: 124.0058 },

    // --- Region VI (Western Visayas) ---
    { id: "iloilo-city", name: "Iloilo City", lat: 10.7202, lon: 122.5621 },
    { id: "bacolod", name: "Bacolod", lat: 10.6766, lon: 122.9509 },
    { id: "cadiz", name: "Cadiz", lat: 10.9561, lon: 123.3039 },
    { id: "escalante", name: "Escalante", lat: 10.8372, lon: 123.4997 },
    { id: "kabankalan", name: "Kabankalan", lat: 9.9903, lon: 122.8208 },
    { id: "la-carlota", name: "La Carlota", lat: 10.4228, lon: 122.9189 },
    { id: "sagay", name: "Sagay", lat: 10.9003, lon: 123.4231 },
    { id: "silay", name: "Silay", lat: 10.8003, lon: 122.9739 },
    { id: "talisay-negros", name: "Talisay, Negros Occidental", lat: 10.7403, lon: 122.9706 },
    { id: "victorias", name: "Victorias", lat: 10.8972, lon: 123.0758 },
    { id: "roxas-city", name: "Roxas City", lat: 11.5886, lon: 122.7514 },
    { id: "passi", name: "Passi", lat: 11.1086, lon: 122.6397 },

    // --- Region VII (Central Visayas) ---
    { id: "cebu-city", name: "Cebu City", lat: 10.3157, lon: 123.8854 },
    { id: "lapu-lapu", name: "Lapu-Lapu", lat: 10.3100, lon: 123.9494 },
    { id: "mandaue", name: "Mandaue", lat: 10.3333, lon: 123.9333 },
    { id: "bogo", name: "Bogo", lat: 11.0514, lon: 124.0042 },
    { id: "carcar", name: "Carcar", lat: 10.1086, lon: 123.6408 },
    { id: "danao", name: "Danao", lat: 10.5219, lon: 124.0269 },
    { id: "naga-cebu", name: "Naga, Cebu", lat: 10.2136, lon: 123.7575 },
    { id: "talisay-cebu", name: "Talisay, Cebu", lat: 10.2439, lon: 123.8503 },
    { id: "toledo", name: "Toledo", lat: 10.3772, lon: 123.6380 },
    { id: "tagbilaran", name: "Tagbilaran", lat: 9.6500, lon: 123.8536 },
    { id: "dumaguete", name: "Dumaguete", lat: 9.3068, lon: 123.3072 },
    { id: "bayawan", name: "Bayawan", lat: 9.3675, lon: 122.8009 },
    { id: "bais", name: "Bais", lat: 9.5933, lon: 123.1208 },
    { id: "canlaon", name: "Canlaon", lat: 10.3844, lon: 123.1994 },
    { id: "guihulngan", name: "Guihulngan", lat: 10.1236, lon: 123.2714 },
    { id: "tanjay", name: "Tanjay", lat: 9.5175, lon: 123.1572 },

    // --- Region VIII (Eastern Visayas) ---
    { id: "tacloban", name: "Tacloban", lat: 11.2444, lon: 125.0039 },
    { id: "baybay", name: "Baybay", lat: 10.6819, lon: 124.7994 },
    { id: "ormoc", name: "Ormoc", lat: 11.0064, lon: 124.6075 },
    { id: "catbalogan", name: "Catbalogan", lat: 11.7764, lon: 124.8847 },
    { id: "calbayog", name: "Calbayog", lat: 12.0658, lon: 124.5950 },
    { id: "borongan", name: "Borongan", lat: 11.6081, lon: 125.4333 },

    // --- Region IX (Zamboanga Peninsula) ---
    { id: "zamboanga-city", name: "Zamboanga City", lat: 6.9214, lon: 122.0790 },
    { id: "dipolog", name: "Dipolog", lat: 8.5858, lon: 123.3414 },
    { id: "dapitan", name: "Dapitan", lat: 8.6544, lon: 123.4244 },
    { id: "pagadian", name: "Pagadian", lat: 7.8282, lon: 123.4356 },
    { id: "isabela-basilan", name: "Isabela, Basilan", lat: 6.7058, lon: 121.9703 },

    // --- Region X (Northern Mindanao) ---
    { id: "cagayan-de-oro", name: "Cagayan de Oro", lat: 8.4542, lon: 124.6319 },
    { id: "iligan", name: "Iligan", lat: 8.2280, lon: 124.2452 },
    { id: "oroquieta", name: "Oroquieta", lat: 8.4856, lon: 123.8031 },
    { id: "ozamiz", name: "Ozamiz", lat: 8.1469, lon: 123.8406 },
    { id: "tangub", name: "Tangub", lat: 8.0661, lon: 123.7483 },
    { id: "gingoog", name: "Gingoog", lat: 8.8253, lon: 125.1103 },
    { id: "malaybalay", name: "Malaybalay", lat: 8.1575, lon: 125.1278 },
    { id: "valencia-bukidnon", name: "Valencia, Bukidnon", lat: 7.9044, lon: 125.0928 },
    { id: "el-salvador", name: "El Salvador", lat: 8.5622, lon: 124.5208 },
    { id: "laguindingan", name: "Laguindingan", lat: 8.6072, lon: 124.4658 },

    // --- Region XI (Davao) ---
    { id: "davao-city", name: "Davao City", lat: 7.1907, lon: 125.4553 },
    { id: "digos", name: "Digos", lat: 6.7497, lon: 125.3572 },
    { id: "mati", name: "Mati", lat: 6.9497, lon: 126.2194 },
    { id: "panabo", name: "Panabo", lat: 7.3086, lon: 125.6840 },
    { id: "samal-island", name: "Samal (Island Garden City)", lat: 7.1014, lon: 125.7181 },
    { id: "tagum", name: "Tagum", lat: 7.4478, lon: 125.8080 },
    { id: "island-garden-city-samal", name: "Island Garden City of Samal", lat: 7.1014, lon: 125.7181 },

    // --- Region XII (SOCCSKSARGEN) ---
    { id: "general-santos", name: "General Santos", lat: 6.1164, lon: 125.1716 },
    { id: "kidapawan", name: "Kidapawan", lat: 7.0083, lon: 125.0894 },
    { id: "koronadal", name: "Koronadal", lat: 6.5033, lon: 124.8472 },
    { id: "tacurong", name: "Tacurong", lat: 6.6936, lon: 124.6761 },
    { id: "cotabato-city", name: "Cotabato City", lat: 7.2236, lon: 124.2461 },

    // --- Region XIII (Caraga) ---
    { id: "butuan", name: "Butuan", lat: 8.9475, lon: 125.5406 },
    { id: "cabadbaran", name: "Cabadbaran", lat: 9.1233, lon: 125.5347 },
    { id: "bayugan", name: "Bayugan", lat: 8.7119, lon: 125.7467 },
    { id: "surigao-city", name: "Surigao City", lat: 9.7486, lon: 125.4950 },
    { id: "bislig", name: "Bislig", lat: 8.2142, lon: 126.3197 },
    { id: "tandag", name: "Tandag", lat: 8.9994, lon: 126.1981 },

    // --- BARMM (Bangsamoro) ---
    { id: "marawi", name: "Marawi", lat: 8.0022, lon: 124.2861 },
    { id: "lamitan-basilan", name: "Lamitan, Basilan", lat: 6.6519, lon: 122.1303 },

    // --- CAR (Cordillera) ---
    { id: "baguio", name: "Baguio", lat: 16.4023, lon: 120.5960 },
    { id: "tabuk", name: "Tabuk", lat: 17.4150, lon: 121.4442 },
    { id: "lagawe", name: "Lagawe", lat: 16.8097, lon: 121.1008 },
    { id: "la-trinidad-benguet", name: "La Trinidad, Benguet", lat: 16.4631, lon: 120.5864 },
    { id: "bontoc-mountain-province", name: "Bontoc, Mountain Province", lat: 17.0886, lon: 120.9756 },

    // --- Notable Islands / Tourist Areas ---
    { id: "boracay", name: "Boracay (Malay, Aklan)", lat: 11.9675, lon: 121.9244 },
    { id: "coron", name: "Coron, Palawan", lat: 11.9983, lon: 120.2033 },
    { id: "el-nido", name: "El Nido, Palawan", lat: 11.1894, lon: 119.4075 },
    { id: "bohol", name: "Bohol (Tagbilaran)", lat: 9.6500, lon: 123.8536 },
    { id: "siargao", name: "Siargao (Del Carmen)", lat: 9.8528, lon: 126.0644 },
    { id: "camiguin", name: "Camiguin (Mambajao)", lat: 9.2500, lon: 124.7167 },
    { id: "palawan", name: "Palawan (Puerto Princesa)", lat: 9.7392, lon: 118.7353 },
    { id: "siquijor", name: "Siquijor", lat: 9.2003, lon: 123.5350 },
];

export default PH_LOCATIONS;
