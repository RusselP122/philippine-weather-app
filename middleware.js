export const config = {
    matcher: [
        '/assets/:path*',
        '/images/:path*',
    ],
};


// Helper to generate styled HTML error page
function getErrorHtml(code, title, message, color) {
    return `
<!DOCTYPE html>
<html>
<head>
  <title>${title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      background-color: #0f172a;
      color: #f8fafc;
      font-family: system-ui, -apple-system, sans-serif;
      height: 100vh;
      margin: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
    }
    .container {
      padding: 2rem;
      max-width: 480px;
      border: 1px solid #334155;
      border-radius: 1rem;
      background: #1e293b;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.5);
    }
    h1 { margin: 0 0 1rem; color: ${color}; font-size: 2.5rem; letter-spacing: -0.025em; }
    h2 { margin: 0 0 1.5rem; color: #e2e8f0; font-size: 1.5rem; }
    p { color: #94a3b8; line-height: 1.6; margin-bottom: 0; }
    .code { 
      display: inline-block; 
      padding: 0.25rem 0.5rem; 
      background: rgba(255,255,255,0.05); 
      border-radius: 0.25rem; 
      font-family: monospace; 
      color: #fca5a5;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>${code}</h1>
    <h2>${title}</h2>
    <p>${message}</p>
  </div>
</body>
</html>
  `;
}

export default function middleware(request) {
    const url = new URL(request.url);
    const { pathname } = url;

    // 0. EXCEPTION: Always allow logo.png (User Request)
    if (pathname === '/images/logo.png') {
        return;
    }

    // 1. Block directory listing/root access
    if (pathname === '/assets/' || pathname === '/assets' ||
        pathname === '/images/' || pathname === '/images') {
        return new Response(
            getErrorHtml('403', 'Access Denied', 'Direct access to this resource directory is allowed on the server!', '#f43f5e'),
            {
                status: 403,
                headers: { 'Content-Type': 'text/html' }
            }
        );
    }

    // 2. Hotlink / Direct Access Protection
    const referer = request.headers.get('referer');
    const allowedDomains = [
        'philippine-weather-app.vercel.app',
        'localhost',
        '127.0.0.1'
    ];

    const isAllowed = referer && allowedDomains.some(domain => referer.includes(domain));

    if (!isAllowed) {
        return new Response(
            getErrorHtml('404', 'Resource Not Found', 'The requested image or asset could not be found or access is restricted.', '#fbbf24'),
            {
                status: 404,
                headers: { 'Content-Type': 'text/html' }
            }
        );
    }
}
