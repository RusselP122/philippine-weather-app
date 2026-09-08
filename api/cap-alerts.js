import crypto from 'crypto';

// In-memory cache for session to avoid redundant round-trips
let sessionCache = null;

function extractCookies(res, existingMap = new Map()) {
  const cookieMap = new Map(existingMap);

  // 1. Try getSetCookie() if available
  if (typeof res.headers.getSetCookie === 'function') {
    const list = res.headers.getSetCookie();
    for (const str of list) {
      const part = str.split(';')[0].trim();
      const eqIdx = part.indexOf('=');
      if (eqIdx > 0) {
        const name = part.slice(0, eqIdx).trim();
        cookieMap.set(name, part);
      }
    }
  }

  // 2. Fallback / supplementary regex extraction from raw 'set-cookie' header
  // (Crucial for Vercel/Node runtimes where getSetCookie is missing or flattens headers)
  const rawHeader = res.headers.get('set-cookie');
  if (rawHeader) {
    const regex = /(?:^|,\s*)([a-zA-Z0-9_\-]+)=([^;]+?)(?=;|,|\s*$)/g;
    let match;
    while ((match = regex.exec(rawHeader)) !== null) {
      const name = match[1].trim();
      const val = match[2].trim();
      if (!['expires', 'path', 'domain', 'samesite', 'max-age', 'secure', 'httponly'].includes(name.toLowerCase())) {
        cookieMap.set(name, `${name}=${val}`);
      }
    }
  }

  return cookieMap;
}

function getSignedHeaders(apiSigSecret, csrfToken, cookieHeader, pathname, baseUrl) {
  const method = 'GET';
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(16).toString('hex');
  const stringToSign = `${method}\n${pathname}\n${ts}\n${nonce}`;
  const sig = crypto.createHmac('sha256', apiSigSecret).update(stringToSign).digest('hex');

  return {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9,fil;q=0.8',
    'Referer': `${baseUrl}/`,
    'Origin': baseUrl,
    'Cookie': cookieHeader,
    'X-CSRF-TOKEN': csrfToken,
    'X-Requested-With': 'XMLHttpRequest',
    'sec-ch-ua': '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'X-Ts': ts,
    'X-Nonce': nonce,
    'X-Sig': sig,
  };
}

async function refreshSession() {
  const baseCandidates = ['https://panahon.gov.ph', 'https://www.panahon.gov.ph'];
  let lastError = null;

  for (const base of baseCandidates) {
    try {
      const homeRes = await fetch(`${base}/`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,fil;q=0.8',
        }
      });

      if (!homeRes.ok) continue;

      const html = await homeRes.text();
      let cookieMap = extractCookies(homeRes);

      const csrfMatch = html.match(/<meta name="csrf-token" content="([^"]+)"/);
      const apiSigMatch = html.match(/<meta name="api-sig" content="([^"]+)"/);
      const apiSigHandleMatch = html.match(/<meta name="api-sig-handle" content="([^"]+)"/);

      const csrfToken = csrfMatch ? csrfMatch[1] : '';
      let apiSigSecret = apiSigMatch ? apiSigMatch[1] : '';
      const apiSigHandle = apiSigHandleMatch ? apiSigHandleMatch[1] : '';

      if (!csrfToken) continue;

      // Exchange api-sig-handle if secret is not directly embedded
      if (!apiSigSecret && apiSigHandle) {
        const sigUrl = `${base}/api/v1/sig?token=${encodeURIComponent(csrfToken)}`;
        const sigRes = await fetch(sigUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36',
            'Cookie': Array.from(cookieMap.values()).join('; '),
            'X-Sig-Handle': apiSigHandle,
            'Referer': `${base}/`,
            'Origin': base,
            'X-Requested-With': 'XMLHttpRequest',
          }
        });

        if (sigRes.ok) {
          cookieMap = extractCookies(sigRes, cookieMap);
          const ct = sigRes.headers.get('content-type') || '';
          if (ct.includes('application/json')) {
            const sigData = await sigRes.json();
            if (sigData && sigData.secret) apiSigSecret = sigData.secret;
          } else {
            const text = await sigRes.text();
            try {
              const sigData = JSON.parse(text);
              if (sigData && sigData.secret) apiSigSecret = sigData.secret;
            } catch (_) {}
          }
        }
      }

      if (!apiSigSecret) continue;

      // Acquire asset-ticket
      const currentCookieHeader = Array.from(cookieMap.values()).join('; ');
      const assetHeaders = getSignedHeaders(apiSigSecret, csrfToken, currentCookieHeader, 'api/v1/asset-ticket', base);
      const assetRes = await fetch(`${base}/api/v1/asset-ticket?token=${encodeURIComponent(csrfToken)}`, {
        headers: assetHeaders,
      });

      if (assetRes.ok) {
        cookieMap = extractCookies(assetRes, cookieMap);
      }

      const cookieHeader = Array.from(cookieMap.values()).join('; ');

      sessionCache = {
        baseUrl: base,
        csrfToken,
        apiSigSecret,
        cookieHeader,
        expiresAt: Date.now() + 100 * 1000, // 100s TTL
      };

      return sessionCache;
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(`Failed to initialize session: ${lastError ? lastError.message : 'All gateway endpoints failed'}`);
}

export default async function handler(req, res) {
  try {
    if (!sessionCache || Date.now() >= sessionCache.expiresAt) {
      await refreshSession();
    }

    let { baseUrl, csrfToken, apiSigSecret, cookieHeader } = sessionCache;
    let alertHeaders = getSignedHeaders(apiSigSecret, csrfToken, cookieHeader, 'api/v1/cap-alerts', baseUrl);
    let alertsUrl = `${baseUrl}/api/v1/cap-alerts?token=${encodeURIComponent(csrfToken)}`;

    let alertsRes = await fetch(alertsUrl, { headers: alertHeaders });

    // If session expired or was rejected, refresh session and retry once
    if (!alertsRes.ok || !(alertsRes.headers.get('content-type') || '').includes('json')) {
      console.warn(`PAGASA CAP Alerts returned HTTP ${alertsRes.status}. Refreshing session and retrying...`);
      await refreshSession();
      const fresh = sessionCache;
      alertHeaders = getSignedHeaders(fresh.apiSigSecret, fresh.csrfToken, fresh.cookieHeader, 'api/v1/cap-alerts', fresh.baseUrl);
      alertsUrl = `${fresh.baseUrl}/api/v1/cap-alerts?token=${encodeURIComponent(fresh.csrfToken)}`;
      alertsRes = await fetch(alertsUrl, { headers: alertHeaders });
    }

    if (!alertsRes.ok) {
      throw new Error(`PAGASA CAP Alerts returned HTTP ${alertsRes.status}`);
    }

    const contentType = alertsRes.headers.get('content-type') || '';
    let data;
    if (contentType.includes('application/json')) {
      data = await alertsRes.json();
    } else {
      const rawText = await alertsRes.text();
      data = JSON.parse(rawText);
    }

    // Sanitize alerts: remove any rogue/defaced script tags and system placeholder notes
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

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return res.status(200).json(data);
  } catch (error) {
    console.error('PAGASA CAP Alerts Fetch Error:', error);
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ success: true, data: { alert_data: [], alert_count: 0 }, error: error.message });
  }
}
