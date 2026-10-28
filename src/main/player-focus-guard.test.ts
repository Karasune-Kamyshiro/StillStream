import { EventEmitter } from "node:events"
import type { Event, Input } from "electron"
import { describe, expect, it, vi } from "vitest"
import { createPlayerFocusGuard } from "./player-focus-guard"

const PLAYER = "https://player.twitch.tv/?channel=example&parent=localhost"
const CHAT = "https://www.twitch.tv/embed/example/chat?parent=localhost"

const harness = () => {
  const window = new EventEmitter()
  const contents = Object.assign(new EventEmitter(), {
    focusedFrame: null as { url: string } | null,
    isDestroyed: () => false,
    mainFrame: {
      executeJavaScript: vi.fn(async (_code: string, _gesture?: boolean) => undefined),
      url: "https://localhost:1234/",
    },
  })
  const release = createPlayerFocusGuard(
    Object.assign(window, { webContents: contents }) as unknown as Parameters<
      typeof createPlayerFocusGuard
    >[0],
  )
  const press = (type: "keyDown" | "keyUp", key = "Escape", isAutoRepeat = false) => {
    const event = { preventDefault: vi.fn() }
    contents.emit(
      "before-input-event",
      event as unknown as Event,
      {
        isAutoRepeat,
        key,
        type,
      } as Input,
    )
    return event.preventDefault
  }
  return { contents, press, release, window }
}

describe("player focus guard", () => {
  it("hands Escape from the focused player iframe to the shell and consumes the press", () => {
    const { contents, press } = harness()
    contents.focusedFrame = { url: PLAYER }
    expect(press("keyDown")).toHaveBeenCalledTimes(1)
    expect(contents.mainFrame.executeJavaScript).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("stillstream:player-escape"),
      true,
    )
    expect(press("keyUp")).toHaveBeenCalledTimes(1)
    // The matching keyUp is the only one consumed.
    expect(press("keyUp")).not.toHaveBeenCalled()
  })

  it("leaves the shell, the chat frame, other keys and Twitch's own fullscreen alone", () => {
    const { contents, press, window } = harness()
    contents.focusedFrame = { url: "https://localhost:1234/" }
    expect(press("keyDown")).not.toHaveBeenCalled()
    contents.focusedFrame = { url: CHAT }
    expect(press("keyDown")).not.toHaveBeenCalled()
    contents.focusedFrame = { url: PLAYER }
    expect(press("keyDown", "Enter")).not.toHaveBeenCalled()
    window.emit("enter-html-full-screen")
    expect(press("keyDown")).not.toHaveBeenCalled()
    window.emit("leave-html-full-screen")
    expect(press("keyDown")).toHaveBeenCalledTimes(1)
    expect(contents.mainFrame.executeJavaScript).toHaveBeenCalledTimes(1)
  })

  it("consumes held repeats without dispatching again and detaches on release", () => {
    const { contents, press, release } = harness()
    contents.focusedFrame = { url: PLAYER }
    press("keyDown")
    expect(press("keyDown", "Escape", true)).toHaveBeenCalledTimes(1)
    expect(contents.mainFrame.executeJavaScript).toHaveBeenCalledTimes(1)
    release()
    expect(contents.listenerCount("before-input-event")).toBe(0)
  })
})
