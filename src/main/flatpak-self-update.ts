import type { EventEmitter } from "node:events"
import dbusNative from "@homebridge/dbus-native"
import type { UpdateInstallResult } from "../shared/contracts"

/**
 * Updates the running Flatpak through the Flatpak portal (org.freedesktop.portal.Flatpak), the
 * API Flatpak offers sandboxed apps for exactly this: no permission beyond the sandbox is needed.
 * The portal installs the newer commit of this app's own ref from the remote it came from (the
 * StillStream repository), and can start that newer version afterwards. It refuses updates that
 * would grant the app more permissions than it has; those go through Discover or `flatpak update`.
 */

const PORTAL = "org.freedesktop.portal.Flatpak"
const PORTAL_PATH = "/org/freedesktop/portal/Flatpak"
const PORTAL_INTERFACE = "org.freedesktop.portal.Flatpak"
const MONITOR_INTERFACE = "org.freedesktop.portal.Flatpak.UpdateMonitor"
/** FLATPAK_SPAWN_FLAGS_LATEST_VERSION: run the newest installed version, not this one. */
const SPAWN_LATEST_VERSION = 2
const INSTALL_TIMEOUT_MS = 20 * 60 * 1000

/** The slice of @homebridge/dbus-native's MessageBus used here, so tests can stand in for it. */
export type PortalBus = {
  readonly invoke: (
    message: {
      readonly body?: readonly unknown[]
      readonly destination: string
      readonly interface: string
      readonly member: string
      readonly path: string
      readonly signature?: string
    },
    callback: (error: unknown, value: unknown) => void,
  ) => void
  readonly addMatch: (rule: string, callback: (error: unknown) => void) => void
  readonly mangle: (path: string, iface: string, member: string) => string
  readonly signals: Pick<EventEmitter, "on" | "removeAllListeners">
  readonly connection: { readonly end: () => void }
}

/** The session bus; inside Flatpak that is the sandbox's filtered proxy, where portals are reachable. */
export const connectSessionBus = (): PortalBus =>
  (dbusNative as unknown as { readonly sessionBus: () => PortalBus }).sessionBus()

const call = (
  bus: PortalBus,
  path: string,
  iface: string,
  member: string,
  signature: string,
  body: readonly unknown[],
): Promise<unknown> =>
  new Promise((resolve, reject) => {
    bus.invoke(
      { body, destination: PORTAL, interface: iface, member, path, signature },
      (error, value) => {
        if (error === undefined || error === null) resolve(value)
        else reject(error)
      },
    )
  })

const describeError = (error: unknown): string => {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null) {
    const { message, name } = error as { message?: unknown; name?: unknown }
    const text = Array.isArray(message) ? message.join(" ") : message
    if (typeof text === "string" && text !== "") return text
    if (typeof name === "string") return name
  }
  return String(error)
}

/** dbus-native decodes a{sv} as [key, [signature, [value]]] pairs. */
const dictionary = (entries: unknown): Record<string, unknown> => {
  const result: Record<string, unknown> = {}
  if (!Array.isArray(entries)) return result
  for (const entry of entries) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string") continue
    const variant = entry[1]
    result[entry[0]] = Array.isArray(variant) && Array.isArray(variant[1]) ? variant[1][0] : variant
  }
  return result
}

/**
 * flatpak-portal asks the user once ("Update StillStream?") through the desktop's Access portal.
 * Without one (Steam Gaming Mode) it fails with NotSupported "No portal support found"; a denied
 * question fails with AccessDenied "Application update not allowed".
 */
const isApprovalError = (error: unknown, reason: string): boolean => {
  const name =
    typeof error === "object" && error !== null && "name" in error ? String(error.name) : ""
  return (
    name === "org.freedesktop.DBus.Error.NotSupported" ||
    name === "org.freedesktop.DBus.Error.AccessDenied" ||
    /no portal support|update not allowed/i.test(reason)
  )
}

type Progress = { readonly error?: string; readonly percent: number; readonly status: number }

const parseProgress = (body: unknown): Progress => {
  const info = dictionary(Array.isArray(body) ? body[0] : undefined)
  const status = typeof info["status"] === "number" ? info["status"] : 0
  const percent = typeof info["progress"] === "number" ? info["progress"] : 0
  const message = info["error_message"] ?? info["error"]
  return typeof message === "string" && message !== ""
    ? { error: message, percent, status }
    : { percent, status }
}

/**
 * Installs the update, reporting progress (0-100) on the way. Resolves "done" once the new
 * version is deployed (it runs after a restart), "empty" when the portal finds nothing newer,
 * and "failed" with the portal's reason otherwise. Never rejects.
 */
export const installFlatpakUpdate = async (
  connect: () => PortalBus,
  onProgress: (percent: number) => void,
): Promise<UpdateInstallResult> => {
  let bus: PortalBus | undefined
  try {
    bus = connect()
    const portal = bus
    const monitor = await call(
      portal,
      PORTAL_PATH,
      PORTAL_INTERFACE,
      "CreateUpdateMonitor",
      "a{sv}",
      [[]],
    )
    if (typeof monitor !== "string")
      return { error: "The Flatpak portal gave no update monitor", status: "failed" }
    const signal = portal.mangle(monitor, MONITOR_INTERFACE, "Progress")
    const finished = new Promise<UpdateInstallResult>((resolve) => {
      const timer = setTimeout(
        () => resolve({ error: "The update took too long", status: "failed" }),
        INSTALL_TIMEOUT_MS,
      )
      portal.signals.on(signal, (body: unknown) => {
        const progress = parseProgress(body)
        if (progress.status === 0) {
          onProgress(progress.percent)
          return
        }
        clearTimeout(timer)
        if (progress.status === 1) resolve({ status: "empty" })
        else if (progress.status === 2) {
          onProgress(100)
          resolve({ status: "done" })
        } else resolve({ error: progress.error ?? "The update failed", status: "failed" })
      })
    })
    await new Promise<void>((resolve) => {
      portal.addMatch(`type='signal',interface='${MONITOR_INTERFACE}',path='${monitor}'`, () =>
        resolve(),
      )
    })
    onProgress(0)
    await call(portal, monitor, MONITOR_INTERFACE, "Update", "sa{sv}", ["", []])
    const result = await finished
    await call(portal, monitor, MONITOR_INTERFACE, "Close", "", []).catch(() => undefined)
    portal.signals.removeAllListeners(signal)
    return result
  } catch (error) {
    const reason = describeError(error)
    return isApprovalError(error, reason)
      ? { error: reason, needsApproval: true, status: "failed" }
      : { error: reason, status: "failed" }
  } finally {
    try {
      bus?.connection.end()
    } catch {
      // The connection is already gone.
    }
  }
}

/** Environment the new instance needs to appear on the same display and session. */
const passedEnvironment = (env: NodeJS.ProcessEnv): [string, string][] =>
  Object.entries(env).flatMap(([name, value]) =>
    value !== undefined &&
    (/^(DISPLAY|WAYLAND_DISPLAY|XDG_SESSION_TYPE|XDG_SESSION_DESKTOP|XDG_CURRENT_DESKTOP|DESKTOP_SESSION|LANG|LANGUAGE|TZ|PULSE_SERVER)$/.test(
      name,
    ) ||
      /^(LC_|Steam|GAMESCOPE|XCURSOR_)/.test(name))
      ? [[name, value]]
      : [],
  )

/** Starts the newest installed version of the app (the one just updated to) as a new instance. */
export const spawnLatestVersion = async (
  connect: () => PortalBus,
  command: string,
  env: NodeJS.ProcessEnv,
): Promise<void> => {
  const bus = connect()
  try {
    await call(bus, PORTAL_PATH, PORTAL_INTERFACE, "Spawn", "ayaaya{uh}a{ss}ua{sv}", [
      Buffer.from("/\0"),
      [Buffer.from(`${command}\0`)],
      [],
      passedEnvironment(env),
      SPAWN_LATEST_VERSION,
      [],
    ])
  } finally {
    try {
      bus.connection.end()
    } catch {
      // The connection is already gone.
    }
  }
}
