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
  PlayerSessionSnapshot,
  SettingsSnapshot,
  StartScreen,
} from "../../../shared/contracts"
import { registerBackDismissal } from "../focus-navigation"

type SettingsPanelProps = {
  readonly auth: AuthSnapshot
  readonly onAccountRequest: () => () => boolean
  readonly onAuthChange: (auth: AuthSnapshot) => void
  readonly onSettingsChange: (settings: SettingsSnapshot, resetAuth: boolean) => void
  /** Saves the start-screen preference; the card is hidden when absent. */
  readonly onStartScreenChange?: (startScreen: StartScreen) => Promise<void>
  readonly settings: SettingsSnapshot
  readonly startScreen?: StartScreen
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

export const SettingsPanel = ({
  auth,
  onAccountRequest,
  onAuthChange,
  onSettingsChange,
  onStartScreenChange,
  settings,
  startScreen = "home",
}: SettingsPanelProps) => {
  const [clientId, setClientId] = useState(settings.clientId)
  const [busy, setBusy] = useState(false)
  const [startScreenBusy, setStartScreenBusy] = useState(false)
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
              Following needs a signed-in account; without one the app opens on Home.
            </p>
          </div>
          {/* A button, not a checkbox: TV remotes send Enter for OK, which never toggles a
              checkbox (only Space does). Buttons activate on Enter, Space and a controller A. */}
          <button
            aria-busy={startScreenBusy}
            aria-checked={startScreen === "following"}
            aria-disabled={startScreenBusy}
            className="settings-toggle"
            data-focus-id="settings-start-following"
            data-focus-left="nav-settings"
            data-focus-up="settings-save"
            data-focusable="true"
            onClick={() => {
              // aria-disabled keeps controller focus while saving; ignore presses meanwhile.
              if (startScreenBusy) return
              const next = startScreen === "following" ? "home" : "following"
              setStartScreenBusy(true)
              setError("")
              void onStartScreenChange(next)
                .catch(() => setError("The start screen could not be saved"))
                .finally(() => setStartScreenBusy(false))
            }}
            role="switch"
            type="button"
          >
            <span aria-hidden="true" className="settings-toggle__box">
              {startScreen === "following" ? <CheckIcon weight="bold" /> : null}
            </span>
            Open Following instead of Home
          </button>
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
