import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@a2ui/core': fileURLToPath(
        new URL('../../packages/a2ui-core/src/index.ts', import.meta.url),
      ),
      '@a2ui/vue': fileURLToPath(
        new URL('../../packages/a2ui-vue/src/index.ts', import.meta.url),
      ),
    },
  },
})
