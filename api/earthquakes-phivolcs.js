const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function parseEarthquakeHtml(html) {
  const earthquakes = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let match;

  while ((match = rowRegex.exec(html)) !== null) {
    const rowContent = match[1];

    if (!rowContent.includes('Earthquake_Information') && !/_B\d+/i.test(rowContent)) {
      continue;
    }

    // Check if the earthquake has reported/recorded intensities
    // In PHIVOLCS, earthquakes with intensities have their date/time in blue (default <a> color),
    // whereas quakes without intensities are wrapped in <span class="auto-style99"> (magenta #FF00FF).
    let hasIntensity = false;
    const tdMatch = rowContent.match(/<td[^>]*>([\s\S]*?)<\/td>/i);
    if (tdMatch) {
      const tdContent = tdMatch[1];
      const aMatch = tdContent.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
      if (aMatch) {
        const innerA = aMatch[1];
        hasIntensity = !innerA.includes('auto-style99') || /color\s*:\s*blue/i.test(innerA);
      }
    }

    const cells = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
      let text = cellMatch[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').trim();
      cells.push(text.replace(/\s+/g, ' '));
    }

    const linkMatch = rowContent.match(/href=["']([^"']+)["']/i);
    const link = linkMatch
      ? `https://earthquake.phivolcs.dost.gov.ph/${linkMatch[1].replace(/\\/g, '/')}`
      : null;

    if (cells.length >= 6) {
      const timeStr = cells[0];
      const latitude = parseFloat(cells[1]);
      const longitude = parseFloat(cells[2]);
      const depth_km = parseFloat(cells[3]);
      const magnitude = parseFloat(cells[4]);
      const location = cells[5];

      if (!isNaN(latitude) && !isNaN(longitude) && !isNaN(magnitude)) {
        let timestamp_iso = null;
        try {
          const cleanTime = timeStr.replace(/\s*-\s*/, ' ');
          const d = new Date(`${cleanTime} GMT+0800`);
          if (!isNaN(d.getTime())) {
            timestamp_iso = d.toISOString();
          }
        } catch (e) {}

        earthquakes.push({
          time_pht: timeStr,
          timestamp_iso: timestamp_iso || new Date().toISOString(),
          latitude,
          longitude,
          depth_km: isNaN(depth_km) ? 0 : depth_km,
          magnitude,
          location,
          bulletin_url: link,
          has_intensity: Boolean(hasIntensity)
        });
      }
    }
  }
  return earthquakes;
}

export default async function handler(req, res) {
  try {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

    // Parse query params (works for both Vercel req.query and Vite connect req.url)
    const urlObj = new URL(req.url, 'http://localhost');
    const queryYear = req.query?.year || urlObj.searchParams.get('year');
    const queryMonth = req.query?.month || urlObj.searchParams.get('month');

    // Determine target URL: either current month or archive page
    let targetUrl = 'https://earthquake.phivolcs.dost.gov.ph/';
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonthIdx = now.getMonth(); // 0-indexed

    if (queryYear && queryMonth) {
      let monthName = null;
      const parsedMonthNum = parseInt(queryMonth, 10);
      if (!isNaN(parsedMonthNum) && parsedMonthNum >= 1 && parsedMonthNum <= 12) {
        monthName = MONTH_NAMES[parsedMonthNum - 1];
      } else {
        const found = MONTH_NAMES.find(m => m.toLowerCase().startsWith(queryMonth.toLowerCase()));
        if (found) monthName = found;
      }

      const isCurrent = Number(queryYear) === currentYear && monthName === MONTH_NAMES[currentMonthIdx];
      if (!isCurrent && monthName) {
        targetUrl = `https://earthquake.phivolcs.dost.gov.ph/EQLatest-Monthly/${queryYear}/${queryYear}_${monthName}.html`;
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`PHIVOLCS returned status ${response.status} for ${targetUrl}`);
    }

    const html = await response.text();
    const earthquakes = parseEarthquakeHtml(html);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
    return res.status(200).json({
      source: 'Philippine Institute of Volcanology and Seismology (DOST-PHIVOLCS)',
      updated_at: new Date().toISOString(),
      count: earthquakes.length,
      earthquakes
    });
  } catch (err) {
    console.error('Error fetching PHIVOLCS earthquake data:', err);
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({
      error: 'Failed to fetch earthquake data from PHIVOLCS',
      details: err.message
    });
  }
}
