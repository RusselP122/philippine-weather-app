// api/volcano-data.js
// On-demand serverless API for PHIVOLCS volcanic earthquake counter data.
// Fetches live data from PHIVOLCS VMEPD, merges with historical archive, and caches responses.

import https from 'https';
import fs from 'fs';
import path from 'path';

const agent = new https.Agent({
  rejectUnauthorized: false
});

const VOLCANO_MAP = {
  mvo: 574, // Mayon Volcano
  bvo: 571, // Bulusan Volcano
  kvo: 565, // Kanlaon Volcano
  tvo: 580, // Taal Volcano
  hvo: 562, // Hibok-Hibok Volcano
  pvo: 583  // Pinatubo Volcano
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5-minute server-side cache
let inMemoryCache = {
  data: null,
  timestamp: 0
};

function httpsRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      agent,
      timeout: 10000
    };

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout connecting to ${url}`));
    });

    req.on('error', reject);

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

function getPHTInfo() {
  const now = new Date();
  const phtOffset = 8 * 60; // minutes
  const localOffset = now.getTimezoneOffset(); // minutes
  const phtTime = new Date(now.getTime() + (phtOffset + localOffset) * 60 * 1000);

  const yyyy = phtTime.getFullYear();
  const mm = String(phtTime.getMonth() + 1).padStart(2, '0');
  const dd = String(phtTime.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;

  const hh = String(phtTime.getHours()).padStart(2, '0');
  const min = String(phtTime.getMinutes()).padStart(2, '0');
  const ss = String(phtTime.getSeconds()).padStart(2, '0');
  const ms = String(phtTime.getMilliseconds()).padStart(3, '0');
  const timestampStr = `${dateStr}T${hh}:${min}:${ss}.${ms}+08:00`;

  return { dateStr, timestampStr };
}

let baselineCache = null;
function loadBaselineArchive() {
  if (baselineCache) {
    return JSON.parse(JSON.stringify(baselineCache));
  }

  const possiblePaths = [
    path.join(process.cwd(), 'public', 'data', 'volcano_data.json'),
    path.join(process.cwd(), 'dist', 'data', 'volcano_data.json')
  ];

  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.metadata && Array.isArray(parsed.records)) {
          baselineCache = parsed;
          return JSON.parse(JSON.stringify(baselineCache));
        }
      }
    } catch {
      // Continue to next path
    }
  }

  return {
    metadata: {
      api_source: "Philippine Typhoon/Weather",
      data_source: "Philippine Institute of Volcanology and Seismology",
      last_updated: "",
      developer_note: "Made by a Filipino, For the Filipino, and For the World.",
      total_Volcanic_earthquakes: ""
    },
    records: []
  };
}

async function fetchLivePhivolcsCounts() {
  const base_url = 'https://vmepd.phivolcs.dost.gov.ph';

  // 1. Fetch homepage for CSRF token & cookie
  const homeRes = await httpsRequest(`${base_url}/`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });

  const setCookies = homeRes.headers['set-cookie'] || [];
  const cookieHeader = setCookies.map(c => c.split(';')[0]).join('; ');
  const csrfMatch = homeRes.body.match(/name=["']csrf-token["'] content=["']([^"']+)["']/);
  if (!csrfMatch) {
    throw new Error('CSRF token not found');
  }
  const csrfToken = csrfMatch[1];

  const commonHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'X-CSRF-Token': csrfToken,
    'X-Requested-With': 'XMLHttpRequest',
    'Content-Type': 'application/x-www-form-urlencoded',
    'Cookie': cookieHeader
  };

  // 2. Fetch low-frequency counts
  const lowFreqBody = new URLSearchParams({ type: '1', '_csrf-frontend': csrfToken }).toString();
  const lowFreqRes = await httpsRequest(`${base_url}/site/lowfreq-vq`, {
    method: 'POST',
    headers: commonHeaders,
    body: lowFreqBody
  });

  let lowFreq = {};
  try {
    lowFreq = JSON.parse(lowFreqRes.body);
  } catch {
    lowFreq = {};
  }

  // 3. Fetch phase counts per volcano
  const structuredData = {};
  for (const [code, vdId] of Object.entries(VOLCANO_MAP)) {
    const phaseBody = new URLSearchParams({
      type: '1',
      vdId: String(vdId),
      '_csrf-frontend': csrfToken
    }).toString();

    const phaseRes = await httpsRequest(`${base_url}/site/phase-vq`, {
      method: 'POST',
      headers: commonHeaders,
      body: phaseBody
    });

    let phaseData = {};
    try {
      phaseData = JSON.parse(phaseRes.body);
    } catch {
      phaseData = {};
    }

    const phaseCount = parseInt(phaseData.vq || '0', 10) || 0;
    const lowCount = parseInt(lowFreq[code] || '0', 10) || 0;
    structuredData[code] = String(lowCount + phaseCount);
  }

  return structuredData;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const now = Date.now();

  // Return from in-memory cache if fresh (< 5 mins)
  if (inMemoryCache.data && (now - inMemoryCache.timestamp < CACHE_TTL_MS)) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json(inMemoryCache.data);
  }

  const archive = loadBaselineArchive();

  try {
    const liveCounts = await fetchLivePhivolcsCounts();
    const { dateStr, timestampStr } = getPHTInfo();

    const summaryParts = Object.entries(liveCounts).map(([k, v]) => `${k}: ${v}`);
    const summaryStr = summaryParts.join(', ');

    archive.metadata.last_updated = timestampStr;
    archive.metadata.total_Volcanic_earthquakes = summaryStr;

    // Check if the latest record is for today
    const records = archive.records || [];
    const lastRecord = records.length > 0 ? records[records.length - 1] : null;

    if (lastRecord && lastRecord.date === dateStr) {
      lastRecord.timestamp = timestampStr;
      lastRecord.data = liveCounts;
      lastRecord.total_Volcanic_earthquakes = summaryStr;
    } else {
      records.push({
        timestamp: timestampStr,
        date: dateStr,
        data: liveCounts,
        total_Volcanic_earthquakes: summaryStr
      });
    }

    archive.records = records;

    // Update in-memory cache
    inMemoryCache = {
      data: archive,
      timestamp: now
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(archive);

  } catch (err) {
    console.error('[api/volcano-data] Live fetch error:', err.message);

    // If live fetch fails, gracefully return cached or baseline archive
    if (inMemoryCache.data) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).json(inMemoryCache.data);
    }

    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(archive);
  }
}
