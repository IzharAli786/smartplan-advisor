import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const API_TARGET = process.env.VITE_API_TARGET ?? "http://localhost:4000";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icon.svg"],
      manifest: {
        name: "Advise — Advisor CRM",
        short_name: "Advise",
        description: "Advisor CRM for Smart Advisors",
        theme_color: "#1e2a38",
        background_color: "#1e2a38",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      workbox: {
        // Cache the app shell for instant open on flaky connections (§13).
        navigateFallback: "/index.html",
        // ...but NEVER answer navigations to backend paths with the app shell —
        // let them hit the network (IIS reverse-proxies them to the API). Without
        // this, opening a signed /files/<key> link in a new tab (e.g. a collateral
        // document) would be served the precached index.html instead of the file.
        navigateFallbackDenylist: [/^\/api\//, /^\/files\//],
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        runtimeCaching: [
          {
            // Network-first for API GETs so data is fresh but still works offline-degraded.
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkFirst",
            options: { cacheName: "api", networkTimeoutSeconds: 5 },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      // Same-origin in dev so the httpOnly session cookie just works.
      "/api": { target: API_TARGET, changeOrigin: true },
      "/files": { target: API_TARGET, changeOrigin: true },
    },
  },
});
