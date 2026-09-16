import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

const build = JSON.parse(readFileSync(new URL('../shared/buildVersion.json', import.meta.url), 'utf8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), {
    name: 'corex-build-marker',
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { name: 'corex-build', content: build.version }, injectTo: 'head' }]
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'build.json', source: JSON.stringify(build) })
    },
  }],
})
