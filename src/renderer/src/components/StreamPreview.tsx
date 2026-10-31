import { useCallback, useEffect, useRef, useState } from "react"

/** How long a card has to stay focused or hovered before its live preview starts. */
export const PREVIEW_DELAY_MS = 1000

const PREVIEW_ACTIVATION_DELAYS_MS = [300, 1200, 2500, 4500] as const

export const previewUrl = (channel: string): string =>
  `https://player.twitch.tv/?${new URLSearchParams({
    autoplay: "true",
    channel,
    controls: "false",
    muted: "true",
    parent: "localhost",
  }).toString()}`

/**
 * Which card shows a live preview: the one focused (or hovered) for PREVIEW_DELAY_MS. Moving on
 * cancels the pending preview and stops a running one, so scrolling through a shelf loads nothing.
 */
export const usePreviewTarget = (): {
  readonly previewId: string | undefined
  readonly arm: (id: string) => void
  readonly disarm: (id: string) => void
} => {
  const [previewId, setPreviewId] = useState<string>()
  const pending = useRef<{ id: string; timer: ReturnType<typeof setTimeout> }>(undefined)

  const arm = useCallback((id: string): void => {
    if (pending.current?.id === id) return
    if (pending.current !== undefined) clearTimeout(pending.current.timer)
    setPreviewId((current) => (current === id ? current : undefined))
    pending.current = { id, timer: setTimeout(() => setPreviewId(id), PREVIEW_DELAY_MS) }
  }, [])

  const disarm = useCallback((id: string): void => {
    if (pending.current?.id !== id) return
    clearTimeout(pending.current.timer)
    pending.current = undefined
    setPreviewId((current) => (current === id ? undefined : current))
  }, [])

  useEffect(
    () => () => {
      if (pending.current !== undefined) clearTimeout(pending.current.timer)
    },
    [],
  )

  return { arm, disarm, previewId }
}

/**
 * A muted, control-less Twitch player laid over a card's thumbnail. It is inert: it never takes
 * focus or input from the controller-first shell, and the thumbnail stays visible until it loads.
 */
export const StreamPreview = ({ channel }: { readonly channel: string }) => {
  const [loaded, setLoaded] = useState(false)

  // Like the full player, the embed shows its poster instead of playing until main starts the
  // video inside the Twitch frame. On browse screens the preview is the only Twitch player, so
  // the same muted activation applies; it is retried while the player is still loading.
  useEffect(() => {
    if (!loaded) return
    let cancelled = false
    const timers = PREVIEW_ACTIVATION_DELAYS_MS.map((delay) =>
      setTimeout(() => {
        if (cancelled) return
        void window.stillStream.system.activateEmbeddedPlayer(false).then(
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
  }, [loaded])

  return (
    <iframe
      allow="autoplay"
      aria-hidden="true"
      className="stream-preview"
      data-loaded={loaded}
      inert
      onLoad={() => setLoaded(true)}
      src={previewUrl(channel)}
      tabIndex={-1}
      title={`Live preview of ${channel}`}
    />
  )
}
