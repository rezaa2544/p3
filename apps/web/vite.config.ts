import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * mode = 'standalone' → خروجی تک‌فایل HTML (بدون Service Worker و بدون chunk جدا).
 * برای artifact مستقل استفاده می‌شود؛ ساخت پیش‌فرض PWA دست‌نخورده می‌ماند.
 */
export default defineConfig(({ mode }) => {
  const standalone = mode === 'standalone';
  return {
  plugins: [
    react(),
    ...(standalone
      ? []
      : [
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
        ]),
  ],
  resolve: standalone
    ? { alias: { 'virtual:pwa-register': path.resolve(import.meta.dirname, 'src/lib/pwa-register-standalone.ts') } }
    : {},
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts: true },
  build: {
    outDir: standalone ? 'dist-standalone' : 'dist',
    sourcemap: false,
    // خروجی تک‌فایل باید اسکریپت کلاسیک (IIFE) باشد تا در file:// و مرورگرهای قدیمی‌تر
    // هم اجرا شود؛ اسکریپت module در برخی حالت‌ها اجرا نمی‌شد و صفحه سفید می‌داد.
    target: standalone ? 'es2018' : 'es2022',
    cssCodeSplit: !standalone,
    modulePreload: standalone ? false : undefined,
    ...(standalone
      ? {
          rollupOptions: {
            output: {
              format: 'iife' as const,
              inlineDynamicImports: true,
              entryFileNames: 'app.js',
              assetFileNames: 'app.[ext]',
            },
          },
        }
      : {}),
  },
  };
});
