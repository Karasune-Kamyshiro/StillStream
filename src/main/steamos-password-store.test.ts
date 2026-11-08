import { describe, expect, it, vi } from "vitest"
import { applySteamOSPasswordStore, isSteamOS } from "./steamos-password-store"

const steamOS =
  'NAME="SteamOS"\nPRETTY_NAME="SteamOS"\nID=steamos\nID_LIKE=arch\nVERSION_CODENAME=holo\n'

describe("SteamOS password store", () => {
  it("recognises SteamOS and derivatives that name it", () => {
    expect(isSteamOS(steamOS)).toBe(true)
    expect(isSteamOS('ID="bazzite"\nID_LIKE="fedora steamos"\n')).toBe(true)
    expect(isSteamOS('ID=nobara\nID_LIKE="rhel centos fedora"\n')).toBe(false)
    expect(isSteamOS(undefined)).toBe(false)
  })

  it("uses one password store in Desktop and Gaming Mode on SteamOS", () => {
    const appendSwitch = vi.fn()
    expect(applySteamOSPasswordStore({ appendSwitch }, steamOS)).toBe(true)
    expect(appendSwitch).toHaveBeenCalledExactlyOnceWith("password-store", "basic")
  })

  it("leaves other systems on their keyring", () => {
    const appendSwitch = vi.fn()
    expect(applySteamOSPasswordStore({ appendSwitch }, "ID=fedora\n")).toBe(false)
    expect(appendSwitch).not.toHaveBeenCalled()
  })
})
