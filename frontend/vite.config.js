import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
const API_TARGET = "http://127.0.0.1:8000";
const proxy = {
  "/api": {
    target: API_TARGET,
    changeOrigin: true,
  },
};
// pour le proxy dev, cf. vite.config.js
export default defineConfig({
  define: {
    __BUILD__: JSON.stringify(new Date().toISOString()),
  },
  server: { host: true, proxy, allowedHosts: true },
  preview: { host: true, port: 4173, proxy, allowedHosts: true },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["favicon.ico", "apple-touch-icon-180x180.png"],
      manifest: {
        name: "Suivi RDV - Centre de santé",
        short_name: "CSB RDV",
        description: "Suivi des patients et rendez-vous, fonctionne hors ligne",
        lang: "fr",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        theme_color: "#0f766e",
        background_color: "#ffffff",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // On précache uniquement l'app shell. Les données vivent dans IndexedDB :
        // aucune règle de cache pour /api.
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2,webmanifest}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api/, /^\/admin/],
      },
      devOptions: { enabled: false }, // le SW n'est testé qu'en build + preview
    }),
  ],
  // accessible depuis le réseau local
  test: { environment: "node", setupFiles: ["./src/test/setup.js"] },
});
