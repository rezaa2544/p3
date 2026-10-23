import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'پایش ۲ — مدیریت مدرسه',
        short_name: 'پایش ۲',
        description: 'سامانه مدیریت هوشمند مدرسه؛ حضور و غیاب، نمرات، تکالیف و گزارش‌ها',
        lang: 'fa',
        dir: 'rtl',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f8fafc',
        theme_color: '#0f766e',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // فقط داده‌های کم‌حجم و لازم برای کار آفلاین، با شبکه-اول و کش کوتاه‌مدت
            urlPattern: /\/api\/(meta\/options|classes|students\?[^&]*classId=[^&]+)(&|$)/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'payesh-offline-data',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 8 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts: true },
  build: { outDir: 'dist', sourcemap: false, target: 'es2022' },
});
