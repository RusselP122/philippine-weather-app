import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '10000', 10);

// Helper to determine Content-Type
const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp'
};

const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;



    // Serve static files from the 'dist' directory
    let filePath = path.join(__dirname, 'dist', pathname);

    // Check if path is a directory (e.g. root '/')
    if (filePath.endsWith(path.sep) || !path.extname(filePath)) {
        filePath = path.join(__dirname, 'dist', 'index.html');
    }

    // Check if file exists, fallback to index.html for SPA routing
    fs.access(filePath, fs.constants.F_OK, (err) => {
        if (err) {
            filePath = path.join(__dirname, 'dist', 'index.html');
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        fs.readFile(filePath, (readErr, content) => {
            if (readErr) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                return res.end('Internal Server Error');
            }
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        });
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT} (binding to 0.0.0.0)`);
});