import { afterEach, describe, expect, it, vi } from "vitest"
import { createPlaybackKeepAwake } from "./playback-keep-awake"

const makeBlocker = () => {
  const started = new Set<number>()
  let next = 1
  return {
    isStarted: vi.fn((id: number) => started.has(id)),
    start: vi.fn(() => {
      const id = next++
      started.add(id)
      return id
    }),
    started,
    stop: vi.fn((id: number) => started.delete(id)),
  }
}

const contentsWith = (frames: { url: string; playing: boolean | "throws" }[]) => ({
  mainFrame: {
    frames: frames.map((frame) => ({
      executeJavaScript: vi.fn(async () => {
        if (frame.playing === "throws") throw new Error("frame gone")
        return frame.playing
      }),
      url: frame.url,
    })),
  },
})

describe("playback keep-awake", () => {
  afterEach(() => vi.useRealTimers())

  it("holds one display-sleep blocker while the official player plays and releases it on pause", async () => {
    const blocker = makeBlocker()
    let playing = true
    const keepAwake = createPlaybackKeepAwake(
      () => contentsWith([{ playing, url: "https://player.twitch.tv/?channel=a" }]),
      blocker,
    )
    expect(await keepAwake.tick()).toBe(true)
    expect(await keepAwake.tick()).toBe(true)
    expect(blocker.start).toHaveBeenCalledExactlyOnceWith("prevent-display-sleep")
    playing = false
    expect(await keepAwake.tick()).toBe(false)
    expect(blocker.started.size).toBe(0)
    keepAwake.dispose()
  })

  it("ignores frames from other origins and failed probes", async () => {
    const blocker = makeBlocker()
    const keepAwake = createPlaybackKeepAwake(
      () =>
        contentsWith([
          { playing: true, url: "https://www.twitch.tv/embed/a/chat?parent=localhost" },
          { playing: "throws", url: "https://player.twitch.tv/?channel=a" },
        ]),
      blocker,
    )
    expect(await keepAwake.tick()).toBe(false)
    expect(blocker.start).not.toHaveBeenCalled()
    keepAwake.dispose()
  })

  it("releases the blocker when disposed and never starts one afterwards", async () => {
    const blocker = makeBlocker()
    const keepAwake = createPlaybackKeepAwake(
      () => contentsWith([{ playing: true, url: "https://player.twitch.tv/?video=1" }]),
      blocker,
    )
    await keepAwake.tick()
    keepAwake.dispose()
    expect(blocker.started.size).toBe(0)
    await keepAwake.tick()
    expect(blocker.start).toHaveBeenCalledTimes(1)
  })
})
