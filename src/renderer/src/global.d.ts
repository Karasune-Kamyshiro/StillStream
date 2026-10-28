import type { StillStreamApi } from "../../shared/contracts"

declare global {
  interface Window {
    readonly stillStream: StillStreamApi
  }
}
