import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { applyVideoDecodingSwitches, readHardwareDecodingChoice } from "./gaming-mode-switches"

const gamingMode = { SteamGamepadUI: "1", SteamOS: "1" }

describe("hardware video decoding", () => {
  it("is off in Steam Gaming Mode by default, where hardware decoding crashes the GPU process", () => {
    const appendSwitch = vi.fn()
    expect(applyVideoDecodingSwitches({ appendSwitch }, gamingMode, "auto")).toBe(false)
    expect(appendSwitch).toHaveBeenCalledExactlyOnceWith("disable-accelerated-video-decode")
  })

  it("stays on by default on the desktop, including SteamOS Desktop Mode", () => {
    const appendSwitch = vi.fn()
    expect(applyVideoDecodingSwitches({ appendSwitch }, { SteamOS: "1" }, "auto")).toBe(true)
    expect(applyVideoDecodingSwitches({ appendSwitch }, {}, "auto")).toBe(true)
    expect(appendSwitch).not.toHaveBeenCalled()
  })

  it("follows an explicit choice anywhere", () => {
    const appendSwitch = vi.fn()
    expect(applyVideoDecodingSwitches({ appendSwitch }, gamingMode, "on")).toBe(true)
    expect(appendSwitch).not.toHaveBeenCalled()
    expect(applyVideoDecodingSwitches({ appendSwitch }, {}, "off")).toBe(false)
    expect(appendSwitch).toHaveBeenCalledExactlyOnceWith("disable-accelerated-video-decode")
  })

  it("reads the saved choice before the app is ready, falling back to automatic", () => {
    const directory = mkdtempSync(join(tmpdir(), "stillstream-prefs-"))
    try {
      expect(readHardwareDecodingChoice(directory)).toBe("auto")
      writeFileSync(
        join(directory, "preferences.json"),
        JSON.stringify({ hardwareVideoDecoding: "on" }),
      )
      expect(readHardwareDecodingChoice(directory)).toBe("on")
      writeFileSync(
        join(directory, "preferences.json"),
        JSON.stringify({ hardwareVideoDecoding: 7 }),
      )
      expect(readHardwareDecodingChoice(directory)).toBe("auto")
      writeFileSync(join(directory, "preferences.json"), "{broken")
      expect(readHardwareDecodingChoice(directory)).toBe("auto")
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })
})
