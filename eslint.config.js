import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-standalone/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.data/**',
      '**/artifacts/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // اسکریپت‌های ابزار (باندل/ساخت دارایی) در محیط Node اجرا می‌شوند
    files: ['scripts/**/*.mjs', 'apps/api/test/load/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        fetch: 'readonly',
        performance: 'readonly',
        Response: 'readonly',
        AbortController: 'readonly',
      },
    },
  },
  {
    // کدهایی که به‌صورت رشته به page.evaluate داده می‌شوند داخل مرورگر اجرا می‌شوند
    files: ['scripts/e2e-*.mjs'],
    languageOptions: {
      globals: {
        document: 'readonly',
        location: 'readonly',
        navigator: 'readonly',
        window: 'readonly',
        Event: 'readonly',
        getComputedStyle: 'readonly',
        HTMLScriptElement: 'readonly',
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off',
    },
  },
);
