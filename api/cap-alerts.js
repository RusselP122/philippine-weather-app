import crypto from 'crypto';

export default async function handler(req, res) {
  try {
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
    
    // Extract cookies
    const cookies = [];
    const rawCookies = homeRes.headers.getSetCookie 
      ? homeRes.headers.getSetCookie() 
      : (homeRes.headers.get('set-cookie') ? [homeRes.headers.get('set-cookie')] : []);
    
    for (const c of rawCookies) {
      const part = c.split(';')[0];
      if (part) cookies.push(part);
    }
    const cookieHeader = cookies.join('; ');

    const csrfMatch = html.match(/<meta name="csrf-token" content="([^"]+)"/);
    const apiSigMatch = html.match(/<meta name="api-sig" content="([^"]+)"/);

    const csrfToken = csrfMatch ? csrfMatch[1] : '';
    const apiSigSecret = apiSigMatch ? apiSigMatch[1] : '';

    if (!csrfToken || !apiSigSecret) {
      throw new Error('Could not extract security tokens from PANaHON portal');
    }

    const method = 'GET';
    const pathname = 'api/v1/cap-alerts';
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = crypto.randomBytes(16).toString('hex');

    const stringToSign = `${method}\n${pathname}\n${ts}\n${nonce}`;
    const sig = crypto.createHmac('sha256', apiSigSecret).update(stringToSign).digest('hex');

    const alertsUrl = `https://panahon.gov.ph/api/v1/cap-alerts?token=${csrfToken}`;
    const alertsRes = await fetch(alertsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': 'https://panahon.gov.ph/',
        'Origin': 'https://panahon.gov.ph',
        'Cookie': cookieHeader,
        'X-CSRF-TOKEN': csrfToken,
        'X-Ts': ts,
        'X-Nonce': nonce,
        'X-Sig': sig,
      }
    });

    if (!alertsRes.ok) {
      throw new Error(`PAGASA CAP Alerts returned HTTP ${alertsRes.status}`);
    }

    const data = await alertsRes.json();
    
    // Set caching headers for performance
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return res.status(200).json(data);
  } catch (error) {
    console.error('PAGASA CAP Alerts Fetch Error:', error);
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ success: true, data: { alert_data: [] }, error: error.message });
  }
}
