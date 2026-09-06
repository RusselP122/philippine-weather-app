import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';

import handler from './api/fetch-gsmap.js';
import capAlertsHandler from './api/cap-alerts.js';
import earthquakesPhivolcsHandler from './api/earthquakes-phivolcs.js';
import earthquakeBulletinHandler from './api/earthquake-bulletin.js';

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
      server.middlewares.use('/api/earthquakes-phivolcs', async (req, res, next) => {
        const mockRes = {
            setHeader: (name, value) => { res.setHeader(name, value); return mockRes; },
            status: (code) => { res.statusCode = code; return mockRes; },
            json: (data) => { 
               res.setHeader('Content-Type', 'application/json'); 
               res.end(JSON.stringify(data)); 
            }
        };
        try {
            await earthquakesPhivolcsHandler(req, mockRes);
        } catch(e) {
            res.statusCode = 500;
            res.end(JSON.stringify({error: e.message}));
        }
      });
      server.middlewares.use('/api/earthquake-bulletin', async (req, res, next) => {
        const mockRes = {
            setHeader: (name, value) => { res.setHeader(name, value); return mockRes; },
            status: (code) => { res.statusCode = code; return mockRes; },
            json: (data) => { 
               res.setHeader('Content-Type', 'application/json'); 
               res.end(JSON.stringify(data)); 
            }
        };
        try {
            await earthquakeBulletinHandler(req, mockRes);
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
      '/api/radar': {
        target: 'https://www.panahon.gov.ph',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/radar/, '/api/v1/radar/timeline'),
      },
    },
  },
});