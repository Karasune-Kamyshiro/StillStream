import type { BrowserWindow } from "electron"
import { z } from "zod"

type FullscreenWindow = Pick<BrowserWindow, "setFullScreen">
type StatefulFullscreenWindow = Pick<BrowserWindow, "isFullScreen" | "setFullScreen">
type ScriptFrame = {
  readonly executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown>
  readonly url: string
}
type ScriptWebContents = {
  readonly mainFrame: { readonly frames: readonly ScriptFrame[] }
}

const MediaSampleSchema = z.object({
  beforeTime: z.number(),
  currentTime: z.number(),
  muted: z.boolean(),
  paused: z.boolean(),
  readyState: z.number().int().min(0).max(4),
  volume: z.number().min(0).max(1),
})

/**
 * Twitch's player internals change without notice. When the embed refuses to start, what it
 * showed is written to the terminal, so a report from a real setup says which control to press.
 */
const reportStalledPlayer = (value: unknown): void => {
  const summary = JSON.stringify(value) ?? String(value)
  console.warn(`[StillStream] Twitch player did not start: ${summary.slice(0, 1500)}`)
}

export const activateEmbeddedPlayer = async (
  webContents: ScriptWebContents,
  audible: boolean,
): Promise<boolean> => {
  const playerFrame = webContents.mainFrame.frames.find(
    (frame) => URL.canParse(frame.url) && new URL(frame.url).origin === "https://player.twitch.tv",
  )
  if (playerFrame === undefined) return false
  const script = `(async () => {
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const gate = document.querySelector('[data-a-target="content-classification-gate-overlay-start-watching-button"]');
    if (gate instanceof HTMLButtonElement) gate.click();
    await Promise.race([new Promise((resolve) => requestAnimationFrame(resolve)), pause(100)]);
    // Twitch can decline its own autoplay (small or freshly revealed embeds). It then shows a
    // blurred poster with a play button, often without any video element yet, and ignores a bare
    // video.play(). Press its play control and ask its media player itself to play, found through
    // the React tree the same way as the low-latency switch.
    // Only controls that exist (or are labelled) for a paused player: a toggle pressed while
    // Twitch is still starting its own playback would pause it instead.
    const PLAY_CONTROLS = [
      '[data-a-target="player-overlay-play-button"]',
      'button[aria-label="Play" i]',
      'button[aria-label^="Play (" i]',
      'button[aria-label^="Wiedergabe" i]',
    ];
    const pressPlay = () => {
      for (const selector of PLAY_CONTROLS) {
        const control = document.querySelector(selector);
        if (control instanceof HTMLElement) {
          control.click();
          return selector;
        }
      }
      return null;
    };
    const fiberOf = (element) => {
      const key = Object.keys(element).find(
        (name) => name.startsWith("__reactFiber$") || name.startsWith("__reactInternalInstance$"),
      );
      return key === undefined ? undefined : element[key];
    };
    const startMediaPlayer = () => {
      const starts = [
        document.querySelector('video'),
        document.querySelector('[data-a-target="player-overlay-click-handler"]'),
        document.querySelector('[data-a-target^="player"]'),
      ];
      for (const start of starts) {
        let element = start;
        let fiber;
        for (let hops = 0; element && hops < 30 && !(fiber = fiberOf(element)); hops++) {
          element = element.parentElement;
        }
        for (let depth = 0; fiber && depth < 120; depth++) {
          const candidate = fiber.memoizedProps && fiber.memoizedProps.mediaPlayerInstance;
          if (candidate && typeof candidate.play === 'function') {
            try { candidate.play(); return true; } catch { return false; }
          }
          fiber = fiber.return;
        }
      }
      return false;
    };
    const diagnostics = (pressed, mediaPlayer) => ({
      controls: [...document.querySelectorAll('button, [data-a-target]')]
        .slice(0, 25)
        .map((element) => [element.getAttribute('data-a-target'), element.getAttribute('aria-label')].filter(Boolean).join('|'))
        .filter(Boolean),
      mediaPlayer,
      pressed,
    });
    let pressed = null;
    let mediaPlayer = false;
    let video = document.querySelector('video');
    if (!(video instanceof HTMLVideoElement) || video.paused) {
      pressed = pressPlay();
      mediaPlayer = startMediaPlayer();
      await pause(400);
      video = document.querySelector('video');
    }
    if (!(video instanceof HTMLVideoElement)) return { diagnostics: diagnostics(pressed, mediaPlayer) };
    const playButton = document.querySelector('[data-a-target="player-play-pause-button"]');
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA && playButton instanceof HTMLButtonElement && pressed === null) {
      playButton.click();
    }
    if (${audible}) {
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        video.muted = true;
      } else {
        video.muted = false;
        // TV setups control loudness on the TV or system; the player plays at full volume.
        video.volume = 1;
      }
    }
    const beforeTime = video.currentTime;
    void video.play().catch(() => undefined);
    await pause(150);
    if (video.paused && pressed === null) {
      pressed = pressPlay();
      mediaPlayer = startMediaPlayer() || mediaPlayer;
    }
    await pause(600);
    return {
      beforeTime,
      currentTime: video.currentTime,
      diagnostics: diagnostics(pressed, mediaPlayer),
      muted: video.muted,
      paused: video.paused,
      readyState: video.readyState,
      volume: video.volume,
    };
  })()`
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<{ readonly kind: "timeout" }>((resolve) => {
    timeoutId = setTimeout(() => resolve({ kind: "timeout" }), 2_500)
  })
  const execution = playerFrame.executeJavaScript(script, true).then(
    (value) => ({ kind: "value", value }) as const,
    () => ({ kind: "error" }) as const,
  )
  const result = await Promise.race([execution, timeout])
  if (timeoutId !== undefined) clearTimeout(timeoutId)
  if (result.kind !== "value") return false
  const parsed = MediaSampleSchema.safeParse(result.value)
  if (!parsed.success) {
    reportStalledPlayer(result.value)
    return false
  }
  const sample = parsed.data
  const playing =
    sample.readyState >= 2 && !sample.paused && sample.currentTime - sample.beforeTime >= 0.1
  if (!playing) reportStalledPlayer(result.value)
  return playing && (!audible || (!sample.muted && sample.volume > 0))
}

export const restoreShellFullscreen = (
  mainWindow: FullscreenWindow,
  runningInSteamGameMode: boolean,
): boolean => {
  mainWindow.setFullScreen(runningInSteamGameMode)
  return runningInSteamGameMode
}

// Returns the previous state so a temporary fullscreen (stream fullscreen) can be undone exactly.
export const setWindowFullscreen = (
  mainWindow: StatefulFullscreenWindow,
  fullscreen: boolean,
): boolean => {
  const previous = mainWindow.isFullScreen()
  if (previous !== fullscreen) mainWindow.setFullScreen(fullscreen)
  return previous
}

const LowLatencyResultSchema = z.boolean().nullable()

/**
 * The embed API has no latency control, but the official player's own media player instance does
 * (the one its Advanced > Low Latency menu drives). It is found through the React tree around the
 * video element, exactly as browser extensions do. Only a fixed script with a boolean crosses into
 * the Twitch frame. Resolves with the mode Twitch reports, or null when this player build exposes
 * no such control (Twitch changed its internals, VOD, or the player is not ready).
 */
export const setEmbeddedPlayerLowLatency = async (
  webContents: ScriptWebContents,
  enabled: boolean | null,
): Promise<boolean | null> => {
  const playerFrame = webContents.mainFrame.frames.find(
    (frame) => URL.canParse(frame.url) && new URL(frame.url).origin === "https://player.twitch.tv",
  )
  if (playerFrame === undefined) return null
  const request = enabled === null ? "null" : String(enabled)
  const script = `(async () => {
    const fiberOf = (element) => {
      const key = Object.keys(element).find(
        (name) => name.startsWith("__reactFiber$") || name.startsWith("__reactInternalInstance$"),
      );
      return key === undefined ? undefined : element[key];
    };
    let element = document.querySelector('video');
    let fiber;
    for (let hops = 0; element && hops < 30 && !(fiber = fiberOf(element)); hops++) {
      element = element.parentElement;
    }
    let player;
    for (let depth = 0; fiber && depth < 80; depth++) {
      const candidate = fiber.memoizedProps && fiber.memoizedProps.mediaPlayerInstance;
      if (
        candidate &&
        typeof candidate.isLiveLowLatency === 'function' &&
        typeof candidate.setLiveLowLatencyEnabled === 'function'
      ) {
        player = candidate;
        break;
      }
      fiber = fiber.return;
    }
    if (player === undefined) return null;
    const request = ${request};
    if (request !== null && Boolean(player.isLiveLowLatency()) !== request) {
      player.setLiveLowLatencyEnabled(request);
      // The switch reloads the stream; give it a moment before reading the mode back.
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    return Boolean(player.isLiveLowLatency());
  })()`
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => resolve(null), 2_500)
  })
  const execution = playerFrame.executeJavaScript(script, true).then(
    (value) => {
      const parsed = LowLatencyResultSchema.safeParse(value)
      return parsed.success ? parsed.data : null
    },
    () => null,
  )
  const result = await Promise.race([execution, timeout])
  if (timeoutId !== undefined) clearTimeout(timeoutId)
  return result
}
