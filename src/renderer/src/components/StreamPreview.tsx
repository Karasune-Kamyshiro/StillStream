import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"

/**
 * How long a card has to stay focused or hovered before its live player starts loading, hidden
 * under the thumbnail. Long enough that tapping or holding the d-pad through a shelf loads no
 * player for the cards passed on the way.
 */
export const PREVIEW_PRELOAD_MS = 400
/**
 * The earliest the preview may cover the thumbnail. It also waits for the video to play, which
 * takes longer than this, so in practice the preview appears as soon as Twitch is ready.
 */
export const PREVIEW_DELAY_MS = PREVIEW_PRELOAD_MS

const PREVIEW_ACTIVATION_DELAYS_MS = [0, 800, 2000, 3500, 5500, 8000] as const
// Behind the thumbnail the player is started again and again until it plays; each try takes
// about a second inside the Twitch frame, and the next follows after this pause.
const HIDDEN_ACTIVATION_PAUSE_MS = 200
const PLAYBACK_CONFIRMATIONS = 2
/**
 * How long a preview may wait behind the thumbnail for its video before showing anyway (to be
 * started in view, should Twitch refuse to play while covered). Twitch regularly needs a few
 * seconds, e.g. while its ad requests time out behind a blocker, and showing earlier only shows
 * its blurred paused poster, so this is a last resort rather than a deadline.
 */
export const REVEAL_GRACE_MS = 8000

/** Must match PREVIEW_FRAME_NAME in the main process, which finds preview frames by it. */
export const PREVIEW_FRAME_NAME = "stillstream-preview"

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
  onAudibleChange,
}: {
  readonly channel: string
  readonly revealed: boolean
  /** Told when the preview starts and stops playing with sound, so other audio can make room. */
  readonly onAudibleChange?: ((audible: boolean) => void) | undefined
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
  // applies. It runs muted while the player loads behind the thumbnail, and the preview only
  // covers the thumbnail once the video plays, so Twitch's paused poster is never shown. Should
  // Twitch refuse to play while covered, the preview shows after a grace period and is started
  // in view instead. Once shown it is activated again, with sound when that is chosen.
  const sound = useContext(PreviewSoundContext)
  const [playing, setPlaying] = useState(false)
  const [graceOver, setGraceOver] = useState(false)
  const shown = revealed && (playing || graceOver)

  useEffect(() => {
    if (!loaded || playing || shown) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    // Playback must be confirmed twice in a row: Twitch's first moments of video can still sit
    // under its blurred paused poster, which should never be what the preview reveals.
    let confirmations = 0
    // One try at a time: the next starts a moment after the previous one reported back.
    const attempt = (): void => {
      void window.stillStream.system.activateEmbeddedPlayer(false, "preview").then(
        (started) => {
          if (cancelled) return
          confirmations = started ? confirmations + 1 : 0
          if (confirmations >= PLAYBACK_CONFIRMATIONS) setPlaying(true)
          else timer = setTimeout(attempt, HIDDEN_ACTIVATION_PAUSE_MS)
        },
        () => {
          confirmations = 0
          if (!cancelled) timer = setTimeout(attempt, HIDDEN_ACTIVATION_PAUSE_MS)
        },
      )
    }
    attempt()
    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [loaded, playing, shown])

  useEffect(() => {
    if (!revealed || playing) return
    const timer = setTimeout(() => setGraceOver(true), REVEAL_GRACE_MS)
    return () => clearTimeout(timer)
  }, [revealed, playing])

  useEffect(() => {
    if (!loaded || !shown || (playing && !sound)) return
    let cancelled = false
    const timers = PREVIEW_ACTIVATION_DELAYS_MS.map((delay) =>
      setTimeout(() => {
        if (cancelled) return
        void window.stillStream.system.activateEmbeddedPlayer(sound, "preview").then(
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
  }, [loaded, shown, playing, sound])

  const audibleChange = useRef(onAudibleChange)
  audibleChange.current = onAudibleChange
  useEffect(() => {
    if (!shown || !sound) return
    audibleChange.current?.(true)
    return () => audibleChange.current?.(false)
  }, [shown, sound])

  return (
    <>
      {shown ? null : (
        // Loading indicator over the thumbnail while the hidden player starts.
        <span aria-hidden="true" className="stream-preview__loading" />
      )}
      <iframe
        allow="autoplay"
        aria-hidden="true"
        className="stream-preview"
        // Main tells this frame apart from the stream being watched by its name.
        name={PREVIEW_FRAME_NAME}
        data-revealed={shown}
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
    </>
  )
}
