type CommandLine = { readonly appendSwitch: (name: string, value?: string) => void }

/** Steam's Gaming Mode on SteamOS: the app runs fullscreen under Gamescope, on X11. */
export const isSteamGameMode = (env: NodeJS.ProcessEnv): boolean =>
  env["SteamOS"] === "1" && env["SteamGamepadUI"] === "1"

/**
 * Chromium switches for Steam Gaming Mode, applied before the app is ready.
 *
 * Under Gamescope, Chromium's GPU process crashes whenever a hardware-decoded video starts
 * ("CreateSharedImage: could not create backing", exit code 8704), for example a live preview,
 * and the whole window flashes each time it restarts. Decoding video on the CPU avoids it;
 * --disable-gpu-memory-buffer-video-frames alone did not. Desktop sessions keep hardware decoding.
 */
export const applyGamingModeSwitches = (
  commandLine: CommandLine,
  env: NodeJS.ProcessEnv,
): boolean => {
  if (!isSteamGameMode(env)) return false
  commandLine.appendSwitch("disable-accelerated-video-decode")
  return true
}
