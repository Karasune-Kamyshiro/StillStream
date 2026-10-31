import { z } from "zod"

export const ChatInputActionSchema = z.enum(["next", "previous", "activate"])
export type ChatInputAction = z.infer<typeof ChatInputActionSchema>
export const ChatInputFailureSchema = z.literal("transport")
export const ChatInputSessionSchema = z.uuid()
export const ChatInputPressSchema = z.tuple([ChatInputSessionSchema, ChatInputActionSchema])

export const ClientIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]{20,64}$/)
  .brand<"ClientId">()

export const CursorInputSchema = z.object({
  after: z.string().max(512).optional(),
  first: z.number().int().min(1).max(100).default(20),
})

export const FAVOURITES_LIMIT = 50
export const FAVOURITES_LIMIT_ERROR = "FAVOURITES_LIMIT_REACHED"

export const FavouriteLoginSchema = z
  .string()
  .min(1)
  .max(25)
  .regex(/^[a-zA-Z0-9_]{1,25}$/)
  .toLowerCase()
export const FavouriteSchema = z.strictObject({
  login: FavouriteLoginSchema,
  userId: z
    .string()
    .min(1)
    .max(64)
    .refine((userId) => !userId.startsWith("direct-"), {
      message: "A favourite userId must not be a synthetic channel id",
    })
    .optional(),
})
export const FavouritesAddInputSchema = FavouriteSchema
export const FavouritesListSchema = z
  .array(FavouriteSchema)
  .max(FAVOURITES_LIMIT)
  .refine((entries) => new Set(entries.map((entry) => entry.login)).size === entries.length, {
    message: "Duplicate favourite login",
  })
export const FavouritesRemoveInputSchema = FavouriteLoginSchema

export const LiveInputSchema = CursorInputSchema.extend({
  gameId: z.string().min(1).max(64).optional(),
})

export const PlaybackProgressGetInputSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((videoId) => videoId !== "__proto__", { message: "Invalid video id" })
export const PlaybackProgressRemoveInputSchema = PlaybackProgressGetInputSchema

export const PlaybackBookmarkValueSchema = z
  .strictObject({
    details: z
      .strictObject({
        title: z.string().min(1).max(300),
        userId: z.string().min(1).max(64),
      })
      .optional(),
    duration: z.number().positive(),
    position: z.number().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .refine((bookmark) => bookmark.position <= bookmark.duration, {
    message: "Playback position must not exceed duration",
    path: ["position"],
  })

export const PlaybackBookmarkSchema = PlaybackBookmarkValueSchema.safeExtend({
  videoId: PlaybackProgressGetInputSchema,
})
export const StartScreenSchema = z.enum(["home", "following"])
export type StartScreen = z.infer<typeof StartScreenSchema>
export const ChatThemeSchema = z.enum(["dark", "light"])
export type ChatTheme = z.infer<typeof ChatThemeSchema>
/** Chat beside the video (the stage splits) or on top of it. */
export const ChatLayoutSchema = z.enum(["beside", "overlay"])
export type ChatLayout = z.infer<typeof ChatLayoutSchema>
export const ChatOverlayPositionSchema = z.enum([
  "right",
  "left",
  "top-right",
  "bottom-right",
  "top-left",
  "bottom-left",
])
export type ChatOverlayPosition = z.infer<typeof ChatOverlayPositionSchema>
export const ChatOverlaySizeSchema = z.enum(["small", "medium", "large"])
export type ChatOverlaySize = z.infer<typeof ChatOverlaySizeSchema>
export const ChatOverlayOpacitySchema = z.enum(["100", "85", "70", "50"])
export type ChatOverlayOpacity = z.infer<typeof ChatOverlayOpacitySchema>
export const ChatTextSizeSchema = z.enum(["small", "normal", "large", "xlarge"])
export type ChatTextSize = z.infer<typeof ChatTextSizeSchema>
// Defaults keep older preference files valid as new options are added.
export const PreferencesSnapshotSchema = z.strictObject({
  chatLayout: ChatLayoutSchema.default("beside"),
  chatOverlayOpacity: ChatOverlayOpacitySchema.default("85"),
  chatOverlayPosition: ChatOverlayPositionSchema.default("right"),
  chatOverlaySize: ChatOverlaySizeSchema.default("medium"),
  chatTextSize: ChatTextSizeSchema.default("normal"),
  chatTheme: ChatThemeSchema.default("dark"),
  /** Undefined until the viewer chooses; Twitch's own player default then applies. */
  lowLatency: z.boolean().optional(),
  /** Twitch quality id (e.g. "1080p60", "chunked" for Source) requested for new streams. */
  quality: z.string().min(1).max(64).optional(),
  /** Open every stream in stream fullscreen, with the controls as a timed overlay. */
  startFullscreen: z.boolean().default(true),
  startScreen: StartScreenSchema.default("home"),
  /** Pause while the app is in the background (another app focused, hidden or minimised). */
  pauseWhenInactive: z.boolean().default(false),
  /** Live previews on stream cards play with sound instead of muted. */
  previewSound: z.boolean().default(false),
})
/** Every preference at its default, as for a first launch. */
export const defaultPreferences = (): PreferencesSnapshot => PreferencesSnapshotSchema.parse({})
export const PreferencesUpdateSchema = z.strictObject({
  chatLayout: ChatLayoutSchema.optional(),
  chatOverlayOpacity: ChatOverlayOpacitySchema.optional(),
  chatOverlayPosition: ChatOverlayPositionSchema.optional(),
  chatOverlaySize: ChatOverlaySizeSchema.optional(),
  chatTextSize: ChatTextSizeSchema.optional(),
  chatTheme: ChatThemeSchema.optional(),
  lowLatency: z.boolean().optional(),
  quality: z.string().min(1).max(64).optional(),
  startFullscreen: z.boolean().optional(),
  startScreen: StartScreenSchema.optional(),
  pauseWhenInactive: z.boolean().optional(),
  previewSound: z.boolean().optional(),
})
export type PreferencesUpdate = z.infer<typeof PreferencesUpdateSchema>
export type PreferencesSnapshot = z.infer<typeof PreferencesSnapshotSchema>

export const PlayerSessionSnapshotSchema = z.strictObject({
  login: FavouriteLoginSchema.optional(),
  signedIn: z.boolean(),
})
export type PlayerSessionSnapshot = z.infer<typeof PlayerSessionSnapshotSchema>

export const PlaybackProgressListSchema = z.array(PlaybackBookmarkSchema).max(100)
export const PlaybackProgressSaveInputSchema = PlaybackBookmarkSchema

export const SearchInputSchema = CursorInputSchema.extend({
  query: z.string().trim().min(1).max(100),
})

export const VideosInputSchema = CursorInputSchema.extend({
  userId: z.string().min(1).max(64),
})

export const StreamCardSchema = z.object({
  category: z.string(),
  id: z.string(),
  profileImageUrl: z.url().optional(),
  startedAt: z.string(),
  tags: z.array(z.string()),
  thumbnailUrl: z.url(),
  title: z.string(),
  userId: z.string(),
  userLogin: z.string(),
  userName: z.string(),
  viewerCount: z.number().int().nonnegative(),
})

export const CategoryCardSchema = z.object({
  boxArtUrl: z.url(),
  id: z.string(),
  name: z.string(),
})

export const ChannelCardSchema = z.object({
  category: z.string(),
  displayName: z.string(),
  id: z.string(),
  isLive: z.boolean(),
  login: z.string(),
  thumbnailUrl: z.url(),
  title: z.string(),
})

export const FollowedChannelCardSchema = z.object({
  displayName: z.string(),
  id: z.string(),
  isLive: z.boolean(),
  login: z.string(),
  profileImageUrl: z.url().optional(),
})

export const VideoCardSchema = z.object({
  createdAt: z.string(),
  duration: z.string(),
  id: z.string(),
  publishedAt: z.string(),
  thumbnailUrl: z.url().optional(),
  title: z.string(),
  userId: z.string(),
  userLogin: z.string(),
  userName: z.string(),
  viewCount: z.number().int().nonnegative(),
})

export const PageSchema = <Item extends z.ZodType>(item: Item) =>
  z
    .object({
      cursor: z.string().optional(),
      items: z.array(item),
    })
    .transform((page) => ({ cursor: page.cursor, items: page.items }))

export const DeviceChallengeSchema = z.object({
  expiresAt: z.string(),
  flowId: z.string(),
  intervalSeconds: z.number().int().positive(),
  userCode: z.string(),
  verificationUri: z.url(),
})

const GuestAuthSchema = z.object({ kind: z.literal("guest") })
const AuthorizingAuthSchema = z.object({
  challenge: DeviceChallengeSchema,
  kind: z.literal("authorizing"),
})
const AuthenticatedAuthSchema = z.object({
  displayName: z.string(),
  kind: z.literal("authenticated"),
  login: z.string(),
})
const AuthErrorSchema = z.object({
  kind: z.literal("error"),
  message: z.string(),
})

export const AuthSnapshotSchema = z.discriminatedUnion("kind", [
  GuestAuthSchema,
  AuthorizingAuthSchema,
  AuthenticatedAuthSchema,
  AuthErrorSchema,
])

export const SettingsSnapshotSchema = z.object({
  clientId: z.string(),
  secureStorage: z.boolean(),
})

export type AuthSnapshot = z.infer<typeof AuthSnapshotSchema>
export const AccountSetupResultSchema = z.strictObject({
  auth: AuthSnapshotSchema,
  player: PlayerSessionSnapshotSchema,
})
export type AccountSetupResult = z.infer<typeof AccountSetupResultSchema>
export type CategoryCard = z.infer<typeof CategoryCardSchema>
export type ChannelCard = z.infer<typeof ChannelCardSchema>
export type ClientId = z.infer<typeof ClientIdSchema>
export type CursorInput = z.input<typeof CursorInputSchema>
export type DeviceChallenge = z.infer<typeof DeviceChallengeSchema>
export type Favourite = z.infer<typeof FavouriteSchema>
export type FollowedChannelCard = z.infer<typeof FollowedChannelCardSchema>
export type LiveInput = z.input<typeof LiveInputSchema>
export type Page<Item> = {
  readonly cursor: string | undefined
  readonly items: readonly Item[]
}
export type PlaybackBookmark = z.infer<typeof PlaybackBookmarkSchema>
export type SearchInput = z.input<typeof SearchInputSchema>
export type SettingsSnapshot = z.infer<typeof SettingsSnapshotSchema>
export type StreamCard = z.infer<typeof StreamCardSchema>
export type VideoCard = z.infer<typeof VideoCardSchema>
export type VideosInput = z.input<typeof VideosInputSchema>

export interface StillStreamApi {
  readonly auth: {
    readonly begin: () => Promise<DeviceChallenge>
    readonly logout: () => Promise<void>
    readonly openActivation: (flowId: string) => Promise<void>
    /** One-window sign-in for both the player and the app's followed-channels access. */
    readonly setup: () => Promise<AccountSetupResult>
    readonly snapshot: () => Promise<AuthSnapshot>
  }
  readonly catalog: {
    readonly followed: (input: CursorInput) => Promise<Page<StreamCard>>
    readonly followedChannels: (input: CursorInput) => Promise<Page<FollowedChannelCard>>
    readonly live: (input: LiveInput) => Promise<Page<StreamCard>>
    readonly search: (input: SearchInput) => Promise<Page<ChannelCard>>
    readonly topCategories: (input: CursorInput) => Promise<Page<CategoryCard>>
    readonly videos: (input: VideosInput) => Promise<Page<VideoCard>>
  }
  readonly chatInput: {
    readonly begin: (session: string) => Promise<void>
    readonly end: (session: string) => Promise<void>
    readonly onEscape: (
      listener: (session: string, failure?: z.infer<typeof ChatInputFailureSchema>) => void,
    ) => () => void
    readonly press: (session: string, action: ChatInputAction) => Promise<void>
  }
  readonly favourites: {
    readonly add: (entry: Favourite) => Promise<readonly Favourite[]>
    readonly list: () => Promise<readonly Favourite[]>
    readonly remove: (login: string) => Promise<readonly Favourite[]>
  }
  readonly playbackProgress: {
    readonly get: (videoId: string) => Promise<PlaybackBookmark | undefined>
    readonly list: () => Promise<readonly PlaybackBookmark[]>
    readonly remove: (videoId: string) => Promise<void>
    readonly save: (bookmark: PlaybackBookmark) => Promise<void>
  }
  readonly preferences: {
    readonly setStartScreen: (startScreen: StartScreen) => Promise<PreferencesSnapshot>
    readonly update: (update: PreferencesUpdate) => Promise<PreferencesSnapshot>
    readonly snapshot: () => Promise<PreferencesSnapshot>
  }
  readonly playerSession: {
    readonly signIn: () => Promise<PlayerSessionSnapshot>
    readonly signOut: () => Promise<PlayerSessionSnapshot>
    readonly snapshot: () => Promise<PlayerSessionSnapshot>
  }
  readonly settings: {
    readonly saveClientId: (clientId: string) => Promise<SettingsSnapshot>
    readonly snapshot: () => Promise<SettingsSnapshot>
  }
  readonly system: {
    readonly activateEmbeddedPlayer: (audible: boolean) => Promise<boolean>
    readonly isSteamGameMode: () => Promise<boolean>
    readonly restoreShellFullscreen: () => Promise<boolean>
    /**
     * Reads (null) or sets the live low-latency mode of the official player. Resolves with the
     * mode Twitch reports, or null when this player build offers no such control.
     */
    readonly setPlayerLowLatency: (enabled: boolean | null) => Promise<boolean | null>
    /** Sets window fullscreen and resolves with the previous state. */
    readonly setFullscreen: (fullscreen: boolean) => Promise<boolean>
    /** Window focus from the operating system: false when another app takes over. */
    readonly onWindowActive: (listener: (active: boolean) => void) => () => void
    readonly toggleFullscreen: () => Promise<boolean>
  }
}
