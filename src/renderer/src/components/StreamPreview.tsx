import { useCallback, useEffect, useRef, useState } from "react"

/** How long a card has to stay focused or hovered before its live preview starts. */
export const PREVIEW_DELAY_MS = 1500

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
