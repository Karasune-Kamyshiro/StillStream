import { readFileSync } from "node:fs"
import { join } from "node:path"
import { type HardwareVideoDecoding, HardwareVideoDecodingSchema } from "../shared/contracts"

type CommandLine = { readonly appendSwitch: (name: string, value?: string) => void }

/** Steam's Gaming Mode on SteamOS: the app runs fullscreen under Gamescope, on X11. */
export const isSteamGameMode = (env: NodeJS.ProcessEnv): boolean =>
  env["SteamOS"] === "1" && env["SteamGamepadUI"] === "1"

/**
 * Whether Chromium decodes video on the graphics card. "auto" turns it off in Steam Gaming Mode
 * only: under Gamescope Chromium's GPU process crashes whenever a hardware-decoded video starts
 * ("CreateSharedImage: could not create backing", exit code 8704), for example a live preview,
 * and the whole window flashes each time it restarts (--disable-gpu-memory-buffer-video-frames
 * alone did not help). Viewers with a weak CPU can force it on; "off" helps elsewhere too.
 */
export const hardwareDecodingEnabled = (
  choice: HardwareVideoDecoding,
  env: NodeJS.ProcessEnv,
): boolean => (choice === "auto" ? !isSteamGameMode(env) : choice === "on")

/**
 * The saved choice, read synchronously before the app is ready: Chromium takes its switches at
 * startup, before the asynchronous preferences store is used. Anything unreadable means "auto".
 */
export const readHardwareDecodingChoice = (userData: string): HardwareVideoDecoding => {
  try {
    const saved: unknown = JSON.parse(readFileSync(join(userData, "preferences.json"), "utf8"))
    const value =
      typeof saved === "object" && saved !== null && "hardwareVideoDecoding" in saved
        ? saved.hardwareVideoDecoding
        : undefined
    return HardwareVideoDecodingSchema.catch("auto").parse(value ?? "auto")
  } catch {
    return "auto"
  }
}

/** Applies the video decoding choice; returns whether hardware decoding stays on. */
export const applyVideoDecodingSwitches = (
  commandLine: CommandLine,
  env: NodeJS.ProcessEnv,
  choice: HardwareVideoDecoding,
): boolean => {
  const enabled = hardwareDecodingEnabled(choice, env)
  if (!enabled) commandLine.appendSwitch("disable-accelerated-video-decode")
  return enabled
}
