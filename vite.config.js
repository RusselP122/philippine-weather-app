import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api/earthquake-data': {
        target: 'https://data.garbinwx.cloud',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/earthquake-data/, '/api/earthquakes.json'),
      },
      '/api/cap-alerts': {
        target: 'https://data.garbinwx.cloud',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/cap-alerts/, '/api/cap-alerts.json'),
      },
    },
  },
});