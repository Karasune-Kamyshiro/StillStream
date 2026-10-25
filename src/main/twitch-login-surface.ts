import { BrowserWindow, type WebContents, WebContentsView, type WebPreferences } from "electron"

/** Where Twitch's own sign-in pages are shown: a separate window or a layer inside the app. */
export type LoginSurface = {
  readonly close: () => void
  readonly focus: () => void
  readonly isClosed: () => boolean
  readonly loadURL: (url: string) => Promise<void>
  readonly onClosed: (listener: () => void) => void
  readonly setTitle: (title: string) => void
  readonly webContents: WebContents
}

export const createWindowSurface = (
  parent: BrowserWindow | undefined,
  webPreferences: WebPreferences,
): LoginSurface => {
  const window = new BrowserWindow({
    autoHideMenuBar: true,
    backgroundColor: "#0e0e10",
    height: 760,
    modal: parent !== undefined,
    ...(parent === undefined ? {} : { parent }),
    title: "Sign in with Twitch",
    width: 520,
    webPreferences,
  })
  return {
    close: () => {
      if (!window.isDestroyed()) window.close()
    },
    focus: () => {
      if (!window.isDestroyed()) window.focus()
    },
    isClosed: () => window.isDestroyed(),
    loadURL: (url) => window.loadURL(url),
    onClosed: (listener) => {
      window.on("closed", listener)
    },
    setTitle: (title) => {
      if (!window.isDestroyed()) window.setTitle(title)
    },
    webContents: window.webContents,
  }
}

/**
 * Gamescope (Steam Game Mode) shows one window at a time and stretches every extra window to the
 * screen, so a separate sign-in window cannot be laid out or navigated there. This layer fills
 * the app's own window instead; Escape (B on a controller in Steam's default layout) cancels.
 */
export const createEmbeddedSurface = (
  parent: BrowserWindow,
  webPreferences: WebPreferences,
): LoginSurface => {
  const view = new WebContentsView({ webPreferences })
  view.setBackgroundColor("#0e0e10")
  const listeners: (() => void)[] = []
  let closed = false

  const layout = (): void => {
    if (parent.isDestroyed()) return
    const [width = 0, height = 0] = parent.getContentSize()
    view.setBounds({ height, width, x: 0, y: 0 })
  }
  const close = (): void => {
    if (closed) return
    closed = true
    parent.removeListener("resize", layout)
    parent.removeListener("closed", close)
    if (!parent.isDestroyed()) {
      parent.contentView.removeChildView(view)
      parent.webContents.focus()
    }
    if (!view.webContents.isDestroyed()) view.webContents.close()
    for (const listener of listeners.splice(0)) listener()
  }

  view.webContents.on("before-input-event", (event, input) => {
    if (input.key !== "Escape" || input.type !== "keyDown") return
    event.preventDefault()
    close()
  })
  view.webContents.on("render-process-gone", close)
  parent.on("resize", layout)
  parent.on("closed", close)
  layout()
  parent.contentView.addChildView(view)
  view.webContents.focus()

  return {
    close,
    focus: () => {
      if (!closed) view.webContents.focus()
    },
    isClosed: () => closed,
    loadURL: async (url) => {
      await view.webContents.loadURL(url)
      if (!closed) view.webContents.focus()
    },
    onClosed: (listener) => {
      if (closed) listener()
      else listeners.push(listener)
    },
    // The app window keeps its own title; the page itself says what Twitch is asking for.
    setTitle: () => undefined,
    webContents: view.webContents,
  }
}

/** Steam Game Mode, any gamescope session, or a fullscreen TV-style window: stay in one window. */
export const shouldEmbedLogin = (
  window: Pick<BrowserWindow, "isDestroyed" | "isFullScreen"> | undefined,
  runningInSteamGameMode: boolean,
  environment: NodeJS.ProcessEnv,
): boolean => {
  if (window === undefined || window.isDestroyed()) return false
  const { GAMESCOPE_WAYLAND_DISPLAY: gamescopeDisplay, XDG_CURRENT_DESKTOP: desktop } = environment
  return (
    runningInSteamGameMode ||
    gamescopeDisplay !== undefined ||
    (desktop ?? "").toLowerCase().includes("gamescope") ||
    window.isFullScreen()
  )
}
