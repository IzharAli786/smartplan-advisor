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
      includeAssets: [
        "favicon.svg",
        "icon.svg",
        "apple-touch-icon.png",
        "pwa-192x192.png",
        "pwa-512x512.png",
      ],
      manifest: {
        // Stable identity so the browser recognises the same app across manifest edits.
        id: "/",
        name: "Advise — Advisor CRM",
        short_name: "Advise",
        description: "Advisor CRM for Smart Advisors",
        lang: "en",
        dir: "ltr",
        categories: ["business", "productivity"],
        theme_color: "#1e2a38",
        background_color: "#1e2a38",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        icons: [
          // PNGs are what Android/Chrome installability and Lighthouse actually require
          // (192 + 512); iOS uses the apple-touch-icon <link> in index.html. The SVG is a
          // crisp any-size fallback for desktop taskbars.
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          // Full-bleed square (safe-zone padded) so Android's adaptive mask never clips it.
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
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
