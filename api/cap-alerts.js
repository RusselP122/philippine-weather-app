import crypto from 'crypto';

// In-memory cache for session to avoid redundant round-trips
let sessionCache = null;

function getSignedHeaders(apiSigSecret, csrfToken, cookieHeader, pathname) {
  const method = 'GET';
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(16).toString('hex');
  const stringToSign = `${method}\n${pathname}\n${ts}\n${nonce}`;
  const sig = crypto.createHmac('sha256', apiSigSecret).update(stringToSign).digest('hex');

  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Referer': 'https://panahon.gov.ph/',
    'Cookie': cookieHeader,
    'X-CSRF-TOKEN': csrfToken,
    'X-Ts': ts,
    'X-Nonce': nonce,
    'X-Sig': sig,
  };
}

async function refreshSession() {
  const homeRes = await fetch('https://panahon.gov.ph/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
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
    const sigUrl = `https://panahon.gov.ph/api/v1/sig?token=${encodeURIComponent(csrfToken)}`;
    const sigRes = await fetch(sigUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Cookie': Array.from(cookieMap.values()).join('; '),
        'X-Sig-Handle': apiSigHandle,
        'Referer': 'https://panahon.gov.ph/',
      }
    });

    if (sigRes.ok) {
      parseCookies(sigRes);
      const sigData = await sigRes.json();
      if (sigData && sigData.secret) {
        apiSigSecret = sigData.secret;
      }
    }
  }

  if (!apiSigSecret) {
    throw new Error('Could not extract or resolve api-sig secret from PANaHON portal');
  }

  // Obtain asset-ticket to ensure session validity and access to protected feeds
  const currentCookieHeader = Array.from(cookieMap.values()).join('; ');
  const assetHeaders = getSignedHeaders(apiSigSecret, csrfToken, currentCookieHeader, 'api/v1/asset-ticket');
  const assetRes = await fetch(`https://panahon.gov.ph/api/v1/asset-ticket?token=${encodeURIComponent(csrfToken)}`, {
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
    let alertsUrl = `https://panahon.gov.ph/api/v1/cap-alerts?token=${encodeURIComponent(csrfToken)}`;

    let alertsRes = await fetch(alertsUrl, { headers: alertHeaders });

    // If session expired or was rejected, refresh session and retry once
    if (!alertsRes.ok) {
      console.warn(`PAGASA CAP Alerts returned HTTP ${alertsRes.status}. Refreshing session and retrying...`);
      await refreshSession();
      const fresh = sessionCache;
      alertHeaders = getSignedHeaders(fresh.apiSigSecret, fresh.csrfToken, fresh.cookieHeader, 'api/v1/cap-alerts');
      alertsUrl = `https://panahon.gov.ph/api/v1/cap-alerts?token=${encodeURIComponent(fresh.csrfToken)}`;
      alertsRes = await fetch(alertsUrl, { headers: alertHeaders });
    }

    if (!alertsRes.ok) {
      throw new Error(`PAGASA CAP Alerts returned HTTP ${alertsRes.status}`);
    }

    const data = await alertsRes.json();

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
