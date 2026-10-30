import { useContext, useEffect, useState } from "react"
import { type ControllerDescription, describeControllers } from "../gamepad-input"
import { SettingsNavContext } from "./settings-nav-context"

const sameDescriptions = (
  a: readonly ControllerDescription[],
  b: readonly ControllerDescription[],
): boolean =>
  a.length === b.length &&
  a.every(
    (entry, index) =>
      entry.name === b[index]?.name &&
      entry.activity === b[index]?.activity &&
      entry.standard === b[index]?.standard,
  )

/**
 * Lists the controllers the app can see and what each one is pressing right now, so a controller
 * that does not respond can be told apart from one the system never handed to the app.
 */
export const ControllerStatus = () => {
  const navFocusId = useContext(SettingsNavContext)
  const [controllers, setControllers] = useState<readonly ControllerDescription[]>([])

  useEffect(() => {
    let frame = 0
    const poll = (): void => {
      const next = describeControllers(navigator.getGamepads?.() ?? [])
      setControllers((current) => (sameDescriptions(current, next) ? current : next))
      frame = requestAnimationFrame(poll)
    }
    frame = requestAnimationFrame(poll)
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <section aria-labelledby="controllers-heading" className="settings-card">
      <div>
        <h2 id="controllers-heading">Controllers</h2>
        <p>
          Every controller the app can see. Press any button: if a controller is missing here, the
          system did not pass it to StillStream; if it is listed, the buttons it reports appear next
          to it.
        </p>
      </div>
      <div
        aria-live="polite"
        className="controller-status"
        data-focus-down="settings-controllers"
        data-focus-id="settings-controllers"
        data-focus-left={navFocusId}
        data-focusable="true"
        role="status"
        // Focusable so a controller-only user can scroll down to read it.
        // biome-ignore lint/a11y/noNoninteractiveTabindex: read-only status reached by d-pad
        tabIndex={0}
      >
        {controllers.length === 0 ? (
          <p>No controller detected yet. Press a button on it.</p>
        ) : (
          <ul>
            {controllers.map((controller) => (
              <li key={`${controller.index}-${controller.name}`}>
                <strong>{controller.name}</strong>
                <span>
                  {controller.standard ? "Standard layout" : "Generic layout"}
                  {controller.activity === "" ? "" : ` · ${controller.activity}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
