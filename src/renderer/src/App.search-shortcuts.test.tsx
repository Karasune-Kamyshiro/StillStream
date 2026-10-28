import { defaultPreferences } from "../../shared/contracts"
// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type {
  AuthSnapshot,
  ChannelCard,
  Favourite,
  Page,
  StillStreamApi,
} from "../../shared/contracts"
import { App } from "./App"
import { dispatchControllerKey } from "./focus-navigation"
import type { TwitchPlayerOptions } from "./twitch-player"

const deferred = <Value,>() => {
  let resolve: ((value: Value) => void) | undefined
  const promise = new Promise<Value>((accept) => {
    resolve = accept
  })
  if (resolve === undefined) throw new Error("Promise executor did not run")
  return { promise, resolve }
}

const result: ChannelCard = {
  category: "Talk shows",
  displayName: "Twitch",
  id: "12826",
  isLive: false,
  login: "twitch",
  thumbnailUrl: "https://example.com/twitch.png",
  title: "Twitch channel",
}
const makeBridge = (auth: AuthSnapshot) =>
  ({
    auth: {
      begin: vi.fn<StillStreamApi["auth"]["begin"]>(),
      logout: vi.fn<StillStreamApi["auth"]["logout"]>().mockResolvedValue(undefined),
      openActivation: vi.fn<StillStreamApi["auth"]["openActivation"]>(),
      setup: vi.fn<StillStreamApi["auth"]["setup"]>(),
      snapshot: vi.fn<StillStreamApi["auth"]["snapshot"]>().mockResolvedValue(auth),
    },
    catalog: {
      followed: vi.fn<StillStreamApi["catalog"]["followed"]>(),
      followedChannels: vi.fn<StillStreamApi["catalog"]["followedChannels"]>(),
      live: vi
        .fn<StillStreamApi["catalog"]["live"]>()
        .mockResolvedValue({ cursor: undefined, items: [] }),
      search: vi
        .fn<StillStreamApi["catalog"]["search"]>()
        .mockResolvedValue({ cursor: undefined, items: [result] }),
      topCategories: vi
        .fn<StillStreamApi["catalog"]["topCategories"]>()
        .mockResolvedValue({ cursor: undefined, items: [] }),
      videos: vi.fn<StillStreamApi["catalog"]["videos"]>(),
    },
    chatInput: {
      begin: vi.fn<StillStreamApi["chatInput"]["begin"]>(),
      end: vi.fn<StillStreamApi["chatInput"]["end"]>().mockResolvedValue(undefined),
      onEscape: vi.fn<StillStreamApi["chatInput"]["onEscape"]>().mockReturnValue(() => undefined),
      press: vi.fn<StillStreamApi["chatInput"]["press"]>().mockResolvedValue(undefined),
    },
    favourites: {
      add: vi.fn<StillStreamApi["favourites"]["add"]>().mockResolvedValue([]),
      list: vi.fn<StillStreamApi["favourites"]["list"]>().mockResolvedValue([]),
      remove: vi.fn<StillStreamApi["favourites"]["remove"]>().mockResolvedValue([]),
    },
    playbackProgress: {
      get: vi.fn<StillStreamApi["playbackProgress"]["get"]>().mockResolvedValue(undefined),
      list: vi.fn<StillStreamApi["playbackProgress"]["list"]>().mockResolvedValue([]),
      remove: vi.fn<StillStreamApi["playbackProgress"]["remove"]>().mockResolvedValue(undefined),
      save: vi.fn<StillStreamApi["playbackProgress"]["save"]>().mockResolvedValue(undefined),
    },
    preferences: {
      setStartScreen: vi.fn<StillStreamApi["preferences"]["setStartScreen"]>(),
      update: vi.fn<StillStreamApi["preferences"]["update"]>(),
      snapshot: vi
        .fn<StillStreamApi["preferences"]["snapshot"]>()
        .mockResolvedValue({ ...defaultPreferences(), startFullscreen: false }),
    },
    playerSession: {
      signIn: vi
        .fn<StillStreamApi["playerSession"]["signIn"]>()
        .mockResolvedValue({ signedIn: false }),
      signOut: vi
        .fn<StillStreamApi["playerSession"]["signOut"]>()
        .mockResolvedValue({ signedIn: false }),
      snapshot: vi
        .fn<StillStreamApi["playerSession"]["snapshot"]>()
        .mockResolvedValue({ signedIn: false }),
    },
    settings: {
      saveClientId: vi.fn<StillStreamApi["settings"]["saveClientId"]>(),
      snapshot: vi
        .fn<StillStreamApi["settings"]["snapshot"]>()
        .mockResolvedValue({ clientId: "client", secureStorage: false }),
    },
    system: {
      activateEmbeddedPlayer: vi
        .fn<StillStreamApi["system"]["activateEmbeddedPlayer"]>()
        .mockResolvedValue(true),
      isSteamGameMode: vi.fn<StillStreamApi["system"]["isSteamGameMode"]>(),
      restoreShellFullscreen: vi
        .fn<StillStreamApi["system"]["restoreShellFullscreen"]>()
        .mockResolvedValue(false),
      onWindowActive: vi
        .fn<StillStreamApi["system"]["onWindowActive"]>()
        .mockReturnValue(() => undefined),
      setPlayerLowLatency: vi
        .fn<StillStreamApi["system"]["setPlayerLowLatency"]>()
        .mockResolvedValue(null),
      setFullscreen: vi.fn<StillStreamApi["system"]["setFullscreen"]>().mockResolvedValue(false),
      toggleFullscreen: vi.fn<StillStreamApi["system"]["toggleFullscreen"]>(),
    },
  }) satisfies StillStreamApi

let root: Root | undefined
let container: HTMLDivElement
let nextFrame: FrameRequestCallback | undefined
let pressedButtons: readonly number[] = []
let frameTime = 0
const keys: string[] = []
const recordKey = (event: KeyboardEvent) => keys.push(event.key)
beforeEach(() => {
  pressedButtons = []
  frameTime = 0
  keys.length = 0
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("navigator", {
    getGamepads: () => [
      {
        axes: [0, 0],
        buttons: Array.from({ length: 16 }, (_, index) => ({
          pressed: pressedButtons.includes(index),
        })),
        connected: true,
      },
    ],
  })
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    nextFrame = callback
    return 1
  })
  vi.stubGlobal("cancelAnimationFrame", vi.fn())
  vi.stubGlobal("matchMedia", () => ({ matches: false }))
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockReturnValue(document.body)
  container = document.createElement("div")
  document.body.append(container)
  document.addEventListener("keydown", recordKey)
})
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.removeEventListener("keydown", recordKey)
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
const target = (id: string): HTMLElement => {
  const element = container.querySelector<HTMLElement>(`[data-focus-id="${id}"]`)
  if (element === null) throw new Error(`Missing ${id}`)
  return element
}
const input = (): HTMLInputElement => {
  const element = container.querySelector<HTMLInputElement>("#channel-search")
  if (element === null) throw new Error("Missing Search input")
  return element
}
const frame = async (buttons: readonly number[] = [], elapsed = 1) => {
  pressedButtons = buttons
  frameTime += elapsed
  for (const element of container.querySelectorAll<HTMLElement>("[data-focusable]"))
    element.scrollIntoView = vi.fn()
  const callback = nextFrame
  if (callback === undefined) throw new Error("No scheduled gamepad frame")
  nextFrame = undefined
  await act(async () => callback(frameTime))
}
const press = async (button: number) => {
  await frame()
  await frame([button])
}
const activate = async (id: string) => {
  target(id).focus()
  await press(0)
}
const typeQuery = async (query: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  if (setter === undefined) throw new Error("Missing native input setter")
  await act(async () => {
    setter.call(input(), query)
    input().dispatchEvent(new Event("input", { bubbles: true }))
  })
}
const mount = async (
  auth: AuthSnapshot = { kind: "guest" },
  configure: (bridge: ReturnType<typeof makeBridge>) => void = () => undefined,
) => {
  const bridge = makeBridge(auth)
  configure(bridge)
  vi.stubGlobal("stillStream", bridge)
  const constructed = vi.fn<(id: string, options: TwitchPlayerOptions) => void>()
  class TestPlayer {
    static readonly OFFLINE = "offline"
    static readonly ONLINE = "online"
    static readonly PAUSE = "pause"
    static readonly PLAY = "play"
    static readonly PLAYBACK_BLOCKED = "blocked"
    static readonly PLAYING = "playing"
    static readonly READY = "ready"
    static readonly SEEK = "seek"
    constructor(id: string, options: TwitchPlayerOptions) {
      constructed(id, options)
    }
    readonly addEventListener = vi.fn()
    readonly pause = vi.fn()
  }
  vi.stubGlobal("Twitch", { Player: TestPlayer })
  root = createRoot(container)
  await act(async () => root?.render(<App />))
  return { bridge, constructed }
}

describe("native gamepad Search shortcuts in App", () => {
  it("lets a guest correct a login, submit and explicitly open one player without catalog or authorization calls", async () => {
    const { bridge, constructed } = await mount()
    await press(2)
    expect(document.activeElement).toBe(input())
    for (const character of "twitchx") await activate(`search-key-${character}`)
    expect(input().value).toBe("twitchx")
    const focused = target("search-key-x")
    await press(2)
    expect(input().value).toBe("twitch")
    for (const elapsed of [500, 100, 1000]) await frame([2], elapsed)
    expect(input().value).toBe("twitch")
    expect(document.activeElement).toBe(focused)
    expect(container.querySelector(".channel-result")).toBeNull()
    await frame([3])
    expect(target("channel-direct-twitch")).toBeDefined()
    for (const elapsed of [500, 100, 1000]) await frame([3], elapsed)
    expect(document.activeElement).toBe(focused)
    expect(constructed).not.toHaveBeenCalled()
    expect(keys).toEqual(["/"])
    target("search-key-submit").focus()
    await press(13)
    expect(document.activeElement).toBe(target("channel-direct-twitch"))
    await press(0)
    expect(constructed).toHaveBeenCalledExactlyOnceWith(
      "twitch-player-root",
      expect.objectContaining({ channel: "twitch" }),
    )
    expect(container.querySelector(".player-view")).not.toBeNull()
    for (const request of Object.values(bridge.catalog)) expect(request).not.toHaveBeenCalled()
    expect(bridge.auth.begin).not.toHaveBeenCalled()
    expect(bridge.auth.openActivation).not.toHaveBeenCalled()
    expect(bridge.auth.logout).not.toHaveBeenCalled()
    expect(bridge.auth.snapshot).toHaveBeenCalledTimes(1)
  })

  it.each([
    { name: "west then overlapping north", presses: [[2], [2, 3], [3]] },
    { name: "both faces together", presses: [[2, 3], [2, 3], [3]] },
  ])("deletes and submits once through Search: $name", async ({ presses }) => {
    const { bridge, constructed } = await mount({
      displayName: "Viewer",
      kind: "authenticated",
      login: "viewer",
    })
    await activate("nav-search")
    await typeQuery("twitchx")
    const focused = input()
    for (const buttons of presses) await frame(buttons)
    await frame([3], 1000)
    expect(input().value).toBe("twitch")
    expect(bridge.catalog.search.mock.calls).toEqual([[{ first: 30, query: "twitch" }]])
    expect(document.activeElement).toBe(focused)
    expect(keys).toEqual([])
    expect(constructed).not.toHaveBeenCalled()
    await press(3)
    expect(bridge.catalog.search.mock.calls).toEqual([
      [{ first: 30, query: "twitch" }],
      [{ first: 30, query: "twitch" }],
    ])
  })

  it("D-cycle-22-2 renders an overlapping delete-and-submit response and reaches its channel by direction", async () => {
    const request = deferred<Page<ChannelCard>>()
    await mount({ displayName: "Viewer", kind: "authenticated", login: "viewer" }, (bridge) =>
      bridge.catalog.search.mockReturnValueOnce(request.promise),
    )
    await activate("nav-search")
    await typeQuery("twitchx")
    for (const buttons of [[2, 3], [2, 3], [3]]) await frame(buttons)
    await frame([3], 1000)
    expect(container.querySelector(".channel-result")).toBeNull()

    await act(async () => request.resolve({ cursor: undefined, items: [result] }))
    const channel = target("channel-12826")
    expect(channel.classList.contains("channel-result")).toBe(true)
    target("search-submit").focus()
    channel.scrollIntoView = vi.fn()
    await act(async () => dispatchControllerKey("ArrowDown"))
    expect(document.activeElement).toBe(channel)
  })

  it("submits the authenticated trimmed query once and consumes presses until the deferred request settles", async () => {
    const { bridge, constructed } = await mount({
      displayName: "Viewer",
      kind: "authenticated",
      login: "viewer",
    })
    const request = deferred<Page<ChannelCard>>()
    bridge.catalog.search.mockReturnValueOnce(request.promise)
    await press(3)
    // Empty Search consumes north rather than navigating or issuing a request.
    await press(3)
    expect(bridge.catalog.search).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(input())
    await typeQuery("  twitch  ")
    await press(3)
    expect(bridge.catalog.search).toHaveBeenCalledExactlyOnceWith({ first: 30, query: "twitch" })
    expect(document.activeElement).toBe(input())
    for (const elapsed of [500, 100, 1000]) await frame([3], elapsed)
    await press(3)
    expect(document.activeElement).toBe(input())
    const focused = target("search-key-q")
    focused.focus()
    await press(3)
    expect(document.activeElement).toBe(focused)
    expect(bridge.catalog.search).toHaveBeenCalledTimes(1)
    expect(container.querySelector(".channel-result")).toBeNull()
    await act(async () => request.resolve({ cursor: undefined, items: [result] }))
    expect(target("channel-12826")).toBeDefined()
    // Settling busy must not turn the held, consumed press into a new submission.
    await frame([3], 1000)
    expect(bridge.catalog.search).toHaveBeenCalledTimes(1)
    await press(3)
    expect(bridge.catalog.search.mock.calls).toEqual([
      [{ first: 30, query: "twitch" }],
      [{ first: 30, query: "twitch" }],
    ])
    expect(input().value).toBe("  twitch  ")
    expect(document.activeElement).toBe(focused)
    expect(keys).toEqual(["/"])
    expect(constructed).not.toHaveBeenCalled()
    expect(bridge.auth.begin).not.toHaveBeenCalled()
  })

  it.each([2, 3])(
    "does not reinterpret held button %s after it opens Search and focus enters the keyboard",
    async (button) => {
      const { bridge, constructed } = await mount()
      await frame([button])
      expect(document.activeElement).toBe(input())
      await typeQuery("twitchx")
      for (const elapsed of [500, 100, 1000]) await frame([button], elapsed)
      expect(input().value).toBe("twitchx")
      expect(container.querySelector(".channel-result")).toBeNull()
      const focused = target("search-key-q")
      focused.focus()
      await frame([button], 1000)
      expect(input().value).toBe("twitchx")
      expect(container.querySelector(".channel-result")).toBeNull()
      await press(button)
      if (button === 2) {
        expect(input().value).toBe("twitch")
        expect(container.querySelector(".channel-result")).toBeNull()
      } else {
        expect(input().value).toBe("twitchx")
        expect(target("channel-direct-twitchx")).toBeDefined()
      }
      expect(document.activeElement).toBe(focused)
      expect(keys).toEqual(["/"])
      expect(constructed).not.toHaveBeenCalled()
      expect(bridge.catalog.search).not.toHaveBeenCalled()
    },
  )

  it("rescues favourites Retry focus to an enabled persistent input while a search request is pending", async () => {
    const searchRequest = deferred<Page<ChannelCard>>()
    const favouritesRetry = deferred<readonly Favourite[]>()
    const { bridge } = await mount(
      { displayName: "Viewer", kind: "authenticated", login: "viewer" },
      (bridge) => {
        bridge.favourites.list
          .mockRejectedValueOnce(new Error("Unreadable favourites"))
          .mockReturnValueOnce(favouritesRetry.promise)
        bridge.catalog.search.mockReturnValueOnce(searchRequest.promise)
      },
    )
    await press(3)
    await typeQuery("twitch")
    target("search-key-submit").focus()
    await press(3)
    expect(target("search-submit").hasAttribute("disabled")).toBe(true)
    expect(target("search-key-submit").hasAttribute("disabled")).toBe(true)
    await press(13)
    expect(document.activeElement).toBe(target("search-favourites-retry"))
    await press(0)
    expect(bridge.favourites.list).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[data-focus-id="search-favourites-retry"]')).toBeNull()
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement).toBe(input())
    expect(input().isConnected).toBe(true)
    expect(input().disabled).toBe(false)
    await act(async () => favouritesRetry.resolve([]))
    expect(document.activeElement).toBe(input())
    await act(async () => searchRequest.resolve({ cursor: undefined, items: [result] }))
    expect(document.activeElement).toBe(input())
    expect(input().isConnected).toBe(true)
    expect(input().disabled).toBe(false)
  })

  it("preserves slash navigation, physical typing, A/B and arrows through the real shell", async () => {
    const { constructed } = await mount()
    await act(async () => dispatchControllerKey("/"))
    await typeQuery("twitch/")
    await act(async () => {
      input().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "/" }))
    })
    expect(input().value).toBe("twitch/")
    expect(document.activeElement).toBe(input())
    await press(13)
    expect(document.activeElement).toBe(target("search-key-q"))
    await press(0)
    expect(input().value).toBe("twitch/q")
    await press(1)
    expect(container.querySelector(".search-view")).toBeNull()
    expect(document.activeElement).toBe(target("nav-home"))
    await press(3)
    expect(document.activeElement).toBe(input())
    await typeQuery("twitch")
    await press(3)
    target("channel-direct-twitch").focus()
    await press(2)
    await press(3)
    expect(input().value).toBe("twitch")
    expect(document.activeElement).toBe(target("channel-direct-twitch"))
    expect(constructed).not.toHaveBeenCalled()
    expect(keys).toEqual(["/", "/", "ArrowDown", "Escape", "/", "/", "/"])
  })
})
