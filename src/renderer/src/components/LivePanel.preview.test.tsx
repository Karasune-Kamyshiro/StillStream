// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { StreamCard } from "../../../shared/contracts"
import { PREVIEW_STREAMS } from "../demo-data"
import { LivePanel } from "./LivePanel"
import { PREVIEW_PRELOAD_MS, PreviewSoundContext } from "./StreamPreview"

const base = PREVIEW_STREAMS[0] as StreamCard
const watching: StreamCard = {
  ...base,
  id: "a",
  startedAt: "2026-10-31T18:00:00Z",
  userLogin: "now",
}
const other: StreamCard = { ...base, id: "b", startedAt: "2026-10-31T18:00:00Z", userLogin: "next" }

describe("live panel previews", () => {
  let root: Root
  let container: HTMLDivElement
  const activate = vi.fn<(audible: boolean, target?: string) => Promise<boolean>>()
  const audible = vi.fn<(audible: boolean) => void>()
  const card = (login: string) =>
    container.querySelector<HTMLButtonElement>(
      `[data-focus-id="live-panel-${login}"]`,
    ) as HTMLButtonElement
  const settle = async (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 50) {
      await act(async () => vi.advanceTimersByTime(50))
    }
  }

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    activate.mockReset().mockResolvedValue(true)
    audible.mockReset()
    vi.stubGlobal("stillStream", {
      catalog: { followed: async () => ({ items: [watching, other] }) },
      system: { activateEmbeddedPlayer: activate },
    })
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () =>
      root.render(
        <PreviewSoundContext.Provider value={true}>
          <LivePanel
            currentChannel="now"
            onClose={() => undefined}
            onPreviewAudible={audible}
            onSelect={() => undefined}
            signedIn
          />
        </PreviewSoundContext.Provider>,
      ),
    )
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("never previews the channel already playing", async () => {
    await act(async () => card("now").focus())
    await settle(PREVIEW_PRELOAD_MS * 3)
    expect(container.querySelector("iframe")).toBeNull()
  })

  it("plays another channel's preview in its own frame and hands the sound over and back", async () => {
    await act(async () => card("next").focus())
    await settle(PREVIEW_PRELOAD_MS)
    const frame = card("next").querySelector("iframe")
    expect(frame?.getAttribute("name")).toBe("stillstream-preview")
    await act(async () => frame?.dispatchEvent(new Event("load")))
    await settle(200)
    expect(activate.mock.calls.every(([, target]) => target === "preview")).toBe(true)
    expect(audible.mock.calls).toEqual([[true]])
    await act(async () => card("now").focus())
    expect(audible.mock.calls).toEqual([[true], [false]])
  })
})
