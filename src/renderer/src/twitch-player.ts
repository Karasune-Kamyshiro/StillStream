import type { PlayerSource } from "./components/PlayerView"

export type TwitchPlayerOptions = {
  readonly autoplay: boolean
  readonly channel?: string
  readonly height: "100%"
  readonly muted: boolean
  readonly parent: readonly ["localhost"]
  readonly time?: string
  readonly video?: string
  readonly width: "100%"
}

export interface TwitchPlayerInstance {
  readonly addEventListener: (event: string, listener: () => void) => void
  readonly disableCaptions: () => void
  readonly enableCaptions: () => void
  readonly getCurrentTime: () => number
  readonly getDuration: () => number
  readonly getMuted: () => boolean
  readonly getQualities: () => unknown
  readonly getQuality: () => string
  readonly isPaused: () => boolean
  readonly pause: () => void
  readonly play: () => void
  readonly seek: (seconds: number) => void
  readonly setMuted: (muted: boolean) => void
  readonly setQuality: (qualityId: string) => void
  readonly setVolume: (volume: number) => void
}

export type TwitchQuality = {
  readonly id: string
  readonly label: string
}

// The documented string list and the official-forum group/name shape share this boundary.
export const normalizeTwitchQualities = (value: unknown): readonly TwitchQuality[] => {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry: unknown): TwitchQuality[] => {
    if (typeof entry === "string" && entry.trim() !== "") {
      return [{ id: entry, label: entry }]
    }
    if (
      typeof entry === "object" &&
      entry !== null &&
      "group" in entry &&
      typeof entry.group === "string" &&
      entry.group.trim() !== "" &&
      "name" in entry &&
      typeof entry.name === "string" &&
      entry.name.trim() !== ""
    ) {
      return [{ id: entry.group, label: entry.name }]
    }
    return []
  })
}

type TwitchPlayerConstructor = {
  new (elementId: string, options: TwitchPlayerOptions): TwitchPlayerInstance
  readonly OFFLINE: string
  readonly ONLINE: string
  readonly PAUSE: string
  readonly PLAY: string
  readonly PLAYBACK_BLOCKED: string
  readonly PLAYING: string
  readonly READY: string
  readonly SEEK: string
}

type TwitchPlayerApi = {
  readonly Player: TwitchPlayerConstructor
}

declare global {
  interface Window {
    Twitch?: TwitchPlayerApi
  }
}

// Documented event name (Twitch.Player.ENDED).
export const TWITCH_PLAYER_ENDED = "ended"

const qualityHeight = (id: string): number | undefined => {
  const match = /^(\d{3,4})p/.exec(id)
  return match?.[1] === undefined ? undefined : Number(match[1])
}

/**
 * Picks the stream quality to request for a saved preference: the same id when the stream offers
 * it (e.g. "1080p60"), otherwise the best quality not above the preferred resolution, so a 1080p60
 * choice still gets 1080p30 or 720p60 on smaller streams. Source ("chunked") stays Source.
 */
export const preferredQualityId = (
  preferred: string,
  available: readonly TwitchQuality[],
): string | undefined => {
  if (available.some((quality) => quality.id === preferred)) return preferred
  const limit = qualityHeight(preferred)
  if (limit === undefined) return undefined
  return available
    .map((quality) => ({ height: qualityHeight(quality.id), id: quality.id }))
    .filter(
      (quality): quality is { height: number; id: string } =>
        quality.height !== undefined && quality.height <= limit,
    )
    .sort((a, b) => b.height - a.height || b.id.localeCompare(a.id))[0]?.id
}

let playerApiPromise: Promise<TwitchPlayerApi> | undefined

export const createTwitchPlayerOptions = (
  source: PlayerSource,
  startingPosition?: number,
): TwitchPlayerOptions => {
  const base = {
    autoplay: true,
    height: "100%",
    muted: true,
    parent: ["localhost"],
    width: "100%",
  } as const
  if (source.kind === "live") return { ...base, channel: source.channel }
  const seconds = Math.floor(startingPosition ?? 0)
  return {
    ...base,
    ...(seconds > 0
      ? { time: `${Math.floor(seconds / 3600)}h${Math.floor(seconds / 60) % 60}m${seconds % 60}s` }
      : {}),
    video: source.videoId,
  }
}

export const loadTwitchPlayerApi = (): Promise<TwitchPlayerApi> => {
  if (playerApiPromise !== undefined) return playerApiPromise
  if (window.Twitch !== undefined) return Promise.resolve(window.Twitch)

  const attempt = new Promise<TwitchPlayerApi>((resolve, reject) => {
    const script = document.createElement("script")
    script.async = true
    script.src = "https://player.twitch.tv/js/embed/v1.js"
    const cleanup = (): void => {
      script.removeEventListener("load", onLoad)
      script.removeEventListener("error", onError)
    }
    const fail = (message: string): void => {
      cleanup()
      script.remove()
      reject(new TypeError(message))
    }
    const onLoad = (): void => {
      if (window.Twitch === undefined) {
        fail("Twitch Player API did not initialize")
        return
      }
      cleanup()
      resolve(window.Twitch)
    }
    const onError = (): void => fail("Twitch Player API failed to load")
    script.addEventListener("load", onLoad)
    script.addEventListener("error", onError)
    document.head.append(script)
  }).catch((cause: unknown) => {
    // Only this attempt may release its single-flight slot.
    if (playerApiPromise === attempt) playerApiPromise = undefined
    throw cause
  })
  playerApiPromise = attempt
  return attempt
}
