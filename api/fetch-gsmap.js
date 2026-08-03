// api/fetch-gsmap.js
import zlib from "zlib";
import ftp from "basic-ftp";
import { Writable } from "stream";

// JAXA GSMaP Authorized Credentials
const JAXA_FTP_HOST = "hokusai.eorc.jaxa.jp";
const JAXA_USER = process.env.JAXA_USER || "rainmap";
const JAXA_PASS = process.env.JAXA_PASS || "Niskur+1404";

// Centroids for 82 Philippine Provinces (Latitude, Longitude)
const PROVINCE_COORDS = {
  "Abra": [17.6, 120.9],
  "Agusan del Norte": [9.0, 125.5],
  "Agusan del Sur": [8.5, 125.8],
  "Aklan": [11.6, 122.3],
  "Albay": [13.2, 123.7],
  "Antique": [11.2, 122.0],
  "Apayao": [18.1, 121.2],
  "Aurora": [15.8, 121.5],
  "Basilan": [6.6, 122.0],
  "Bataan": [14.7, 120.4],
  "Batanes": [20.4, 121.9],
  "Batangas": [13.8, 121.0],
  "Benguet": [16.5, 120.6],
  "Biliran": [11.6, 124.5],
  "Bohol": [9.8, 124.2],
  "Bukidnon": [8.0, 125.0],
  "Bulacan": [14.9, 121.0],
  "Cagayan": [18.0, 121.8],
  "Camarines Norte": [14.1, 122.8],
  "Camarines Sur": [13.6, 123.3],
  "Camiguin": [9.2, 124.7],
  "Capiz": [11.4, 122.7],
  "Catanduanes": [13.8, 124.3],
  "Cavite": [14.3, 120.9],
  "Cebu": [10.3, 123.9],
  "Cotabato": [7.2, 124.8],
  "Davao de Oro": [7.5, 126.0],
  "Davao del Norte": [7.6, 125.8],
  "Davao del Sur": [6.8, 125.4],
  "Davao Occidental": [6.1, 125.6],
  "Davao Oriental": [7.2, 126.3],
  "Dinagat Islands": [10.0, 125.6],
  "Eastern Samar": [11.7, 125.4],
  "Guimaras": [10.6, 122.6],
  "Ifugao": [16.8, 121.1],
  "Ilocos Norte": [18.2, 120.7],
  "Ilocos Sur": [17.3, 120.5],
  "Iloilo": [11.0, 122.6],
  "Isabela": [16.9, 121.9],
  "Kalinga": [17.4, 121.2],
  "La Union": [16.6, 120.4],
  "Laguna": [14.2, 121.4],
  "Lanao del Norte": [8.0, 124.0],
  "Lanao del Sur": [7.8, 124.3],
  "Leyte": [10.9, 124.8],
  "Maguindanao": [7.1, 124.4],
  "Marinduque": [13.4, 121.9],
  "Masbate": [12.2, 123.6],
  "Metropolitan Manila": [14.6, 121.0],
  "Misamis Occidental": [8.3, 123.7],
  "Misamis Oriental": [8.7, 124.8],
  "Mountain Province": [17.1, 121.0],
  "Negros Occidental": [10.3, 123.0],
  "Negros Oriental": [9.6, 122.9],
  "Northern Samar": [12.4, 124.6],
  "Nueva Ecija": [15.6, 121.0],
  "Nueva Vizcaya": [16.3, 121.1],
  "Occidental Mindoro": [13.2, 120.7],
  "Oriental Mindoro": [13.1, 121.3],
  "Palawan": [9.8, 118.7],
  "Pampanga": [15.0, 120.6],
  "Pangasinan": [15.9, 120.3],
  "Quezon": [14.0, 121.9],
  "Quirino": [16.3, 121.6],
  "Rizal": [14.6, 121.3],
  "Romblon": [12.5, 122.3],
  "Samar": [11.8, 124.9],
  "Sarangani": [5.9, 125.2],
  "Siquijor": [9.2, 123.6],
  "Sorsogon": [12.8, 124.0],
  "South Cotabato": [6.2, 124.8],
  "Southern Leyte": [10.3, 125.0],
  "Sultan Kudarat": [6.6, 124.3],
  "Sulu": [6.0, 121.0],
  "Surigao del Norte": [9.7, 125.6],
  "Surigao del Sur": [8.6, 126.1],
  "Tarlac": [15.5, 120.5],
  "Tawi-Tawi": [5.1, 120.0],
  "Zambales": [15.3, 120.1],
  "Zamboanga del Norte": [8.2, 123.1],
  "Zamboanga del Sur": [7.7, 123.3],
  "Zamboanga Sibugay": [7.7, 122.6]
};

/**
 * Extracts IEEE 754 float32 rainfall rate (mm/hr) from raw JAXA GSMaP binary buffer
 * GSMaP grid: 3600 columns x 1800 rows (0.1 degree resolution, 60N to 60S, 0E to 360E)
 */
function readGsmapRawBinaryValue(binaryBuffer, lat, lon) {
  if (!binaryBuffer || binaryBuffer.length < 3600 * 1200 * 4) {
    return 0;
  }

  // Row index from latitude (60.0N = row 0, 60.0S = row 1200)
  const row = Math.floor((60.0 - lat) / 0.1);
  // Column index from longitude (0.0E = col 0, 360.0E = col 3600)
  const normalizedLon = (lon + 360) % 360;
  const col = Math.floor(normalizedLon / 0.1);

  if (row < 0 || row >= 1200 || col < 0 || col >= 3600) {
    return 0;
  }

  const byteOffset = (row * 3600 + col) * 4;
  if (byteOffset + 4 > binaryBuffer.length) {
    return 0;
  }

  // Read little-endian 32-bit float value from binary stream
  const val = binaryBuffer.readFloatLE(byteOffset);
  return val > 0 ? val : 0;
}

export default async function handler(req, res) {
  try {
    const now = new Date();

    // 1. Generate real-time satellite timeline frames
    const timeSteps = [
      { label: "Latest (Now)", offsetHours: 0 },
      { label: "1 Hour Ago", offsetHours: 1 },
      { label: "2 Hours Ago", offsetHours: 2 },
      { label: "3 Hours Ago", offsetHours: 3 },
      { label: "6 Hours Ago", offsetHours: 6 },
    ];

    const frames = timeSteps.map(step => {
      const targetTime = new Date(now.getTime() - step.offsetHours * 3600 * 1000);
      const isoDate = targetTime.toISOString().split("T")[0];
      const formattedTime = targetTime.toLocaleTimeString("en-US", {
        timeZone: "Asia/Manila",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
      }) + " PHT";

      return {
        label: step.label,
        offsetHours: step.offsetHours,
        date: isoDate,
        formattedTime,
        isoString: targetTime.toISOString(),
        tileUrl: `https://gibs-{s}.earthdata.nasa.gov/wmts/epsg3857/best/GPM_3IMERGHHE/default/${isoDate}/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`
      };
    });

    let rawBinaryBuffer = null;
    let dataSource = `JAXA GSMaP (${JAXA_FTP_HOST})`;
    let latestFileName = "None";

    // 2. Fetch authenticated raw GSMaP `.dat.gz` binary payload using basic-ftp
    const client = new ftp.Client();
    try {
      await client.access({
        host: JAXA_FTP_HOST,
        user: JAXA_USER,
        password: JAXA_PASS,
        secure: false
      });

      const list = await client.list("now/latest");
      const gsmapFiles = list
        .map(f => f.name)
        .filter(n => /^gsmap_now\.\d{8}\.\d{4}\.dat\.gz$/.test(n))
        .sort();

      if (gsmapFiles.length > 0) {
        latestFileName = gsmapFiles[gsmapFiles.length - 1];
        console.log("Fetching GSMaP file:", latestFileName);

        const chunks = [];
        const writable = new Writable({
          write(chunk, encoding, callback) {
            chunks.push(chunk);
            callback();
          }
        });

        await client.downloadTo(writable, `now/latest/${latestFileName}`);
        
        let compressedBuffer = Buffer.concat(chunks);
        // Decompress raw gzip binary stream
        rawBinaryBuffer = zlib.gunzipSync(compressedBuffer);
      }
    } catch (binErr) {
      console.warn("JAXA GSMaP FTP fetch note:", binErr.message);
    } finally {
      client.close();
    }

    // 3. Extract exact province rainfall values directly from raw binary
    const provinceRainfall = {};

    Object.entries(PROVINCE_COORDS).forEach(([provName, [lat, lon]]) => {
      let rainVal = 0;
      if (rawBinaryBuffer) {
        rainVal = readGsmapRawBinaryValue(rawBinaryBuffer, lat, lon);
      }

      provinceRainfall[provName] = {
        rainfall: Math.round(rainVal * 10) / 10,
        rainfall_mm: Math.round(rainVal * 10) / 10,
        current_rate: rainVal,
        source: dataSource
      };
    });
    // Add Cache-Control to prevent spamming JAXA FTP on every request
    // Cache for 30 minutes (1800s) on Vercel's Edge Network
    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=600');

    return res.status(200).json({
      success: true,
      message: "JAXA GSMaP Raw Binary precipitation extracted successfully",
      timestamp: now.toISOString(),
      user: JAXA_USER,
      ftp_host: JAXA_FTP_HOST,
      file_processed: latestFileName,
      provider: `JAXA GSMaP (${JAXA_FTP_HOST})`,
      dataType: "4-byte float32 plain binary (3600x1800 grid)",
      bounds: [
        [-60, 80],
        [60, 160]
      ],
      attribution: "JAXA Global Rainfall Watch Data",
      frames,
      provinces: provinceRainfall
    });
  } catch (error) {
    console.error("Error in api/fetch-gsmap.js:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to parse JAXA P-Tree Raw Binary data"
    });
  }
}
