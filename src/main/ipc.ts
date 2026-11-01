import { type BrowserWindow, type IpcMainInvokeEvent, ipcMain, shell } from "electron"
import { z } from "zod"
import { CHANNELS } from "../shared/channels"
import {
  ChatInputPressSchema,
  ChatInputSessionSchema,
  CursorInputSchema,
  FavouritesAddInputSchema,
  FavouritesRemoveInputSchema,
  LiveInputSchema,
  PlaybackProgressGetInputSchema,
  PlaybackProgressRemoveInputSchema,
  PlaybackProgressSaveInputSchema,
  PreferencesUpdateSchema,
  SearchInputSchema,
  StartScreenSchema,
  type UpdateSnapshot,
  VideosInputSchema,
} from "../shared/contracts"
import type { ChatInput } from "./chat-input"
import type { FavouritesStore } from "./favourites-store"
import type { PlaybackProgressStore } from "./playback-progress-store"
import type { PreferencesStore } from "./preferences-store"
import type { TwitchService } from "./twitch-service"
import type { TwitchWebSession } from "./twitch-web-session"
import { releasePageUrl } from "./update-check"
import {
  activateEmbeddedPlayer,
  restoreShellFullscreen,
  setEmbeddedPlayerLowLatency,
  setWindowFullscreen,
} from "./window-controls"

type IpcOptions = {
  readonly chatInput: Pick<ChatInput, "begin" | "end" | "press">
  readonly favourites: Pick<FavouritesStore, "add" | "list" | "remove">
  readonly mainWindow: BrowserWindow
  readonly playbackProgress: Pick<PlaybackProgressStore, "get" | "list" | "remove" | "save">
  readonly preferences: Pick<PreferencesStore, "load" | "setStartScreen" | "update">
  readonly playerSession: Pick<TwitchWebSession, "setup" | "signIn" | "signOut" | "snapshot">
  readonly rendererOrigin: string
  readonly runningInSteamGameMode: boolean
  readonly twitch: TwitchService
  /** Absent in tests that do not exercise updates; the check then reports "unknown". */
  readonly updates?: {
    readonly check: (includePrereleases: boolean) => Promise<UpdateSnapshot>
  }
}

export class InvalidIpcSenderError extends Error {
  public constructor() {
    super("IPC call rejected from an unexpected frame")
    this.name = "InvalidIpcSenderError"
  }
}

export const registerIpc = (options: IpcOptions): void => {
  const authorize = (event: IpcMainInvokeEvent): void => {
    const senderFrame = event.senderFrame
    if (
      senderFrame === null ||
      event.sender.id !== options.mainWindow.webContents.id ||
      senderFrame !== options.mainWindow.webContents.mainFrame ||
      !URL.canParse(senderFrame.url) ||
      new URL(senderFrame.url).origin !== options.rendererOrigin
    ) {
      throw new InvalidIpcSenderError()
    }
  }

  ipcMain.handle(CHANNELS.chatInputBegin, async (event, ...input: unknown[]) => {
    authorize(event)
    const [session] = z.tuple([ChatInputSessionSchema]).parse(input)
    options.chatInput.begin(session)
  })
  ipcMain.handle(CHANNELS.chatInputEnd, async (event, ...input: unknown[]) => {
    authorize(event)
    const [session] = z.tuple([ChatInputSessionSchema]).parse(input)
    options.chatInput.end(session)
  })
  ipcMain.handle(CHANNELS.chatInputPress, async (event, ...input: unknown[]) => {
    authorize(event)
    const [session, action] = ChatInputPressSchema.parse(input)
    await options.chatInput.press(session, action)
  })
  ipcMain.handle(CHANNELS.settingsSnapshot, async (event) => {
    authorize(event)
    return options.twitch.settingsSnapshot()
  })
  ipcMain.handle(CHANNELS.settingsSaveClientId, async (event, input: unknown) => {
    authorize(event)
    return options.twitch.saveClientId(z.string().parse(input))
  })
  ipcMain.handle(CHANNELS.authSnapshot, async (event) => {
    authorize(event)
    return options.twitch.authSnapshot()
  })
  ipcMain.handle(CHANNELS.authBegin, async (event) => {
    authorize(event)
    return options.twitch.beginAuthorization()
  })
  ipcMain.handle(CHANNELS.authOpenActivation, async (event, input: unknown) => {
    authorize(event)
    await shell.openExternal(options.twitch.activationUrl(z.uuid().parse(input)))
  })
  ipcMain.handle(CHANNELS.updatesCheck, async (event, input: unknown) => {
    authorize(event)
    const includePrereleases = z.boolean().parse(input)
    if (options.updates === undefined) {
      return {
        currentVersion: "",
        includePrereleases,
        packaging: { kind: "other" },
        status: "unknown",
      } satisfies UpdateSnapshot
    }
    return options.updates.check(includePrereleases)
  })
  ipcMain.handle(CHANNELS.updatesOpenReleasePage, async (event, input: unknown) => {
    authorize(event)
    await shell.openExternal(releasePageUrl(input))
  })
  ipcMain.handle(CHANNELS.authSetup, async (event, ...input: unknown[]) => {
    authorize(event)
    z.tuple([]).parse(input)
    const player = await options.playerSession.setup({
      begin: async () => {
        if ((await options.twitch.authSnapshot()).kind === "authenticated") return undefined
        const challenge = await options.twitch.beginAuthorization()
        return {
          intervalSeconds: challenge.intervalSeconds,
          url: options.twitch.activationUrl(challenge.flowId),
        }
      },
      poll: async () => {
        const auth = await options.twitch.authSnapshot()
        return auth.kind === "authenticated"
          ? "done"
          : auth.kind === "authorizing"
            ? "pending"
            : "failed"
      },
    })
    return { auth: await options.twitch.authSnapshot(), player }
  })
  ipcMain.handle(CHANNELS.authLogout, async (event) => {
    authorize(event)
    await options.twitch.logout()
  })
  ipcMain.handle(CHANNELS.catalogLive, async (event, input: unknown) => {
    authorize(event)
    return options.twitch.live(LiveInputSchema.parse(input))
  })
  ipcMain.handle(CHANNELS.catalogFollowed, async (event, input: unknown) => {
    authorize(event)
    return options.twitch.followed(CursorInputSchema.parse(input))
  })
  ipcMain.handle(CHANNELS.catalogFollowedChannels, async (event, input: unknown) => {
    authorize(event)
    return options.twitch.followedChannels(CursorInputSchema.parse(input))
  })
  ipcMain.handle(CHANNELS.catalogTopCategories, async (event, input: unknown) => {
    authorize(event)
    return options.twitch.topCategories(CursorInputSchema.parse(input))
  })
  ipcMain.handle(CHANNELS.catalogSearch, async (event, input: unknown) => {
    authorize(event)
    return options.twitch.search(SearchInputSchema.parse(input))
  })
  ipcMain.handle(CHANNELS.catalogVideos, async (event, input: unknown) => {
    authorize(event)
    return options.twitch.videos(VideosInputSchema.parse(input))
  })
  ipcMain.handle(CHANNELS.favouritesAdd, async (event, ...input: unknown[]) => {
    authorize(event)
    const [entry] = z.tuple([FavouritesAddInputSchema]).parse(input)
    return options.favourites.add(entry)
  })
  ipcMain.handle(CHANNELS.favouritesList, async (event, ...input: unknown[]) => {
    authorize(event)
    z.tuple([]).parse(input)
    return options.favourites.list()
  })
  ipcMain.handle(CHANNELS.favouritesRemove, async (event, ...input: unknown[]) => {
    authorize(event)
    const [login] = z.tuple([FavouritesRemoveInputSchema]).parse(input)
    return options.favourites.remove(login)
  })
  ipcMain.handle(CHANNELS.playbackProgressGet, async (event, ...input: unknown[]) => {
    authorize(event)
    const [videoId] = z.tuple([PlaybackProgressGetInputSchema]).parse(input)
    return options.playbackProgress.get(videoId)
  })
  ipcMain.handle(CHANNELS.playbackProgressList, async (event, ...input: unknown[]) => {
    authorize(event)
    z.tuple([]).parse(input)
    return options.playbackProgress.list()
  })
  ipcMain.handle(CHANNELS.playbackProgressRemove, async (event, ...input: unknown[]) => {
    authorize(event)
    const [videoId] = z.tuple([PlaybackProgressRemoveInputSchema]).parse(input)
    await options.playbackProgress.remove(videoId)
  })
  ipcMain.handle(CHANNELS.playbackProgressSave, async (event, ...input: unknown[]) => {
    authorize(event)
    const [bookmark] = z.tuple([PlaybackProgressSaveInputSchema]).parse(input)
    await options.playbackProgress.save(bookmark)
  })
  ipcMain.handle(CHANNELS.preferencesSnapshot, async (event, ...input: unknown[]) => {
    authorize(event)
    z.tuple([]).parse(input)
    return options.preferences.load()
  })
  ipcMain.handle(CHANNELS.preferencesSetStartScreen, async (event, ...input: unknown[]) => {
    authorize(event)
    const [startScreen] = z.tuple([StartScreenSchema]).parse(input)
    return options.preferences.setStartScreen(startScreen)
  })
  ipcMain.handle(CHANNELS.preferencesUpdate, async (event, ...input: unknown[]) => {
    authorize(event)
    const [update] = z.tuple([PreferencesUpdateSchema]).parse(input)
    return options.preferences.update(update)
  })
  ipcMain.handle(CHANNELS.playerSessionSnapshot, async (event, ...input: unknown[]) => {
    authorize(event)
    z.tuple([]).parse(input)
    return options.playerSession.snapshot()
  })
  ipcMain.handle(CHANNELS.playerSessionSignIn, async (event, ...input: unknown[]) => {
    authorize(event)
    z.tuple([]).parse(input)
    return options.playerSession.signIn()
  })
  ipcMain.handle(CHANNELS.playerSessionSignOut, async (event, ...input: unknown[]) => {
    authorize(event)
    z.tuple([]).parse(input)
    return options.playerSession.signOut()
  })
  ipcMain.handle(
    CHANNELS.systemActivateEmbeddedPlayer,
    async (event, input: unknown, target: unknown = "player") => {
      authorize(event)
      return activateEmbeddedPlayer(
        options.mainWindow.webContents,
        z.boolean().parse(input),
        z.enum(["player", "preview"]).parse(target),
      )
    },
  )
  ipcMain.handle(CHANNELS.systemIsSteamGameMode, (event) => {
    authorize(event)
    return options.runningInSteamGameMode
  })
  ipcMain.handle(CHANNELS.systemRestoreShellFullscreen, (event) => {
    authorize(event)
    return restoreShellFullscreen(options.mainWindow, options.runningInSteamGameMode)
  })
  ipcMain.handle(CHANNELS.systemSetPlayerLowLatency, async (event, ...input: unknown[]) => {
    authorize(event)
    const [enabled] = z.tuple([z.boolean().nullable()]).parse(input)
    return setEmbeddedPlayerLowLatency(options.mainWindow.webContents, enabled)
  })
  ipcMain.handle(CHANNELS.systemSetFullscreen, (event, input: unknown) => {
    authorize(event)
    return setWindowFullscreen(options.mainWindow, z.boolean().parse(input))
  })
  ipcMain.handle(CHANNELS.systemToggleFullscreen, (event) => {
    authorize(event)
    const fullscreen = !options.mainWindow.isFullScreen()
    options.mainWindow.setFullScreen(fullscreen)
    return fullscreen
  })
}
