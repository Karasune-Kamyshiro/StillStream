import { describe, expect, it } from "vitest"
import { shouldEmbedLogin } from "./twitch-login-surface"

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
