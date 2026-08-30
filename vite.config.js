import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';

import handler from './api/fetch-gsmap.js';
import capAlertsHandler from './api/cap-alerts.js';

function vercelApiPlugin() {
  return {
    name: 'vercel-api',
    configureServer(server) {
      server.middlewares.use('/api/fetch-gsmap', async (req, res, next) => {
         const mockRes = {
             setHeader: (name, value) => { res.setHeader(name, value); return mockRes; },
             status: (code) => { res.statusCode = code; return mockRes; },
             json: (data) => { 
                res.setHeader('Content-Type', 'application/json'); 
                res.end(JSON.stringify(data)); 
             }
         };
         try {
             await handler(req, mockRes);
         } catch(e) {
             res.statusCode = 500;
             res.end(JSON.stringify({error: e.message}));
         }
      });
      server.middlewares.use('/api/cap-alerts', async (req, res, next) => {
        const mockRes = {
            setHeader: (name, value) => { res.setHeader(name, value); return mockRes; },
            status: (code) => { res.statusCode = code; return mockRes; },
            json: (data) => { 
               res.setHeader('Content-Type', 'application/json'); 
               res.end(JSON.stringify(data)); 
            }
        };
        try {
            await capAlertsHandler(req, mockRes);
        } catch(e) {
            res.statusCode = 500;
            res.end(JSON.stringify({error: e.message}));
        }
      });
    }
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    vercelApiPlugin(),
  ],
  build: {
    chunkSizeWarningLimit: 1500,
  },
  server: {
    proxy: {
      '/api/earthquake-data': {
        target: 'https://data.garbinwx.org',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/earthquake-data/, '/api/earthquakes.json'),
      },
      '/api/ogimet': {
        target: 'http://www.ogimet.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/ogimet/, '/cgi-bin'),
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
      '/socket.io': {
        target: 'https://ws.panahon.gov.ph',
        changeOrigin: true,
        ws: true,
        secure: false,
        headers: {
          Origin: 'https://panahon.gov.ph',
          Referer: 'https://panahon.gov.ph/'
        }
      },
    },
  },
});