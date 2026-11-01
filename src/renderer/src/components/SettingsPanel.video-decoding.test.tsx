// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { HardwareVideoDecoding } from "../../../shared/contracts"
import { SettingsPanel } from "./SettingsPanel"

describe("hardware video decoding setting", () => {
  let root: Root
  let container: HTMLDivElement
  let choice: HardwareVideoDecoding
  const save = vi.fn(async (next: HardwareVideoDecoding) => {
    choice = next
    render()
  })
  const render = () =>
    root.render(
      <SettingsPanel
        auth={{ kind: "guest" }}
        hardwareVideoDecoding={choice}
        onAccountRequest={() => () => true}
        onAuthChange={() => undefined}
        onHardwareVideoDecodingChange={save}
        onSettingsChange={() => undefined}
        onStartScreenChange={async () => undefined}
        settings={{ clientId: "abcdefghijklmnopqrstuvwxyz1234", secureStorage: true }}
      />,
    )
  const cycle = () =>
    container.querySelector<HTMLButtonElement>('[data-focus-id="settings-video-decoding"]')

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    vi.stubGlobal("stillStream", {
      playerSession: { snapshot: vi.fn(async () => ({ signedIn: false })) },
    })
    choice = "auto"
    save.mockClear()
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => render())
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it("cycles Automatic, On, Off and asks for a restart only while the choice differs", async () => {
    expect(cycle()?.textContent).toContain("Automatic")
    expect(container.textContent).not.toContain("Restart StillStream")
    await act(async () => cycle()?.click())
    expect(save).toHaveBeenLastCalledWith("on")
    expect(cycle()?.textContent).toContain("On")
    expect(container.textContent).toContain("Restart StillStream to apply")
    await act(async () => cycle()?.click())
    expect(save).toHaveBeenLastCalledWith("off")
    await act(async () => cycle()?.click())
    expect(save).toHaveBeenLastCalledWith("auto")
    expect(container.textContent).not.toContain("Restart StillStream")
  })
})
