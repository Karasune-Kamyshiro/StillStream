import type { PowerSaveBlocker } from "electron"

type KeepAwakeBlocker = Pick<PowerSaveBlocker, "isStarted" | "start" | "stop">
type ProbeFrame = {
  readonly executeJavaScript: (code: string) => Promise<unknown>
  readonly url: string
}
type ProbeWebContents = {
  readonly mainFrame: { readonly frames: readonly ProbeFrame[] }
}

// Read-only: reports whether the official player's video element is currently advancing.
const PLAYING_PROBE = `(() => {
  const video = document.querySelector('video');
  return video instanceof HTMLVideoElement && !video.paused && !video.ended && video.readyState >= 2;
})()`

const PROBE_TIMEOUT_MS = 1_000

const isTwitchPlayerFrame = (frame: ProbeFrame): boolean =>
  URL.canParse(frame.url) && new URL(frame.url).origin === "https://player.twitch.tv"

const probeFrame = async (frame: ProbeFrame): Promise<boolean> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<false>((resolve) => {
    timeoutId = setTimeout(() => resolve(false), PROBE_TIMEOUT_MS)
  })
  const result = await Promise.race([
    frame.executeJavaScript(PLAYING_PROBE).then(
      (value) => value === true,
      () => false,
    ),
    timeout,
  ])
  if (timeoutId !== undefined) clearTimeout(timeoutId)
  return result
}

export type PlaybackKeepAwake = {
  readonly dispose: () => void
  readonly tick: () => Promise<boolean>
}

/**
 * Chromium does not reliably inhibit the desktop screensaver for media inside the cross-origin
 * Twitch iframe, so main samples the player and holds a display-sleep blocker while it plays.
 */
export const createPlaybackKeepAwake = (
  webContents: () => ProbeWebContents | undefined,
  blocker: KeepAwakeBlocker,
  intervalMs = 15_000,
): PlaybackKeepAwake => {
  let blockerId: number | undefined
  let disposed = false

  const hold = (playing: boolean): void => {
    if (playing && !disposed) {
      if (blockerId === undefined || !blocker.isStarted(blockerId)) {
        blockerId = blocker.start("prevent-display-sleep")
      }
      return
    }
    if (blockerId !== undefined) {
      if (blocker.isStarted(blockerId)) blocker.stop(blockerId)
      blockerId = undefined
    }
  }

  const tick = async (): Promise<boolean> => {
    const contents = webContents()
    if (contents === undefined || disposed) {
      hold(false)
      return false
    }
    const frames = contents.mainFrame.frames.filter(isTwitchPlayerFrame)
    const samples = await Promise.all(frames.map(probeFrame))
    const playing = samples.includes(true)
    hold(playing)
    return playing
  }

  const timer = setInterval(() => void tick(), intervalMs)

  return {
    dispose: () => {
      disposed = true
      clearInterval(timer)
      hold(false)
    },
    tick,
  }
}
