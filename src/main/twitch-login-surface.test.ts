import { describe, expect, it } from "vitest"
import { adjustedZoomFactor, shouldEmbedLogin, tvZoomFactor } from "./twitch-login-surface"

const window = (fullscreen: boolean, destroyed = false) => ({
  isDestroyed: () => destroyed,
  isFullScreen: () => fullscreen,
})

describe("embedded Twitch sign-in", () => {
  it("stays in the app window under Steam Game Mode, gamescope, or a fullscreen app", () => {
    expect(shouldEmbedLogin(window(false), true, {})).toBe(true)
    expect(
      shouldEmbedLogin(window(false), false, { GAMESCOPE_WAYLAND_DISPLAY: "gamescope-0" }),
    ).toBe(true)
    expect(shouldEmbedLogin(window(false), false, { XDG_CURRENT_DESKTOP: "gamescope" })).toBe(true)
    expect(shouldEmbedLogin(window(true), false, {})).toBe(true)
  })

  it("uses a separate window on an ordinary windowed desktop or without a live app window", () => {
    expect(shouldEmbedLogin(window(false), false, { XDG_CURRENT_DESKTOP: "KDE" })).toBe(false)
    expect(shouldEmbedLogin(window(true, true), true, {})).toBe(false)
    expect(shouldEmbedLogin(undefined, true, {})).toBe(false)
  })
})

describe("TV zoom for the embedded sign-in", () => {
  it("matches 100% at 1080p, 200% at 1440p and 250% at 4K, and blends in between", () => {
    expect(tvZoomFactor(1280)).toBe(1)
    expect(tvZoomFactor(1920)).toBe(1)
    expect(tvZoomFactor(2560)).toBe(2)
    expect(tvZoomFactor(3840)).toBe(2.5)
    expect(tvZoomFactor(2240)).toBeCloseTo(1.5)
    expect(tvZoomFactor(3200)).toBeCloseTo(2.25)
  })

  it("keeps the physical size beyond 4K and clamps manual adjustments", () => {
    expect(tvZoomFactor(7680)).toBe(5)
    expect(adjustedZoomFactor(2.5, 0.5)).toBe(3)
    expect(adjustedZoomFactor(1, -2)).toBe(0.5)
    expect(adjustedZoomFactor(4.5, 1)).toBe(5)
  })
})
