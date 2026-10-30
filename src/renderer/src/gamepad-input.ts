/**
 * Reads every connected controller into one standard-layout state.
 *
 * SteamOS often exposes more than one gamepad for a single physical controller: with Steam Input
 * the real device stays listed (Steam grabs it, so it never reports a press) next to Steam's
 * virtual Xbox 360 pad, and without Steam Input other phantom devices can come first. Reading
 * only the first connected gamepad therefore ignored Xbox-style controllers, while a Switch Pro
 * controller, which Chromium reads over hidraw, happened to work. All pads are merged instead.
 *
 * Chromium only reports the W3C "standard" mapping for controllers it recognises. Others arrive
 * in Linux evdev order, which is translated here so A, B, Start and the d-pad still line up.
 */

type PadLike = Pick<Gamepad, "axes" | "buttons" | "connected"> &
  Partial<Pick<Gamepad, "id" | "index" | "mapping">>

export type ControllerState = {
  /** Pressed buttons, as indices of the W3C standard gamepad layout. */
  readonly pressed: ReadonlySet<number>
  /** Left stick, the strongest deflection across all controllers. */
  readonly x: number
  readonly y: number
}

export const EMPTY_CONTROLLER_STATE: ControllerState = { pressed: new Set(), x: 0, y: 0 }

// Linux evdev button order (A, B, X, Y, LB, RB, Back, Start, Guide, LS, RS) → standard indices.
const EVDEV_TO_STANDARD = [0, 1, 2, 3, 4, 5, 8, 9, 16, 10, 11] as const
// Drivers that report the d-pad as buttons append them after the sticks: left, right, up, down.
const EVDEV_DPAD_BUTTONS = [14, 15, 12, 13] as const
const HAT_THRESHOLD = 0.5

const isStandard = (pad: PadLike): boolean => pad.mapping !== ""

const isPressed = (button: GamepadButton | undefined): boolean =>
  button?.pressed === true || (button?.value ?? 0) > 0.5

const standardPressed = (pad: PadLike, pressed: Set<number>): void => {
  if (isStandard(pad)) {
    pad.buttons.forEach((button, index) => {
      if (isPressed(button)) pressed.add(index)
    })
    return
  }
  pad.buttons.forEach((button, index) => {
    if (!isPressed(button)) return
    const mapped =
      index < EVDEV_TO_STANDARD.length
        ? EVDEV_TO_STANDARD[index]
        : EVDEV_DPAD_BUTTONS[index - EVDEV_TO_STANDARD.length]
    if (mapped !== undefined) pressed.add(mapped)
  })
  // The d-pad as a hat switch: the two axes after the sticks and triggers. A trigger in that slot
  // would rest at -1 and hold Left or Up forever, so an axis only counts once it has been seen
  // centred, which a hat is whenever the d-pad is released.
  if (pad.axes.length >= 8) {
    const hatX = hatAxis(pad, 6)
    const hatY = hatAxis(pad, 7)
    if (hatX < -HAT_THRESHOLD) pressed.add(14)
    if (hatX > HAT_THRESHOLD) pressed.add(15)
    if (hatY < -HAT_THRESHOLD) pressed.add(12)
    if (hatY > HAT_THRESHOLD) pressed.add(13)
  }
}

const centredHats = new Set<string>()

const hatAxis = (pad: PadLike, axis: number): number => {
  const value = pad.axes[axis] ?? 0
  const key = `${pad.index ?? -1}:${pad.id ?? ""}:${axis}`
  if (Math.abs(value) < 0.1) centredHats.add(key)
  return centredHats.has(key) ? value : 0
}

const stronger = (current: number, candidate: number): number =>
  Math.abs(candidate) > Math.abs(current) ? candidate : current

/** Motion sensors and similar companion devices carry a handful of buttons at most. */
const isController = (pad: PadLike | null | undefined): pad is PadLike =>
  pad?.connected === true && pad.buttons.length >= 4

export const readControllerState = (
  pads: readonly (PadLike | null | undefined)[],
): ControllerState => {
  const pressed = new Set<number>()
  let x = 0
  let y = 0
  for (const pad of pads) {
    if (!isController(pad)) continue
    standardPressed(pad, pressed)
    x = stronger(x, pad.axes[0] ?? 0)
    y = stronger(y, pad.axes[1] ?? 0)
  }
  return { pressed, x, y }
}

export type ControllerDescription = {
  readonly index: number
  readonly name: string
  readonly standard: boolean
  /** Raw button indices and axes held right now, as the browser reports them. */
  readonly activity: string
}

export const describeControllers = (
  pads: readonly (PadLike | null | undefined)[],
): ControllerDescription[] =>
  pads.flatMap((pad, position) => {
    if (pad === null || pad === undefined || !pad.connected) return []
    const buttons = pad.buttons.flatMap((button, index) => (isPressed(button) ? [`B${index}`] : []))
    const axes = pad.axes.flatMap((value, index) =>
      Math.abs(value) > HAT_THRESHOLD && !(value < -0.99 && index !== 0 && index !== 1)
        ? [`A${index}${value < 0 ? "−" : "+"}`]
        : [],
    )
    return [
      {
        activity: [...buttons, ...axes].join(" "),
        index: pad.index ?? position,
        name: pad.id ?? `Controller ${position + 1}`,
        standard: isStandard(pad),
      },
    ]
  })
