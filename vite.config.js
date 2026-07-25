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