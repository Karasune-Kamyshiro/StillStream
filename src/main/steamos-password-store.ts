import { readFileSync } from "node:fs"

type CommandLine = { readonly appendSwitch: (name: string, value?: string) => void }

/** Inside Flatpak the host's os-release is at /run/host; elsewhere at /etc. */
const OS_RELEASE_PATHS = ["/run/host/os-release", "/etc/os-release"] as const

const readOsRelease = (): string | undefined => {
  for (const path of OS_RELEASE_PATHS) {
    try {
      return readFileSync(path, "utf8")
    } catch {
      // Try the next location.
    }
  }
  return undefined
}

/** Whether os-release describes SteamOS (ID=steamos, or a derivative naming it in ID_LIKE). */
export const isSteamOS = (osRelease: string | undefined): boolean => {
  if (osRelease === undefined) return false
  const field = (name: string): string[] =>
    (new RegExp(`^${name}=(.*)$`, "m").exec(osRelease)?.[1] ?? "")
      .replace(/^["']|["']$/g, "")
      .toLowerCase()
      .split(/\s+/)
  return field("ID").includes("steamos") || field("ID_LIKE").includes("steamos")
}

/**
 * On SteamOS, Desktop Mode runs KDE with KWallet while Gaming Mode has no keyring at all, so
 * Chromium picked a different password store in each: the Twitch sign-in (and Twitch's web
 * session cookies) encrypted in Desktop Mode could not be read in Gaming Mode, and signing in
 * again there replaced them, so every switch signed the viewer out. One store for both modes
 * fixes that; Chromium's own "basic" store is the only one Gaming Mode has. The token file stays
 * mode 0600 inside the app's own data folder.
 */
export const applySteamOSPasswordStore = (
  commandLine: CommandLine,
  osRelease: string | undefined = readOsRelease(),
): boolean => {
  if (!isSteamOS(osRelease)) return false
  commandLine.appendSwitch("password-store", "basic")
  return true
}
