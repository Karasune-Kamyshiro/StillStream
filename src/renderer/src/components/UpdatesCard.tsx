import { useContext } from "react"
import type { UpdateSnapshot } from "../../../shared/contracts"
import { SettingsSwitch } from "./settings-controls"
import { SettingsNavContext } from "./settings-nav-context"
import { canInstallUpdate } from "./UpdateDialog"

const REPOSITORY = "https://karasune-kamyshiro.github.io/StillStream"
const STABLE_REF = `${REPOSITORY}/io.github.karasune.StillStream.flatpakref`
const BETA_REF = `${REPOSITORY}/io.github.karasune.StillStream-beta.flatpakref`

const statusLine = (snapshot: UpdateSnapshot | undefined, checking: boolean): string => {
  if (snapshot === undefined) return checking ? "Checking for updates…" : "Not checked yet."
  if (snapshot.status === "available" && snapshot.latest !== undefined) {
    return `StillStream ${snapshot.latest.version}${snapshot.latest.prerelease ? " (pre-release)" : ""} is available. You have ${snapshot.currentVersion}.`
  }
  if (snapshot.status === "current") return `StillStream ${snapshot.currentVersion} is up to date.`
  return checking ? "Checking for updates…" : "GitHub could not be reached; try again later."
}

/** A Flatpak installed from a downloaded bundle: not from the repository, so it never updates. */
const installedFromFile = ({ packaging }: UpdateSnapshot): boolean =>
  packaging.kind === "flatpak" && packaging.branch !== "stable" && packaging.branch !== "beta"

/** How this installation gets the update, for the way it was installed. */
const HowToUpdate = ({ snapshot }: { readonly snapshot: UpdateSnapshot }) => {
  const { packaging, includePrereleases } = snapshot
  if (packaging.kind === "flatpak") {
    if (installedFromFile(snapshot)) {
      return (
        <p>
          This copy was installed from a downloaded file, which never updates itself. Switch to the
          StillStream repository once; settings, favourites and sign-in stay. Remove this copy, then
          install from the repository, and updates arrive through Discover or{" "}
          <code>flatpak update</code> from then on:
          <code className="settings-updates__command">
            flatpak uninstall io.github.karasune.StillStream
          </code>
          <code className="settings-updates__command">
            flatpak install --user {includePrereleases ? BETA_REF : STABLE_REF}
          </code>
        </p>
      )
    }
    const wantsBeta = includePrereleases && packaging.branch === "stable"
    const wantsStable = !includePrereleases && packaging.branch === "beta"
    return (
      <>
        <p>
          Updates arrive through Discover or <code>flatpak update</code> (branch{" "}
          <strong>{packaging.branch}</strong>).
        </p>
        {wantsBeta || wantsStable ? (
          <p>
            {wantsBeta ? "Pre-releases come through the beta branch:" : "Full releases only:"}
            <code className="settings-updates__command">
              flatpak install --user {wantsBeta ? BETA_REF : STABLE_REF}
            </code>
          </p>
        ) : null}
      </>
    )
  }
  return (
    <p>
      Download the new version from its release page and replace this one; settings and sign-in are
      kept.
    </p>
  )
}

export const UpdatesCard = ({
  checking,
  focusUp,
  includePrereleases,
  onCheck,
  onIncludePrereleasesChange,
  onInstall,
  snapshot,
}: {
  readonly checking: boolean
  /** The control above the card's switch. */
  readonly focusUp: string
  readonly includePrereleases: boolean
  readonly onCheck: () => void
  readonly onIncludePrereleasesChange: (include: boolean) => Promise<void>
  /** Opens the update dialog, installing right away; shown for a repository Flatpak. */
  readonly onInstall?: (() => void) | undefined
  readonly snapshot: UpdateSnapshot | undefined
}) => {
  const navFocusId = useContext(SettingsNavContext)
  const available = snapshot?.status === "available" ? snapshot.latest : undefined
  const download = available !== undefined && snapshot?.packaging.kind !== "flatpak"
  const installable =
    available !== undefined && snapshot !== undefined && canInstallUpdate(snapshot)
  const actions: {
    readonly disabled?: boolean
    readonly id: string
    readonly label: string
    readonly onClick: () => void
    readonly primary?: boolean
  }[] = [
    ...(installable && onInstall !== undefined
      ? [{ id: "settings-updates-install", label: "Update now", onClick: onInstall, primary: true }]
      : []),
    {
      disabled: checking,
      id: "settings-updates-check",
      label: "Check now",
      onClick: () => {
        if (!checking) onCheck()
      },
    },
    ...(download
      ? [
          {
            id: "settings-updates-open",
            label: "Open release page",
            onClick: () => void window.stillStream.updates?.openReleasePage(available.url),
          },
        ]
      : []),
  ]
  return (
    <section aria-labelledby="updates-heading" className="settings-card">
      <div>
        <h2 id="updates-heading">Updates</h2>
        <p>
          StillStream looks for new releases on GitHub when it starts and every few hours. A dot on
          Settings shows when one is out.
        </p>
      </div>
      <div className="settings-options settings-updates">
        <p aria-live="polite" className="settings-updates__status">
          {statusLine(snapshot, checking)}
        </p>
        {snapshot !== undefined && (available !== undefined || installedFromFile(snapshot)) ? (
          <HowToUpdate snapshot={snapshot} />
        ) : null}
        <SettingsSwitch
          checked={includePrereleases}
          focusDown={actions[0]?.id ?? "settings-updates-check"}
          focusId="settings-updates-prerelease"
          focusUp={focusUp}
          label="Include pre-releases"
          onChange={onIncludePrereleasesChange}
        />
        <div className="settings-updates__actions">
          {actions.map((action, index) => (
            <button
              {...(action.disabled === true ? { "aria-disabled": true } : {})}
              className={action.primary === true ? "primary-button" : undefined}
              data-focus-id={action.id}
              data-focus-left={actions[index - 1]?.id ?? navFocusId}
              {...(index < actions.length - 1
                ? { "data-focus-right": actions[index + 1]?.id }
                : {})}
              data-focus-up="settings-updates-prerelease"
              data-focusable="true"
              key={action.id}
              onClick={action.onClick}
              type="button"
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
