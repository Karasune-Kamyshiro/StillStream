import { X509Certificate } from "node:crypto"
import { join } from "node:path"
import { app, BrowserWindow, dialog, net, powerSaveBlocker, safeStorage, session } from "electron"
import { CHANNELS } from "../shared/channels"
import { createChatInput } from "./chat-input"
import { FavouritesStore } from "./favourites-store"
import { connectSessionBus, installFlatpakUpdate, spawnLatestVersion } from "./flatpak-self-update"
import { applyGamingModeSwitches } from "./gaming-mode-switches"
import { type StaticHttpsServer, startStaticHttpsServer } from "./https-server"
import { registerIpc } from "./ipc"
import { adoptLegacyData } from "./legacy-data"
import { createPlaybackKeepAwake } from "./playback-keep-awake"
import { PlaybackProgressStore } from "./playback-progress-store"
import { createPlayerFocusGuard } from "./player-focus-guard"
import { PreferencesStore } from "./preferences-store"
import { SettingsStore } from "./settings-store"
import { TokenVault } from "./token-vault"
import { shouldEmbedLogin } from "./twitch-login-surface"
import { TwitchService } from "./twitch-service"
import { createTwitchWebSession, plainChromiumUserAgent } from "./twitch-web-session"
import { checkForUpdates, readPackaging } from "./update-check"

let staticServer: StaticHttpsServer | undefined
let primaryWindow: BrowserWindow | undefined
let activationRequested = false

const activateWindow = (): void => {
  if (primaryWindow === undefined) {
    activationRequested = true
    return
  }
  activationRequested = false
  if (primaryWindow.isMinimized()) primaryWindow.restore()
  primaryWindow.show()
  primaryWindow.focus()
}

const isTwitchPlayerOrigin = (value: string): boolean =>
  URL.canParse(value) && new URL(value).origin === "https://player.twitch.tv"

const createWindow = async (): Promise<void> => {
  const { SteamGamepadUI: steamGamepadUi, SteamOS: steamOs } = process.env
  const runningInSteamGameMode = steamOs === "1" && steamGamepadUi === "1"
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    backgroundColor: "#0e0e10",
    fullscreen: runningInSteamGameMode,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      sandbox: true,
    },
  })

  primaryWindow = mainWindow
  const keepAwake = createPlaybackKeepAwake(
    () => (mainWindow.isDestroyed() ? undefined : mainWindow.webContents),
    powerSaveBlocker,
  )
  mainWindow.on("closed", () => {
    keepAwake.dispose()
    primaryWindow = undefined
  })

  const { ELECTRON_RENDERER_URL: developmentRendererUrl } = process.env
  const rendererUrl = app.isPackaged ? undefined : developmentRendererUrl
  let rendererOrigin: string
  if (rendererUrl !== undefined) {
    rendererOrigin = new URL(rendererUrl).origin
  } else {
    const certificatesPath = app.isPackaged
      ? join(process.resourcesPath, "certs")
      : join(app.getAppPath(), "resources/certs")
    staticServer = await startStaticHttpsServer({
      assetsPath: join(app.getAppPath(), "out/renderer"),
      certificatePath: join(certificatesPath, "localhost-cert.pem"),
      keyPath: join(certificatesPath, "localhost-key.pem"),
    })
    rendererOrigin = staticServer.origin

    app.on("certificate-error", (event, webContents, url, error, certificate, callback) => {
      const trustsCertificate =
        webContents.id === mainWindow.webContents.id &&
        URL.canParse(url) &&
        new URL(url).origin === staticServer?.origin &&
        error === "net::ERR_CERT_AUTHORITY_INVALID" &&
        new X509Certificate(certificate.data).fingerprint256 ===
          staticServer?.certificateFingerprint

      if (trustsCertificate) {
        event.preventDefault()
        callback(true)
        return
      }
      callback(false)
    })
  }

  // One-time carry-over of preferences from the VacuumStream data folder, before stores open.
  await adoptLegacyData(app.getPath("userData")).catch(() => [])
  const tokenVault = new TokenVault(app.getPath("userData"), {
    backend: () => safeStorage.getSelectedStorageBackend(),
    decrypt: (value) => safeStorage.decryptString(value),
    encrypt: (value) => safeStorage.encryptString(value),
    isAvailable: () => safeStorage.isEncryptionAvailable(),
  })
  if (!tokenVault.isSecure) {
    console.warn("Secure OAuth token storage unavailable; using mode-0600 file fallback")
  }
  const chatInput = createChatInput(mainWindow)
  const releasePlayerFocusGuard = createPlayerFocusGuard(mainWindow)
  mainWindow.on("closed", releasePlayerFocusGuard)
  mainWindow.on("blur", chatInput.blur)
  // The OS-level window focus (unlike the renderer's own blur, which also fires when an embedded
  // Twitch frame takes focus) tells the player when another app, such as Steam, takes over.
  const sendWindowActive = (active: boolean) => (): void => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send(CHANNELS.systemWindowActive, active)
  }
  mainWindow.on("blur", sendWindowActive(false))
  mainWindow.on("hide", sendWindowActive(false))
  mainWindow.on("minimize", sendWindowActive(false))
  mainWindow.on("focus", sendWindowActive(true))
  mainWindow.on("show", sendWindowActive(true))
  mainWindow.on("restore", sendWindowActive(true))
  mainWindow.on("closed", chatInput.cancel)
  mainWindow.webContents.on("render-process-gone", chatInput.cancel)
  mainWindow.webContents.on("did-start-navigation", (_event, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) chatInput.cancel()
  })
  registerIpc({
    chatInput,
    favourites: new FavouritesStore(app.getPath("userData")),
    mainWindow,
    playbackProgress: new PlaybackProgressStore(app.getPath("userData")),
    preferences: new PreferencesStore(app.getPath("userData")),
    playerSession: createTwitchWebSession({
      embed: () => shouldEmbedLogin(mainWindow, runningInSteamGameMode, process.env),
      parent: () => (mainWindow.isDestroyed() ? undefined : mainWindow),
      session: session.defaultSession,
      userAgent: () => plainChromiumUserAgent(app.userAgentFallback),
    }),
    rendererOrigin,
    runningInSteamGameMode,
    twitch: new TwitchService(new SettingsStore(app.getPath("userData")), tokenVault),
    updates: {
      install: async (onProgress) => {
        const packaging = await readPackaging()
        if (packaging.kind !== "flatpak" || !["stable", "beta"].includes(packaging.branch)) {
          return {
            error: "Only the Flatpak from the StillStream repository updates itself",
            status: "failed",
          }
        }
        return installFlatpakUpdate(connectSessionBus, onProgress)
      },
      restart: async () => {
        // In Gaming Mode only Steam may start the app, so this instance just closes for a relaunch.
        if (!runningInSteamGameMode) {
          app.releaseSingleInstanceLock()
          await spawnLatestVersion(connectSessionBus, "stillstream", process.env)
        }
        app.quit()
      },
      check: async (includePrereleases) =>
        checkForUpdates({
          currentVersion: app.getVersion(),
          fetch: (url, init) => net.fetch(url, init),
          includePrereleases,
          packaging: await readPackaging(),
        }),
    },
  })

  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin) =>
      webContents !== null &&
      webContents.id === mainWindow.webContents.id &&
      permission === "fullscreen" &&
      isTwitchPlayerOrigin(requestingOrigin),
  )
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      callback(
        webContents.id === mainWindow.webContents.id &&
          permission === "fullscreen" &&
          isTwitchPlayerOrigin(details.requestingUrl),
      )
    },
  )

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const permitsNavigation = URL.canParse(url) && new URL(url).origin === rendererOrigin
    if (!permitsNavigation) {
      event.preventDefault()
    }
  })

  await mainWindow.loadURL(rendererUrl ?? rendererOrigin)
  if (activationRequested) activateWindow()
}

// Before the app is ready: Chromium reads its switches at startup.
applyGamingModeSwitches(app.commandLine, process.env)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // A second launch may only reactivate this window, never supply navigation arguments.
  app.on("second-instance", activateWindow)

  app
    .whenReady()
    .then(createWindow)
    .catch(async (error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown startup failure"
      dialog.showErrorBox("StillStream could not start", message)
      await staticServer?.close()
      app.exit(1)
    })

  // Chromium restarts a crashed GPU process silently, and the whole window flashes while it
  // does. Logging it makes such a flash traceable from a terminal.
  app.on("child-process-gone", (_event, details) => {
    console.warn(
      `[StillStream] ${details.type} process gone: ${details.reason} (exit code ${details.exitCode})`,
    )
  })

  app.on("window-all-closed", () => {
    app.quit()
  })

  app.on("will-quit", () => {
    void staticServer?.close()
  })
}
