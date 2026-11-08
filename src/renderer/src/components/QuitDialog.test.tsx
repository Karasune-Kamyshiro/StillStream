// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { dismissOpenSurface } from "../focus-navigation"
import { QuitDialog } from "./QuitDialog"

describe("quit dialog", () => {
  let root: Root
  let container: HTMLDivElement
  const quit = vi.fn(async () => undefined)
  const onClose = vi.fn()
  const button = (id: string) =>
    document.querySelector<HTMLButtonElement>(`[data-focus-id="${id}"]`)

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    vi.stubGlobal("stillStream", { system: { quit } })
    quit.mockClear()
    onClose.mockClear()
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root.render(<QuitDialog onClose={onClose} />))
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it("focuses Quit, so Back then A quits", async () => {
    expect(document.activeElement).toBe(button("quit-confirm"))
    await act(async () => button("quit-confirm")?.click())
    expect(quit).toHaveBeenCalledOnce()
  })

  it("stays on Back again or Cancel", async () => {
    expect(dismissOpenSurface()).toBe(true)
    expect(onClose).toHaveBeenCalledOnce()
    await act(async () => button("quit-cancel")?.click())
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(quit).not.toHaveBeenCalled()
  })
})
