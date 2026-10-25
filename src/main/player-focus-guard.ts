import type { BrowserWindow, Event, Input } from "electron"

type GuardFrame = {
  readonly executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown>
  readonly url: string
}
type GuardContents = {
  readonly focusedFrame: { readonly url: string } | null
  readonly isDestroyed: () => boolean
  readonly mainFrame: GuardFrame
  readonly on: (event: "before-input-event", listener: (event: Event, input: Input) => void) => void
  readonly removeListener: (
    event: "before-input-event",
    listener: (event: Event, input: Input) => void,
  ) => void
}
type GuardWindow = Pick<BrowserWindow, "on" | "removeListener"> & {
  readonly webContents: GuardContents
}

// Fixed script, no renderer input: tells the shell that Escape was pressed inside the player.
const PLAYER_ESCAPE_SCRIPT =
  'document.dispatchEvent(new CustomEvent("vacuumstream:player-escape")); undefined'

const isTwitchPlayerUrl = (value: string): boolean =>
  URL.canParse(value) && new URL(value).origin === "https://player.twitch.tv"

/**
 * A click on the official player gives its cross-origin iframe keyboard focus, after which no
 * key reaches the controller-first shell. Main sees input first, so Escape pressed while the
 * player frame is focused is consumed here and handed to the shell, which reclaims focus.
 * Twitch's own HTML fullscreen keeps Escape, so the player can leave that mode itself.
 */
export const createPlayerFocusGuard = (window: GuardWindow): (() => void) => {
  const contents = window.webContents
  let htmlFullscreen = false
  let swallowKeyUp = false

  const enterHtmlFullscreen = (): void => {
    htmlFullscreen = true
  }
  const leaveHtmlFullscreen = (): void => {
    htmlFullscreen = false
  }
  const onInput = (event: Event, input: Input): void => {
    if (input.key !== "Escape") return
    if (input.type === "keyUp") {
      if (swallowKeyUp) {
        swallowKeyUp = false
        event.preventDefault()
      }
      return
    }
    if (input.type !== "keyDown" || htmlFullscreen) return
    const focused = contents.focusedFrame
    if (focused === null || !isTwitchPlayerUrl(focused.url)) return
    event.preventDefault()
    swallowKeyUp = true
    if (input.isAutoRepeat || contents.isDestroyed()) return
    void contents.mainFrame.executeJavaScript(PLAYER_ESCAPE_SCRIPT, true).catch(() => undefined)
  }

  window.on("enter-html-full-screen", enterHtmlFullscreen)
  window.on("leave-html-full-screen", leaveHtmlFullscreen)
  contents.on("before-input-event", onInput)
  return () => {
    window.removeListener("enter-html-full-screen", enterHtmlFullscreen)
    window.removeListener("leave-html-full-screen", leaveHtmlFullscreen)
    // Plain event-emitter cleanup; safe even once the page has been destroyed.
    contents.removeListener("before-input-event", onInput)
  }
}
