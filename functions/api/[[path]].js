export async function onRequest(context) {
  const { request, params } = context;
  const url = new URL(request.url);
  const pathArr = params.path || [];
  const fullPath = pathArr.join('/');

  // Route: /api/earthquake-data
  if (fullPath === 'earthquake-data') {
    const targetUrl = 'https://data.garbinwx.org/api/earthquakes.json';
    return fetch(targetUrl, {
      headers: {
        'User-Agent': request.headers.get('user-agent') || 'Mozilla/5.0'
      }
    });
  }

  // Route: /api/cap-alerts
  if (fullPath === 'cap-alerts') {
    const targetUrl = 'https://www.panahon.gov.ph/api/v1/cap-alerts?token=sH2S6zIL6jKA7lgffdgyI3kGTZgPjGdiHCsIocAW';
    return fetch(targetUrl, {
      headers: {
        'User-Agent': request.headers.get('user-agent') || 'Mozilla/5.0',
        'Referer': 'https://www.panahon.gov.ph/'
      }
    });
  }

  // Route: /api/ogimet/*
  if (pathArr[0] === 'ogimet') {
    const ogimetPath = pathArr.slice(1).join('/');
    const targetUrl = `http://www.ogimet.com/cgi-bin/${ogimetPath}${url.search}`;
    return fetch(targetUrl, {
      headers: {
        'User-Agent': request.headers.get('user-agent') || 'Mozilla/5.0'
      }
    });
  }

  // Route: /api/zoom-earth/*
  if (pathArr[0] === 'zoom-earth') {
    const zoomPath = pathArr.slice(1).join('/');
    const targetUrl = `https://tiles.zoom.earth/${zoomPath}${url.search}`;
    const response = await fetch(targetUrl, {
      headers: {
        'Referer': 'https://zoom.earth/',
        'User-Agent': request.headers.get('user-agent') || 'Mozilla/5.0'
      }
    });
    
    // Create a new response to copy body and add headers (e.g. Cache-Control)
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }

  // Route: /api/lightning
  if (fullPath === 'lightning') {
    const targetUrl = 'https://panahon.gov.ph/api/v1/lightning';
    return fetch(targetUrl, {
      headers: {
        'User-Agent': request.headers.get('user-agent') || 'Mozilla/5.0',
        'Referer': 'https://www.panahon.gov.ph/'
      }
    });
  }

  // Route: /api/radar
  if (fullPath === 'radar') {
    const targetUrl = 'https://www.panahon.gov.ph/api/v1/radar/timeline?token=vYopE7FszD6VmZ71qnG0GAh0dc4Qtv8G2Wp7eJ4k&sublayer=hybrid-reflectivity';
    return fetch(targetUrl, {
      headers: {
        'User-Agent': request.headers.get('user-agent') || 'Mozilla/5.0',
        'Referer': 'https://www.panahon.gov.ph/'
      }
    });
  }

  return new Response(JSON.stringify({ error: 'Not Found' }), { 
    status: 404, 
    headers: { 'Content-Type': 'application/json' } 
  });
}
