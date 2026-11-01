import {
  CheckCircleIcon,
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
import type { UpdateCheck } from "../useUpdateCheck"
import { ControllerStatus } from "./ControllerStatus"
import { SettingsCycle, SettingsSwitch } from "./settings-controls"
import { SettingsNavContext } from "./settings-nav-context"
import { UpdatesCard } from "./UpdatesCard"

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
  /** Sidebar control that Left returns to: the tab the viewer came from. */
  readonly navFocusId?: string
  readonly startScreen?: StartScreen
  readonly startFullscreen?: boolean
  /** Saves the stream fullscreen preference; the switch is hidden when absent. */
  readonly onStartFullscreenChange?: (startFullscreen: boolean) => Promise<void>
  readonly pauseWhenInactive?: boolean
  /** Saves the background pause preference; the switch is hidden when absent. */
  readonly onPauseWhenInactiveChange?: (pauseWhenInactive: boolean) => Promise<void>
  readonly previewSound?: boolean
  /** Saves the preview sound preference; the switch is hidden when absent. */
  readonly onPreviewSoundChange?: (previewSound: boolean) => Promise<void>
  /** The update check and its pre-release preference; the Updates card is hidden when absent. */
  readonly updates?: {
    readonly check: UpdateCheck
    readonly includePrereleases: boolean
    readonly onIncludePrereleasesChange: (include: boolean) => Promise<void>
  }
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
 * Left from any Settings control returns to the sidebar tab the viewer came from (for example
 * Following), not to the Settings tab itself, so finishing in Settings is one Left and OK away.
 */

export const SettingsPanel = ({
  navFocusId = "nav-settings",
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
  pauseWhenInactive = false,
  onPauseWhenInactiveChange,
  previewSound = false,
  onPreviewSoundChange,
  updates,
}: SettingsPanelProps) => {
  // The last option of the Start screen card, which the Chat card continues below.
  // The Player behaviour options in order; the Chat card continues below the last one.
  const behaviourIds = [
    "settings-start-following",
    ...(onStartFullscreenChange === undefined ? [] : ["settings-start-fullscreen"]),
    ...(onPauseWhenInactiveChange === undefined ? [] : ["settings-pause-inactive"]),
    ...(onPreviewSoundChange === undefined ? [] : ["settings-preview-sound"]),
  ]
  const startCardLastId = behaviourIds.at(-1) ?? "settings-start-following"
  const behaviourBelow = (id: string): string | undefined =>
    behaviourIds[behaviourIds.indexOf(id) + 1] ??
    (onChatPreferencesChange === undefined ? undefined : "settings-chat-dark")
  const behaviourAbove = (id: string): string =>
    behaviourIds[behaviourIds.indexOf(id) - 1] ?? "settings-save"
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
    void window.stillStream.playerSession.snapshot().then(
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
      const nextSettings = await window.stillStream.settings.saveClientId(clientId)
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
      const result = await window.stillStream.auth.setup()
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
        const challenge = await window.stillStream.auth.begin()
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
        await window.stillStream.auth.logout()
        if (isCurrent()) onAuthChange({ kind: "guest" })
        if (playerSession?.signedIn === true) {
          const nextPlayer = await window.stillStream.playerSession.signOut()
          if (isCurrent()) setPlayerSession(nextPlayer)
        }
      } else if (auth.kind === "authorizing") {
        await window.stillStream.auth.openActivation(auth.challenge.flowId)
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
    <SettingsNavContext.Provider value={navFocusId}>
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
              Sign in once in the Twitch window. StillStream can then show your followed channels,
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
              data-focus-left={navFocusId}
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
                data-focus-left={navFocusId}
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
              A public Client ID is built in. Only replace it when using your own Twitch
              application. StillStream never asks for or stores a Client Secret.
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
                data-focus-left={navFocusId}
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
          <section aria-labelledby="player-behaviour-heading" className="settings-card">
            <div>
              <h2 id="player-behaviour-heading">Player behaviour</h2>
              <p>
                Where StillStream opens and returns to (Following needs a signed-in account), how
                streams start, what happens when you switch to another app, such as Steam, and
                whether the live preview on a selected card plays with sound.
              </p>
            </div>
            <div className="settings-options">
              <SettingsSwitch
                checked={startScreen === "following"}
                focusDown={behaviourBelow("settings-start-following")}
                focusId="settings-start-following"
                focusUp={behaviourAbove("settings-start-following")}
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
                  focusDown={behaviourBelow("settings-start-fullscreen")}
                  focusId="settings-start-fullscreen"
                  focusUp={behaviourAbove("settings-start-fullscreen")}
                  label="Start streams in fullscreen"
                  onChange={(checked) => {
                    setError("")
                    return onStartFullscreenChange(checked).catch(() =>
                      setError("The fullscreen preference could not be saved"),
                    )
                  }}
                />
              )}
              {onPauseWhenInactiveChange === undefined ? null : (
                <SettingsSwitch
                  checked={pauseWhenInactive}
                  focusDown={behaviourBelow("settings-pause-inactive")}
                  focusId="settings-pause-inactive"
                  focusUp={behaviourAbove("settings-pause-inactive")}
                  label="Pause when switching to another app"
                  onChange={(checked) => {
                    setError("")
                    return onPauseWhenInactiveChange(checked).catch(() =>
                      setError("The pause preference could not be saved"),
                    )
                  }}
                />
              )}
              {onPreviewSoundChange === undefined ? null : (
                <SettingsSwitch
                  checked={previewSound}
                  focusDown={behaviourBelow("settings-preview-sound")}
                  focusId="settings-preview-sound"
                  focusUp={behaviourAbove("settings-preview-sound")}
                  label="Play live previews with sound"
                  onChange={(checked) => {
                    setError("")
                    return onPreviewSoundChange(checked).catch(() =>
                      setError("The preview sound preference could not be saved"),
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
        {updates === undefined ? null : (
          <UpdatesCard
            checking={updates.check.checking}
            focusUp={
              onChatPreferencesChange === undefined
                ? onStartScreenChange === undefined
                  ? "settings-save"
                  : startCardLastId
                : "settings-chat-text"
            }
            includePrereleases={updates.includePrereleases}
            onCheck={updates.check.checkNow}
            onIncludePrereleasesChange={(include) => {
              setError("")
              return updates
                .onIncludePrereleasesChange(include)
                .then(updates.check.checkNow)
                .catch(() => setError("The update preference could not be saved"))
            }}
            snapshot={updates.check.snapshot}
          />
        )}
        <ControllerStatus />
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
    </SettingsNavContext.Provider>
  )
}
