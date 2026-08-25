import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';

import handler from './api/fetch-gsmap.js';

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
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('leaflet') || id.includes('@turf') || id.includes('@tmcw/togeojson')) {
              return 'vendor-maps';
            }
            if (id.includes('recharts') || id.includes('d3-')) {
              return 'vendor-charts';
            }
            if (id.includes('framer-motion')) {
              return 'vendor-motion';
            }
            if (id.includes('lucide-react')) {
              return 'vendor-icons';
            }
            if (id.includes('html2canvas') || id.includes('jszip') || id.includes('gif.js')) {
              return 'vendor-media';
            }
            if (id.includes('@supabase')) {
              return 'vendor-supabase';
            }
            if (id.includes('react') || id.includes('react-dom') || id.includes('@vercel/analytics')) {
              return 'vendor-react';
            }
          }
        },
      },
    },
  },
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