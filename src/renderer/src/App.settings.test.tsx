import { defaultPreferences, PreferencesSnapshotSchema } from "../../shared/contracts"
// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest"
import type { AuthSnapshot, DeviceChallenge, VacuumStreamApi } from "../../shared/contracts"
import { App } from "./App"
import { dispatchControllerKey } from "./focus-navigation"
import * as playerModule from "./twitch-player"
import * as controllerModule from "./useAppController"

const challenge: DeviceChallenge = {
  expiresAt: "2026-09-22T21:00:00.000Z",
  flowId: "123e4567-e89b-12d3-a456-426614174000",
  intervalSeconds: 5,
  userCode: "ABCD-1234",
  verificationUri: "https://www.twitch.tv/activate",
}
const authenticated: AuthSnapshot = {
  displayName: "Fixture Viewer",
  kind: "authenticated",
  login: "fixture_viewer",
}
const authorizing: AuthSnapshot = { challenge, kind: "authorizing" }
const states: readonly { readonly auth: AuthSnapshot; readonly id: string }[] = [
  { auth: { kind: "guest" }, id: "settings-sign-in" },
  { auth: authorizing, id: "settings-open-activation" },
  { auth: authenticated, id: "settings-logout" },
  { auth: { kind: "error", message: "access_denied" }, id: "settings-sign-in" },
]
const deferred = <T,>() => {
  let controls:
    | { readonly reject: (error: Error) => void; readonly resolve: (value: T) => void }
    | undefined
  const promise = new Promise<T>((resolve, reject) => {
    controls = { reject, resolve }
  })
  if (controls === undefined) throw new Error("Promise executor did not run")
  return { ...controls, promise }
}
const makeBridge = (auth: AuthSnapshot) => {
  const begin = vi.fn<VacuumStreamApi["auth"]["begin"]>()
  return makeBridgeWith(auth, begin)
}
// One-click setup is modelled as the viewer closing the Twitch window once the code was issued,
// which leaves the account authorizing exactly as the device flow does. Races stay on `begin`.
const makeBridgeWith = (auth: AuthSnapshot, begin: Mock<VacuumStreamApi["auth"]["begin"]>) =>
  ({
    auth: {
      begin,
      logout: vi.fn<VacuumStreamApi["auth"]["logout"]>().mockResolvedValue(undefined),
      openActivation: vi
        .fn<VacuumStreamApi["auth"]["openActivation"]>()
        .mockResolvedValue(undefined),
      setup: vi.fn<VacuumStreamApi["auth"]["setup"]>(async () => ({
        auth: { challenge: await begin(), kind: "authorizing" },
        player: { signedIn: false },
      })),
      snapshot: vi.fn<VacuumStreamApi["auth"]["snapshot"]>().mockResolvedValue(auth),
    },
    catalog: {
      followed: vi
        .fn<VacuumStreamApi["catalog"]["followed"]>()
        .mockResolvedValue({ cursor: undefined, items: [] }),
      followedChannels: vi
        .fn<VacuumStreamApi["catalog"]["followedChannels"]>()
        .mockResolvedValue({ cursor: undefined, items: [] }),
      live: vi
        .fn<VacuumStreamApi["catalog"]["live"]>()
        .mockResolvedValue({ cursor: undefined, items: [] }),
      search: vi
        .fn<VacuumStreamApi["catalog"]["search"]>()
        .mockResolvedValue({ cursor: undefined, items: [] }),
      topCategories: vi
        .fn<VacuumStreamApi["catalog"]["topCategories"]>()
        .mockResolvedValue({ cursor: undefined, items: [] }),
      videos: vi
        .fn<VacuumStreamApi["catalog"]["videos"]>()
        .mockResolvedValue({ cursor: undefined, items: [] }),
    },
    chatInput: {
      begin: vi.fn<VacuumStreamApi["chatInput"]["begin"]>(),
      end: vi.fn<VacuumStreamApi["chatInput"]["end"]>(),
      onEscape: vi.fn<VacuumStreamApi["chatInput"]["onEscape"]>(),
      press: vi.fn<VacuumStreamApi["chatInput"]["press"]>().mockResolvedValue(undefined),
    },
    favourites: {
      add: vi.fn<VacuumStreamApi["favourites"]["add"]>(),
      list: vi.fn<VacuumStreamApi["favourites"]["list"]>().mockResolvedValue([]),
      remove: vi.fn<VacuumStreamApi["favourites"]["remove"]>(),
    },
    playbackProgress: {
      get: vi.fn<VacuumStreamApi["playbackProgress"]["get"]>(),
      list: vi.fn<VacuumStreamApi["playbackProgress"]["list"]>().mockResolvedValue([]),
      remove: vi.fn<VacuumStreamApi["playbackProgress"]["remove"]>(),
      save: vi.fn<VacuumStreamApi["playbackProgress"]["save"]>(),
    },
    preferences: {
      setStartScreen: vi.fn<VacuumStreamApi["preferences"]["setStartScreen"]>(),
      update: vi.fn<VacuumStreamApi["preferences"]["update"]>(),
      snapshot: vi
        .fn<VacuumStreamApi["preferences"]["snapshot"]>()
        .mockResolvedValue({ ...defaultPreferences(), startFullscreen: false }),
    },
    playerSession: {
      signIn: vi
        .fn<VacuumStreamApi["playerSession"]["signIn"]>()
        .mockResolvedValue({ signedIn: false }),
      signOut: vi
        .fn<VacuumStreamApi["playerSession"]["signOut"]>()
        .mockResolvedValue({ signedIn: false }),
      snapshot: vi
        .fn<VacuumStreamApi["playerSession"]["snapshot"]>()
        .mockResolvedValue({ signedIn: false }),
    },
    settings: {
      saveClientId: vi.fn<VacuumStreamApi["settings"]["saveClientId"]>(),
      snapshot: vi
        .fn<VacuumStreamApi["settings"]["snapshot"]>()
        .mockResolvedValue({ clientId: "abcdefghijklmnopqrstuvwxyz1234", secureStorage: false }),
    },
    system: {
      activateEmbeddedPlayer: vi.fn<VacuumStreamApi["system"]["activateEmbeddedPlayer"]>(),
      isSteamGameMode: vi.fn<VacuumStreamApi["system"]["isSteamGameMode"]>(),
      restoreShellFullscreen: vi
        .fn<VacuumStreamApi["system"]["restoreShellFullscreen"]>()
        .mockResolvedValue(false),
      onWindowActive: vi
        .fn<VacuumStreamApi["system"]["onWindowActive"]>()
        .mockReturnValue(() => undefined),
      setPlayerLowLatency: vi
        .fn<VacuumStreamApi["system"]["setPlayerLowLatency"]>()
        .mockResolvedValue(null),
      setFullscreen: vi.fn<VacuumStreamApi["system"]["setFullscreen"]>().mockResolvedValue(false),
      toggleFullscreen: vi.fn<VacuumStreamApi["system"]["toggleFullscreen"]>(),
    },
  }) satisfies VacuumStreamApi

let root: Root | undefined
let container: HTMLDivElement
let observedController: ReturnType<typeof controllerModule.useAppController> | undefined
const realController = controllerModule.useAppController
let compactNavigation = false
beforeEach(() => {
  // Authentication delivery is explicitly controlled, never driven by the poll interval.
  vi.useFakeTimers()
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  )
  vi.stubGlobal("cancelAnimationFrame", vi.fn())
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(width < 45rem)" ? compactNavigation : true,
  }))
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockReturnValue(document.body)
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  })
  vi.spyOn(controllerModule, "useAppController").mockImplementation(() => {
    observedController = realController()
    return observedController
  })
  compactNavigation = false
  container = document.createElement("div")
  document.body.append(container)
})
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  observedController = undefined
  document.body.replaceChildren()
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView")
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
const controller = () => {
  if (observedController === undefined) throw new Error("App is not mounted")
  return observedController
}
const target = (id: string): HTMLElement => {
  const element = container.querySelector<HTMLElement>(`[data-focus-id="${id}"]`)
  if (element === null) throw new Error(`Missing focus target ${id}`)
  return element
}
const key = async (value: string) => {
  await act(async () => dispatchControllerKey(value))
}
const activate = async (id: string) => {
  target(id).focus()
  await key("Enter")
}
const mount = async (auth: AuthSnapshot = { kind: "guest" }) => {
  const bridge = makeBridge(auth)
  vi.stubGlobal("vacuumStream", bridge)
  root = createRoot(container)
  await act(async () => root?.render(<App />))
  await activate("nav-settings")
  return bridge
}
const deliverAuth = async (auth: AuthSnapshot) => {
  const snapshot = deferred<AuthSnapshot>()
  // Subscribe the real controller before delivering the upstream authentication result.
  const delivered = snapshot.promise.then((next) => controller().setAuth(next))
  await act(async () => {
    snapshot.resolve(auth)
    await delivered
  })
}
const secondaryAction = (auth: AuthSnapshot, playerLoaded: boolean): string | undefined =>
  auth.kind === "guest" || auth.kind === "error"
    ? "settings-sign-in-device"
    : auth.kind === "authenticated" && playerLoaded
      ? "settings-player-session"
      : undefined
const expectFocus = (id: string) => {
  expect(document.activeElement?.getAttribute("data-focus-id")).toBe(id)
  expect(document.activeElement).toBe(target(id))
}

describe("Settings in the mounted App", () => {
  describe.each([false, true])("compact navigation: %s", (compact) => {
    it.each(states)(
      "enters the current account action from selected Settings: $auth.kind",
      async ({ auth, id }) => {
        compactNavigation = compact
        await mount(auth)
        expectFocus("nav-settings")
        await key(compact ? "ArrowDown" : "ArrowRight")
        expectFocus(id)
        const below = secondaryAction(auth, true)
        await key("ArrowDown")
        if (below !== undefined) {
          expectFocus(below)
          await key("ArrowDown")
        }
        expectFocus("settings-client-id")
        await key("ArrowDown")
        expectFocus("settings-save")
        await key("ArrowUp")
        expectFocus("settings-client-id")
        await key("ArrowUp")
        if (below !== undefined) {
          expectFocus(below)
          await key("ArrowUp")
        }
        expectFocus(id)
        // Left returns to the tab the viewer came from (Home here), not to Settings.
        await key("ArrowLeft")
        expectFocus("nav-home")
      },
    )
  })

  it.each(states)(
    "declares account-first boundaries before effects: $auth.kind",
    ({ auth, id }) => {
      vi.mocked(controllerModule.useAppController).mockImplementation(() => ({
        ...realController(),
        auth,
        screen: { kind: "browse", route: "settings" },
      }))
      container.innerHTML = renderToStaticMarkup(<App />)
      expect(target("nav-settings").getAttribute("data-focus-right")).toBe(id)
      expect(target("nav-settings").getAttribute("data-focus-down")).toBe(id)
      // Static markup has no player snapshot yet, so only the device-code fallback can appear.
      const below = secondaryAction(auth, false)
      expect(target(id).getAttribute("data-focus-down")).toBe(below ?? "settings-client-id")
      if (below !== undefined) {
        expect(target(below).getAttribute("data-focus-up")).toBe(id)
        expect(target(below).getAttribute("data-focus-down")).toBe("settings-client-id")
      }
      expect(target(id).getAttribute("data-focus-left")).toBe("nav-home")
      expect(target(id).getAttribute("data-focus-up")).toBe("nav-settings")
      expect(target("settings-client-id").getAttribute("data-focus-up")).toBe(below ?? id)
      expect(target("settings-client-id").getAttribute("data-focus-down")).toBe("settings-save")
      expect(target("settings-save").getAttribute("data-focus-up")).toBe("settings-client-id")
      expect(
        [...container.querySelectorAll(".settings-card")].map((card) =>
          card.getAttribute("aria-labelledby"),
        ),
      ).toEqual([
        "account-heading",
        "developer-app-heading",
        "player-behaviour-heading",
        "chat-heading",
      ])
      expect(
        container.querySelectorAll(
          '#account-heading ~ button, [aria-labelledby="account-heading"] button',
        ),
      ).toHaveLength(below === undefined ? 1 : 2)
    },
  )

  it("preserves the challenge and exact activation flowId without saving settings or constructing a player", async () => {
    const loadPlayer = vi.spyOn(playerModule, "loadTwitchPlayerApi")
    const Player = vi.fn()
    vi.stubGlobal("Twitch", { Player })
    const bridge = await mount()
    const begin = deferred<DeviceChallenge>()
    bridge.auth.begin.mockReturnValueOnce(begin.promise)
    const outgoing = target("settings-sign-in")
    await activate("settings-sign-in")
    await act(async () => begin.resolve(challenge))
    expect(controller().auth.kind === "authorizing" && controller().auth).toEqual(authorizing)
    const auth = controller().auth
    expect(auth.kind === "authorizing" && auth.challenge).toBe(challenge)
    expect(target("settings-open-activation")).toBe(outgoing)
    expectFocus("settings-open-activation")
    await key("Enter")
    expect(bridge.auth.openActivation).toHaveBeenCalledExactlyOnceWith(challenge.flowId)
    await deliverAuth(authenticated)
    expect(target("settings-logout")).toBe(outgoing)
    expectFocus("settings-logout")
    await key("ArrowDown")
    expectFocus("settings-player-session")
    expect(bridge.auth.setup).toHaveBeenCalledTimes(1)
    expect(bridge.settings.saveClientId).not.toHaveBeenCalled()
    expect(loadPlayer).not.toHaveBeenCalled()
    expect(Player).not.toHaveBeenCalled()
    expect(container.querySelector(".player-view")).toBeNull()
  })

  it("does not steal Client ID editor focus or unsaved text across authentication changes", async () => {
    const bridge = await mount()
    const begin = deferred<DeviceChallenge>()
    bridge.auth.begin.mockReturnValueOnce(begin.promise)
    await activate("settings-sign-in")
    const input = target("settings-client-id")
    if (!(input instanceof HTMLInputElement)) throw new Error("Missing Client ID editor")
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    if (setter === undefined) throw new Error("Missing native input setter")
    input.focus()
    await act(async () => {
      setter.call(input, "unsavedclientidentifier1234")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => begin.resolve(challenge))
    expectFocus("settings-client-id")
    for (const auth of [
      authenticated,
      { kind: "guest" } as const,
      authorizing,
      { kind: "error", message: "expired_token" } as const,
    ]) {
      await deliverAuth(auth)
      expectFocus("settings-client-id")
      expect(input.value).toBe("unsavedclientidentifier1234")
    }
    expect(bridge.settings.saveClientId).not.toHaveBeenCalled()
  })

  it("keeps the newer challenge when begin requests complete newer-then-older across a Settings remount", async () => {
    const bridge = await mount()
    const older = deferred<DeviceChallenge>()
    const newer = deferred<DeviceChallenge>()
    const olderChallenge = { ...challenge, userCode: "CODE0001" }
    const newerChallenge = {
      ...challenge,
      flowId: "123e4567-e89b-12d3-a456-426614174001",
      userCode: "CODE0002",
    }
    bridge.auth.begin.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    await activate("settings-sign-in")
    await activate("nav-search")
    await activate("nav-settings")
    await activate("settings-sign-in")
    expect(bridge.auth.begin).toHaveBeenCalledTimes(2)
    await act(async () => newer.resolve(newerChallenge))
    expect(container.querySelector(".device-code strong")?.textContent).toBe("CODE0002")
    await act(async () => older.resolve(olderChallenge))
    expect(container.querySelector(".device-code strong")?.textContent).toBe("CODE0002")
    expect(controller().auth).toEqual({ challenge: newerChallenge, kind: "authorizing" })
    expectFocus("settings-open-activation")
    await key("Enter")
    expect(bridge.auth.openActivation).toHaveBeenCalledExactlyOnceWith(newerChallenge.flowId)
  })

  it("keeps the remounted request pending and guarded when an older begin settles first", async () => {
    const bridge = await mount()
    const older = deferred<DeviceChallenge>()
    const newer = deferred<DeviceChallenge>()
    bridge.auth.begin.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    await activate("settings-sign-in")
    await activate("nav-search")
    await activate("nav-settings")
    await activate("settings-sign-in")
    await act(async () => older.resolve({ ...challenge, userCode: "CODE0001" }))
    expect(controller().auth).toEqual({ kind: "guest" })
    expect(target("settings-sign-in").getAttribute("aria-busy")).toBe("true")
    await key("Enter")
    expect(bridge.auth.begin).toHaveBeenCalledTimes(2)
    await act(async () => newer.resolve(challenge))
    expect(controller().auth).toEqual(authorizing)
    expectFocus("settings-open-activation")
  })

  it.each(["begin", "logout"] as const)(
    "discards pending %s after an upstream account change without a remount",
    async (operation) => {
      const bridge = await mount(operation === "logout" ? authenticated : { kind: "guest" })
      const pending = deferred<DeviceChallenge>()
      bridge.auth.begin.mockReturnValueOnce(pending.promise)
      bridge.auth.logout.mockImplementationOnce(async () => {
        await pending.promise
      })
      await activate(operation === "logout" ? "settings-logout" : "settings-sign-in")
      const newerAuth: AuthSnapshot = {
        displayName: "New Viewer",
        kind: "authenticated",
        login: "new_viewer",
      }
      await deliverAuth(newerAuth)
      await act(async () => pending.resolve(challenge))
      expect(controller().auth).toEqual(newerAuth)
      expectFocus("settings-logout")
      expect(target("settings-logout").getAttribute("aria-disabled")).toBe("false")
    },
  )

  it("does not let an old logout remove a newer challenge after a Settings remount", async () => {
    const bridge = await mount(authenticated)
    const logout = deferred<void>()
    const begin = deferred<DeviceChallenge>()
    bridge.auth.logout.mockReturnValueOnce(logout.promise)
    bridge.auth.begin.mockReturnValueOnce(begin.promise)
    await activate("settings-logout")
    await activate("nav-search")
    // The upstream session is now guest while the original logout response is still in flight.
    await deliverAuth({ kind: "guest" })
    await activate("nav-settings")
    await activate("settings-sign-in")
    await act(async () => begin.resolve(challenge))
    expect(controller().auth).toEqual(authorizing)
    await act(async () => logout.resolve(undefined))
    expect(controller().auth).toEqual(authorizing)
    expect(container.querySelector(".device-code strong")?.textContent).toBe(challenge.userCode)
    expectFocus("settings-open-activation")
  })

  it.each([
    { destination: "home", outgoing: "home-refresh", survivor: "home-sign-in" },
    { destination: "following", outgoing: "following-refresh", survivor: "following-connect" },
    { destination: "settings", outgoing: "settings-logout", survivor: "settings-sign-in" },
  ])(
    "keeps connected enabled focus when logout completes on $destination",
    async ({ destination, outgoing, survivor }) => {
      const bridge = await mount(authenticated)
      const logout = deferred<void>()
      bridge.auth.logout.mockReturnValueOnce(logout.promise)
      await activate("settings-logout")
      if (destination !== "settings") {
        await activate(`nav-${destination}`)
        await key("ArrowRight")
      }
      expectFocus(outgoing)
      const focused = target(outgoing)
      await act(async () => logout.resolve(undefined))
      expect(controller().auth).toEqual({ kind: "guest" })
      expect(container.querySelector(`[data-focus-id="${outgoing}"]`)).toBeNull()
      expect(document.activeElement).not.toBe(document.body)
      expectFocus(survivor)
      expect(target(survivor).isConnected).toBe(true)
      expect(target(survivor).hasAttribute("disabled")).toBe(false)
      expect(target(survivor).getAttribute("aria-disabled")).not.toBe("true")
      expect(target(`nav-${destination}`).getAttribute("data-focus-right")).toBe(survivor)
      if (destination === "settings") expect(target(survivor)).toBe(focused)
      else expect(focused.isConnected).toBe(false)
    },
  )

  it("does not reclaim Home focus when logout removes a previously focused Refresh", async () => {
    const bridge = await mount(authenticated)
    const logout = deferred<void>()
    bridge.auth.logout.mockReturnValueOnce(logout.promise)
    await activate("settings-logout")
    await activate("nav-home")
    await key("ArrowRight")
    expectFocus("home-refresh")
    await key("ArrowLeft")
    expectFocus("nav-home")
    await act(async () => logout.resolve(undefined))
    expect(container.querySelector('[data-focus-id="home-refresh"]')).toBeNull()
    expectFocus("nav-home")
  })

  it.each(["begin", "logout", "openActivation"] as const)(
    "does not navigate back after leaving Settings during %s",
    async (operation) => {
      const bridge = await mount(
        operation === "logout"
          ? authenticated
          : operation === "openActivation"
            ? authorizing
            : { kind: "guest" },
      )
      const pending = deferred<DeviceChallenge>()
      bridge.auth.begin.mockReturnValue(pending.promise)
      bridge.auth.logout.mockImplementation(async () => {
        await pending.promise
      })
      bridge.auth.openActivation.mockImplementation(async () => {
        await pending.promise
      })
      await activate(
        operation === "logout"
          ? "settings-logout"
          : operation === "openActivation"
            ? "settings-open-activation"
            : "settings-sign-in",
      )
      await activate("nav-search")
      const focused = target("search-input")
      expect(document.activeElement).toBe(focused)
      await act(async () => pending.resolve(challenge))
      await deliverAuth(operation === "logout" ? { kind: "guest" } : authenticated)
      expect(controller().screen).toEqual({ kind: "browse", route: "search" })
      expect(document.activeElement).toBe(focused)
      expect(container.querySelector(".settings-panel")).toBeNull()
    },
  )
})

describe("Start screen preference", () => {
  const start = async (auth: AuthSnapshot, startScreen: "following" | "home") => {
    const bridge = makeBridge(auth)
    bridge.preferences.snapshot.mockResolvedValue({ ...defaultPreferences(), startScreen })
    bridge.preferences.setStartScreen.mockImplementation(async (next) => ({
      ...defaultPreferences(),
      startScreen: next,
    }))
    vi.stubGlobal("vacuumStream", bridge)
    root = createRoot(container)
    await act(async () => root?.render(<App />))
    return bridge
  }

  it("opens Following at startup and returns there on Back when the viewer prefers it", async () => {
    await start(authenticated, "following")
    expect(controller().screen).toEqual({ kind: "browse", route: "following" })
    await act(async () => controller().navigate("search"))
    await key("Escape")
    expect(controller().screen).toEqual({ kind: "browse", route: "following" })
    // Back on the start screen itself stays put.
    await key("Escape")
    expect(controller().screen).toEqual({ kind: "browse", route: "following" })
  })

  it("keeps guests on Home even when Following is preferred", async () => {
    await start({ kind: "guest" }, "following")
    expect(controller().screen).toEqual({ kind: "browse", route: "home" })
  })

  it("saves the choice from the Settings checkbox", async () => {
    const bridge = await start(authenticated, "home")
    await activate("nav-settings")
    const toggle = target("settings-start-following")
    // A real button, so a TV remote's OK (Enter) and Space both activate it natively.
    expect(toggle).toBeInstanceOf(HTMLButtonElement)
    expect(toggle.getAttribute("role")).toBe("switch")
    expect(toggle.getAttribute("aria-checked")).toBe("false")
    expect(target("settings-save").getAttribute("data-focus-down")).toBe("settings-start-following")
    await activate("settings-start-following")
    expect(bridge.preferences.setStartScreen).toHaveBeenCalledExactlyOnceWith("following")
    expect(controller().startScreen).toBe("following")
    expect(toggle.getAttribute("aria-checked")).toBe("true")
    expectFocus("settings-start-following")
    await activate("settings-start-following")
    expect(bridge.preferences.setStartScreen).toHaveBeenLastCalledWith("home")
    expect(toggle.getAttribute("aria-checked")).toBe("false")
  })
})

describe("Chat preferences", () => {
  it("saves each chat option from Settings, cycling values with the remote's OK", async () => {
    const bridge = makeBridge(authenticated)
    let saved = defaultPreferences()
    bridge.preferences.snapshot.mockResolvedValue(saved)
    bridge.preferences.update.mockImplementation(async (update) => {
      saved = PreferencesSnapshotSchema.parse({ ...saved, ...update })
      return saved
    })
    vi.stubGlobal("vacuumStream", bridge)
    root = createRoot(container)
    await act(async () => root?.render(<App />))
    await activate("nav-settings")
    for (const id of [
      "settings-chat-dark",
      "settings-chat-overlay",
      "settings-chat-position",
      "settings-chat-size",
      "settings-chat-opacity",
      "settings-chat-text",
    ]) {
      expect(target(id)).toBeInstanceOf(HTMLButtonElement)
    }
    expect(target("settings-chat-dark").getAttribute("aria-checked")).toBe("true")
    await activate("settings-chat-dark")
    await activate("settings-chat-overlay")
    await activate("settings-chat-position")
    await activate("settings-chat-position")
    await activate("settings-chat-text")
    expect(bridge.preferences.update.mock.calls.map(([update]) => update)).toEqual([
      { chatTheme: "light" },
      { chatLayout: "overlay" },
      { chatOverlayPosition: "bottom-right" },
      { chatOverlayPosition: "top-right" },
      { chatTextSize: "large" },
    ])
    expect(target("settings-chat-position").textContent).toBe("Overlay positionTop right")
    expect(target("settings-chat-overlay").getAttribute("aria-checked")).toBe("true")
    expect(target("settings-chat-text").getAttribute("data-focus-up")).toBe("settings-chat-opacity")
  })
})

describe("Stream fullscreen preference", () => {
  it("is on by default and saves from the Player behaviour card", async () => {
    const bridge = makeBridge(authenticated)
    let saved = PreferencesSnapshotSchema.parse({})
    bridge.preferences.snapshot.mockResolvedValue(saved)
    bridge.preferences.update.mockImplementation(async (update) => {
      saved = PreferencesSnapshotSchema.parse({ ...saved, ...update })
      return saved
    })
    vi.stubGlobal("vacuumStream", bridge)
    root = createRoot(container)
    await act(async () => root?.render(<App />))
    await activate("nav-settings")
    const toggle = target("settings-start-fullscreen")
    expect(toggle.getAttribute("aria-checked")).toBe("true")
    expect(target("settings-start-following").getAttribute("data-focus-down")).toBe(
      "settings-start-fullscreen",
    )
    expect(target("settings-start-fullscreen").getAttribute("data-focus-down")).toBe(
      "settings-pause-inactive",
    )
    expect(target("settings-chat-dark").getAttribute("data-focus-up")).toBe(
      "settings-pause-inactive",
    )
    await activate("settings-start-fullscreen")
    expect(bridge.preferences.update).toHaveBeenCalledExactlyOnceWith({ startFullscreen: false })
    expect(toggle.getAttribute("aria-checked")).toBe("false")
  })
})

describe("Settings return path", () => {
  it("sends Left from Settings back to the tab the viewer came from", async () => {
    const bridge = makeBridge(authenticated)
    vi.stubGlobal("vacuumStream", bridge)
    root = createRoot(container)
    await act(async () => root?.render(<App />))
    await activate("nav-following")
    await activate("nav-settings")
    // The Client ID field keeps Left/Right for its text cursor.
    for (const id of ["settings-logout", "settings-save", "settings-chat-dark"]) {
      expect(target(id).getAttribute("data-focus-left")).toBe("nav-following")
    }
    target("settings-chat-dark").focus()
    await key("ArrowLeft")
    expectFocus("nav-following")
  })

  it("saves the background pause switch, off by default", async () => {
    const bridge = makeBridge(authenticated)
    let saved = PreferencesSnapshotSchema.parse({})
    bridge.preferences.snapshot.mockResolvedValue(saved)
    bridge.preferences.update.mockImplementation(async (update) => {
      saved = PreferencesSnapshotSchema.parse({ ...saved, ...update })
      return saved
    })
    vi.stubGlobal("vacuumStream", bridge)
    root = createRoot(container)
    await act(async () => root?.render(<App />))
    await activate("nav-settings")
    const toggle = target("settings-pause-inactive")
    expect(toggle.getAttribute("aria-checked")).toBe("false")
    await activate("settings-pause-inactive")
    expect(bridge.preferences.update).toHaveBeenCalledExactlyOnceWith({ pauseWhenInactive: true })
    expect(toggle.getAttribute("aria-checked")).toBe("true")
  })
})

describe("Sidebar navigation", () => {
  it("moves Up/Down between tabs only, never into the page beside them", async () => {
    compactNavigation = false
    const bridge = makeBridge(authenticated)
    vi.stubGlobal("vacuumStream", bridge)
    root = createRoot(container)
    await act(async () => root?.render(<App />))
    await activate("nav-search")
    target("nav-search").focus()
    await key("ArrowDown")
    expectFocus("nav-settings")
    await key("ArrowUp")
    expectFocus("nav-search")
    await key("ArrowUp")
    expectFocus("nav-following")
  })
})
