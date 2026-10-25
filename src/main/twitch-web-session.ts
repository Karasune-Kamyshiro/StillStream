import type { BrowserWindow, Cookie, Session } from "electron"
import type { PlayerSessionSnapshot } from "../shared/contracts"
import {
  createEmbeddedSurface,
  createWindowSurface,
  type LoginSurface,
} from "./twitch-login-surface"

const LOGIN_URL = "https://www.twitch.tv/login"
const AUTH_COOKIE = "auth-token"
const LOGIN_COOKIE = "login"
const LOGIN_PATTERN = /^[a-zA-Z0-9_]{1,25}$/
// Twitch may still be writing companion cookies when the auth token lands.
const CLOSE_DELAY_MS = 1_500

const cookieHost = (domain: string | undefined): string | undefined =>
  domain === undefined ? undefined : domain.replace(/^\./, "")

const isTwitchHost = (host: string | undefined): boolean =>
  host !== undefined && (host === "twitch.tv" || host.endsWith(".twitch.tv"))

const isTwitchCookie = (cookie: Cookie): boolean => isTwitchHost(cookieHost(cookie.domain))

const isTwitchUrl = (value: string): boolean =>
  URL.canParse(value) &&
  new URL(value).protocol === "https:" &&
  isTwitchHost(new URL(value).hostname)

const cookieUrl = (cookie: Cookie): string =>
  `https://${cookieHost(cookie.domain) ?? "www.twitch.tv"}${cookie.path ?? "/"}`

/**
 * Browser-level Twitch sign-in for the embedded player.
 *
 * Helix Device Flow tokens never authenticate the official player iframe. The player recognizes
 * a viewer (and their subscriber ad-free benefits) only through twitch.tv's own session cookies,
 * so this opens Twitch's real login page in the same cookie jar the player iframe uses.
 */
export const createTwitchWebSession = (options: {
  /** True when sign-in must stay inside the app window (Steam Game Mode, fullscreen). */
  readonly embed: () => boolean
  readonly parent: () => BrowserWindow | undefined
  readonly session: Session
  readonly userAgent: () => string
}) => {
  let pending: Promise<PlayerSessionSnapshot> | undefined
  let loginWindow: LoginSurface | undefined

  const twitchCookies = async (name?: string): Promise<Cookie[]> =>
    (await options.session.cookies.get(name === undefined ? {} : { name })).filter(isTwitchCookie)

  const snapshot = async (): Promise<PlayerSessionSnapshot> => {
    const auth = (await twitchCookies(AUTH_COOKIE)).find((cookie) => cookie.value !== "")
    if (auth === undefined) return { signedIn: false }
    const login = (await twitchCookies(LOGIN_COOKIE)).find((cookie) =>
      LOGIN_PATTERN.test(cookie.value),
    )
    return login === undefined ? { signedIn: true } : { login: login.value, signedIn: true }
  }

  // The player iframe is cross-site beneath https://localhost, so Lax cookies would never reach it.
  const allowCrossSiteSession = async (): Promise<void> => {
    const cookies = [...(await twitchCookies(AUTH_COOKIE)), ...(await twitchCookies(LOGIN_COOKIE))]
    await Promise.all(
      cookies
        .filter((cookie) => cookie.sameSite !== "no_restriction")
        .map((cookie) =>
          options.session.cookies.set({
            ...(cookie.hostOnly === true ? {} : { domain: cookie.domain }),
            ...(cookie.expirationDate === undefined
              ? {}
              : { expirationDate: cookie.expirationDate }),
            httpOnly: cookie.httpOnly ?? false,
            name: cookie.name,
            path: cookie.path ?? "/",
            sameSite: "no_restriction",
            secure: true,
            url: cookieUrl(cookie),
            value: cookie.value,
          }),
        ),
    )
  }

  /**
   * Opens Twitch in a window that shares the player's cookie jar. Once Twitch's own login has
   * produced a session, `afterSignIn` decides what the same window does next (close, or continue
   * to a follow-up page such as device activation).
   */
  const openTwitchWindow = (
    signedIn: boolean,
    afterSignIn: (window: LoginSurface) => void,
  ): Promise<PlayerSessionSnapshot> => {
    if (pending !== undefined) {
      loginWindow?.focus()
      return pending
    }
    const attempt = new Promise<PlayerSessionSnapshot>((resolve) => {
      const parent = options.parent()
      const webPreferences = {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        session: options.session,
      }
      const window =
        parent !== undefined && options.embed()
          ? createEmbeddedSurface(parent, webPreferences)
          : createWindowSurface(parent, webPreferences)
      loginWindow = window
      // Twitch rejects some embedded-browser user agents; present as plain Chromium.
      window.webContents.setUserAgent(options.userAgent())
      window.webContents.setWindowOpenHandler(({ url }) => {
        if (isTwitchUrl(url)) void window.loadURL(url)
        return { action: "deny" }
      })
      window.webContents.on("will-navigate", (event, url) => {
        if (!URL.canParse(url) || new URL(url).protocol !== "https:") event.preventDefault()
      })

      let continueTimer: ReturnType<typeof setTimeout> | undefined
      const continueAfterSignIn = (delay: number): void => {
        if (continueTimer !== undefined) return
        continueTimer = setTimeout(() => {
          if (!window.isClosed()) afterSignIn(window)
        }, delay)
      }
      const onCookieChanged = (
        _event: Electron.Event,
        cookie: Cookie,
        _cause: string,
        removed: boolean,
      ): void => {
        if (
          removed ||
          cookie.name !== AUTH_COOKIE ||
          cookie.value === "" ||
          !isTwitchCookie(cookie)
        )
          return
        continueAfterSignIn(CLOSE_DELAY_MS)
      }
      options.session.cookies.on("changed", onCookieChanged)

      window.onClosed(() => {
        if (continueTimer !== undefined) clearTimeout(continueTimer)
        options.session.cookies.removeListener("changed", onCookieChanged)
        loginWindow = undefined
        void allowCrossSiteSession()
          .catch(() => undefined)
          .then(snapshot)
          .catch((): PlayerSessionSnapshot => ({ signedIn: false }))
          .then((result) => {
            pending = undefined
            resolve(result)
          })
      })
      if (signedIn) {
        continueAfterSignIn(0)
      } else {
        void window.loadURL(LOGIN_URL).catch(() => undefined)
      }
    })
    pending = attempt
    return attempt
  }

  const signIn = (): Promise<PlayerSessionSnapshot> =>
    openTwitchWindow(false, (window) => window.close())

  /**
   * One-window setup: Twitch login (skipped when the player already has a session), then the
   * device activation page for the app's own Helix sign-in. Because the window is already logged
   * in and the activation URL carries the code, the viewer only confirms on Twitch's page.
   */
  const setup = async (device: DeviceActivation): Promise<PlayerSessionSnapshot> => {
    if (pending !== undefined) {
      loginWindow?.focus()
      return pending
    }
    const current = await snapshot()
    let activationStarted = false
    return openTwitchWindow(current.signedIn, (window) => {
      if (activationStarted) return
      activationStarted = true
      void activateDevice(window, device)
    })
  }

  const activateDevice = async (window: LoginSurface, device: DeviceActivation): Promise<void> => {
    let activation: Awaited<ReturnType<DeviceActivation["begin"]>>
    try {
      activation = await device.begin()
    } catch {
      activation = undefined
    }
    if (window.isClosed()) return
    if (activation === undefined) {
      window.close()
      return
    }
    window.setTitle("Allow VacuumStream on Twitch")
    await window.loadURL(activation.url).catch(() => undefined)
    while (!window.isClosed()) {
      await new Promise((resolve) => setTimeout(resolve, activation.intervalSeconds * 1000))
      if (window.isClosed()) return
      const state = await device.poll().catch(() => "pending" as const)
      if (state === "pending") continue
      // Leave a denied or expired activation on screen so the viewer sees Twitch's message.
      if (state === "done") window.close()
      return
    }
  }

  const signOut = async (): Promise<PlayerSessionSnapshot> => {
    loginWindow?.close()
    const cookies = await twitchCookies()
    await Promise.all(
      cookies.map((cookie) =>
        options.session.cookies.remove(cookieUrl(cookie), cookie.name).catch(() => undefined),
      ),
    )
    await Promise.all(
      ["https://www.twitch.tv", "https://player.twitch.tv", "https://passport.twitch.tv"].map(
        (origin) =>
          options.session
            .clearStorageData({
              origin,
              storages: ["cachestorage", "indexdb", "localstorage", "serviceworkers"],
            })
            .catch(() => undefined),
      ),
    )
    return snapshot()
  }

  return { setup, signIn, signOut, snapshot }
}

export type DeviceActivation = {
  /** Starts device sign-in; resolves undefined when the app is already signed in. */
  readonly begin: () => Promise<
    { readonly intervalSeconds: number; readonly url: string } | undefined
  >
  readonly poll: () => Promise<"done" | "failed" | "pending">
}

export type TwitchWebSession = ReturnType<typeof createTwitchWebSession>

export const plainChromiumUserAgent = (userAgent: string): string =>
  userAgent.replace(/\s(?:Electron|vacuumstream)\/\S+/gi, "")
