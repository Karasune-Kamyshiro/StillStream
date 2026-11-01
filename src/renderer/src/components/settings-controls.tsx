import { CheckIcon } from "@phosphor-icons/react"
import { useContext, useState } from "react"
import { SettingsNavContext } from "./settings-nav-context"

/**
 * An on/off option. A button rather than a checkbox: TV remotes send Enter for OK, which never
 * toggles a checkbox (only Space does). Buttons activate on Enter, Space and a controller A.
 */
export const SettingsSwitch = ({
  checked,
  focusDown,
  focusId,
  focusUp,
  label,
  onChange,
}: {
  readonly checked: boolean
  readonly focusDown?: string | undefined
  readonly focusId: string
  readonly focusUp: string
  readonly label: string
  readonly onChange: (checked: boolean) => Promise<void>
}) => {
  const navFocusId = useContext(SettingsNavContext)
  const [busy, setBusy] = useState(false)
  return (
    <button
      aria-busy={busy}
      aria-checked={checked}
      aria-disabled={busy}
      className="settings-toggle"
      {...(focusDown === undefined ? {} : { "data-focus-down": focusDown })}
      data-focus-id={focusId}
      data-focus-left={navFocusId}
      data-focus-up={focusUp}
      data-focusable="true"
      onClick={() => {
        // aria-disabled keeps controller focus while saving; ignore presses meanwhile.
        if (busy) return
        setBusy(true)
        void onChange(!checked).finally(() => setBusy(false))
      }}
      role="switch"
      type="button"
    >
      <span aria-hidden="true" className="settings-toggle__box">
        {checked ? <CheckIcon weight="bold" /> : null}
      </span>
      {label}
    </button>
  )
}

/** A value that steps to its next choice on every press (OK, Space, A), wrapping around. */
export const SettingsCycle = ({
  focusDown,
  focusId,
  focusUp,
  label,
  onNext,
  value,
}: {
  readonly focusDown?: string | undefined
  readonly focusId: string
  readonly focusUp: string
  readonly label: string
  readonly onNext: () => Promise<void>
  readonly value: string
}) => {
  const navFocusId = useContext(SettingsNavContext)
  const [busy, setBusy] = useState(false)
  return (
    <button
      aria-busy={busy}
      aria-disabled={busy}
      className="settings-cycle"
      {...(focusDown === undefined ? {} : { "data-focus-down": focusDown })}
      data-focus-id={focusId}
      data-focus-left={navFocusId}
      data-focus-up={focusUp}
      data-focusable="true"
      onClick={() => {
        if (busy) return
        setBusy(true)
        void onNext().finally(() => setBusy(false))
      }}
      type="button"
    >
      <span>{label}</span>
      <strong>{value}</strong>
    </button>
  )
}
