// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { UpdateInstallResult, UpdateSnapshot } from "../../../shared/contracts"
import { dismissOpenSurface } from "../focus-navigation"
import { UpdateDialog } from "./UpdateDialog"

const snapshot = (packaging: UpdateSnapshot["packaging"]): UpdateSnapshot => ({
  currentVersion: "0.2.3-test.16",
  includePrereleases: true,
  latest: {
    prerelease: true,
    url: "https://github.com/Karasune-Kamyshiro/StillStream/releases/tag/v0.2.3-test.17",
    version: "0.2.3-test.17",
  },
  packaging,
  status: "available",
})

describe("update dialog", () => {
  let root: Root
  let container: HTMLDivElement
  let progressListener: ((percent: number) => void) | undefined
  let finishInstall: (result: UpdateInstallResult) => void
  const install = vi.fn<() => Promise<UpdateInstallResult>>()
  const restart = vi.fn<() => Promise<void>>()
  const openReleasePage = vi.fn<(url: string) => Promise<void>>()
  const onClose = vi.fn()
  const button = (id: string) =>
    document.querySelector<HTMLButtonElement>(`[data-focus-id="${id}"]`)
  const text = () => document.querySelector(".update-dialog")?.textContent ?? ""
  const render = async (packaging: UpdateSnapshot["packaging"], gamingMode = false) => {
    vi.stubGlobal("stillStream", {
      system: { isSteamGameMode: async () => gamingMode },
      updates: {
        install,
        onProgress: (listener: (percent: number) => void) => {
          progressListener = listener
          return () => {
            progressListener = undefined
          }
        },
        openReleasePage,
        restart,
      },
    })
    await act(async () =>
      root.render(<UpdateDialog onClose={onClose} snapshot={snapshot(packaging)} />),
    )
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    install.mockReset().mockImplementation(
      () =>
        new Promise((resolve) => {
          finishInstall = resolve
        }),
    )
    restart.mockReset().mockResolvedValue(undefined)
    openReleasePage.mockReset().mockResolvedValue(undefined)
    onClose.mockReset()
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it("asks first, then installs with progress and offers a restart", async () => {
    await render({ branch: "beta", kind: "flatpak" })
    expect(text()).toContain("StillStream 0.2.3-test.17 is available. You have 0.2.3-test.16.")
    expect(document.activeElement).toBe(button("update-now"))
    await act(async () => button("update-now")?.click())
    expect(install).toHaveBeenCalledOnce()
    await act(async () => progressListener?.(45))
    expect(document.querySelector("progress")?.value).toBe(45)
    // Back is swallowed while installing.
    await act(async () => void dismissOpenSurface())
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => finishInstall({ status: "done" }))
    expect(text()).toContain("Restart StillStream to use it.")
    expect(document.activeElement).toBe(button("update-restart"))
    await act(async () => button("update-restart")?.click())
    expect(restart).toHaveBeenCalledOnce()
  })

  it("tells Gaming Mode to start it again from Steam", async () => {
    await render({ branch: "stable", kind: "flatpak" }, true)
    await act(async () => button("update-now")?.click())
    await act(async () => finishInstall({ status: "done" }))
    expect(button("update-restart")?.textContent).toBe("Close StillStream")
    expect(text()).toContain("start it again from Steam")
  })

  it("explains a failed install and points to Discover", async () => {
    await render({ branch: "beta", kind: "flatpak" })
    await act(async () => button("update-now")?.click())
    await act(async () =>
      finishInstall({ error: "Update requires new permissions", status: "failed" }),
    )
    expect(text()).toContain("Update requires new permissions")
    expect(text()).toContain("Discover")
    await act(async () => button("update-close")?.click())
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("shows the one-time approval command when Flatpak could not ask", async () => {
    await render({ branch: "beta", kind: "flatpak" }, true)
    await act(async () => button("update-now")?.click())
    await act(async () =>
      finishInstall({ error: "No portal support found", needsApproval: true, status: "failed" }),
    )
    expect(text()).toContain(
      "flatpak permission-set flatpak updates io.github.karasune.StillStream yes",
    )
    expect(document.activeElement).toBe(button("update-close"))
  })

  it("sends an AppImage to the release page, and Later or Back just closes", async () => {
    await render({ kind: "appimage" })
    expect(button("update-now")).toBeNull()
    await act(async () => button("update-open")?.click())
    expect(openReleasePage).toHaveBeenCalledWith(
      "https://github.com/Karasune-Kamyshiro/StillStream/releases/tag/v0.2.3-test.17",
    )
    onClose.mockReset()
    await act(async () => void dismissOpenSurface())
    expect(onClose).toHaveBeenCalledOnce()
  })
})
