import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
  defaultPreferences,
  type PreferencesSnapshot,
  PreferencesSnapshotSchema,
  type PreferencesUpdate,
  PreferencesUpdateSchema,
  type StartScreen,
} from "../shared/contracts"

const defaults = defaultPreferences

const isMissingFile = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT"

/**
 * Viewer preferences, kept apart from credentials and the Client ID. The renderer's origin uses an
 * ephemeral port, so browser storage cannot persist these across launches.
 */
export class PreferencesStore {
  readonly #directory: string
  readonly #path: string
  #writes = Promise.resolve()

  public constructor(directory: string) {
    this.#directory = directory
    this.#path = join(directory, "preferences.json")
  }

  public async load(): Promise<PreferencesSnapshot> {
    let contents: string
    try {
      contents = await readFile(this.#path, "utf8")
    } catch (error) {
      if (isMissingFile(error)) return defaults()
      throw error
    }
    // A damaged or outdated file must never block startup; fall back to defaults.
    try {
      const parsed = PreferencesSnapshotSchema.safeParse(JSON.parse(contents))
      return parsed.success ? parsed.data : defaults()
    } catch {
      return defaults()
    }
  }

  public setStartScreen(startScreen: StartScreen): Promise<PreferencesSnapshot> {
    return this.update({ startScreen })
  }

  // Async so invalid input rejects like any other failure; the queue is still set synchronously.
  public async update(input: PreferencesUpdate): Promise<PreferencesSnapshot> {
    const update = PreferencesUpdateSchema.parse(input)
    const write = this.#writes.then(async () => {
      const next = PreferencesSnapshotSchema.parse({ ...(await this.load()), ...update })
      await mkdir(this.#directory, { recursive: true })
      const temporaryPath = `${this.#path}.tmp`
      await writeFile(temporaryPath, JSON.stringify(next, undefined, 2), { mode: 0o600 })
      await rename(temporaryPath, this.#path)
      return next
    })
    this.#writes = write.then(
      () => undefined,
      () => undefined,
    )
    return write
  }
}
