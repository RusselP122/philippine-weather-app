import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'generate-map-api',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url && req.url.startsWith('/api/generate-map')) {
            try {
              const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
              const dataset = url.searchParams.get('dataset');
              const horizon = url.searchParams.get('horizon');
              const isWide = url.searchParams.get('isWide');
              const disturbanceId = url.searchParams.get('disturbanceId');

              // Validation
              if (dataset !== 'base' && dataset !== 'large') {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'text/plain');
                res.end('Invalid dataset parameter');
                return;
              }
              if (horizon !== '5day' && horizon !== '15day') {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'text/plain');
                res.end('Invalid horizon parameter');
                return;
              }
              if (isWide !== 'true' && isWide !== 'false') {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'text/plain');
                res.end('Invalid isWide parameter');
                return;
              }
              if (!disturbanceId || !/^\d+$/.test(disturbanceId)) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'text/plain');
                res.end('Invalid disturbanceId parameter');
                return;
              }

              // Path setup
              const pythonScript = path.join(process.cwd(), 'generate_trends_map.py');
              const tempDir = path.join(process.cwd(), 'temp_data');
              if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
              }
              const tempOutputFile = path.join(tempDir, `trends_${Date.now()}_${Math.random().toString(36).substring(7)}.png`);
              
              // Run python script
              const isWidePy = isWide === 'true' ? 'True' : 'False';
              const cmd = `python "${pythonScript}" --dataset ${dataset} --horizon ${horizon} --is-wide ${isWidePy} --disturbance-id ${disturbanceId} --output "${tempOutputFile}"`;

              exec(cmd, (error, stdout, stderr) => {
                if (error) {
                  console.error(`Error executing python generate_trends_map.py:`, error);
                  console.error(`stderr:`, stderr);
                  res.statusCode = 500;
                  res.setHeader('Content-Type', 'text/plain');
                  res.end(`Failed to generate map: ${error.message}\n${stderr}`);
                  return;
                }

                fs.readFile(tempOutputFile, (err, data) => {
                  if (err) {
                    res.statusCode = 500;
                    res.setHeader('Content-Type', 'text/plain');
                    res.end(`Failed to read generated image: ${err.message}`);
                    return;
                  }
                  res.writeHead(200, {
                    'Content-Type': 'image/png',
                    'Content-Length': data.length
                  });
                  res.end(data);

                  // clean up file asynchronously
                  fs.unlink(tempOutputFile, (unlinkErr) => {
                    if (unlinkErr) {
                      console.error(`Failed to delete temp file ${tempOutputFile}:`, unlinkErr);
                    }
                  });
                });
              });
            } catch (err) {
              console.error('API Error:', err);
              res.statusCode = 500;
              res.setHeader('Content-Type', 'text/plain');
              res.end(`Internal Server Error: ${err.message}`);
            }
          } else {
            next();
          }
        });
      }
    }
  ],
  server: {
    proxy: {
      '/api/earthquake-data': {
        target: 'https://data.garbinwx.org',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/earthquake-data/, '/api/earthquakes.json'),
      },
      '/api/cap-alerts': {
        target: 'https://www.panahon.gov.ph',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/cap-alerts/, '/api/v1/cap-alerts?token=sH2S6zIL6jKA7lgffdgyI3kGTZgPjGdiHCsIocAW'),
      },
      '/api/ogimet': {
        target: 'http://www.ogimet.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/ogimet/, '/cgi-bin'),
      },
      '/api/zoom-earth': {
        target: 'https://tiles.zoom.earth',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/zoom-earth/, ''),
        headers: {
          Referer: 'https://zoom.earth/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      },
      '/api/lightning': {
        target: 'https://panahon.gov.ph',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/lightning/, '/api/v1/lightning'),
      },
      '/api/radar': {
        target: 'https://www.panahon.gov.ph',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/radar/, '/api/v1/radar/timeline'),
      },
    },
  },
});