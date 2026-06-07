const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = process.env.PORT || 10000;

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

    // API Endpoint for trends map generation
    if (pathname.startsWith('/api/generate-map')) {
        const dataset = parsedUrl.searchParams.get('dataset');
        const horizon = parsedUrl.searchParams.get('horizon');
        const isWide = parsedUrl.searchParams.get('isWide');
        const disturbanceId = parsedUrl.searchParams.get('disturbanceId');

        // Validation
        if (dataset !== 'base' && dataset !== 'large') {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            return res.end('Invalid dataset parameter');
        }
        if (horizon !== '5day' && horizon !== '15day') {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            return res.end('Invalid horizon parameter');
        }
        if (isWide !== 'true' && isWide !== 'false') {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            return res.end('Invalid isWide parameter');
        }
        if (!disturbanceId || !/^\d+$/.test(disturbanceId)) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            return res.end('Invalid disturbanceId parameter');
        }

        const tempDir = path.join(__dirname, 'temp_data');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        const tempOutputFile = path.join(tempDir, `trends_${Date.now()}_${Math.random().toString(36).substring(7)}.png`);

        const pythonScript = path.join(__dirname, 'generate_trends_map.py');
        const isWidePy = isWide === 'true' ? 'True' : 'False';

        // Render deployment always runs under Linux with python3
        const cmd = `python3 "${pythonScript}" --dataset ${dataset} --horizon ${horizon} --is-wide ${isWidePy} --disturbance-id ${disturbanceId} --output "${tempOutputFile}"`;

        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error executing python generate_trends_map.py:`, error);
                console.error(`stderr:`, stderr);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                return res.end(`Failed to generate map: ${error.message}\n${stderr}`);
            }

            fs.readFile(tempOutputFile, (err, data) => {
                if (err) {
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    return res.end(`Failed to read generated image: ${err.message}`);
                }

                res.writeHead(200, {
                    'Content-Type': 'image/png',
                    'Content-Length': data.length
                });
                res.end(data);

                // Clean up temp file
                fs.unlink(tempOutputFile, (unlinkErr) => {
                    if (unlinkErr) {
                        console.error(`Failed to delete temp file ${tempOutputFile}:`, unlinkErr);
                    }
                });
            });
        });
        return;
    }

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

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});