import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { adoptLegacyData } from "./legacy-data"

describe("adopting VacuumStream data after the rename", () => {
  let config: string
  beforeEach(async () => {
    config = await mkdtemp(join(tmpdir(), "stillstream-config-"))
  })
  afterEach(async () => {
    await rm(config, { force: true, recursive: true })
  })

  it("copies plain preference files once, never sign-in tokens", async () => {
    const legacy = join(config, "vacuumstream")
    await mkdir(legacy)
    await writeFile(join(legacy, "preferences.json"), '{"startScreen":"following"}')
    await writeFile(join(legacy, "favourites.json"), "[]")
    await writeFile(join(legacy, "oauth-token.bin"), "secret")
    const userData = join(config, "stillstream")
    expect(await adoptLegacyData(userData)).toEqual(["favourites.json", "preferences.json"])
    expect(await readFile(join(userData, "preferences.json"), "utf8")).toBe(
      '{"startScreen":"following"}',
    )
    await expect(readFile(join(userData, "oauth-token.bin"))).rejects.toThrow()
    // A second start keeps the new folder's own files.
    await writeFile(join(legacy, "preferences.json"), '{"startScreen":"home"}')
    expect(await adoptLegacyData(userData)).toEqual([])
  })

  it("does nothing without an old folder", async () => {
    expect(await adoptLegacyData(join(config, "stillstream"))).toEqual([])
  })
})
