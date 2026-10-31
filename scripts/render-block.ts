// Eval-only renderer: writes a block revision into a running Next.js preview
// app (a copy of this repo's components and Tailwind setup), opens it with
// Playwright and returns desktop and phone screenshots. Production has no
// renderer yet; generateBlock() skips the visual critique without one.

import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { chromium, type Browser } from "playwright"
import { themeCss } from "@/lib/generator/bundle"
import { googleFontsHref } from "@/lib/generator/direction"
import type { Render } from "@/lib/generator/generate-block"
import type { ThemeTokens } from "@/lib/token-schema"

const MAX_HEIGHT = 2400
const ENTRY_ANIMATION_MS = 2500

let browser: Promise<Browser> | undefined

export async function closeRenderer() {
  if (browser) await (await browser).close()
}

/** Theme CSS for a preview page: fonts, then the client's variables scoped to `.tulip-scope`. */
export function previewCss(tokens: ThemeTokens, background: string) {
  const css = themeCss(tokens, background)
    .replace(/@theme inline \{[\s\S]*?\n\}\n/, "")
    .replace(":root", ".tulip-scope")
  return `@import url("${googleFontsHref(tokens)}");\n${css}`
}

export function createRenderer(options: {
  previewDir: string
  previewUrl: string
  tokens: ThemeTokens
  background: string
  exportName: (source: string) => string
}) {
  return async (source: string, revision: string): Promise<Render> => {
    const id = revision.toLowerCase().replace(/[^a-z0-9-]/g, "-")
    const componentDir = path.join(options.previewDir, "components", "render")
    const pageDir = path.join(options.previewDir, "app", "render", id)
    await mkdir(componentDir, { recursive: true })
    await mkdir(pageDir, { recursive: true })
    await writeFile(path.join(componentDir, `${id}.tsx`), source)
    await writeFile(path.join(pageDir, "theme.css"), previewCss(options.tokens, options.background))
    await writeFile(
      path.join(pageDir, "page.tsx"),
      `import "./theme.css"\nimport { ${options.exportName(source)} as Block } from "@/components/render/${id}"\n\nexport default function Page() {\n  return (\n    <main className="tulip-scope bg-background text-foreground min-h-screen">\n      <Block />\n    </main>\n  )\n}\n`,
    )

    browser ??= chromium.launch()
    const shots: Partial<Render> = {}
    for (const [key, width, height] of [["desktop", 1280, 900], ["mobile", 390, 844]] as const) {
      const page = await (await browser).newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
      try {
        // A just-written route can 404 until the dev server's watcher picks it
        // up, and the first hit compiles it; retry a few times.
        let response = null
        for (let attempt = 0; attempt < 6; attempt++) {
          response = await page.goto(`${options.previewUrl}/render/${id}`, { waitUntil: "networkidle", timeout: 120_000 })
          if (response?.status() !== 404) break
          await page.waitForTimeout(2000)
        }
        if (!response?.ok()) throw new Error(`Preview returned ${response?.status()} for ${id}`)
        await page.evaluate(() => document.fonts.ready)
        // Chart libraries animate in (recharts: 1.5s); capture the settled frame.
        await page.waitForTimeout(ENTRY_ANIMATION_MS)
        const full = await page.evaluate(() => document.documentElement.scrollHeight)
        shots[key] = await page.screenshot({ clip: { x: 0, y: 0, width, height: Math.min(full, MAX_HEIGHT) }, fullPage: true })
      } finally {
        await page.close()
      }
    }
    return shots as Render
  }
}
