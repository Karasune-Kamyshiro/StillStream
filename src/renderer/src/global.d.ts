import type { StillStreamApi } from "../../shared/contracts"

declare global {
  /** package.json version, injected at build time (electron.vite.config.ts, vitest.config.ts). */
  const __STILLSTREAM_VERSION__: string

  interface Window {
    readonly stillStream: StillStreamApi
  }
}
