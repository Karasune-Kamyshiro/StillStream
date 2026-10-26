import { type RefObject, useCallback, useLayoutEffect, useRef, useState } from "react"
import { markControllerFocus } from "../focus-navigation"
import {
  normalizeTwitchQualities,
  preferredQualityId,
  type TwitchPlayerInstance,
  type TwitchQuality,
} from "../twitch-player"

const optionFocusId = (id: string): string => `player-quality-option-${id}`
const focusControl = (element: HTMLButtonElement | null): void => {
  if (element === null) return
  markControllerFocus(element)
  element.focus()
}

export type LowLatencyControl = {
  readonly busy: boolean
  /** True/false as reported by Twitch, null when unsupported, undefined while unknown. */
  readonly enabled: boolean | null | undefined
  readonly onToggle: () => void
}

const LOW_LATENCY_ID = "player-quality-low-latency"

export type QualityPreference = {
  /** Saved quality id, requested once per stream as soon as Twitch reports it. */
  readonly preferred: string | undefined
  readonly onChoose: (id: string) => void
}

export const usePlayerQuality = (
  playerRef: RefObject<TwitchPlayerInstance | undefined>,
  ready: boolean,
  lowLatency?: LowLatencyControl,
  preference?: QualityPreference,
) => {
  const preferenceRef = useRef(preference)
  preferenceRef.current = preference
  const preferenceApplied = useRef(false)
  const [open, setOpen] = useState(false)
  const [qualities, setQualities] = useState<readonly TwitchQuality[]>([])
  const [requested, setRequested] = useState<TwitchQuality | undefined>(undefined)
  const [reported, setReported] = useState<string | undefined>(undefined)
  const [error, setError] = useState("")
  const buttonRef = useRef<HTMLButtonElement>(null)
  const chooserRef = useRef<HTMLElement>(null)
  const focusOnOpen = useRef(false)

  const refreshQualities = useCallback((player: TwitchPlayerInstance): readonly TwitchQuality[] => {
    try {
      const next = normalizeTwitchQualities(player.getQualities())
      const current = player.getQuality()
      const preferred = preferenceRef.current?.preferred
      if (!preferenceApplied.current && preferred !== undefined && next.length > 0) {
        preferenceApplied.current = true
        const target = preferred === "auto" ? undefined : preferredQualityId(preferred, next)
        if (target !== undefined && target !== current) {
          player.setQuality(target)
          setRequested(next.find((quality) => quality.id === target))
        }
      }
      setQualities(next)
      setReported(current)
      setError("")
      return next
    } catch {
      setQualities([])
      setReported(undefined)
      setError("Twitch could not report playback qualities.")
      return []
    }
  }, [])

  const resetQualities = useCallback((close = true): void => {
    if (close) preferenceApplied.current = false
    setQualities([])
    setRequested(undefined)
    setReported(undefined)
    setError("")
    if (close) {
      if (chooserRef.current?.contains(document.activeElement)) focusControl(buttonRef.current)
      focusOnOpen.current = false
      setOpen(false)
    }
  }, [])

  useLayoutEffect(() => {
    // Recover shell focus when a refreshed list removes the focused option.
    if (open && (focusOnOpen.current || document.activeElement === document.body)) {
      focusControl(
        chooserRef.current?.querySelector<HTMLButtonElement>(
          "button:not(.player-quality__latency)",
        ) ?? null,
      )
      focusOnOpen.current = false
    }
  })

  const openChooser = (): void => {
    if (ready && playerRef.current !== undefined) refreshQualities(playerRef.current)
    if (open) {
      focusControl(
        chooserRef.current?.querySelector<HTMLButtonElement>(
          "button:not(.player-quality__latency)",
        ) ?? null,
      )
    } else {
      focusOnOpen.current = true
      setOpen(true)
    }
  }
  const closeChooser = (): void => {
    setOpen(false)
    focusControl(buttonRef.current)
  }
  const dismissChooser = useCallback((): boolean => {
    if (!open) return false
    setOpen(false)
    focusControl(buttonRef.current)
    return true
  }, [open])
  const selectQuality = (id: string): void => {
    const player = playerRef.current
    if (!ready || player === undefined) return
    const quality = refreshQualities(player).find((entry) => entry.id === id)
    if (quality === undefined) return
    try {
      player.setQuality(quality.id)
      // A request is not confirmation; Auto's reported quality is its effective resolution.
      setRequested(quality)
      preferenceRef.current?.onChoose(quality.id)
    } catch {
      setError("Twitch could not accept the quality request. Try again.")
    }
  }

  const firstId =
    qualities[0] === undefined ? "player-quality-close" : optionFocusId(qualities[0].id)
  const lastQuality = qualities.at(-1)
  // Row order: qualities, Close, then Low latency (live only), wrapping around. Opening the
  // chooser still lands on the first quality (or Close), never on the latency switch.
  const wrapId = lowLatency === undefined ? "player-quality-close" : LOW_LATENCY_ID

  return {
    qualityButton: (
      <button
        aria-controls={open ? "player-quality-chooser" : undefined}
        aria-expanded={open}
        data-focus-down={open ? firstId : "player-quality"}
        data-focus-id="player-quality"
        data-focus-left={ready ? "player-muted" : "player-back"}
        data-focus-right="player-captions"
        data-focus-up="player-back"
        data-focusable="true"
        data-player-quality={reported}
        data-requested-quality={requested?.id}
        onClick={openChooser}
        ref={buttonRef}
        type="button"
      >
        Quality
      </button>
    ),
    qualityChooser: open ? (
      <section
        aria-label="Playback quality"
        className="player-quality"
        id="player-quality-chooser"
        ref={chooserRef}
      >
        <p aria-live="polite" className="player-quality__status">
          {error !== ""
            ? error
            : qualities.length === 0
              ? "Twitch has not supplied quality options for this source."
              : requested === undefined
                ? "Choose a quality reported by Twitch."
                : `Requested: ${requested.label}. Twitch may take time to apply the change.`}
        </p>
        <div className="player-quality__options">
          {qualities.map((quality, index) => (
            <button
              aria-pressed={requested?.id === quality.id}
              data-focus-down="player-quality-close"
              data-focus-id={optionFocusId(quality.id)}
              data-focus-left={
                index === 0 ? wrapId : optionFocusId(qualities[index - 1]?.id ?? quality.id)
              }
              data-focus-right={
                index === qualities.length - 1
                  ? "player-quality-close"
                  : optionFocusId(qualities[index + 1]?.id ?? quality.id)
              }
              data-focus-up="player-quality"
              data-focusable="true"
              key={quality.id}
              onClick={() => selectQuality(quality.id)}
              type="button"
            >
              {quality.label}
            </button>
          ))}
        </div>
        <button
          data-focus-down="player-quality"
          data-focus-id="player-quality-close"
          data-focus-left={
            lastQuality === undefined ? "player-quality" : optionFocusId(lastQuality.id)
          }
          data-focus-right={lowLatency === undefined ? firstId : LOW_LATENCY_ID}
          data-focus-up="player-quality"
          data-focusable="true"
          onClick={closeChooser}
          type="button"
        >
          Close
        </button>
        {lowLatency === undefined ? null : (
          <button
            aria-busy={lowLatency.busy}
            aria-checked={lowLatency.enabled === true}
            aria-disabled={lowLatency.busy || lowLatency.enabled === null}
            className="player-quality__latency"
            data-focus-down="player-quality-close"
            data-focus-id={LOW_LATENCY_ID}
            data-focus-left="player-quality-close"
            data-focus-right={firstId}
            data-focus-up="player-quality"
            data-focusable="true"
            onClick={() => {
              if (!lowLatency.busy && lowLatency.enabled !== null) lowLatency.onToggle()
            }}
            role="switch"
            title={
              lowLatency.enabled === null
                ? "Twitch's player does not offer low latency control for this stream"
                : undefined
            }
            type="button"
          >
            Low latency:{" "}
            {lowLatency.enabled === null
              ? "unavailable"
              : lowLatency.enabled === undefined
                ? "…"
                : lowLatency.enabled
                  ? "On"
                  : "Off"}
          </button>
        )}
      </section>
    ) : null,
    dismissQualityChooser: dismissChooser,
    refreshQualities,
    resetQualities,
  }
}
