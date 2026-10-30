import { useEffect } from "react"
import { type ControllerState, readControllerState } from "./gamepad-input"

export const FOCUS_DIRECTIONS = ["down", "left", "right", "up"] as const
export type FocusDirection = (typeof FOCUS_DIRECTIONS)[number]

export type FocusCandidate = {
  readonly bottom: number
  readonly id: string
  readonly left: number
  readonly right: number
  readonly top: number
}

const assertNever = (value: never): never => {
  throw new TypeError(`Unhandled focus direction: ${String(value)}`)
}

const center = (start: number, end: number): number => start + (end - start) / 2

export const chooseNextFocus = (
  current: FocusCandidate | undefined,
  candidates: readonly FocusCandidate[],
  direction: FocusDirection,
): FocusCandidate | undefined => {
  if (current === undefined) {
    return candidates[0]
  }
  const currentX = center(current.left, current.right)
  const currentY = center(current.top, current.bottom)

  return candidates
    .filter((candidate) => {
      if (candidate.id === current.id) {
        return false
      }
      switch (direction) {
        case "down":
          return candidate.top >= current.bottom
        case "left":
          return candidate.right <= current.left
        case "right":
          return candidate.left >= current.right
        case "up":
          return candidate.bottom <= current.top
        default:
          return assertNever(direction)
      }
    })
    .map((candidate) => {
      const candidateX = center(candidate.left, candidate.right)
      const candidateY = center(candidate.top, candidate.bottom)
      const primary =
        direction === "left" || direction === "right"
          ? Math.abs(candidateX - currentX)
          : Math.abs(candidateY - currentY)
      const secondary =
        direction === "left" || direction === "right"
          ? Math.abs(candidateY - currentY)
          : Math.abs(candidateX - currentX)
      return { candidate, score: primary + secondary * 2 }
    })
    .sort((left, right) => left.score - right.score)[0]?.candidate
}

export const focusDirectionalOverride = (
  current: HTMLElement,
  direction: FocusDirection,
): HTMLElement | undefined => {
  const insideNavigation = current.closest(".navigation") !== null
  if (insideNavigation) {
    const horizontalNavigation = matchMedia("(width < 45rem)").matches
    const along = horizontalNavigation
      ? direction === "left" || direction === "right"
      : direction === "up" || direction === "down"
    if (along) {
      // Along the navigation's own axis, move between its tabs in their fixed order.
      const forward = direction === "down" || direction === "right"
      const { navNext, navPrevious } = current.dataset
      const neighbourId = forward ? navNext : navPrevious
      if (neighbourId === undefined) return current
      return (
        document.querySelector<HTMLElement>(`.navigation [data-focus-id="${neighbourId}"]`) ??
        undefined
      )
    }
  }
  const { focusDown, focusLeft, focusRight, focusUp } = current.dataset
  let targetId: string | undefined
  switch (direction) {
    case "down":
      targetId = focusDown
      break
    case "left":
      targetId = focusLeft
      break
    case "right":
      targetId = focusRight
      break
    case "up":
      targetId = focusUp
      break
    default:
      return assertNever(direction)
  }
  if (targetId === undefined) return undefined
  return [...document.querySelectorAll<HTMLElement>("[data-focus-id]")].find((element) => {
    const { focusId } = element.dataset
    return focusId === targetId
  })
}

export const markControllerFocus = (element: HTMLElement): void => {
  document
    .querySelector<HTMLElement>('[data-controller-focused="true"]')
    ?.removeAttribute("data-controller-focused")
  element.setAttribute("data-controller-focused", "true")
}

const moveFocusTo = (element: HTMLElement): void => {
  markControllerFocus(element)
  element.focus()
  element.scrollIntoView({
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    block: "nearest",
    inline: "nearest",
  })
}

export const CHAT_GAMEPAD_EVENT = "stillstream:chat-gamepad"
export type ChatGamepadAction = "next" | "previous" | "activate" | "exit" | "consume"
export const SEARCH_GAMEPAD_EVENT = "stillstream:search-gamepad"
export type SearchGamepadAction = "delete" | "submit"
type GamepadInput = string | 2 | 3

const keyboardForGamepad = (
  state: ControllerState,
  dispatchedFaces: ReadonlySet<number>,
): GamepadInput | undefined => {
  const { pressed } = state
  if (pressed.has(0)) return "Enter"
  if (pressed.has(1)) return "Escape"
  if (pressed.has(2) && !dispatchedFaces.has(2)) return 2
  if (pressed.has(3) && !dispatchedFaces.has(3)) return 3
  // Once both edges are handled, held faces retain their priority over lower-priority controls.
  if (pressed.has(2)) return 2
  if (pressed.has(3)) return 3
  if (pressed.has(9)) return "F10"
  if (pressed.has(12) || state.y < -0.55) return "ArrowUp"
  if (pressed.has(13) || state.y > 0.55) return "ArrowDown"
  if (pressed.has(14) || state.x < -0.55) return "ArrowLeft"
  if (pressed.has(15) || state.x > 0.55) return "ArrowRight"
  return undefined
}

const backDismissals: (() => boolean)[] = []

// Back closes the innermost open surface before leaving the screen. Controller Back is dispatched
// on document itself, where capture and bubble listeners run in registration order, so an open
// surface cannot count on intercepting the event first. It registers here and the shell asks.
export const registerBackDismissal = (dismiss: () => boolean): (() => void) => {
  backDismissals.push(dismiss)
  return () => {
    const index = backDismissals.lastIndexOf(dismiss)
    if (index >= 0) backDismissals.splice(index, 1)
  }
}

// Only the surface registered last answers: an outer one must never consume Back for an inner one.
export const dismissOpenSurface = (): boolean => backDismissals.at(-1)?.() === true

export const dispatchControllerKey = (key: string): void => {
  const activeElement = document.activeElement
  if (key === "Enter" && activeElement instanceof HTMLElement) {
    activeElement.click()
    return
  }
  document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }))
}

const dispatchGamepadInput = (input: GamepadInput): void => {
  // Resolve chat semantics only after physical press detection, before any shell click/shortcut.
  const action: ChatGamepadAction =
    input === "Enter"
      ? "activate"
      : input === "Escape"
        ? "exit"
        : input === "ArrowDown" || input === "ArrowRight"
          ? "next"
          : input === "ArrowUp" || input === "ArrowLeft"
            ? "previous"
            : "consume"
  if (
    !document.dispatchEvent(
      new CustomEvent<ChatGamepadAction>(CHAT_GAMEPAD_EVENT, {
        cancelable: true,
        detail: action,
      }),
    )
  )
    return
  if (typeof input === "string") {
    dispatchControllerKey(input)
    return
  }
  const event = new CustomEvent<SearchGamepadAction>(SEARCH_GAMEPAD_EVENT, {
    bubbles: true,
    cancelable: true,
    detail: input === 2 ? "delete" : "submit",
  })
  if (document.activeElement?.dispatchEvent(event) === false) return
  dispatchControllerKey("/")
}

export const shouldPreserveInputArrow = (
  inputHasFocus: boolean,
  eventIsTrusted: boolean,
  key: string,
  hasDirectionalOverride = false,
): boolean =>
  inputHasFocus &&
  eventIsTrusted &&
  !hasDirectionalOverride &&
  (key === "ArrowLeft" || key === "ArrowRight")

export const shouldRepeatControllerKey = (key: string | undefined): boolean =>
  key?.startsWith("Arrow") === true

const installGamepadBridge = (): (() => void) => {
  let animationFrame = 0
  let activeInput: GamepadInput | undefined
  const dispatchedFaces = new Set<number>()
  let pressedAt = 0
  let repeatedAt = 0

  const poll = (now: number): void => {
    // Every connected controller counts: SteamOS can list idle or grabbed devices first.
    const state = readControllerState(navigator.getGamepads())
    // Only a dispatched edge is consumed. A held face must not hide another face's new edge.
    for (const button of dispatchedFaces) {
      if (!state.pressed.has(button)) dispatchedFaces.delete(button)
    }
    const input = keyboardForGamepad(state, dispatchedFaces)
    const changed = typeof input === "number" ? !dispatchedFaces.has(input) : input !== activeInput
    const repeats =
      typeof input === "string" &&
      shouldRepeatControllerKey(input) &&
      now - pressedAt >= 500 &&
      (repeatedAt === 0 || now - repeatedAt >= 100)

    if (input !== undefined && (changed || repeats)) {
      // Latch before dispatch: opening Search or leaving chat cannot reinterpret this press.
      if (typeof input === "number") dispatchedFaces.add(input)
      dispatchGamepadInput(input)
      if (changed) {
        pressedAt = now
        repeatedAt = 0
      } else {
        repeatedAt = now
      }
    }
    if (input === undefined) {
      pressedAt = 0
      repeatedAt = 0
    }
    activeInput = input
    animationFrame = requestAnimationFrame(poll)
  }

  animationFrame = requestAnimationFrame(poll)
  return () => cancelAnimationFrame(animationFrame)
}

export const useControllerNavigation = (): void => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const activeElement = document.activeElement
      const directionByKey: Readonly<Record<string, FocusDirection | undefined>> = {
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
        ArrowUp: "up",
      }
      const direction = directionByKey[event.key]
      const directionalOverride =
        activeElement instanceof HTMLElement && direction !== undefined
          ? focusDirectionalOverride(activeElement, direction)
          : undefined
      if (
        shouldPreserveInputArrow(
          activeElement instanceof HTMLInputElement,
          event.isTrusted,
          event.key,
          directionalOverride !== undefined,
        )
      ) {
        return
      }
      if ((event.key === "Home" || event.key === "End") && activeElement instanceof HTMLElement) {
        const reel = activeElement.closest<HTMLElement>(".shelf__reel, .category-reel")
        const elements = reel?.querySelectorAll<HTMLElement>('[data-focusable="true"]')
        const destination =
          event.key === "Home" ? elements?.[0] : elements?.item((elements.length ?? 0) - 1)
        if (destination !== undefined && destination !== null) {
          event.preventDefault()
          destination.focus()
        }
        return
      }
      if (direction === undefined) return
      if (directionalOverride !== undefined) {
        if (
          !directionalOverride.hasAttribute("disabled") &&
          directionalOverride.offsetParent !== null
        ) {
          event.preventDefault()
          moveFocusTo(directionalOverride)
          return
        }
      }

      // Along the navigation's own axis (Up/Down in the sidebar, Left/Right in the compact bar)
      // only its tabs are candidates, so Down from Search reaches Settings rather than whatever
      // page control happens to be geometrically nearer.
      const navigation =
        activeElement instanceof HTMLElement ? activeElement.closest(".navigation") : null
      const alongNavigation =
        navigation !== null &&
        (matchMedia("(width < 45rem)").matches
          ? direction === "left" || direction === "right"
          : direction === "up" || direction === "down")
      const elements = [
        ...document.querySelectorAll<HTMLElement>('[data-focusable="true"]'),
      ].filter(
        (element) =>
          !element.hasAttribute("disabled") &&
          element.offsetParent !== null &&
          (!alongNavigation || navigation?.contains(element) === true),
      )
      const candidates = elements.map((element, index) => {
        const bounds = element.getBoundingClientRect()
        const { focusId } = element.dataset
        return {
          bottom: bounds.bottom,
          id: focusId ?? String(index),
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
        }
      })
      const activeIndex =
        activeElement instanceof HTMLElement ? elements.indexOf(activeElement) : -1
      const current = activeIndex < 0 ? undefined : candidates[activeIndex]
      const next = chooseNextFocus(current, candidates, direction)
      const nextIndex =
        next === undefined ? -1 : candidates.findIndex((candidate) => candidate.id === next.id)
      const nextElement = nextIndex < 0 ? undefined : elements[nextIndex]
      if (nextElement !== undefined) {
        event.preventDefault()
        moveFocusTo(nextElement)
      }
    }

    document.addEventListener("keydown", onKeyDown)
    const removeGamepadBridge = installGamepadBridge()
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      removeGamepadBridge()
    }
  }, [])
}
