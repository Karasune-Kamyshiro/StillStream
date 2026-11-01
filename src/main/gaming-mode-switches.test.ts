import { describe, expect, it, vi } from "vitest"
import { applyGamingModeSwitches } from "./gaming-mode-switches"

describe("Gaming Mode Chromium switches", () => {
  it("decodes video on the CPU in Steam Gaming Mode, where hardware decoding crashes the GPU process", () => {
    const appendSwitch = vi.fn()
    expect(applyGamingModeSwitches({ appendSwitch }, { SteamGamepadUI: "1", SteamOS: "1" })).toBe(
      true,
    )
    expect(appendSwitch).toHaveBeenCalledExactlyOnceWith("disable-accelerated-video-decode")
  })

  it("keeps hardware decoding on the desktop, including SteamOS Desktop Mode", () => {
    const appendSwitch = vi.fn()
    expect(applyGamingModeSwitches({ appendSwitch }, { SteamOS: "1" })).toBe(false)
    expect(applyGamingModeSwitches({ appendSwitch }, {})).toBe(false)
    expect(appendSwitch).not.toHaveBeenCalled()
  })
})
