import { copyFile, mkdir, stat } from "node:fs/promises"
import { dirname, join } from "node:path"

/** Preferences, favourites and watch progress: plain files that survive the rename. */
const PORTABLE_FILES = [
  "favourites.json",
  "playback-progress.json",
  "preferences.json",
  "settings.json",
] as const

const exists = async (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  )

/**
 * StillStream was called VacuumStream, whose data lived in a sibling folder. On the first start
 * under the new name, copy the viewer's plain preference files across once. Sign-in tokens are
 * left behind on purpose: they are encrypted against the old application identity, so the viewer
 * signs in again. Flatpak sandboxes cannot see each other, so there this finds nothing to copy.
 */
export const adoptLegacyData = async (
  userData: string,
  legacyNames: readonly string[] = ["vacuumstream", "VacuumStream"],
): Promise<readonly string[]> => {
  if (await exists(join(userData, "preferences.json"))) return []
  if (await exists(join(userData, "settings.json"))) return []
  for (const name of legacyNames) {
    const legacy = join(dirname(userData), name)
    if (legacy === userData || !(await exists(legacy))) continue
    const copied: string[] = []
    await mkdir(userData, { recursive: true })
    for (const file of PORTABLE_FILES) {
      const source = join(legacy, file)
      if (!(await exists(source))) continue
      await copyFile(source, join(userData, file)).then(
        () => copied.push(file),
        () => undefined,
      )
    }
    return copied
  }
  return []
}
