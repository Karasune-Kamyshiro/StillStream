import { describe, expect, it } from "vitest"
import {
  checkForUpdates,
  compareVersions,
  detectPackaging,
  RELEASES_PAGE,
  releasePageUrl,
} from "./update-check"

const release = (tag: string, prerelease = false, draft = false) => ({
  draft,
  html_url: `${RELEASES_PAGE}/tag/${tag}`,
  prerelease,
  tag_name: tag,
})
const fetchReturning =
  (body: unknown, ok = true) =>
  async () =>
    ({ json: async () => body, ok }) as Response

describe("compareVersions", () => {
  it.each([
    ["0.2.3-test.2", "0.2.3-test.10", -1],
    ["0.2.3-test.12", "0.2.3", -1],
    ["v0.2.4", "0.2.3", 1],
    ["0.2.1-fork.13", "0.2.3-test.1", -1],
    ["0.2.3", "v0.2.3", 0],
    ["1.0.0-alpha", "1.0.0-alpha.1", -1],
    ["1.0.0-1", "1.0.0-beta", -1],
  ])("%s vs %s", (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected)
  })
})

describe("detectPackaging", () => {
  it("reads the Flatpak branch from /.flatpak-info", () => {
    expect(detectPackaging({ FLATPAK_ID: "x" }, "[Instance]\nbranch=beta\narch=x86_64\n")).toEqual({
      branch: "beta",
      kind: "flatpak",
    })
  })
  it("treats a Flatpak without a branch as installed from a file", () => {
    expect(detectPackaging({ FLATPAK_ID: "x" }, undefined)).toEqual({
      branch: "master",
      kind: "flatpak",
    })
  })
  it("recognises the AppImage and anything else", () => {
    expect(detectPackaging({ APPIMAGE: "/a" }, undefined)).toEqual({ kind: "appimage" })
    expect(detectPackaging({}, undefined)).toEqual({ kind: "other" })
  })
})

describe("checkForUpdates", () => {
  const packaging = { kind: "appimage" } as const
  const releases = [
    release("v0.2.4-test.1", true),
    release("v0.2.3"),
    release("v0.3.0", false, true),
    release("v0.2.2"),
  ]

  it("offers the newest full release, ignoring drafts and pre-releases by default", async () => {
    const result = await checkForUpdates({
      currentVersion: "0.2.3-test.12",
      fetch: fetchReturning(releases),
      includePrereleases: false,
      packaging,
    })
    expect(result).toMatchObject({
      latest: { prerelease: false, url: `${RELEASES_PAGE}/tag/v0.2.3`, version: "0.2.3" },
      status: "available",
    })
  })

  it("offers pre-releases when asked", async () => {
    const result = await checkForUpdates({
      currentVersion: "0.2.3",
      fetch: fetchReturning(releases),
      includePrereleases: true,
      packaging,
    })
    expect(result.latest).toMatchObject({ prerelease: true, version: "0.2.4-test.1" })
  })

  it("is current when nothing newer is out", async () => {
    const result = await checkForUpdates({
      currentVersion: "0.2.4-test.1",
      fetch: fetchReturning(releases),
      includePrereleases: true,
      packaging,
    })
    expect(result.status).toBe("current")
  })

  it("reports unknown instead of failing when GitHub cannot be asked", async () => {
    for (const fetch of [
      fetchReturning({}, false),
      fetchReturning({ message: "rate limited" }),
      async () => {
        throw new Error("offline")
      },
    ]) {
      const result = await checkForUpdates({
        currentVersion: "0.2.3",
        fetch,
        includePrereleases: false,
        packaging,
      })
      expect(result.status).toBe("unknown")
    }
  })
})

describe("releasePageUrl", () => {
  it("only opens this project's release pages", () => {
    expect(releasePageUrl(`${RELEASES_PAGE}/tag/v0.2.3`)).toBe(`${RELEASES_PAGE}/tag/v0.2.3`)
    expect(() => releasePageUrl("https://example.com/")).toThrow()
    expect(() => releasePageUrl(`${RELEASES_PAGE}.evil.example/tag/x`)).toThrow()
  })
})
