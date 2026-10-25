import { BrowserWindow, type Cookie, type Session } from "electron"
import type { PlayerSessionSnapshot } from "../shared/contracts"

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
  readonly parent: () => BrowserWindow | undefined
  readonly session: Session
  readonly userAgent: () => string
}) => {
  let pending: Promise<PlayerSessionSnapshot> | undefined
  let loginWindow: BrowserWindow | undefined

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

  const signIn = (): Promise<PlayerSessionSnapshot> => {
    if (pending !== undefined) {
      loginWindow?.focus()
      return pending
    }
    const attempt = new Promise<PlayerSessionSnapshot>((resolve) => {
      const parent = options.parent()
      const window = new BrowserWindow({
        autoHideMenuBar: true,
        backgroundColor: "#0e0e10",
        height: 760,
        modal: parent !== undefined,
        ...(parent === undefined ? {} : { parent }),
        title: "Sign in to Twitch",
        width: 520,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          session: options.session,
        },
      })
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

      let closeTimer: ReturnType<typeof setTimeout> | undefined
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
        if (closeTimer !== undefined) return
        closeTimer = setTimeout(() => {
          if (!window.isDestroyed()) window.close()
        }, CLOSE_DELAY_MS)
      }
      options.session.cookies.on("changed", onCookieChanged)

      window.on("closed", () => {
        if (closeTimer !== undefined) clearTimeout(closeTimer)
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
      void window.loadURL(LOGIN_URL).catch(() => undefined)
    })
    pending = attempt
    return attempt
  }

  const signOut = async (): Promise<PlayerSessionSnapshot> => {
    if (loginWindow !== undefined && !loginWindow.isDestroyed()) loginWindow.close()
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

  return { signIn, signOut, snapshot }
}

export type TwitchWebSession = ReturnType<typeof createTwitchWebSession>

export const plainChromiumUserAgent = (userAgent: string): string =>
  userAgent.replace(/\s(?:Electron|vacuumstream)\/\S+/gi, "")
