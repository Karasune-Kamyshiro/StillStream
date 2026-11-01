import { type ChildProcess, execFileSync, spawn } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { connectSessionBus, installFlatpakUpdate, spawnLatestVersion } from "./flatpak-self-update"

/**
 * Runs the self-update client against a real D-Bus daemon and a stand-in Flatpak portal that
 * speaks the portal's actual interface, so marshalling and signal routing are exercised end to
 * end. Skipped where dbus-daemon is not installed.
 */
const hasDbusDaemon = (() => {
  try {
    execFileSync("dbus-daemon", ["--version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
})()

describe.skipIf(!hasDbusDaemon)("Flatpak self-update over D-Bus", () => {
  let daemon: ChildProcess
  let directory: string
  let address: string
  const portals: ChildProcess[] = []

  const startPortal = async (mode: string): Promise<{ output: () => string }> => {
    const portal = spawn(
      process.execPath,
      [join(__dirname, "test-support", "fake-flatpak-portal.cjs"), mode],
      { env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: address } },
    )
    portals.push(portal)
    let output = ""
    portal.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString()
    })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`portal did not start: ${output}`)), 5000)
      portal.stdout?.on("data", () => {
        if (output.includes("ready")) {
          clearTimeout(timer)
          resolve()
        }
      })
    })
    return { output: () => output }
  }
  const stopPortals = (): void => {
    for (const portal of portals.splice(0)) portal.kill()
  }

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), "stillstream-dbus-"))
    address = `unix:path=${join(directory, "bus")}`
    // A bus without service directories, so only the stand-in portal can answer (a session bus
    // would start the host's real flatpak-portal on demand).
    const config = join(directory, "bus.conf")
    writeFileSync(
      config,
      `<busconfig><type>session</type><listen>${address}</listen><auth>EXTERNAL</auth>
        <policy context="default"><allow send_destination="*"/><allow receive_sender="*"/><allow own="*"/></policy></busconfig>`,
    )
    daemon = spawn("dbus-daemon", ["--nofork", `--config-file=${config}`])
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        execFileSync(
          "dbus-send",
          [`--bus=${address}`, "--dest=org.freedesktop.DBus", "/", "org.freedesktop.DBus.GetId"],
          { stdio: "ignore" },
        )
        break
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
    process.env["DBUS_SESSION_BUS_ADDRESS"] = address
  })
  afterAll(() => {
    stopPortals()
    daemon?.kill()
    rmSync(directory, { force: true, recursive: true })
  })

  it("installs, reporting the portal's progress, and closes the monitor", async () => {
    const portal = await startPortal("done")
    const progress: number[] = []
    const result = await installFlatpakUpdate(connectSessionBus, (percent) =>
      progress.push(percent),
    )
    expect(result).toEqual({ status: "done" })
    expect(progress).toEqual([0, 30, 70, 100])
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(portal.output()).toContain("closed")
    stopPortals()
  })

  it("reports when there is nothing newer to install", async () => {
    await startPortal("empty")
    expect(await installFlatpakUpdate(connectSessionBus, () => undefined)).toEqual({
      status: "empty",
    })
    stopPortals()
  })

  it("passes on the portal's reason when the update fails", async () => {
    await startPortal("failed")
    expect(await installFlatpakUpdate(connectSessionBus, () => undefined)).toEqual({
      error: "Disk full",
      status: "failed",
    })
    stopPortals()
  })

  it("passes on a refusal, such as an update that needs new permissions", async () => {
    await startPortal("refuse")
    expect(await installFlatpakUpdate(connectSessionBus, () => undefined)).toEqual({
      error: "Update requires new permissions",
      status: "failed",
    })
    stopPortals()
  })

  it("recognises the one-time approval Flatpak could not ask for", async () => {
    await startPortal("unapproved")
    expect(await installFlatpakUpdate(connectSessionBus, () => undefined)).toEqual({
      error: "No portal support found",
      needsApproval: true,
      status: "failed",
    })
    stopPortals()
  })

  it("fails cleanly when no portal answers", async () => {
    const result = await installFlatpakUpdate(connectSessionBus, () => undefined)
    expect(result.status).toBe("failed")
  })

  it("starts the newest version through the portal with the session's display", async () => {
    const portal = await startPortal("done")
    await spawnLatestVersion(connectSessionBus, "stillstream", {
      DISPLAY: ":0",
      FLATPAK_ID: "io.github.karasune.StillStream",
      SteamGamepadUI: "1",
      WAYLAND_DISPLAY: "wayland-0",
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    const line = portal
      .output()
      .split("\n")
      .find((entry) => entry.startsWith("spawn "))
    const call = JSON.parse(line?.slice("spawn ".length) ?? "{}")
    expect(call.argv).toEqual(["stillstream\0"])
    expect(call.flags).toBe(2)
    expect(Object.fromEntries(call.envs)).toEqual({
      DISPLAY: ":0",
      SteamGamepadUI: "1",
      WAYLAND_DISPLAY: "wayland-0",
    })
    stopPortals()
  })
})
