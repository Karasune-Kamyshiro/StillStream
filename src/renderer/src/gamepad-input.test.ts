import { describe, expect, it } from "vitest"
import { describeControllers, readControllerState } from "./gamepad-input"

type Pad = Parameters<typeof readControllerState>[0][number]

const pad = ({
  axes = [0, 0, 0, 0],
  buttons = 17,
  connected = true,
  id = "pad",
  index = 0,
  mapping = "standard",
  pressed = [],
}: {
  axes?: number[]
  buttons?: number
  connected?: boolean
  id?: string
  index?: number
  mapping?: GamepadMappingType
  pressed?: number[]
}): Pad => ({
  axes,
  buttons: Array.from({ length: buttons }, (_, button) => ({
    pressed: pressed.includes(button),
    touched: pressed.includes(button),
    value: pressed.includes(button) ? 1 : 0,
  })),
  connected,
  id,
  index,
  mapping,
})

const pressedOf = (pads: Pad[]): number[] => [...readControllerState(pads).pressed].sort()

describe("readControllerState", () => {
  it("reads a controller listed after an idle one, as Steam Input arranges them", () => {
    const grabbed = pad({ id: "Microsoft X-Box One pad", index: 0 })
    const virtual = pad({ id: "Microsoft X-Box 360 pad 0", index: 1, pressed: [0] })
    expect(pressedOf([grabbed, virtual])).toEqual([0])
  })

  it("takes the strongest stick deflection across controllers", () => {
    const state = readControllerState([pad({ axes: [0.1, 0] }), pad({ axes: [0, -0.9], index: 1 })])
    expect(state).toMatchObject({ x: 0.1, y: -0.9 })
  })

  it("translates the evdev button order of an unrecognised controller", () => {
    // Back (6) and Start (7) in evdev order are standard 8 and 9; LS (9) must not become Start.
    const generic = pad({ buttons: 11, mapping: "", pressed: [0, 7, 9] })
    expect(pressedOf([generic])).toEqual([0, 10, 9].sort())
  })

  it("reads a hat-switch d-pad once it has been seen centred", () => {
    const base = { axes: [0, 0, -1, 0, 0, -1, 0, 0], buttons: 11, id: "hat", mapping: "" as const }
    expect(pressedOf([pad(base)])).toEqual([])
    expect(pressedOf([pad({ ...base, axes: [0, 0, -1, 0, 0, -1, 1, -1] })])).toEqual([12, 15])
  })

  it("ignores hat slots that rest at -1 like a trigger", () => {
    const triggers = pad({ axes: [0, 0, 0, 0, 0, 0, -1, -1], buttons: 11, id: "t", mapping: "" })
    expect(pressedOf([triggers])).toEqual([])
  })

  it("ignores motion sensors and disconnected slots", () => {
    expect(pressedOf([null, pad({ buttons: 0 }), pad({ connected: false, pressed: [0] })])).toEqual(
      [],
    )
  })
})

describe("describeControllers", () => {
  it("names each connected controller with its layout and held inputs", () => {
    expect(
      describeControllers([
        null,
        pad({ axes: [0, 0.8, -1, 0], id: "Xbox", index: 1, mapping: "", pressed: [1] }),
      ]),
    ).toEqual([{ activity: "B1 A1+", index: 1, name: "Xbox", standard: false }])
  })
})
