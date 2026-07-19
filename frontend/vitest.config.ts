import { defineConfig } from 'vitest/config'


export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: [
      'src/hooks/runPayload.test.ts',
      'src/components/liveMonitorMetrics.test.ts',
    ],
  },
})
