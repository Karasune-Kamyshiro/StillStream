import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { UpdateSnapshot } from "../../../shared/contracts"
import { UpdatesCard } from "./UpdatesCard"

const render = (snapshot: UpdateSnapshot | undefined, checking = false) =>
  renderToStaticMarkup(
    <UpdatesCard
      checking={checking}
      focusUp="settings-chat-text"
      includePrereleases={snapshot?.includePrereleases ?? false}
      onCheck={() => undefined}
      onIncludePrereleasesChange={async () => undefined}
      snapshot={snapshot}
    />,
  )
const available = (packaging: UpdateSnapshot["packaging"], includePrereleases = false) =>
  ({
    currentVersion: "0.2.3",
    includePrereleases,
    latest: {
      prerelease: false,
      url: "https://github.com/x/releases/tag/v0.2.4",
      version: "0.2.4",
    },
    packaging,
    status: "available",
  }) satisfies UpdateSnapshot

describe("Updates card", () => {
  it("says when this version is current", () => {
    const markup = render({
      currentVersion: "0.2.3",
      includePrereleases: false,
      packaging: { kind: "appimage" },
      status: "current",
    })
    expect(markup).toContain("StillStream 0.2.3 is up to date.")
    expect(markup).not.toContain("settings-updates-open")
  })

  it("links an AppImage to the release page", () => {
    const markup = render(available({ kind: "appimage" }))
    expect(markup).toContain("StillStream 0.2.4 is available. You have 0.2.3.")
    expect(markup).toContain('data-focus-id="settings-updates-open"')
  })

  it("points a repository Flatpak at Discover, and to the beta branch for pre-releases", () => {
    const stable = render(available({ branch: "stable", kind: "flatpak" }))
    expect(stable).toContain("Discover")
    expect(stable).not.toContain("settings-updates-open")
    expect(stable).not.toContain("flatpak install")
    const wantsBeta = render(available({ branch: "stable", kind: "flatpak" }, true))
    expect(wantsBeta).toContain("io.github.karasune.StillStream-beta.flatpakref")
  })

  it("explains that a Flatpak installed from a file needs the repository once", () => {
    const markup = render({
      currentVersion: "0.2.3",
      includePrereleases: false,
      packaging: { branch: "master", kind: "flatpak" },
      status: "current",
    })
    expect(markup).toContain("installed from a downloaded file")
    expect(markup).toContain("io.github.karasune.StillStream.flatpakref")
  })
})
