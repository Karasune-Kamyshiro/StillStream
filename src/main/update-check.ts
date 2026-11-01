import { readFile } from "node:fs/promises"
import { z } from "zod"
import type { UpdatePackaging, UpdateSnapshot } from "../shared/contracts"

export const RELEASES_PAGE = "https://github.com/Karasune-Kamyshiro/StillStream/releases"
const RELEASES_API =
  "https://api.github.com/repos/Karasune-Kamyshiro/StillStream/releases?per_page=30"

const ReleaseSchema = z.object({
  draft: z.boolean(),
  html_url: z.string(),
  prerelease: z.boolean(),
  tag_name: z.string(),
})

type Version = { readonly core: readonly number[]; readonly pre: readonly string[] }

const parseVersion = (value: string): Version | undefined => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(value.trim())
  if (match === null) return undefined
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] === undefined ? [] : match[4].split("."),
  }
}

const compareIdentifiers = (a: string, b: string): number => {
  const numericA = /^\d+$/.test(a)
  const numericB = /^\d+$/.test(b)
  if (numericA && numericB) return Number(a) - Number(b)
  if (numericA !== numericB) return numericA ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** Semantic version order: 0.2.3-test.2 < 0.2.3-test.10 < 0.2.3 < 0.2.4. */
export const compareVersions = (a: string, b: string): number => {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (left === undefined || right === undefined) return 0
  for (let index = 0; index < 3; index += 1) {
    const difference = (left.core[index] ?? 0) - (right.core[index] ?? 0)
    if (difference !== 0) return Math.sign(difference)
  }
  if (left.pre.length === 0 || right.pre.length === 0) {
    return left.pre.length === right.pre.length ? 0 : left.pre.length === 0 ? 1 : -1
  }
  for (let index = 0; index < Math.max(left.pre.length, right.pre.length); index += 1) {
    const a = left.pre[index]
    const b = right.pre[index]
    if (a === undefined) return -1
    if (b === undefined) return 1
    const difference = compareIdentifiers(a, b)
    if (difference !== 0) return Math.sign(difference)
  }
  return 0
}

/** How this copy was installed decides how it can update. */
export const detectPackaging = (
  env: NodeJS.ProcessEnv,
  flatpakInfo: string | undefined,
): UpdatePackaging => {
  if (env["FLATPAK_ID"] !== undefined || flatpakInfo !== undefined) {
    const branch = /^branch=(.+)$/m.exec(flatpakInfo ?? "")?.[1]?.trim() ?? "master"
    return { branch, kind: "flatpak" }
  }
  if (env["APPIMAGE"] !== undefined) return { kind: "appimage" }
  return { kind: "other" }
}

export const readPackaging = async (): Promise<UpdatePackaging> =>
  detectPackaging(process.env, await readFile("/.flatpak-info", "utf8").catch(() => undefined))

type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<Response>

/**
 * Compares this version with the newest GitHub release (pre-releases only when asked). Network
 * and API failures report "unknown" rather than throwing: an update check must never get in the
 * way of watching.
 */
export const checkForUpdates = async ({
  currentVersion,
  fetch,
  includePrereleases,
  packaging,
}: {
  readonly currentVersion: string
  readonly fetch: FetchLike
  readonly includePrereleases: boolean
  readonly packaging: UpdatePackaging
}): Promise<UpdateSnapshot> => {
  const base = { currentVersion, includePrereleases, packaging }
  try {
    const response = await fetch(RELEASES_API, {
      headers: { Accept: "application/vnd.github+json" },
    })
    if (!response.ok) return { ...base, status: "unknown" }
    const releases = z.array(ReleaseSchema).parse(await response.json())
    const newest = releases
      .filter((release) => !release.draft && (includePrereleases || !release.prerelease))
      .filter((release) => parseVersion(release.tag_name) !== undefined)
      .sort((a, b) => compareVersions(b.tag_name, a.tag_name))[0]
    if (newest === undefined || compareVersions(newest.tag_name, currentVersion) <= 0) {
      return { ...base, status: "current" }
    }
    return {
      ...base,
      latest: {
        prerelease: newest.prerelease,
        url: newest.html_url.startsWith(`${RELEASES_PAGE}/`) ? newest.html_url : RELEASES_PAGE,
        version: newest.tag_name.replace(/^v/, ""),
      },
      status: "available",
    }
  } catch {
    return { ...base, status: "unknown" }
  }
}

/** Only release pages of this project may be opened from the update notice. */
export const releasePageUrl = (input: unknown): string => {
  const url = z.url().parse(input)
  if (url !== RELEASES_PAGE && !url.startsWith(`${RELEASES_PAGE}/tag/`)) {
    throw new Error("Not a StillStream release page")
  }
  return url
}
