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
  // Zoom is shared per host within a session; a desktop window always shows Twitch at 100%.
  window.webContents.on("dom-ready", () => {
    if (!window.isDestroyed()) window.webContents.setZoomFactor(1)
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

// Measured in app pixels, so desktop scaling (e.g. 200% on a 4K panel) is already accounted for.
const ZOOM_POINTS: readonly (readonly [width: number, zoom: number])[] = [
  [1920, 1],
  [2560, 2],
  [3840, 2.5],
]
const MIN_ZOOM = 0.5
const MAX_ZOOM = 5
const ZOOM_KEYS: Readonly<Record<string, number>> = {
  "+": 0.25,
  "-": -0.25,
  "0": 0,
  "=": 0.25,
  _: -0.25,
}

/** Twitch's pages are sized for a desk; scale them up for a TV across the room. */
export const tvZoomFactor = (width: number): number => {
  const [first, ...rest] = ZOOM_POINTS
  if (first === undefined || width <= first[0]) return first?.[1] ?? 1
  let previous = first
  for (const point of rest) {
    if (width <= point[0]) {
      const progress = (width - previous[0]) / (point[0] - previous[0])
      return previous[1] + progress * (point[1] - previous[1])
    }
    previous = point
  }
  // Beyond 4K (e.g. 8K), keep the same physical size as at 4K.
  return Math.min(MAX_ZOOM, previous[1] * (width / previous[0]))
}

export const adjustedZoomFactor = (automatic: number, adjustment: number): number =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, automatic + adjustment))

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
  let zoomAdjustment = 0

  // Chromium resets zoom when the page changes host, so this runs on every navigation too.
  const applyZoom = (): void => {
    if (closed || parent.isDestroyed() || view.webContents.isDestroyed()) return
    const [width = 0] = parent.getContentSize()
    view.webContents.setZoomFactor(adjustedZoomFactor(tvZoomFactor(width), zoomAdjustment))
  }
  const layout = (): void => {
    if (parent.isDestroyed()) return
    const [width = 0, height = 0] = parent.getContentSize()
    view.setBounds({ height, width, x: 0, y: 0 })
    applyZoom()
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
    if (input.type !== "keyDown") return
    if (input.key === "Escape") {
      event.preventDefault()
      close()
      return
    }
    // Ctrl + plus / minus / 0 fine-tunes the automatic TV zoom for this sign-in.
    if (!input.control) return
    const step = ZOOM_KEYS[input.key]
    if (step === undefined) return
    event.preventDefault()
    zoomAdjustment = step === 0 ? 0 : zoomAdjustment + step
    applyZoom()
  })
  view.webContents.on("did-navigate", applyZoom)
  view.webContents.on("did-navigate-in-page", applyZoom)
  view.webContents.on("dom-ready", applyZoom)
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
