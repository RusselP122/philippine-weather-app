export const config = {
    matcher: [
        '/assets/:path*',
        '/images/:path*',
    ],
};

export default function middleware(request) {
    // Fix 500 Error: Use standard URL API instead of request.nextUrl (Next.js specific)
    const url = new URL(request.url);
    const { pathname } = url;

    // 0. EXCEPTION: Always allow logo.png (User Request)
    if (pathname === '/images/logo.png') {
        return; // Pass through to Vercel (allow access)
    }

    // 1. Block directory listing/root access (e.g. /assets/ or /images/)
    if (pathname === '/assets/' || pathname === '/assets' ||
        pathname === '/images/' || pathname === '/images') {
        return new Response('Access to this resource on the server is denied!', {
            status: 403,
            headers: { 'Content-Type': 'text/plain' }
        });
    }

    // 2. Hotlink / Direct Access Protection for files
    const referer = request.headers.get('referer');
    const allowedDomains = [
        'philippine-weather-app.vercel.app',
        'localhost',
        '127.0.0.1'
    ];

    const isAllowed = referer && allowedDomains.some(domain => referer.includes(domain));

    if (!isAllowed) {
        // Return custom 404 response
        return new Response('404 Not Found', {
            status: 404,
            headers: { 'Content-Type': 'text/plain' }
        });
    }
}
