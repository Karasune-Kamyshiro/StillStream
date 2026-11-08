import { useEffect, useLayoutEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { markControllerFocus, registerBackDismissal } from "../focus-navigation"

/**
 * "Quit StillStream?" after Back (B, Escape) on the start screen with nothing open, like TV and
 * console apps. Quit is focused, so B then A quits; Back again or Cancel stays.
 */
export const QuitDialog = ({ onClose }: { readonly onClose: () => void }) => {
  const quitRef = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    const quit = quitRef.current
    if (quit === null) return
    markControllerFocus(quit)
    quit.focus()
  }, [])

  useEffect(
    () =>
      registerBackDismissal(() => {
        onClose()
        return true
      }),
    [onClose],
  )

  return createPortal(
    <div className="update-dialog__backdrop">
      <div
        aria-describedby="quit-dialog-text"
        aria-labelledby="quit-dialog-title"
        aria-modal="true"
        className="update-dialog"
        role="alertdialog"
      >
        <h2 id="quit-dialog-title">Quit StillStream?</h2>
        <p id="quit-dialog-text">Press Back again to stay.</p>
        <div className="update-dialog__actions">
          <button
            className="primary-button"
            data-focus-down="quit-confirm"
            data-focus-id="quit-confirm"
            data-focus-left="quit-confirm"
            data-focus-right="quit-cancel"
            data-focus-up="quit-confirm"
            data-focusable="true"
            onClick={() => void window.stillStream.system.quit?.()}
            ref={quitRef}
            type="button"
          >
            Quit
          </button>
          <button
            data-focus-down="quit-cancel"
            data-focus-id="quit-cancel"
            data-focus-left="quit-confirm"
            data-focus-right="quit-cancel"
            data-focus-up="quit-cancel"
            data-focusable="true"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
