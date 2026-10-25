import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
  type PreferencesSnapshot,
  PreferencesSnapshotSchema,
  type StartScreen,
  StartScreenSchema,
} from "../shared/contracts"

const DEFAULT_PREFERENCES: PreferencesSnapshot = { startScreen: "home" }

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
      if (isMissingFile(error)) return DEFAULT_PREFERENCES
      throw error
    }
    // A damaged or outdated file must never block startup; fall back to defaults.
    try {
      const parsed = PreferencesSnapshotSchema.safeParse(JSON.parse(contents))
      return parsed.success ? parsed.data : DEFAULT_PREFERENCES
    } catch {
      return DEFAULT_PREFERENCES
    }
  }

  public setStartScreen(input: StartScreen): Promise<PreferencesSnapshot> {
    const startScreen = StartScreenSchema.parse(input)
    const write = this.#writes.then(async () => {
      const next = { ...(await this.load()), startScreen }
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
