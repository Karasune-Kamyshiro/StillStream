// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { StreamCard } from "../../../shared/contracts"
import { PREVIEW_STREAMS } from "../demo-data"
import { PREVIEW_DELAY_MS } from "./StreamPreview"
import { StreamShelf } from "./StreamShelf"

const base = PREVIEW_STREAMS[0] as StreamCard
const live: StreamCard = {
  ...base,
  id: "live",
  startedAt: "2026-10-30T18:00:00Z",
  userLogin: "on_air",
}
const offline: StreamCard = { ...base, id: "offline", startedAt: "", userLogin: "off_air" }

describe("stream card live preview", () => {
  let root: Root
  let container: HTMLDivElement
  const card = (id: string) =>
    container.querySelector<HTMLButtonElement>(
      `[data-focus-id="stream-${id}"]`,
    ) as HTMLButtonElement
  const previewOf = (id: string) => card(id).querySelector("iframe")

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () =>
      root.render(
        <StreamShelf
          emptyMessage="Empty"
          onSelect={() => undefined}
          streams={[live, offline]}
          title="Live"
        />,
      ),
    )
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("starts a muted, inert player once a live card stays focused", async () => {
    await act(async () => card("live").focus())
    await act(async () => vi.advanceTimersByTime(PREVIEW_DELAY_MS - 100))
    expect(previewOf("live")).toBeNull()
    await act(async () => vi.advanceTimersByTime(100))
    const frame = previewOf("live")
    expect(frame?.getAttribute("src")).toContain("channel=on_air")
    expect(frame?.getAttribute("src")).toContain("muted=true")
    expect(frame?.hasAttribute("inert")).toBe(true)
    expect(frame?.tabIndex).toBe(-1)
  })

  it("stops the preview when focus moves on, and never previews an offline channel", async () => {
    await act(async () => card("live").focus())
    await act(async () => vi.advanceTimersByTime(PREVIEW_DELAY_MS))
    await act(async () => card("offline").focus())
    expect(previewOf("live")).toBeNull()
    await act(async () => vi.advanceTimersByTime(PREVIEW_DELAY_MS * 2))
    expect(container.querySelector("iframe")).toBeNull()
  })

  it("does not start a preview for a card that was only passed through", async () => {
    await act(async () => card("live").focus())
    await act(async () => vi.advanceTimersByTime(PREVIEW_DELAY_MS / 2))
    await act(async () => card("offline").focus())
    await act(async () => vi.advanceTimersByTime(PREVIEW_DELAY_MS))
    expect(container.querySelector("iframe")).toBeNull()
  })

  it("starts the loaded preview muted through the main process, retrying until it plays", async () => {
    const activate = vi.fn<(audible: boolean) => Promise<boolean>>()
    activate.mockResolvedValueOnce(false).mockResolvedValue(true)
    vi.stubGlobal("stillStream", { system: { activateEmbeddedPlayer: activate } })
    await act(async () => card("live").focus())
    await act(async () => vi.advanceTimersByTime(PREVIEW_DELAY_MS))
    await act(async () => previewOf("live")?.dispatchEvent(new Event("load")))
    for (let step = 0; step < 50; step += 1) {
      await act(async () => vi.advanceTimersByTime(200))
    }
    expect(activate.mock.calls).toEqual([[false], [false]])
  })
})
