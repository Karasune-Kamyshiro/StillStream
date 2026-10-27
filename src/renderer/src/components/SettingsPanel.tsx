import {
  CheckCircleIcon,
  CheckIcon,
  CopyIcon,
  DeviceMobileIcon,
  MonitorPlayIcon,
  SignInIcon,
  SignOutIcon,
} from "@phosphor-icons/react"
import { QRCodeSVG } from "qrcode.react"
import { type ComponentProps, useEffect, useRef, useState } from "react"
import type {
  AuthSnapshot,
  ChatOverlayOpacity,
  ChatOverlayPosition,
  ChatOverlaySize,
  ChatTextSize,
  PlayerSessionSnapshot,
  PreferencesUpdate,
  SettingsSnapshot,
  StartScreen,
} from "../../../shared/contracts"
import {
  CHAT_OVERLAY_LABELS,
  type ChatAppearance,
  DEFAULT_CHAT_APPEARANCE,
  nextOption,
} from "../chat-appearance"
import { registerBackDismissal } from "../focus-navigation"

type SettingsPanelProps = {
  readonly auth: AuthSnapshot
  readonly chatAppearance?: ChatAppearance
  /** Saves chat preferences; the Chat card is hidden when absent. */
  readonly onChatPreferencesChange?: (update: PreferencesUpdate) => Promise<void>
  readonly onAccountRequest: () => () => boolean
  readonly onAuthChange: (auth: AuthSnapshot) => void
  readonly onSettingsChange: (settings: SettingsSnapshot, resetAuth: boolean) => void
  /** Saves the start-screen preference; the card is hidden when absent. */
  readonly onStartScreenChange?: (startScreen: StartScreen) => Promise<void>
  readonly settings: SettingsSnapshot
  readonly startScreen?: StartScreen
  readonly startFullscreen?: boolean
  /** Saves the stream fullscreen preference; the switch is hidden when absent. */
  readonly onStartFullscreenChange?: (startFullscreen: boolean) => Promise<void>
}

type SubmitHandler = NonNullable<ComponentProps<"form">["onSubmit"]>

export const settingsAccountFocusId = (auth: AuthSnapshot): string =>
  auth.kind === "authenticated"
    ? "settings-logout"
    : auth.kind === "authorizing"
      ? "settings-open-activation"
      : "settings-sign-in"

export const settingsSecondaryFocusId = (
  auth: AuthSnapshot,
  playerSession: PlayerSessionSnapshot | undefined,
): string | undefined =>
  auth.kind === "guest" || auth.kind === "error"
    ? "settings-sign-in-device"
    : auth.kind === "authenticated" && playerSession?.signedIn === false
      ? "settings-player-session"
      : undefined

const errorMessage = (error: unknown): string =>
  error instanceof Error && error.message.includes("id.twitch.tv")
    ? "Twitch could not start device sign-in. Check the Client ID and network connection"
    : error instanceof Error
      ? error.message
      : "An unexpected error occurred"

/**
 * An on/off option. A button rather than a checkbox: TV remotes send Enter for OK, which never
 * toggles a checkbox (only Space does). Buttons activate on Enter, Space and a controller A.
 */
const SettingsSwitch = ({
  checked,
  focusDown,
  focusId,
  focusUp,
  label,
  onChange,
}: {
  readonly checked: boolean
  readonly focusDown?: string | undefined
  readonly focusId: string
  readonly focusUp: string
  readonly label: string
  readonly onChange: (checked: boolean) => Promise<void>
}) => {
  const [busy, setBusy] = useState(false)
  return (
    <button
      aria-busy={busy}
      aria-checked={checked}
      aria-disabled={busy}
      className="settings-toggle"
      {...(focusDown === undefined ? {} : { "data-focus-down": focusDown })}
      data-focus-id={focusId}
      data-focus-left="nav-settings"
      data-focus-up={focusUp}
      data-focusable="true"
      onClick={() => {
        // aria-disabled keeps controller focus while saving; ignore presses meanwhile.
        if (busy) return
        setBusy(true)
        void onChange(!checked).finally(() => setBusy(false))
      }}
      role="switch"
      type="button"
    >
      <span aria-hidden="true" className="settings-toggle__box">
        {checked ? <CheckIcon weight="bold" /> : null}
      </span>
      {label}
    </button>
  )
}

/** A value that steps to its next choice on every press (OK, Space, A), wrapping around. */
const SettingsCycle = ({
  focusDown,
  focusId,
  focusUp,
  label,
  onNext,
  value,
}: {
  readonly focusDown?: string | undefined
  readonly focusId: string
  readonly focusUp: string
  readonly label: string
  readonly onNext: () => Promise<void>
  readonly value: string
}) => {
  const [busy, setBusy] = useState(false)
  return (
    <button
      aria-busy={busy}
      aria-disabled={busy}
      className="settings-cycle"
      {...(focusDown === undefined ? {} : { "data-focus-down": focusDown })}
      data-focus-id={focusId}
      data-focus-left="nav-settings"
      data-focus-up={focusUp}
      data-focusable="true"
      onClick={() => {
        if (busy) return
        setBusy(true)
        void onNext().finally(() => setBusy(false))
      }}
      type="button"
    >
      <span>{label}</span>
      <strong>{value}</strong>
    </button>
  )
}

export const SettingsPanel = ({
  auth,
  chatAppearance = DEFAULT_CHAT_APPEARANCE,
  onChatPreferencesChange,
  onAccountRequest,
  onAuthChange,
  onSettingsChange,
  onStartScreenChange,
  settings,
  startScreen = "home",
  startFullscreen = true,
  onStartFullscreenChange,
}: SettingsPanelProps) => {
  // The last option of the Start screen card, which the Chat card continues below.
  const startCardLastId =
    onStartFullscreenChange === undefined ? "settings-start-following" : "settings-start-fullscreen"
  const [clientId, setClientId] = useState(settings.clientId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const pending = useRef(false)
  const accountFocusId = settingsAccountFocusId(auth)
  const needsClientId = (auth.kind === "guest" || auth.kind === "error") && settings.clientId === ""
  const AccountIcon =
    auth.kind === "authenticated"
      ? SignOutIcon
      : auth.kind === "authorizing"
        ? CopyIcon
        : SignInIcon

  useEffect(() => setClientId(settings.clientId), [settings.clientId])

  const [playerSession, setPlayerSession] = useState<PlayerSessionSnapshot | undefined>(undefined)
  const secondaryFocusId = settingsSecondaryFocusId(auth, playerSession)
  const belowAccountId = secondaryFocusId ?? "settings-client-id"
  const primaryRef = useRef<HTMLButtonElement>(null)
  // While Twitch's sign-in is open (possibly as a layer over this screen in Steam Game Mode),
  // Back belongs to it: the same B press closes the layer and must not also leave Settings.
  const [setupOpen, setSetupOpen] = useState(false)
  useEffect(() => (setupOpen ? registerBackDismissal(() => true) : undefined), [setupOpen])
  const secondaryFocused = useRef(false)
  // A secondary action can vanish under the controller (code shown, player signed in);
  // hand focus to the account button instead of dropping it on the page.
  useEffect(() => {
    if (secondaryFocusId !== undefined || !secondaryFocused.current) return
    secondaryFocused.current = false
    primaryRef.current?.focus()
  }, [secondaryFocusId])

  useEffect(() => {
    let current = true
    void window.vacuumStream.playerSession.snapshot().then(
      (snapshot) => {
        if (current) setPlayerSession(snapshot)
      },
      () => {
        if (current) setPlayerSession({ signedIn: false })
      },
    )
    return () => {
      current = false
    }
  }, [])

  const save: SubmitHandler = async (event) => {
    event.preventDefault()
    if (pending.current) return
    if (!/^[a-z0-9]{20,64}$/.test(clientId.trim())) {
      setError("Client IDs use 20–64 lowercase letters and numbers")
      return
    }
    pending.current = true
    const isCurrent = onAccountRequest()
    setBusy(true)
    setError("")
    try {
      const nextSettings = await window.vacuumStream.settings.saveClientId(clientId)
      if (isCurrent()) onSettingsChange(nextSettings, nextSettings.clientId !== settings.clientId)
    } catch (caught) {
      if (isCurrent()) setError(errorMessage(caught))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  // Opens Twitch once: login (skipped when the player already has a session), then the
  // prefilled device activation, so both sign-ins finish with a single confirmation.
  const runSetup = async (isCurrent: () => boolean): Promise<void> => {
    setSetupOpen(true)
    try {
      const result = await window.vacuumStream.auth.setup()
      if (!isCurrent()) return
      onAuthChange(result.auth)
      setPlayerSession(result.player)
    } finally {
      setSetupOpen(false)
    }
  }

  // Secondary actions: the code-on-another-device fallback, or finishing the player sign-in.
  const activateSecondary = async (): Promise<void> => {
    if (pending.current || needsClientId) return
    pending.current = true
    const isCurrent = onAccountRequest()
    setBusy(true)
    setError("")
    try {
      if (auth.kind === "authenticated") {
        await runSetup(isCurrent)
      } else {
        const challenge = await window.vacuumStream.auth.begin()
        if (isCurrent()) onAuthChange({ challenge, kind: "authorizing" })
      }
    } catch (caught) {
      if (isCurrent()) setError(errorMessage(caught))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  const activateAccount = async (): Promise<void> => {
    // aria-disabled keeps controller focus; the ref also blocks clicks before React commits.
    if (pending.current || needsClientId) return
    pending.current = true
    // App owns currentness across routes; this mount still owns its synchronous click guard.
    const isCurrent = onAccountRequest()
    setBusy(true)
    setError("")
    try {
      if (auth.kind === "authenticated") {
        await window.vacuumStream.auth.logout()
        if (isCurrent()) onAuthChange({ kind: "guest" })
        if (playerSession?.signedIn === true) {
          const nextPlayer = await window.vacuumStream.playerSession.signOut()
          if (isCurrent()) setPlayerSession(nextPlayer)
        }
      } else if (auth.kind === "authorizing") {
        await window.vacuumStream.auth.openActivation(auth.challenge.flowId)
      } else {
        await runSetup(isCurrent)
      }
    } catch (caught) {
      if (isCurrent()) {
        setError(
          auth.kind === "authorizing"
            ? "Could not open a browser. Enter the code manually at the address shown below"
            : errorMessage(caught),
        )
      }
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  return (
    <main className="settings-panel" id="main-content" tabIndex={-1}>
      <header className="page-heading">
        <span>Account and application</span>
        <h1>Settings</h1>
        <p>Sign in to Twitch to unlock personalized discovery.</p>
      </header>

      <section aria-labelledby="account-heading" className="settings-card">
        <div>
          <h2 id="account-heading">Twitch account</h2>
          <p>
            Sign in once in the Twitch window. VacuumStream can then show your followed channels,
            and the player knows who is watching, so subscriber and Turbo ad-free benefits apply.
          </p>
        </div>
        <div className={auth.kind === "authorizing" ? "device-code" : "account-status"}>
          {auth.kind === "authenticated" ? <span>Signed in as {auth.displayName}</span> : null}
          {playerSession === undefined ? null : (
            <span className="account-status__player">
              {playerSession.signedIn
                ? `Player signed in${playerSession.login === undefined ? "" : ` as ${playerSession.login}`}`
                : "Player not signed in: ads play as for a guest"}
            </span>
          )}
          {auth.kind === "authorizing" ? (
            <div className="device-code__challenge">
              <div>
                <span>Enter this code at Twitch</span>
                <strong>{auth.challenge.userCode}</strong>
                <span>{auth.challenge.verificationUri}</span>
              </div>
              <div
                aria-label="Scan Twitch activation QR code"
                className="device-code__qr"
                role="img"
              >
                <QRCodeSVG
                  level="M"
                  marginSize={4}
                  size={192}
                  title="Twitch activation link"
                  value={auth.challenge.verificationUri}
                />
              </div>
            </div>
          ) : null}
          <button
            aria-busy={busy}
            aria-disabled={busy || needsClientId}
            className="primary-button"
            data-focus-down={belowAccountId}
            data-focus-id={accountFocusId}
            data-focus-left="nav-settings"
            data-focus-up="nav-settings"
            data-focusable="true"
            onClick={activateAccount}
            ref={primaryRef}
            type="button"
          >
            <AccountIcon aria-hidden="true" />
            {auth.kind === "authenticated"
              ? "Sign out"
              : auth.kind === "authorizing"
                ? "Open Twitch activation"
                : "Sign in with Twitch"}
          </button>
          {secondaryFocusId === undefined ? null : (
            <button
              aria-busy={busy}
              aria-disabled={busy || needsClientId}
              data-focus-down="settings-client-id"
              data-focus-id={secondaryFocusId}
              data-focus-left="nav-settings"
              data-focus-up={accountFocusId}
              data-focusable="true"
              onBlur={() => {
                secondaryFocused.current = false
              }}
              onClick={activateSecondary}
              onFocus={() => {
                secondaryFocused.current = true
              }}
              type="button"
            >
              {secondaryFocusId === "settings-player-session" ? (
                <MonitorPlayIcon aria-hidden="true" />
              ) : (
                <DeviceMobileIcon aria-hidden="true" />
              )}
              {secondaryFocusId === "settings-player-session"
                ? "Sign in the player too"
                : "Use a code on another device"}
            </button>
          )}
        </div>
      </section>

      <section aria-labelledby="developer-app-heading" className="settings-card">
        <div>
          <h2 id="developer-app-heading">Twitch application</h2>
          <p>
            A public Client ID is built in. Only replace it when using your own Twitch application.
            VacuumStream never asks for or stores a Client Secret.
          </p>
        </div>
        <form onSubmit={save}>
          <label htmlFor="client-id">Public Client ID</label>
          <div className="field-row">
            <input
              autoComplete="off"
              data-focus-down="settings-save"
              data-focus-id="settings-client-id"
              data-focus-up={
                belowAccountId === "settings-client-id" ? accountFocusId : belowAccountId
              }
              data-focusable="true"
              id="client-id"
              onChange={(event) => setClientId(event.currentTarget.value)}
              placeholder="abcdefghijklmnopqrstuvwxyz1234"
              spellCheck="false"
              value={clientId}
            />
            <button
              {...(onStartScreenChange === undefined
                ? {}
                : { "data-focus-down": "settings-start-following" })}
              data-focus-id="settings-save"
              data-focus-left="nav-settings"
              data-focus-up="settings-client-id"
              data-focusable="true"
              disabled={busy}
              type="submit"
            >
              <CheckCircleIcon aria-hidden="true" />
              Save
            </button>
          </div>
        </form>
      </section>

      {onStartScreenChange === undefined ? null : (
        <section aria-labelledby="start-screen-heading" className="settings-card">
          <div>
            <h2 id="start-screen-heading">Start screen</h2>
            <p>
              Choose where VacuumStream opens, and where Back and leaving a stream return to.
              Following needs a signed-in account; without one the app opens on Home. Streams can
              open in fullscreen, with the controls on top for a few seconds; Up shows them again.
            </p>
          </div>
          <div className="settings-options">
            <SettingsSwitch
              checked={startScreen === "following"}
              focusDown={
                onStartFullscreenChange !== undefined
                  ? "settings-start-fullscreen"
                  : onChatPreferencesChange === undefined
                    ? undefined
                    : "settings-chat-dark"
              }
              focusId="settings-start-following"
              focusUp="settings-save"
              label="Open Following instead of Home"
              onChange={(checked) => {
                setError("")
                return onStartScreenChange(checked ? "following" : "home").catch(() =>
                  setError("The start screen could not be saved"),
                )
              }}
            />
            {onStartFullscreenChange === undefined ? null : (
              <SettingsSwitch
                checked={startFullscreen}
                focusDown={onChatPreferencesChange === undefined ? undefined : "settings-chat-dark"}
                focusId="settings-start-fullscreen"
                focusUp="settings-start-following"
                label="Start streams in fullscreen"
                onChange={(checked) => {
                  setError("")
                  return onStartFullscreenChange(checked).catch(() =>
                    setError("The fullscreen preference could not be saved"),
                  )
                }}
              />
            )}
          </div>
        </section>
      )}

      {onChatPreferencesChange === undefined ? null : (
        <section aria-labelledby="chat-heading" className="settings-card">
          <div>
            <h2 id="chat-heading">Chat</h2>
            <p>
              Twitch's chat beside the video or on top of it, also in stream fullscreen. Changes
              apply the next time chat opens; Over video in the player switches the layout live.
            </p>
          </div>
          <div className="settings-options">
            {(() => {
              const save = (update: PreferencesUpdate, failure: string): Promise<void> => {
                setError("")
                return onChatPreferencesChange(update).catch(() => setError(failure))
              }
              const chain = [
                "settings-chat-dark",
                "settings-chat-overlay",
                "settings-chat-position",
                "settings-chat-size",
                "settings-chat-opacity",
                "settings-chat-text",
              ] as const
              const above = (id: (typeof chain)[number]): string => {
                const index = chain.indexOf(id)
                return index === 0
                  ? onStartScreenChange === undefined
                    ? "settings-save"
                    : startCardLastId
                  : (chain[index - 1] ?? "settings-save")
              }
              const below = (id: (typeof chain)[number]): string | undefined =>
                chain[chain.indexOf(id) + 1]
              return (
                <>
                  <SettingsSwitch
                    checked={chatAppearance.theme === "dark"}
                    focusDown={below("settings-chat-dark")}
                    focusId="settings-chat-dark"
                    focusUp={above("settings-chat-dark")}
                    label="Dark chat"
                    onChange={(checked) =>
                      save(
                        { chatTheme: checked ? "dark" : "light" },
                        "The chat theme could not be saved",
                      )
                    }
                  />
                  <SettingsSwitch
                    checked={chatAppearance.layout === "overlay"}
                    focusDown={below("settings-chat-overlay")}
                    focusId="settings-chat-overlay"
                    focusUp={above("settings-chat-overlay")}
                    label="Show chat over the video"
                    onChange={(checked) =>
                      save(
                        { chatLayout: checked ? "overlay" : "beside" },
                        "The chat layout could not be saved",
                      )
                    }
                  />
                  <SettingsCycle
                    focusDown={below("settings-chat-position")}
                    focusId="settings-chat-position"
                    focusUp={above("settings-chat-position")}
                    label="Overlay position"
                    onNext={() =>
                      save(
                        {
                          chatOverlayPosition: nextOption<ChatOverlayPosition>(
                            [
                              "right",
                              "bottom-right",
                              "top-right",
                              "left",
                              "bottom-left",
                              "top-left",
                            ],
                            chatAppearance.position,
                          ),
                        },
                        "The overlay position could not be saved",
                      )
                    }
                    value={CHAT_OVERLAY_LABELS.position[chatAppearance.position]}
                  />
                  <SettingsCycle
                    focusDown={below("settings-chat-size")}
                    focusId="settings-chat-size"
                    focusUp={above("settings-chat-size")}
                    label="Overlay size"
                    onNext={() =>
                      save(
                        {
                          chatOverlaySize: nextOption<ChatOverlaySize>(
                            ["small", "medium", "large"],
                            chatAppearance.size,
                          ),
                        },
                        "The overlay size could not be saved",
                      )
                    }
                    value={CHAT_OVERLAY_LABELS.size[chatAppearance.size]}
                  />
                  <SettingsCycle
                    focusDown={below("settings-chat-opacity")}
                    focusId="settings-chat-opacity"
                    focusUp={above("settings-chat-opacity")}
                    label="Overlay opacity"
                    onNext={() =>
                      save(
                        {
                          chatOverlayOpacity: nextOption<ChatOverlayOpacity>(
                            ["100", "85", "70", "50"],
                            chatAppearance.opacity,
                          ),
                        },
                        "The overlay opacity could not be saved",
                      )
                    }
                    value={CHAT_OVERLAY_LABELS.opacity[chatAppearance.opacity]}
                  />
                  <SettingsCycle
                    focusDown={below("settings-chat-text")}
                    focusId="settings-chat-text"
                    focusUp={above("settings-chat-text")}
                    label="Chat text size"
                    onNext={() =>
                      save(
                        {
                          chatTextSize: nextOption<ChatTextSize>(
                            ["small", "normal", "large", "xlarge"],
                            chatAppearance.textSize,
                          ),
                        },
                        "The chat text size could not be saved",
                      )
                    }
                    value={CHAT_OVERLAY_LABELS.textSize[chatAppearance.textSize]}
                  />
                </>
              )
            })()}
          </div>
        </section>
      )}
      {error !== "" ? (
        <p className="error-message" role="alert">
          {error}
        </p>
      ) : null}
      {auth.kind === "error" ? (
        <p className="error-message" role="alert">
          {auth.message}
        </p>
      ) : null}
    </main>
  )
}
