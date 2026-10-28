import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { defaultPreferences } from "../shared/contracts"
import { PreferencesStore } from "./preferences-store"

describe("preferences store", () => {
  let directory: string
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "stillstream-preferences-"))
  })
  afterEach(async () => {
    await rm(directory, { force: true, recursive: true })
  })

  it("starts on Home until Following is chosen, then remembers it across instances", async () => {
    expect(await new PreferencesStore(directory).load()).toEqual(defaultPreferences())
    expect(await new PreferencesStore(directory).setStartScreen("following")).toEqual({
      ...defaultPreferences(),
      startScreen: "following",
    })
    expect(await new PreferencesStore(directory).load()).toEqual({
      ...defaultPreferences(),
      startScreen: "following",
    })
    const path = join(directory, "preferences.json")
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      ...defaultPreferences(),
      startScreen: "following",
    })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it("falls back to Home for damaged or unknown preference files", async () => {
    const path = join(directory, "preferences.json")
    await writeFile(path, "{not json")
    expect(await new PreferencesStore(directory).load()).toEqual(defaultPreferences())
    await writeFile(path, JSON.stringify({ startScreen: "videos" }))
    expect(await new PreferencesStore(directory).load()).toEqual(defaultPreferences())
  })

  it("keeps older preference files valid as options are added, and merges updates", async () => {
    const path = join(directory, "preferences.json")
    await writeFile(path, JSON.stringify({ startScreen: "following" }))
    const store = new PreferencesStore(directory)
    expect(await store.load()).toEqual({ ...defaultPreferences(), startScreen: "following" })
    expect(
      await store.update({
        chatLayout: "overlay",
        chatOverlayPosition: "bottom-left",
        quality: "1080p60",
      }),
    ).toEqual({
      ...defaultPreferences(),
      chatLayout: "overlay",
      chatOverlayPosition: "bottom-left",
      quality: "1080p60",
      startScreen: "following",
    })
    await expect(store.update({ chatOverlaySize: "huge" } as never)).rejects.toThrow()
  })

  it("serializes rapid changes so the last choice wins", async () => {
    const store = new PreferencesStore(directory)
    await Promise.all([
      store.setStartScreen("following"),
      store.setStartScreen("home"),
      store.setStartScreen("following"),
    ])
    expect(await store.load()).toEqual({ ...defaultPreferences(), startScreen: "following" })
  })
})
