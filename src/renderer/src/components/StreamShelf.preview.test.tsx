// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { StreamCard } from "../../../shared/contracts"
import { PREVIEW_STREAMS } from "../demo-data"
import {
  PREVIEW_DELAY_MS,
  PREVIEW_PRELOAD_MS,
  PreviewSoundContext,
  REVEAL_GRACE_MS,
} from "./StreamPreview"
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

  it("preloads a muted, inert player under the thumbnail, then shows it", async () => {
    await act(async () => card("live").focus())
    await act(async () => vi.advanceTimersByTime(PREVIEW_PRELOAD_MS - 1))
    expect(previewOf("live")).toBeNull()
    await act(async () => vi.advanceTimersByTime(1))
    const frame = previewOf("live")
    expect(frame?.getAttribute("src")).toContain("channel=on_air")
    expect(frame?.getAttribute("src")).toContain("muted=true")
    expect(frame?.hasAttribute("inert")).toBe(true)
    expect(frame?.tabIndex).toBe(-1)
    expect(frame?.dataset["revealed"]).toBe("false")
  })

  it("lays the player out at Twitch's autoplay minimum of 400x300", async () => {
    await act(async () => card("live").focus())
    await act(async () => vi.advanceTimersByTime(PREVIEW_PRELOAD_MS))
    const frame = previewOf("live")
    expect(Number(frame?.getAttribute("width"))).toBeGreaterThanOrEqual(400)
    expect(Number(frame?.getAttribute("height"))).toBeGreaterThanOrEqual(300)
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
    await act(async () => vi.advanceTimersByTime(PREVIEW_PRELOAD_MS / 2))
    await act(async () => card("offline").focus())
    await act(async () => vi.advanceTimersByTime(PREVIEW_DELAY_MS))
    expect(container.querySelector("iframe")).toBeNull()
  })

  const withBridge = (activate: (audible: boolean) => Promise<boolean>) =>
    vi.stubGlobal("stillStream", { system: { activateEmbeddedPlayer: activate } })
  const settle = async (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 50) {
      await act(async () => vi.advanceTimersByTime(50))
    }
  }
  const loadPreview = async () => {
    await act(async () => card("live").focus())
    await act(async () => vi.advanceTimersByTime(PREVIEW_PRELOAD_MS))
    await act(async () => previewOf("live")?.dispatchEvent(new Event("load")))
  }

  it("starts the player muted behind the thumbnail and shows it once it plays", async () => {
    const activate = vi.fn<(audible: boolean) => Promise<boolean>>()
    activate.mockResolvedValueOnce(false).mockResolvedValue(true)
    withBridge(activate)
    await loadPreview()
    // The first try reports no playback yet: the thumbnail stays in front.
    expect(previewOf("live")?.dataset["revealed"]).toBe("false")
    // The next try, a moment later, finds the video playing and the preview shows.
    await settle(300)
    expect(activate.mock.calls).toEqual([[false], [false]])
    expect(previewOf("live")?.dataset["revealed"]).toBe("true")
    await settle(5000)
    // Already playing and previews are muted: nothing more to start.
    expect(activate).toHaveBeenCalledTimes(2)
  })

  it("shows a player that will not start behind the thumbnail after a grace period", async () => {
    const activate = vi.fn<(audible: boolean) => Promise<boolean>>().mockResolvedValue(false)
    withBridge(activate)
    await loadPreview()
    await settle(PREVIEW_DELAY_MS - PREVIEW_PRELOAD_MS + REVEAL_GRACE_MS - 50)
    expect(previewOf("live")?.dataset["revealed"]).toBe("false")
    await settle(50)
    expect(previewOf("live")?.dataset["revealed"]).toBe("true")
  })

  it("starts muted while hidden, then with sound once shown when previews have sound", async () => {
    const activate = vi.fn<(audible: boolean) => Promise<boolean>>().mockResolvedValue(true)
    withBridge(activate)
    await act(async () =>
      root.render(
        <PreviewSoundContext.Provider value={true}>
          <StreamShelf
            emptyMessage="Empty"
            onSelect={() => undefined}
            streams={[live, offline]}
            title="Live"
          />
        </PreviewSoundContext.Provider>,
      ),
    )
    await loadPreview()
    expect(activate.mock.calls).toEqual([[false]])
    await settle(PREVIEW_DELAY_MS)
    expect(activate.mock.calls).toEqual([[false], [true]])
  })
})
