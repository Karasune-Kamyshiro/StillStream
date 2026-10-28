import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { StreamCard } from "../../../shared/contracts"
import { markControllerFocus } from "../focus-navigation"

type LivePanelProps = {
  /** The channel already playing; it is marked and focused first. */
  readonly currentChannel: string | undefined
  readonly onClose: () => void
  /** Pointer entered (true) or left (false) the panel, for pointer-driven auto-close. */
  readonly onPointerInside?: (inside: boolean) => void
  readonly onSelect: (stream: StreamCard) => void
  /** False for guests: Following needs a signed-in account. */
  readonly signedIn: boolean
}

type LiveState =
  | { readonly kind: "error" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly streams: readonly StreamCard[] }

const cardId = (stream: StreamCard): string => `live-panel-${stream.userLogin}`
const viewers = (count: number): string =>
  new Intl.NumberFormat(undefined, { notation: "compact" }).format(count)

/**
 * Followed channels that are live, along the bottom edge of the player: switch streams without
 * leaving the player or stream fullscreen. Left/Right moves, OK/A switches; Down (which opened it),
 * Up or Back closes it, mirroring the top bar that Up opens and closes.
 */
export const LivePanel = ({
  currentChannel,
  onClose,
  onPointerInside,
  onSelect,
  signedIn,
}: LivePanelProps) => {
  const [state, setState] = useState<LiveState>({ kind: "loading" })
  const panelRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!signedIn) return
    let current = true
    void window.stillStream.catalog.followed({ first: 30 }).then(
      (page) => {
        if (current) setState({ kind: "ready", streams: page.items })
      },
      () => {
        if (current) setState({ kind: "error" })
      },
    )
    return () => {
      current = false
    }
  }, [signedIn])

  // Land on the playing channel when it is listed, otherwise the first entry or the close action.
  const streams = state.kind === "ready" ? state.streams : []
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (panel === null || panel.contains(document.activeElement)) return
    const target =
      panel.querySelector<HTMLElement>('[aria-current="true"]') ??
      panel.querySelector<HTMLElement>('[data-focusable="true"]')
    if (target === null) return
    markControllerFocus(target)
    target.focus()
  })

  useEffect(() => {
    const panel = panelRef.current
    if (panel === null || onPointerInside === undefined) return
    const enter = (): void => onPointerInside(true)
    const leave = (): void => onPointerInside(false)
    panel.addEventListener("mouseenter", enter)
    panel.addEventListener("mouseleave", leave)
    return () => {
      panel.removeEventListener("mouseenter", enter)
      panel.removeEventListener("mouseleave", leave)
    }
  }, [onPointerInside])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
      if (!panelRef.current?.contains(document.activeElement)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      onClose()
    }
    document.addEventListener("keydown", onKeyDown, true)
    return () => document.removeEventListener("keydown", onKeyDown, true)
  }, [onClose])

  const first = streams[0]
  const last = streams.at(-1)
  return (
    <section
      aria-label="Live channels you follow"
      className="live-panel"
      id="live-panel"
      ref={panelRef}
    >
      <header className="live-panel__heading">
        <strong>Live now</strong>
        <span className="live-panel__hint">Following · Down, Up or Back to close</span>
      </header>
      {!signedIn ? (
        <p className="live-panel__message">Sign in with Twitch to see the channels you follow.</p>
      ) : state.kind === "loading" ? (
        <p aria-busy="true" className="live-panel__message">
          Loading live channels…
        </p>
      ) : state.kind === "error" ? (
        <p className="live-panel__message" role="alert">
          Twitch could not list your followed channels right now.
        </p>
      ) : streams.length === 0 ? (
        <p className="live-panel__message">None of the channels you follow are live.</p>
      ) : (
        <ul className="live-panel__reel">
          {streams.map((stream, index) => (
            <li key={stream.id}>
              <button
                aria-current={stream.userLogin === currentChannel}
                className="live-panel__card"
                data-focus-down={cardId(stream)}
                data-focus-id={cardId(stream)}
                data-focus-left={cardId(streams[index - 1] ?? last ?? stream)}
                data-focus-right={cardId(streams[index + 1] ?? first ?? stream)}
                data-focus-up={cardId(stream)}
                data-focusable="true"
                onClick={() => onSelect(stream)}
                type="button"
              >
                <img alt="" decoding="async" loading="lazy" src={stream.thumbnailUrl} />
                <span className="live-panel__name">{stream.userName}</span>
                <span className="live-panel__meta">
                  {stream.category === "" ? "Live" : stream.category} ·{" "}
                  {viewers(stream.viewerCount)}
                </span>
                <span className="live-panel__title">{stream.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {streams.length === 0 ? (
        <button
          className="live-panel__close"
          data-focus-down="live-panel-close"
          data-focus-id="live-panel-close"
          data-focus-left="live-panel-close"
          data-focus-right="live-panel-close"
          data-focus-up="live-panel-close"
          data-focusable="true"
          onClick={onClose}
          type="button"
        >
          Close
        </button>
      ) : null}
    </section>
  )
}
