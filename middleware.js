export const config = {
    matcher: [
        '/assets/:path*',
        '/images/:path*',
    ],
};

export default function middleware(request) {
    const url = request.nextUrl;
    const { pathname } = url;

    // 1. Block directory listing/root access (e.g. /assets/ or /images/)
    // User requested specifc 403 message for this.
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
        // Return custom 404 response as requested previously for files
        return new Response('404 Not Found', {
            status: 404,
            headers: { 'Content-Type': 'text/plain' }
        });
    }
}
