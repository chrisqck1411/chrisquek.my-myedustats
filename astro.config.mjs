import { defineConfig } from 'astro/config';

// Strict content policy: no inline scripts or styles may ever be emitted.
// - inlineStylesheets: 'never'  -> all CSS is written to external files
// - assetsInlineLimit: 0        -> small scripts are never inlined either
export default defineConfig({
  site: 'https://myedustats.chrisquek.my',
  output: 'static',
  trailingSlash: 'always',
  build: {
    format: 'directory',
    inlineStylesheets: 'never',
  },
  vite: {
    build: {
      assetsInlineLimit: 0,
    },
  },
  devToolbar: { enabled: false },
});
