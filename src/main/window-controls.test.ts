import { describe, expect, it } from "vitest"
import {
  activateEmbeddedPlayer,
  PREVIEW_FRAME_NAME,
  restoreShellFullscreen,
  setEmbeddedPlayerLowLatency,
} from "./window-controls"

const webContentsFor = (result: unknown, executions: boolean[]) => ({
  mainFrame: {
    frames: [
      {
        executeJavaScript: async (): Promise<boolean> => false,
        url: "https://example.com/frame",
      },
      {
        executeJavaScript: async (_code: string, userGesture?: boolean): Promise<unknown> => {
          executions.push(userGesture === true)
          return result
        },
        url: "https://player.twitch.tv/embed",
      },
    ],
  },
})

describe("window controller actions", () => {
  it("rejects a paused-only false positive without usable media", async () => {
    // Given a Twitch video that reports unpaused before media is attached
    const executions: boolean[] = []
    const webContents = webContentsFor(
      { beforeTime: 0, currentTime: 0, muted: false, paused: false, readyState: 0, volume: 0.5 },
      executions,
    )

    // When audible playback activation is classified
    const playbackStarted = await activateEmbeddedPlayer(webContents, true)

    // Then the empty video is rejected despite its paused flag
    expect(playbackStarted).toBe(false)
    expect(executions).toEqual([true])
  })

  it("accepts progressing muted media for a manual resume", async () => {
    // Given muted Twitch media that advances during activation
    const webContents = webContentsFor(
      { beforeTime: 10, currentTime: 10.5, muted: true, paused: false, readyState: 4, volume: 0.5 },
      [],
    )

    // When playback is resumed without changing the user's mute choice
    const playbackStarted = await activateEmbeddedPlayer(webContents, false)

    // Then real media progress is sufficient
    expect(playbackStarted).toBe(true)
  })

  it("requires advancing unmuted media for audible autoplay", async () => {
    // Given advancing Twitch media that is still muted
    const webContents = webContentsFor(
      { beforeTime: 10, currentTime: 10.5, muted: true, paused: false, readyState: 4, volume: 0.5 },
      [],
    )

    // When audible autoplay is classified
    const playbackStarted = await activateEmbeddedPlayer(webContents, true)

    // Then muted progress does not claim audible success
    expect(playbackStarted).toBe(false)
  })

  it("accepts advancing unmuted media for audible autoplay", async () => {
    // Given advancing audible Twitch media
    const webContents = webContentsFor(
      {
        beforeTime: 10,
        currentTime: 10.5,
        muted: false,
        paused: false,
        readyState: 4,
        volume: 0.5,
      },
      [],
    )

    // When audible autoplay is classified
    const playbackStarted = await activateEmbeddedPlayer(webContents, true)

    // Then the progressing media is accepted
    expect(playbackStarted).toBe(true)
  })

  it("restores the desktop shell to windowed mode", () => {
    // Given a fullscreen-capable desktop window
    const fullscreenStates: boolean[] = []
    const mainWindow = {
      setFullScreen: (fullscreen: boolean): void => {
        fullscreenStates.push(fullscreen)
      },
    }

    // When player fullscreen is left outside Steam Gaming Mode
    const fullscreen = restoreShellFullscreen(mainWindow, false)

    // Then the shell is explicitly windowed instead of toggled
    expect(fullscreen).toBe(false)
    expect(fullscreenStates).toEqual([false])
  })

  it("preserves fullscreen when returning to Steam Gaming Mode shell", () => {
    // Given a fullscreen-capable Gaming Mode window
    const fullscreenStates: boolean[] = []
    const mainWindow = {
      setFullScreen: (fullscreen: boolean): void => {
        fullscreenStates.push(fullscreen)
      },
    }

    // When player fullscreen is left in Steam Gaming Mode
    const fullscreen = restoreShellFullscreen(mainWindow, true)

    // Then the shell returns to its intended fullscreen baseline
    expect(fullscreen).toBe(true)
    expect(fullscreenStates).toEqual([true])
  })
})

describe("stream and live preview frames", () => {
  const playing = {
    beforeTime: 0,
    currentTime: 1,
    muted: true,
    paused: false,
    readyState: 4,
    volume: 1,
  }
  const frames = (calls: string[]) => ({
    mainFrame: {
      frames: [
        {
          executeJavaScript: async (): Promise<unknown> => {
            calls.push("preview")
            return playing
          },
          name: PREVIEW_FRAME_NAME,
          url: "https://player.twitch.tv/?channel=other",
        },
        {
          executeJavaScript: async (): Promise<unknown> => {
            calls.push("player")
            return playing
          },
          name: "",
          url: "https://player.twitch.tv/?channel=watched",
        },
      ],
    },
  })

  it("starts the watched stream, never a preview listed before it", async () => {
    const calls: string[] = []
    expect(await activateEmbeddedPlayer(frames(calls), false)).toBe(true)
    expect(calls).toEqual(["player"])
  })

  it("starts the named preview frame when asked for the preview", async () => {
    const calls: string[] = []
    expect(await activateEmbeddedPlayer(frames(calls), false, "preview")).toBe(true)
    expect(calls).toEqual(["preview"])
  })

  it("leaves the watched stream alone when no preview is showing", async () => {
    const calls: string[] = []
    const onlyPlayer = { mainFrame: { frames: frames(calls).mainFrame.frames.slice(1) } }
    expect(await activateEmbeddedPlayer(onlyPlayer, false, "preview")).toBe(false)
    expect(calls).toEqual([])
  })
})

describe("embedded player low latency", () => {
  const contentsWith = (frames: { url: string; result: unknown }[]) => {
    const scripts: string[] = []
    return {
      contents: {
        mainFrame: {
          frames: frames.map((frame) => ({
            executeJavaScript: async (code: string) => {
              scripts.push(code)
              if (frame.result instanceof Error) throw frame.result
              return frame.result
            },
            url: frame.url,
          })),
        },
      },
      scripts,
    }
  }

  it("runs a fixed script in the official player frame and reports Twitch's mode", async () => {
    const { contents, scripts } = contentsWith([
      { result: true, url: "https://www.twitch.tv/embed/a/chat?parent=localhost" },
      { result: true, url: "https://player.twitch.tv/?channel=a&parent=localhost" },
    ])
    expect(await setEmbeddedPlayerLowLatency(contents, true)).toBe(true)
    expect(await setEmbeddedPlayerLowLatency(contents, null)).toBe(true)
    expect(scripts).toHaveLength(2)
    expect(scripts[0]).toContain("const request = true;")
    expect(scripts[1]).toContain("const request = null;")
    expect(scripts[0]).toContain("setLiveLowLatencyEnabled")
  })

  it("reports null when the player is missing, lacks the control, or answers unexpectedly", async () => {
    expect(await setEmbeddedPlayerLowLatency(contentsWith([]).contents, false)).toBeNull()
    for (const result of [null, "yes", new Error("frame gone")]) {
      const { contents } = contentsWith([{ result, url: "https://player.twitch.tv/?video=1" }])
      expect(await setEmbeddedPlayerLowLatency(contents, false)).toBeNull()
    }
  })
})
