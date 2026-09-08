import crypto from 'crypto';

// In-memory cache for session to avoid redundant round-trips
let sessionCache = null;

const BASE_URL = 'https://www.panahon.gov.ph';

function getSignedHeaders(apiSigSecret, csrfToken, cookieHeader, pathname) {
  const method = 'GET';
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(16).toString('hex');
  const stringToSign = `${method}\n${pathname}\n${ts}\n${nonce}`;
  const sig = crypto.createHmac('sha256', apiSigSecret).update(stringToSign).digest('hex');

  return {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9,fil;q=0.8',
    'Referer': `${BASE_URL}/`,
    'Origin': BASE_URL,
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
  const homeRes = await fetch(`${BASE_URL}/`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,fil;q=0.8',
      'sec-ch-ua': '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"',
      'sec-ch-ua-mobile': '?1',
      'sec-ch-ua-platform': '"Android"',
    }
  });

  if (!homeRes.ok) {
    throw new Error(`Failed to load PANaHON gateway: ${homeRes.status}`);
  }

  const html = await homeRes.text();
  const cookieMap = new Map();

  const parseCookies = (res) => {
    const raw = res.headers.getSetCookie 
      ? res.headers.getSetCookie() 
      : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
    for (const c of raw) {
      const part = c.split(';')[0].trim();
      if (part) {
        const eqIdx = part.indexOf('=');
        if (eqIdx > 0) {
          cookieMap.set(part.slice(0, eqIdx), part);
        }
      }
    }
  };

  parseCookies(homeRes);

  const csrfMatch = html.match(/<meta name="csrf-token" content="([^"]+)"/);
  const apiSigMatch = html.match(/<meta name="api-sig" content="([^"]+)"/);
  const apiSigHandleMatch = html.match(/<meta name="api-sig-handle" content="([^"]+)"/);

  const csrfToken = csrfMatch ? csrfMatch[1] : '';
  let apiSigSecret = apiSigMatch ? apiSigMatch[1] : '';
  const apiSigHandle = apiSigHandleMatch ? apiSigHandleMatch[1] : '';

  if (!csrfToken) {
    throw new Error('Could not extract csrf-token from PANaHON portal');
  }

  // If secret is not directly embedded in meta[name="api-sig"], exchange the api-sig-handle via /api/v1/sig
  if (!apiSigSecret && apiSigHandle) {
    const sigUrl = `${BASE_URL}/api/v1/sig?token=${encodeURIComponent(csrfToken)}`;
    const sigRes = await fetch(sigUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36',
        'Cookie': Array.from(cookieMap.values()).join('; '),
        'X-Sig-Handle': apiSigHandle,
        'Referer': `${BASE_URL}/`,
        'Origin': BASE_URL,
        'X-Requested-With': 'XMLHttpRequest',
        'sec-ch-ua': '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"',
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': '"Android"',
      }
    });

    if (sigRes.ok) {
      parseCookies(sigRes);
      const ct = sigRes.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const sigData = await sigRes.json();
        if (sigData && sigData.secret) {
          apiSigSecret = sigData.secret;
        }
      } else {
        const text = await sigRes.text();
        try {
          const sigData = JSON.parse(text);
          if (sigData && sigData.secret) apiSigSecret = sigData.secret;
        } catch (_) {}
      }
    }
  }

  if (!apiSigSecret) {
    throw new Error('Could not extract or resolve api-sig secret from PANaHON portal');
  }

  // Obtain asset-ticket to ensure session validity and access to protected feeds
  const currentCookieHeader = Array.from(cookieMap.values()).join('; ');
  const assetHeaders = getSignedHeaders(apiSigSecret, csrfToken, currentCookieHeader, 'api/v1/asset-ticket');
  const assetRes = await fetch(`${BASE_URL}/api/v1/asset-ticket?token=${encodeURIComponent(csrfToken)}`, {
    headers: assetHeaders,
  });

  if (assetRes.ok) {
    parseCookies(assetRes);
  }

  const cookieHeader = Array.from(cookieMap.values()).join('; ');

  sessionCache = {
    csrfToken,
    apiSigSecret,
    cookieHeader,
    expiresAt: Date.now() + 100 * 1000, // 100 seconds TTL
  };

  return sessionCache;
}

export default async function handler(req, res) {
  try {
    if (!sessionCache || Date.now() >= sessionCache.expiresAt) {
      await refreshSession();
    }

    let { csrfToken, apiSigSecret, cookieHeader } = sessionCache;
    let alertHeaders = getSignedHeaders(apiSigSecret, csrfToken, cookieHeader, 'api/v1/cap-alerts');
    let alertsUrl = `${BASE_URL}/api/v1/cap-alerts?token=${encodeURIComponent(csrfToken)}`;

    let alertsRes = await fetch(alertsUrl, { headers: alertHeaders });

    // If session expired or was rejected, refresh session and retry once
    if (!alertsRes.ok || !(alertsRes.headers.get('content-type') || '').includes('json')) {
      console.warn(`PAGASA CAP Alerts returned HTTP ${alertsRes.status}. Refreshing session and retrying...`);
      await refreshSession();
      const fresh = sessionCache;
      alertHeaders = getSignedHeaders(fresh.apiSigSecret, fresh.csrfToken, fresh.cookieHeader, 'api/v1/cap-alerts');
      alertsUrl = `${BASE_URL}/api/v1/cap-alerts?token=${encodeURIComponent(fresh.csrfToken)}`;
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
