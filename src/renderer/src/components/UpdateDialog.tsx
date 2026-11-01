import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { UpdateSnapshot } from "../../../shared/contracts"
import { markControllerFocus, registerBackDismissal } from "../focus-navigation"

/** A Flatpak from the StillStream repository updates itself through the Flatpak portal. */
export const canInstallUpdate = (snapshot: UpdateSnapshot): boolean =>
  snapshot.packaging.kind === "flatpak" &&
  (snapshot.packaging.branch === "stable" || snapshot.packaging.branch === "beta")

type Stage =
  | { readonly kind: "ask" }
  | { readonly kind: "installing"; readonly percent: number }
  | { readonly kind: "installed" }
  | { readonly kind: "current" }
  | { readonly kind: "failed"; readonly error: string }

type Action = { readonly id: string; readonly label: string; readonly onClick: () => void }

/**
 * "StillStream X is available. Update now?" A Flatpak from the repository installs the update
 * in place and restarts into it; an AppImage gets its release page. Back or Later closes it.
 */
export const UpdateDialog = ({
  installNow = false,
  onClose,
  snapshot,
}: {
  /** Start installing right away (the Settings button) instead of asking first. */
  readonly installNow?: boolean
  readonly onClose: () => void
  readonly snapshot: UpdateSnapshot
}) => {
  const [stage, setStage] = useState<Stage>({ kind: "ask" })
  const [gamingMode, setGamingMode] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const installing = stage.kind === "installing"
  const version = snapshot.latest?.version ?? ""
  const installable = canInstallUpdate(snapshot)

  useEffect(() => {
    let current = true
    void window.stillStream.system.isSteamGameMode().then(
      (value) => {
        if (current) setGamingMode(value)
      },
      () => undefined,
    )
    return () => {
      current = false
    }
  }, [])

  const install = (): void => {
    const updates = window.stillStream.updates
    if (updates === undefined) return
    setStage({ kind: "installing", percent: 0 })
    const stop = updates.onProgress((percent) => setStage({ kind: "installing", percent }))
    void updates.install().then(
      (result) => {
        stop()
        setStage(
          result.status === "done"
            ? { kind: "installed" }
            : result.status === "empty"
              ? { kind: "current" }
              : { error: result.error ?? "The update failed.", kind: "failed" },
        )
      },
      () => {
        stop()
        setStage({ error: "The update could not be started.", kind: "failed" })
      },
    )
  }

  const startInstall = useRef(installNow)
  useEffect(() => {
    if (!startInstall.current) return
    startInstall.current = false
    install()
  })

  // Back closes the dialog (Later), except while installing, when it is swallowed.
  useEffect(
    () =>
      registerBackDismissal(() => {
        if (!installing) onClose()
        return true
      }),
    [installing, onClose],
  )

  const actions: Action[] =
    stage.kind === "ask"
      ? installable
        ? [
            { id: "update-now", label: "Update now", onClick: install },
            { id: "update-later", label: "Later", onClick: onClose },
          ]
        : [
            {
              id: "update-open",
              label: "Open release page",
              onClick: () => {
                if (snapshot.latest !== undefined) {
                  void window.stillStream.updates?.openReleasePage(snapshot.latest.url)
                }
                onClose()
              },
            },
            { id: "update-later", label: "Later", onClick: onClose },
          ]
      : stage.kind === "installed"
        ? [
            {
              id: "update-restart",
              label: gamingMode ? "Close StillStream" : "Restart now",
              onClick: () => void window.stillStream.updates?.restart(),
            },
            { id: "update-later", label: "Later", onClick: onClose },
          ]
        : stage.kind === "installing"
          ? []
          : [{ id: "update-close", label: "Close", onClick: onClose }]

  // Controller focus moves to the first action whenever the actions change (or to the dialog
  // itself while installing, when there is nothing to press).
  const firstAction = actions[0]?.id
  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return
    const target = dialog.querySelector<HTMLElement>(`[data-focus-id="${firstAction}"]`) ?? dialog
    markControllerFocus(target)
    target.focus()
  }, [firstAction])

  const message =
    stage.kind === "ask"
      ? installable
        ? `StillStream ${version} is available. You have ${snapshot.currentVersion}. Update now? It downloads in the background.`
        : `StillStream ${version} is available. You have ${snapshot.currentVersion}. Download it from the release page and replace this AppImage; settings and sign-in are kept.`
      : stage.kind === "installing"
        ? `Updating to StillStream ${version}…`
        : stage.kind === "installed"
          ? gamingMode
            ? `StillStream ${version} is installed. Close StillStream and start it again from Steam to use it.`
            : `StillStream ${version} is installed. Restart StillStream to use it.`
          : stage.kind === "current"
            ? "Flatpak found nothing newer to install yet; the repository may still be updating. Try again in a few minutes."
            : `The update could not be installed here: ${stage.error} You can update through Discover or with flatpak update instead.`

  return createPortal(
    <div className="update-dialog__backdrop">
      <div
        aria-labelledby="update-dialog-title"
        aria-modal="true"
        className="update-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <span className="update-dialog__eyebrow">Update</span>
        <h2 id="update-dialog-title">
          {stage.kind === "installed" ? "Update installed" : `StillStream ${version}`}
        </h2>
        <p aria-live="polite">{message}</p>
        {installing ? (
          <progress aria-label="Update progress" max={100} value={stage.percent}>
            {stage.percent}%
          </progress>
        ) : null}
        {actions.length === 0 ? null : (
          <div className="update-dialog__actions">
            {actions.map((action, index) => (
              <button
                className={index === 0 ? "primary-button" : undefined}
                data-focus-down={action.id}
                data-focus-id={action.id}
                data-focus-left={actions[index - 1]?.id ?? action.id}
                data-focus-right={actions[index + 1]?.id ?? action.id}
                data-focus-up={action.id}
                data-focusable="true"
                key={action.id}
                onClick={action.onClick}
                type="button"
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
