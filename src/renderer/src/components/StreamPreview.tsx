import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"

/** How long a card has to stay focused or hovered before its live preview shows. */
export const PREVIEW_DELAY_MS = 1000
/**
 * The player starts loading this early, hidden under the thumbnail, so the video is ready when
 * the preview shows. Shorter than a d-pad repeat would load a player for every card passed.
 */
export const PREVIEW_PRELOAD_MS = 250

const PREVIEW_ACTIVATION_DELAYS_MS = [0, 800, 2000, 3500, 5500, 8000] as const
const HIDDEN_ACTIVATION_DELAYS_MS = [0, 350] as const

/** True when live previews play with sound (the "Play live previews with sound" setting). */
export const PreviewSoundContext = createContext(false)

// Twitch only autoplays embeds of at least 400x300 CSS pixels; smaller ones stay on their poster.
const MIN_WIDTH = 400
const MIN_HEIGHT = 300

export const previewUrl = (channel: string): string =>
  `https://player.twitch.tv/?${new URLSearchParams({
    autoplay: "true",
    channel,
    controls: "false",
    muted: "true",
    parent: "localhost",
  }).toString()}`

export type PreviewTarget = {
  /** The card whose player is loading or playing. */
  readonly mountedId: string | undefined
  /** The card whose player is shown over its thumbnail. */
  readonly revealedId: string | undefined
  readonly arm: (id: string) => void
  readonly disarm: (id: string) => void
}

type Pending = { readonly id: string; readonly timers: ReturnType<typeof setTimeout>[] }

const clearPending = (pending: { current: Pending | undefined }): void => {
  for (const timer of pending.current?.timers ?? []) clearTimeout(timer)
  pending.current = undefined
}

/**
 * Which card previews: the one focused (or hovered) long enough. Moving on cancels the pending
 * preview and removes a running one, so scrolling through a shelf loads at most a brief player.
 */
export const usePreviewTarget = (): PreviewTarget => {
  const [mountedId, setMountedId] = useState<string>()
  const [revealedId, setRevealedId] = useState<string>()
  const pending = useRef<Pending>(undefined)

  const arm = useCallback((id: string): void => {
    if (pending.current?.id === id) return
    clearPending(pending)
    setMountedId((current) => (current === id ? current : undefined))
    setRevealedId((current) => (current === id ? current : undefined))
    pending.current = {
      id,
      timers: [
        setTimeout(() => setMountedId(id), PREVIEW_PRELOAD_MS),
        setTimeout(() => setRevealedId(id), PREVIEW_DELAY_MS),
      ],
    }
  }, [])

  const disarm = useCallback((id: string): void => {
    if (pending.current?.id !== id) return
    clearPending(pending)
    setMountedId((current) => (current === id ? undefined : current))
    setRevealedId((current) => (current === id ? undefined : current))
  }, [])

  useEffect(() => () => clearPending(pending), [])

  return { arm, disarm, mountedId, revealedId }
}

type FrameBox = { readonly height: number; readonly scale: number; readonly width: number }

/** Lays the player out at Twitch's autoplay minimum and scales it down onto the thumbnail. */
const frameBoxFor = (width: number, height: number): FrameBox => {
  if (width <= 0 || height <= 0) return { height: MIN_HEIGHT, scale: 1, width: MIN_WIDTH }
  const grow = Math.max(1, MIN_WIDTH / width, MIN_HEIGHT / height)
  return { height: height * grow, scale: 1 / grow, width: width * grow }
}

/**
 * A muted, control-less Twitch player over a card's thumbnail. It loads underneath the
 * thumbnail and only covers it once revealed. It is inert: it never takes focus or input from
 * the controller-first shell.
 */
export const StreamPreview = ({
  channel,
  revealed,
}: {
  readonly channel: string
  readonly revealed: boolean
}) => {
  const [loaded, setLoaded] = useState(false)
  const [box, setBox] = useState<FrameBox>(() => frameBoxFor(0, 0))
  const frameRef = useRef<HTMLIFrameElement>(null)

  useLayoutEffect(() => {
    const art = frameRef.current?.parentElement
    if (art === null || art === undefined) return
    const measure = (): void => setBox(frameBoxFor(art.clientWidth, art.clientHeight))
    measure()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(art)
    return () => observer.disconnect()
  }, [])

  // Like the full player, the embed can sit on its poster until main starts the video inside the
  // Twitch frame. On browse screens the preview is the only Twitch player, so the same activation
  // applies: muted while it loads behind the thumbnail, so it is already running when it shows,
  // then (with sound if chosen) once revealed, retried while the stream is still buffering.
  const sound = useContext(PreviewSoundContext)
  useEffect(() => {
    if (!loaded) return
    let cancelled = false
    const delays = revealed ? PREVIEW_ACTIVATION_DELAYS_MS : HIDDEN_ACTIVATION_DELAYS_MS
    const audible = revealed && sound
    const timers = delays.map((delay) =>
      setTimeout(() => {
        if (cancelled) return
        void window.stillStream.system.activateEmbeddedPlayer(audible).then(
          (started) => {
            if (started) cancelled = true
          },
          () => undefined,
        )
      }, delay),
    )
    return () => {
      cancelled = true
      for (const timer of timers) clearTimeout(timer)
    }
  }, [loaded, revealed, sound])

  return (
    <iframe
      allow="autoplay"
      aria-hidden="true"
      className="stream-preview"
      data-revealed={revealed}
      height={Math.round(box.height)}
      inert
      onLoad={() => setLoaded(true)}
      ref={frameRef}
      src={previewUrl(channel)}
      style={{ transform: box.scale === 1 ? undefined : `scale(${box.scale})` }}
      tabIndex={-1}
      title={`Live preview of ${channel}`}
      width={Math.round(box.width)}
    />
  )
}
