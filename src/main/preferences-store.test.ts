import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { PreferencesStore } from "./preferences-store"

describe("preferences store", () => {
  let directory: string
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "vacuumstream-preferences-"))
  })
  afterEach(async () => {
    await rm(directory, { force: true, recursive: true })
  })

  it("starts on Home until Following is chosen, then remembers it across instances", async () => {
    expect(await new PreferencesStore(directory).load()).toEqual({
      chatTheme: "dark",
      startScreen: "home",
    })
    expect(await new PreferencesStore(directory).setStartScreen("following")).toEqual({
      chatTheme: "dark",
      startScreen: "following",
    })
    expect(await new PreferencesStore(directory).load()).toEqual({
      chatTheme: "dark",
      startScreen: "following",
    })
    const path = join(directory, "preferences.json")
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      chatTheme: "dark",
      startScreen: "following",
    })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it("falls back to Home for damaged or unknown preference files", async () => {
    const path = join(directory, "preferences.json")
    await writeFile(path, "{not json")
    expect(await new PreferencesStore(directory).load()).toEqual({
      chatTheme: "dark",
      startScreen: "home",
    })
    await writeFile(path, JSON.stringify({ startScreen: "videos" }))
    expect(await new PreferencesStore(directory).load()).toEqual({
      chatTheme: "dark",
      startScreen: "home",
    })
  })

  it("serializes rapid changes so the last choice wins", async () => {
    const store = new PreferencesStore(directory)
    await Promise.all([
      store.setStartScreen("following"),
      store.setStartScreen("home"),
      store.setStartScreen("following"),
    ])
    expect(await store.load()).toEqual({ chatTheme: "dark", startScreen: "following" })
  })
})
