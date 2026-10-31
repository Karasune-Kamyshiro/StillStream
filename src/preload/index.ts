import { contextBridge, ipcRenderer } from "electron"
import { z } from "zod"
import { CHANNELS } from "../shared/channels"
import {
  AccountSetupResultSchema,
  AuthSnapshotSchema,
  CategoryCardSchema,
  ChannelCardSchema,
  ChatInputFailureSchema,
  ChatInputPressSchema,
  ChatInputSessionSchema,
  DeviceChallengeSchema,
  FavouritesAddInputSchema,
  FavouritesListSchema,
  FavouritesRemoveInputSchema,
  FollowedChannelCardSchema,
  PageSchema,
  PlaybackBookmarkSchema,
  PlaybackProgressGetInputSchema,
  PlaybackProgressListSchema,
  PlaybackProgressRemoveInputSchema,
  PlaybackProgressSaveInputSchema,
  PlayerSessionSnapshotSchema,
  PreferencesSnapshotSchema,
  PreferencesUpdateSchema,
  SettingsSnapshotSchema,
  StartScreenSchema,
  type StillStreamApi,
  StreamCardSchema,
  VideoCardSchema,
} from "../shared/contracts"

const api = {
  auth: {
    begin: () =>
      ipcRenderer.invoke(CHANNELS.authBegin).then((value) => DeviceChallengeSchema.parse(value)),
    logout: () => ipcRenderer.invoke(CHANNELS.authLogout).then(() => undefined),
    openActivation: (flowId) =>
      ipcRenderer.invoke(CHANNELS.authOpenActivation, flowId).then(() => undefined),
    setup: () =>
      ipcRenderer.invoke(CHANNELS.authSetup).then((value) => AccountSetupResultSchema.parse(value)),
    snapshot: () =>
      ipcRenderer.invoke(CHANNELS.authSnapshot).then((value) => AuthSnapshotSchema.parse(value)),
  },
  catalog: {
    followed: (input) =>
      ipcRenderer
        .invoke(CHANNELS.catalogFollowed, input)
        .then((value) => PageSchema(StreamCardSchema).parse(value)),
    followedChannels: (input) =>
      ipcRenderer
        .invoke(CHANNELS.catalogFollowedChannels, input)
        .then((value) => PageSchema(FollowedChannelCardSchema).parse(value)),
    live: (input) =>
      ipcRenderer
        .invoke(CHANNELS.catalogLive, input)
        .then((value) => PageSchema(StreamCardSchema).parse(value)),
    search: (input) =>
      ipcRenderer
        .invoke(CHANNELS.catalogSearch, input)
        .then((value) => PageSchema(ChannelCardSchema).parse(value)),
    topCategories: (input) =>
      ipcRenderer
        .invoke(CHANNELS.catalogTopCategories, input)
        .then((value) => PageSchema(CategoryCardSchema).parse(value)),
    videos: (input) =>
      ipcRenderer
        .invoke(CHANNELS.catalogVideos, input)
        .then((value) => PageSchema(VideoCardSchema).parse(value)),
  },
  chatInput: {
    begin: (session) =>
      ipcRenderer
        .invoke(CHANNELS.chatInputBegin, ChatInputSessionSchema.parse(session))
        .then(() => undefined),
    end: (session) =>
      ipcRenderer
        .invoke(CHANNELS.chatInputEnd, ChatInputSessionSchema.parse(session))
        .then(() => undefined),
    onEscape: (listener) => {
      const onEscape = (
        _event: Electron.IpcRendererEvent,
        session: unknown,
        failure: unknown,
      ): void => {
        const id = ChatInputSessionSchema.parse(session)
        if (failure === undefined) listener(id)
        else listener(id, ChatInputFailureSchema.parse(failure))
      }
      ipcRenderer.on(CHANNELS.chatInputEscape, onEscape)
      return () => {
        ipcRenderer.removeListener(CHANNELS.chatInputEscape, onEscape)
      }
    },
    press: (...input) =>
      ipcRenderer
        .invoke(CHANNELS.chatInputPress, ...ChatInputPressSchema.parse(input))
        .then((value) => z.void().parse(value)),
  },
  favourites: {
    add: (entry) =>
      ipcRenderer
        .invoke(CHANNELS.favouritesAdd, FavouritesAddInputSchema.parse(entry))
        .then((value) => FavouritesListSchema.parse(value)),
    list: () =>
      ipcRenderer
        .invoke(CHANNELS.favouritesList)
        .then((value) => FavouritesListSchema.parse(value)),
    remove: (login) =>
      ipcRenderer
        .invoke(CHANNELS.favouritesRemove, FavouritesRemoveInputSchema.parse(login))
        .then((value) => FavouritesListSchema.parse(value)),
  },
  playbackProgress: {
    get: (videoId) =>
      ipcRenderer
        .invoke(CHANNELS.playbackProgressGet, PlaybackProgressGetInputSchema.parse(videoId))
        .then((value) => PlaybackBookmarkSchema.optional().parse(value)),
    list: () =>
      ipcRenderer
        .invoke(CHANNELS.playbackProgressList)
        .then((value) => PlaybackProgressListSchema.parse(value)),
    remove: (videoId) =>
      ipcRenderer
        .invoke(CHANNELS.playbackProgressRemove, PlaybackProgressRemoveInputSchema.parse(videoId))
        .then((value) => z.void().parse(value)),
    save: (bookmark) =>
      ipcRenderer
        .invoke(CHANNELS.playbackProgressSave, PlaybackProgressSaveInputSchema.parse(bookmark))
        .then((value) => z.void().parse(value)),
  },
  preferences: {
    setStartScreen: (startScreen) =>
      ipcRenderer
        .invoke(CHANNELS.preferencesSetStartScreen, StartScreenSchema.parse(startScreen))
        .then((value) => PreferencesSnapshotSchema.parse(value)),
    snapshot: () =>
      ipcRenderer
        .invoke(CHANNELS.preferencesSnapshot)
        .then((value) => PreferencesSnapshotSchema.parse(value)),
    update: (update) =>
      ipcRenderer
        .invoke(CHANNELS.preferencesUpdate, PreferencesUpdateSchema.parse(update))
        .then((value) => PreferencesSnapshotSchema.parse(value)),
  },
  playerSession: {
    signIn: () =>
      ipcRenderer
        .invoke(CHANNELS.playerSessionSignIn)
        .then((value) => PlayerSessionSnapshotSchema.parse(value)),
    signOut: () =>
      ipcRenderer
        .invoke(CHANNELS.playerSessionSignOut)
        .then((value) => PlayerSessionSnapshotSchema.parse(value)),
    snapshot: () =>
      ipcRenderer
        .invoke(CHANNELS.playerSessionSnapshot)
        .then((value) => PlayerSessionSnapshotSchema.parse(value)),
  },
  settings: {
    saveClientId: (clientId) =>
      ipcRenderer
        .invoke(CHANNELS.settingsSaveClientId, clientId)
        .then((value) => SettingsSnapshotSchema.parse(value)),
    snapshot: () =>
      ipcRenderer
        .invoke(CHANNELS.settingsSnapshot)
        .then((value) => SettingsSnapshotSchema.parse(value)),
  },
  system: {
    activateEmbeddedPlayer: (audible, target = "player") =>
      ipcRenderer
        .invoke(CHANNELS.systemActivateEmbeddedPlayer, audible, target)
        .then((value) => Boolean(value)),
    isSteamGameMode: () =>
      ipcRenderer.invoke(CHANNELS.systemIsSteamGameMode).then((value) => Boolean(value)),
    restoreShellFullscreen: () =>
      ipcRenderer.invoke(CHANNELS.systemRestoreShellFullscreen).then((value) => Boolean(value)),
    onWindowActive: (listener) => {
      const onActive = (_event: Electron.IpcRendererEvent, active: unknown): void => {
        listener(z.boolean().parse(active))
      }
      ipcRenderer.on(CHANNELS.systemWindowActive, onActive)
      return () => {
        ipcRenderer.removeListener(CHANNELS.systemWindowActive, onActive)
      }
    },
    setPlayerLowLatency: (enabled) =>
      ipcRenderer
        .invoke(CHANNELS.systemSetPlayerLowLatency, z.boolean().nullable().parse(enabled))
        .then((value) => z.boolean().nullable().parse(value)),
    setFullscreen: (fullscreen) =>
      ipcRenderer
        .invoke(CHANNELS.systemSetFullscreen, z.boolean().parse(fullscreen))
        .then((value) => Boolean(value)),
    toggleFullscreen: () =>
      ipcRenderer.invoke(CHANNELS.systemToggleFullscreen).then((value) => Boolean(value)),
  },
} satisfies StillStreamApi

contextBridge.exposeInMainWorld("stillStream", api)
