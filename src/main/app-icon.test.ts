import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// The Flatpak installs build/icon.png as hicolor/512x512, and AppStream/Flatpak tooling rejects
// an icon whose pixels do not match that size. Catch a mis-sized export here, not in a release.
describe("application icon", () => {
  it("is a 512x512 PNG", async () => {
    const png = await readFile(join(process.cwd(), "build/icon.png"))
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG")
    const width = png.readUInt32BE(16)
    const height = png.readUInt32BE(20)
    expect(
      { height, width },
      `build/icon.png is ${width}x${height}; export it at exactly 512x512`,
    ).toEqual({ height: 512, width: 512 })
  })
})
