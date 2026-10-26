import {
  ArrowLeftIcon,
  BroadcastIcon,
  CornersInIcon,
  CornersOutIcon,
  FilmStripIcon,
  PauseIcon,
  PlayIcon,
  SpeakerHighIcon,
  SpeakerSimpleXIcon,
} from "@phosphor-icons/react"
import { cloneElement, useCallback, useEffect, useRef, useState } from "react"
import type { ChatLayout, StreamCard } from "../../../shared/contracts"
import type { ChatAppearance } from "../chat-appearance"
import { markControllerFocus, registerBackDismissal } from "../focus-navigation"
import {
  createTwitchPlayerOptions,
  loadTwitchPlayerApi,
  TWITCH_PLAYER_ENDED,
  type TwitchPlayerInstance,
} from "../twitch-player"
import { LivePanel } from "./LivePanel"
import { usePlayerCaptions } from "./usePlayerCaptions"
import { usePlayerChat } from "./usePlayerChat"
import { usePlayerQuality } from "./usePlayerQuality"
import { useVideoResume, type VideoProgress, type VideoSampleReason } from "./useVideoResume"

export type PlayerSource =
  | {
      readonly channel: string
      readonly kind: "live"
      readonly title: string
      readonly userId: string
    }
  | {
      readonly kind: "video"
      readonly title: string
      readonly userId: string
      readonly videoId: string
    }

/** Survives a channel switch from the live panel, so stream fullscreen carries over. */
export type FullscreenCarry = { immersive: boolean; restoreWindowed: boolean }

type PlayerViewProps = {
  readonly chatAppearance?: ChatAppearance
  readonly fullscreenCarry?: FullscreenCarry
  /** Switches to another live stream from the live panel; the panel is hidden when absent. */
  readonly onSwitchStream?: (stream: StreamCard) => void
  /** Whether a Twitch account is connected, for the live panel's followed channels. */
  readonly signedIn?: boolean
  /** Saved low-latency choice; undefined keeps Twitch's own default. */
  readonly lowLatency?: boolean
  readonly onBack: () => void
  readonly onChatLayoutChange?: (layout: ChatLayout) => void
  readonly onLowLatencyChange?: (enabled: boolean) => void
  readonly onPastBroadcasts: (userId: string) => void
  /** Remembers the quality the viewer picked, for new streams. */
  readonly onQualityChange?: (quality: string) => void
  readonly preferredQuality?: string
  /** Sets window fullscreen and resolves with the previous state. */
  readonly onSetFullscreen: (fullscreen: boolean) => Promise<boolean>
  readonly source: PlayerSource
}

// Dispatched into this document by main's player focus guard; see src/main/player-focus-guard.ts.
const PLAYER_ESCAPE_EVENT = "vacuumstream:player-escape"

const SEEK_ACTIONS = [
  { id: "player-seek-back-5m", label: "Back 5 minutes", seconds: -300 },
  { id: "player-seek-back-30s", label: "Back 30 seconds", seconds: -30 },
  { id: "player-seek-forward-30s", label: "Forward 30 seconds", seconds: 30 },
  { id: "player-seek-forward-5m", label: "Forward 5 minutes", seconds: 300 },
] as const

const FIRST_SEEK_ACTION = SEEK_ACTIONS[0]
const LAST_SEEK_ACTION = SEEK_ACTIONS.at(-1) ?? FIRST_SEEK_ACTION

const formatTime = (seconds: number | undefined, showHours: boolean): string => {
  if (seconds === undefined) return "--:--"
  const wholeSeconds = Math.floor(Math.max(0, seconds))
  const minutes = Math.floor(wholeSeconds / 60)
  const remainder = String(wholeSeconds % 60).padStart(2, "0")
  return showHours
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${remainder}`
    : `${minutes}:${remainder}`
}

export const PlayerView = ({
  chatAppearance,
  fullscreenCarry,
  onSwitchStream,
  signedIn = false,
  lowLatency,
  onBack,
  onChatLayoutChange,
  onLowLatencyChange,
  onPastBroadcasts,
  onQualityChange,
  onSetFullscreen,
  preferredQuality,
  source,
}: PlayerViewProps) => {
  const [frameState, setFrameState] = useState<"loading" | "offline" | "ready" | "startup-error">(
    "loading",
  )
  const [startupAttempt, setStartupAttempt] = useState(0)
  const startupAttemptRef = useRef(0)
  const [muted, setMuted] = useState(true)
  const [paused, setPaused] = useState(true)
  const [position, setPosition] = useState<number | undefined>(undefined)
  const [duration, setDuration] = useState<number | undefined>(undefined)
  const [seekTransportOpen, setSeekTransportOpen] = useState(false)
  // Stream fullscreen: the toolbar, submenus and chat hide so the video fills the window.
  const [immersive, setImmersive] = useState(fullscreenCarry?.immersive ?? false)
  const immersiveRef = useRef(fullscreenCarry?.immersive ?? false)
  const immersiveGenerationRef = useRef(0)
  const restoreWindowedRef = useRef(fullscreenCarry?.restoreWindowed ?? false)
  const syncCarry = (): void => {
    if (fullscreenCarry === undefined) return
    fullscreenCarry.immersive = immersiveRef.current
    fullscreenCarry.restoreWindowed = restoreWindowedRef.current
  }
  const [livePanelOpen, setLivePanelOpen] = useState(false)
  const livePanelOpenRef = useRef(false)
  const liveButtonRef = useRef<HTMLButtonElement>(null)
  const immersiveExitRef = useRef<HTMLButtonElement>(null)
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null)
  const autoStartGenerationRef = useRef(0)
  const autoStartTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const backButtonRef = useRef<HTMLButtonElement>(null)
  const seekButtonRef = useRef<HTMLButtonElement>(null)
  const playerRef = useRef<TwitchPlayerInstance | undefined>(undefined)
  const progressRef = useRef<VideoProgress | undefined>(undefined)
  const { beginProgress, canPlay, progressStatus, resumePrompt, startingPosition } = useVideoResume(
    source,
    onBack,
  )
  const {
    chatButton,
    chatEnterButton,
    chatHint,
    chatLayoutButton,
    chatPane,
    chatReloadButton,
    fullscreenLeft,
  } = usePlayerChat(source, backButtonRef, chatAppearance, onChatLayoutChange)

  // Low latency exists only for live streams. Twitch reports the mode; the saved choice is
  // re-applied once per stream, after playback starts and the player's controls exist.
  const [latencyMode, setLatencyMode] = useState<boolean | null | undefined>(undefined)
  const [latencyBusy, setLatencyBusy] = useState(false)
  const latencyRequested = useRef(false)
  const lowLatencyPreference = useRef(lowLatency)
  lowLatencyPreference.current = lowLatency
  const syncLowLatency = useCallback((request: boolean | null): void => {
    setLatencyBusy(true)
    void window.vacuumStream.system
      .setPlayerLowLatency(request)
      .then(
        (mode) => setLatencyMode(mode),
        () => setLatencyMode(null),
      )
      .finally(() => setLatencyBusy(false))
  }, [])
  const toggleLowLatency = (): void => {
    const next = !(latencyMode ?? lowLatency ?? false)
    onLowLatencyChange?.(next)
    syncLowLatency(next)
  }
  const { dismissQualityChooser, qualityButton, qualityChooser, refreshQualities, resetQualities } =
    usePlayerQuality(
      playerRef,
      frameState === "ready",
      source.kind === "live"
        ? { busy: latencyBusy, enabled: latencyMode, onToggle: toggleLowLatency }
        : undefined,
      { onChoose: (id) => onQualityChange?.(id), preferred: preferredQuality },
      onSwitchStream === undefined ? "player-back" : "player-following",
    )

  const { captionsButton, captionsChooser, dismissCaptionsChooser, resetCaptions } =
    usePlayerCaptions(playerRef, frameState === "ready")

  const dismissSeekTransport = useCallback((): boolean => {
    if (!seekTransportOpen) return false
    setSeekTransportOpen(false)
    const seekButton = seekButtonRef.current
    if (seekButton !== null) {
      markControllerFocus(seekButton)
      seekButton.focus()
    }
    return true
  }, [seekTransportOpen])

  const enterImmersive = (): void => {
    if (immersiveRef.current) return
    immersiveRef.current = true
    const generation = immersiveGenerationRef.current + 1
    immersiveGenerationRef.current = generation
    dismissQualityChooser()
    dismissCaptionsChooser()
    setSeekTransportOpen(false)
    setImmersive(true)
    syncCarry()
    void onSetFullscreen(true).then(
      (wasFullscreen) => {
        if (immersiveGenerationRef.current !== generation) return
        // Only undo a fullscreen this mode created; an app already fullscreen stays that way.
        restoreWindowedRef.current = !wasFullscreen
        if (!immersiveRef.current && !wasFullscreen) {
          restoreWindowedRef.current = false
          void onSetFullscreen(false).catch(() => undefined)
        }
        syncCarry()
      },
      () => undefined,
    )
  }

  const exitImmersive = useCallback((): boolean => {
    if (!immersiveRef.current) return false
    immersiveRef.current = false
    setImmersive(false)
    if (restoreWindowedRef.current) {
      restoreWindowedRef.current = false
      void onSetFullscreen(false).catch(() => undefined)
    }
    if (fullscreenCarry !== undefined) {
      fullscreenCarry.immersive = false
      fullscreenCarry.restoreWindowed = false
    }
    const fullscreenButton = fullscreenButtonRef.current
    if (fullscreenButton !== null) {
      markControllerFocus(fullscreenButton)
      fullscreenButton.focus()
    }
    return true
  }, [fullscreenCarry, onSetFullscreen])

  const openLivePanel = (): void => {
    if (onSwitchStream === undefined) return
    dismissQualityChooser()
    dismissCaptionsChooser()
    setSeekTransportOpen(false)
    livePanelOpenRef.current = true
    setLivePanelOpen(true)
  }
  const closeLivePanel = useCallback((): boolean => {
    if (!livePanelOpenRef.current) return false
    livePanelOpenRef.current = false
    setLivePanelOpen(false)
    const target = immersiveRef.current ? immersiveExitRef.current : liveButtonRef.current
    if (target !== null) {
      markControllerFocus(target)
      target.focus()
    }
    return true
  }, [])
  const switchStream = (stream: StreamCard): void => {
    if (source.kind === "live" && stream.userLogin === source.channel) {
      closeLivePanel()
      return
    }
    livePanelOpenRef.current = false
    setLivePanelOpen(false)
    syncCarry()
    onSwitchStream?.(stream)
  }

  // Stream fullscreen: Down opens the live panel along the bottom edge. OK, A and Space reach the
  // fullscreen surface as a click (play/pause); Back is handled by the dismissal stack.
  useEffect(() => {
    if (!immersive || livePanelOpen || onSwitchStream === undefined) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "ArrowDown" || document.activeElement !== immersiveExitRef.current) return
      event.preventDefault()
      event.stopImmediatePropagation()
      livePanelOpenRef.current = true
      setLivePanelOpen(true)
    }
    document.addEventListener("keydown", onKeyDown, true)
    return () => document.removeEventListener("keydown", onKeyDown, true)
  }, [immersive, livePanelOpen, onSwitchStream])

  // Main reports Escape pressed while the Twitch iframe holds keyboard focus (after a click on
  // the video). Take focus back: leave stream fullscreen, or return to the toolbar.
  useEffect(() => {
    const onPlayerEscape = (): void => {
      if (exitImmersive()) return
      const back = backButtonRef.current
      if (back === null) return
      markControllerFocus(back)
      back.focus()
    }
    document.addEventListener(PLAYER_ESCAPE_EVENT, onPlayerEscape)
    return () => document.removeEventListener(PLAYER_ESCAPE_EVENT, onPlayerEscape)
  }, [exitImmersive])

  useEffect(() => {
    if (!immersive) return
    // Keep keyboard and controller input in the shell, not inside the Twitch iframe.
    const exitButton = immersiveExitRef.current
    if (exitButton !== null) {
      markControllerFocus(exitButton)
      exitButton.focus()
    }
  }, [immersive])

  // Back closes the submenu the viewer is in, or the first one still open, before leaving.
  const dismissSubmenu = useCallback((): boolean => {
    if (closeLivePanel()) return true
    if (exitImmersive()) return true
    const focused = document.activeElement
    const submenus = [
      { dismiss: dismissQualityChooser, id: "player-quality-chooser" },
      { dismiss: dismissCaptionsChooser, id: "player-captions-chooser" },
      { dismiss: dismissSeekTransport, id: "player-seek-transport" },
    ]
    const focusedSubmenu = submenus.find(
      ({ id }) => focused instanceof Element && focused.closest(`#${id}`) !== null,
    )
    return focusedSubmenu === undefined
      ? submenus.some(({ dismiss }) => dismiss())
      : focusedSubmenu.dismiss()
  }, [
    closeLivePanel,
    dismissCaptionsChooser,
    dismissQualityChooser,
    dismissSeekTransport,
    exitImmersive,
  ])

  useEffect(() => registerBackDismissal(dismissSubmenu), [dismissSubmenu])

  const cancelAutoStart = useCallback((): void => {
    autoStartGenerationRef.current += 1
    if (autoStartTimerRef.current !== undefined) {
      clearTimeout(autoStartTimerRef.current)
      autoStartTimerRef.current = undefined
    }
  }, [])

  useEffect(() => {
    if (canPlay) backButtonRef.current?.focus()
  }, [canPlay])
  useEffect(() => {
    if (frameState !== "ready") return undefined
    // Ads and Twitch's own controls change playback without always emitting PLAY or PAUSE, so the
    // toolbar would keep offering the action the viewer already has. Resync when they reach for it.
    const resync = (): void => {
      const player = playerRef.current
      if (player === undefined) return
      setPaused(player.isPaused())
      setMuted(player.getMuted())
    }
    document.addEventListener("keydown", resync)
    return () => document.removeEventListener("keydown", resync)
  }, [frameState])
  useEffect(() => {
    let active = true
    let initialized = false
    let offline = false
    let timelineTimer: ReturnType<typeof setInterval> | undefined
    setFrameState("loading")
    latencyRequested.current = false
    setLatencyMode(undefined)
    setPosition(undefined)
    setDuration(undefined)
    resetQualities()
    resetCaptions()
    setSeekTransportOpen(false)
    if (!canPlay) return
    const progress =
      source.kind === "video" ? beginProgress(source, startingPosition, () => active) : undefined
    progressRef.current = progress
    const autoStartGeneration = autoStartGenerationRef.current + 1
    autoStartGenerationRef.current = autoStartGeneration
    let autoStartDeadline = 0
    let autoStartStarted = false
    let player: TwitchPlayerInstance | undefined
    const refreshTimeline = (reason: VideoSampleReason = "sample"): void => {
      // User intent cancels autoplay, not sampling; the mounted player owns this lifecycle.
      if (!active || !initialized || offline || source.kind !== "video" || player === undefined)
        return
      const currentTime = player.getCurrentTime()
      const totalTime = player.getDuration()
      setPosition(Number.isFinite(currentTime) ? currentTime : undefined)
      setDuration(Number.isFinite(totalTime) && totalTime > 0 ? totalTime : undefined)
      progress?.observe(currentTime, totalTime, reason)
    }
    const attemptAutoStart = (): void => {
      void window.vacuumStream.system.activateEmbeddedPlayer(true).then((playbackStarted) => {
        if (
          !active ||
          autoStartGenerationRef.current !== autoStartGeneration ||
          player === undefined
        ) {
          return
        }
        if (playbackStarted) {
          player.setMuted(false)
          // Twitch's embed starts at half volume; a TV app should match the rest of the system.
          player.setVolume(1)
          setMuted(false)
          setPaused(false)
          return
        }
        if (Date.now() >= autoStartDeadline) {
          setPaused(true)
          return
        }
        autoStartTimerRef.current = setTimeout(attemptAutoStart, 500)
      })
    }
    void loadTwitchPlayerApi()
      .then((api) => {
        if (!active || startupAttemptRef.current !== startupAttempt) return
        player = new api.Player(
          "twitch-player-root",
          createTwitchPlayerOptions(source, startingPosition),
        )
        playerRef.current = player
        player.addEventListener(api.Player.READY, () => {
          if (!active || player === undefined) return
          initialized = true
          // Initialization cannot override an observed live outage; only ONLINE can.
          if (source.kind === "live" && offline) return
          offline = false
          setFrameState("ready")
          refreshQualities(player)
          if (source.kind === "video") {
            refreshTimeline("ready")
            if (timelineTimer === undefined) {
              timelineTimer = setInterval(refreshTimeline, 1000)
            }
          }
          setMuted(player.getMuted())
          setPaused(player.isPaused())
          if (!autoStartStarted) {
            autoStartStarted = true
            autoStartDeadline = Date.now() + 20_000
            attemptAutoStart()
          }
        })
        player.addEventListener(api.Player.PLAYING, () => {
          if (!active || !initialized || offline || player === undefined) return
          setPaused(false)
          refreshQualities(player)
          refreshTimeline("playing")
          if (source.kind === "live" && !latencyRequested.current) {
            latencyRequested.current = true
            syncLowLatency(lowLatencyPreference.current ?? null)
          }
        })
        if (source.kind === "video") {
          player.addEventListener(api.Player.SEEK, () => refreshTimeline("seek"))
          player.addEventListener(TWITCH_PLAYER_ENDED, () => {
            if (active) progress?.end()
          })
        }
        player.addEventListener(api.Player.PLAY, () => {
          if (active) setPaused(false)
        })
        player.addEventListener(api.Player.PAUSE, () => {
          if (!active) return
          setPaused(true)
          refreshTimeline("pause")
        })
        player.addEventListener(api.Player.PLAYBACK_BLOCKED, () => {
          if (active) setPaused(true)
        })
        player.addEventListener(api.Player.ONLINE, () => {
          if (!active || source.kind !== "live" || player === undefined) return
          offline = false
          setFrameState(initialized ? "ready" : "loading")
          if (!initialized) return
          // Availability is not playback: refresh the shell without reactivating media.
          setMuted(player.getMuted())
          setPaused(player.isPaused())
          refreshQualities(player)
        })
        player.addEventListener(api.Player.OFFLINE, () => {
          if (!active) return
          offline = true
          clearInterval(timelineTimer)
          timelineTimer = undefined
          setFrameState("offline")
          resetQualities(false)
        })
      })
      .catch(() => {
        if (!active || startupAttemptRef.current !== startupAttempt) return
        setFrameState("startup-error")
      })
    return () => {
      progress?.leave()
      active = false
      resetCaptions()
      progressRef.current = undefined
      clearInterval(timelineTimer)
      cancelAutoStart()
      player?.pause()
      playerRef.current = undefined
      document.querySelector("#twitch-player-root")?.replaceChildren()
    }
  }, [
    source,
    startupAttempt,
    canPlay,
    startingPosition,
    beginProgress,
    cancelAutoStart,
    refreshQualities,
    resetCaptions,
    resetQualities,
    syncLowLatency,
  ])

  const retryStartup = (): void => {
    if (frameState !== "startup-error" || startupAttemptRef.current !== startupAttempt) return
    // Lock synchronously, before React commits the pending state.
    startupAttemptRef.current += 1
    if (backButtonRef.current !== null) {
      markControllerFocus(backButtonRef.current)
      backButtonRef.current.focus()
    }
    setFrameState("loading")
    setStartupAttempt(startupAttemptRef.current)
  }

  const togglePlayback = (): void => {
    cancelAutoStart()
    const player = playerRef.current
    if (player === undefined) return
    // Twitch pauses for ads without always emitting PAUSE, so the player's own state decides.
    if (player.isPaused()) {
      void window.vacuumStream.system.activateEmbeddedPlayer(false).then((playbackStarted) => {
        setMuted(player.getMuted())
        if (playbackStarted) setPaused(false)
      })
    } else {
      player.pause()
    }
  }

  const toggleMuted = (): void => {
    cancelAutoStart()
    const player = playerRef.current
    if (player === undefined) return
    const nextMuted = !player.getMuted()
    player.setMuted(nextMuted)
    setMuted(nextMuted)
  }

  const seekRelative = (seconds: number): void => {
    cancelAutoStart()
    const player = playerRef.current
    if (source.kind !== "video" || frameState !== "ready" || player === undefined) return
    const currentTime = player.getCurrentTime()
    const totalTime = player.getDuration()
    if (!Number.isFinite(currentTime) || !Number.isFinite(totalTime) || totalTime <= 0) return
    const destination = Math.min(totalTime, Math.max(0, currentTime + seconds))
    progressRef.current?.requestSeek(destination)
    player.seek(destination)
  }

  // Following sits beside Back, apart from the playback controls; it then leads into them.
  const toolbarStartId = onSwitchStream === undefined ? "player-back" : "player-following"
  const firstControlId =
    frameState === "startup-error"
      ? "player-retry"
      : frameState === "ready"
        ? "player-playback"
        : "player-quality"
  // The control after the chat/VOD group: the Live button when present, else fullscreen.
  const afterToolbarId = "player-fullscreen"
  const showHours = duration !== undefined && duration >= 3600
  const unknownBroadcaster = source.kind === "video" && source.userId === "0"
  const seekTransportUsable =
    source.kind === "video" && frameState === "ready" && duration !== undefined
  const captionsRight = unknownBroadcaster
    ? seekTransportUsable
      ? "player-seek"
      : afterToolbarId
    : "player-vods"
  const vodsRight =
    source.kind === "live" ? "player-chat" : seekTransportUsable ? "player-seek" : afterToolbarId
  const seekLeft = unknownBroadcaster ? "player-captions" : "player-vods"
  const toolbarFullscreenLeft =
    source.kind === "video" ? (seekTransportUsable ? "player-seek" : seekLeft) : fullscreenLeft

  if (resumePrompt !== null) {
    return <main className="player-view player-view--resume">{resumePrompt}</main>
  }

  return (
    <main
      className={[
        "player-view",
        source.kind === "video" && seekTransportOpen ? "player-view--video" : undefined,
        immersive ? "player-view--immersive" : undefined,
      ]
        .filter((name) => name !== undefined)
        .join(" ")}
    >
      {immersive ? (
        <button
          aria-label={paused ? "Play" : "Pause"}
          aria-describedby="player-immersive-hint"
          className="player-immersive-exit"
          data-focus-down="player-immersive-exit"
          data-focus-id="player-immersive-exit"
          data-focus-left="player-immersive-exit"
          data-focus-right="player-immersive-exit"
          data-focus-up="player-immersive-exit"
          data-focusable="true"
          // OK, A, Space and a click toggle playback; a double click leaves like Back does.
          onClick={togglePlayback}
          onDoubleClick={exitImmersive}
          ref={immersiveExitRef}
          type="button"
        >
          <span className="player-immersive-exit__hint" id="player-immersive-hint">
            <CornersInIcon aria-hidden="true" />
            OK / A / Space: play or pause ·{" "}
            {onSwitchStream === undefined ? "" : "Down: live channels · "}Back: controls
          </span>
          {paused && frameState === "ready" ? (
            <span aria-hidden="true" className="player-immersive-exit__paused">
              <PauseIcon weight="fill" />
            </span>
          ) : null}
        </button>
      ) : null}
      <header className="player-toolbar">
        <button
          data-focus-down={
            source.kind === "video"
              ? seekTransportOpen
                ? "player-seek-back-5m"
                : "player-back"
              : undefined
          }
          data-focus-id="player-back"
          data-focus-left="player-fullscreen"
          data-focus-right={onSwitchStream === undefined ? firstControlId : "player-following"}
          data-focusable="true"
          onClick={onBack}
          ref={backButtonRef}
          type="button"
        >
          <ArrowLeftIcon aria-hidden="true" />
          Back
        </button>
        {onSwitchStream === undefined ? null : (
          <button
            aria-controls={livePanelOpen ? "live-panel" : undefined}
            aria-expanded={livePanelOpen}
            className="player-following"
            data-focus-id="player-following"
            data-focus-left="player-back"
            data-focus-right={firstControlId}
            data-focus-up="player-back"
            data-focusable="true"
            onClick={() => (livePanelOpen ? closeLivePanel() : openLivePanel())}
            ref={liveButtonRef}
            type="button"
          >
            <BroadcastIcon aria-hidden="true" />
            Following
          </button>
        )}
        {frameState === "startup-error" ? (
          <button
            className="player-retry"
            data-focus-down="player-back"
            data-focus-id="player-retry"
            data-focus-left={toolbarStartId}
            data-focus-right="player-quality"
            data-focus-up="player-back"
            data-focusable="true"
            onClick={retryStartup}
            type="button"
          >
            Retry loading player
          </button>
        ) : null}
        <div>
          <strong>{source.title}</strong>
          <span>{source.kind === "live" ? "Live on Twitch" : "Past broadcast"}</span>
        </div>
        <button
          aria-label={paused ? "Play" : "Pause"}
          data-focus-id="player-playback"
          data-focus-left={toolbarStartId}
          data-focus-right="player-muted"
          data-focusable="true"
          disabled={frameState !== "ready"}
          onClick={togglePlayback}
          type="button"
        >
          {paused ? <PlayIcon aria-hidden="true" /> : <PauseIcon aria-hidden="true" />}
        </button>
        <button
          aria-label={muted ? "Unmute" : "Mute"}
          data-focus-id="player-muted"
          data-focus-left="player-playback"
          data-focus-right="player-quality"
          data-focusable="true"
          disabled={frameState !== "ready"}
          onClick={toggleMuted}
          type="button"
        >
          {muted ? (
            <SpeakerSimpleXIcon aria-hidden="true" data-icon-state="muted" />
          ) : (
            <SpeakerHighIcon aria-hidden="true" data-icon-state="audible" />
          )}
        </button>
        {frameState === "startup-error"
          ? cloneElement(qualityButton, { "data-focus-left": "player-retry" })
          : qualityButton}
        {unknownBroadcaster
          ? cloneElement(captionsButton, { "data-focus-right": captionsRight })
          : captionsButton}
        <button
          data-focus-id="player-vods"
          data-focus-left="player-captions"
          data-focus-right={vodsRight}
          data-focusable="true"
          disabled={unknownBroadcaster}
          onClick={() => onPastBroadcasts(source.userId)}
          type="button"
        >
          <FilmStripIcon aria-hidden="true" />
          Past broadcasts
        </button>
        {source.kind === "video" ? (
          <button
            aria-controls={seekTransportOpen ? "player-seek-transport" : undefined}
            aria-expanded={seekTransportOpen}
            data-focus-down={seekTransportOpen ? "player-seek-back-5m" : "player-seek"}
            data-focus-id="player-seek"
            data-focus-left={seekLeft}
            data-focus-right={afterToolbarId}
            data-focus-up="player-back"
            data-focusable="true"
            disabled={!seekTransportUsable}
            onClick={() => setSeekTransportOpen((open) => !open)}
            ref={seekButtonRef}
            type="button"
          >
            Seek
          </button>
        ) : null}
        {chatButton}
        {chatEnterButton}
        {chatReloadButton}
        {chatLayoutButton}
        <button
          aria-label="Fullscreen stream"
          data-focus-id="player-fullscreen"
          data-focus-left={toolbarFullscreenLeft}
          data-focus-right="player-back"
          data-focusable="true"
          onClick={enterImmersive}
          ref={fullscreenButtonRef}
          type="button"
        >
          <CornersOutIcon aria-hidden="true" />
        </button>
      </header>
      {source.kind === "video" && seekTransportOpen ? (
        <section
          aria-label="Past broadcast seeking"
          className="player-transport"
          id="player-seek-transport"
        >
          {SEEK_ACTIONS.map((action, index) => (
            <button
              data-focus-down="player-back"
              data-focus-id={action.id}
              data-focus-left={SEEK_ACTIONS[index - 1]?.id ?? LAST_SEEK_ACTION.id}
              data-focus-right={SEEK_ACTIONS[index + 1]?.id ?? FIRST_SEEK_ACTION.id}
              data-focus-up="player-back"
              data-focusable="true"
              disabled={!seekTransportUsable}
              key={action.id}
              onClick={() => seekRelative(action.seconds)}
              type="button"
            >
              {action.label}
            </button>
          ))}
          <output aria-label="Playback position" aria-live="off" className="player-transport__time">
            {formatTime(position, showHours)} / {formatTime(duration, showHours)}
          </output>
        </section>
      ) : null}
      {progressStatus}
      {qualityChooser}
      {captionsChooser}
      {chatHint}
      {frameState === "startup-error" || frameState === "offline" ? (
        <p className="player-load-status" role="alert">
          {frameState === "startup-error"
            ? "Twitch player could not be loaded. Check your connection, then retry loading player."
            : "This Twitch source is offline. You can wait or go Back to choose another broadcast."}
        </p>
      ) : null}
      <div className="player-stage">
        <div aria-busy={frameState === "loading"} className="player-frame">
          <div className="twitch-player-root" id="twitch-player-root" />
        </div>
        {chatPane}
        {livePanelOpen && onSwitchStream !== undefined ? (
          <LivePanel
            currentChannel={source.kind === "live" ? source.channel : undefined}
            onClose={closeLivePanel}
            onSelect={switchStream}
            signedIn={signedIn}
          />
        ) : null}
      </div>
    </main>
  )
}
