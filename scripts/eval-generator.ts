// Output-quality eval for the block generator. Runs a fixed matrix of briefs
// through the production path (deriveTokens → directBrief → planBlocks →
// generateBlock, no database) and measures each block:
//   - taste audit findings on the first draft and after repair
//   - repair and visual-critique passes used
//   - TypeScript errors against this repo's real shadcn primitives
//   - token contrast and brand-colour placement
//   - tokens and cost
// With a running preview app it also renders every revision, lets Claude
// critique its own screenshots, and (with --baseline) runs a blind pairwise
// judge of each final block against the same block from an earlier run.
//
//   bun scripts/eval-generator.ts [outDir] [--only=<brief-id,...>]
//     [--preview-dir=<path> --preview-url=<url>] [--baseline=<earlier outDir>]
//     [--no-direction] [--blocks=<block-slug,...>] [--direction-from=<earlier outDir>]
//
// Needs ANTHROPIC_API_KEY. Writes <outDir>/results.json, every block's source
// to <outDir>/blocks/<brief>/<block>.tsx and screenshots to <outDir>/shots/.

import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { z } from "zod"
import { deriveTokens, planBlocks, type Brief } from "@/lib/generator/brief"
import { applyDirection, directBrief, type Direction } from "@/lib/generator/direction"
import {
  MODEL,
  addUsage,
  ask,
  emptyUsage,
  extractFenced,
  generateBlock,
  mapLimit,
  usageCostUsd,
  type BlockResult,
  type Render,
  type Renderer,
  type Usage,
} from "@/lib/generator/generate-block"
import { tokenContrastPairs } from "@/lib/taste-inspector"
import type { ThemeTokens } from "@/lib/token-schema"
import { closeRenderer, createRenderer } from "./render-block"

const run = promisify(execFile)

// Chosen to stress the generator: every layout, every feature, and brand
// colours that fail contrast (orange, pale yellow, mid grey), a near-black
// brand, and a dark page background.
export const EVAL_BRIEFS: (Brief & { id: string; why: string })[] = [
  {
    id: "tulip-orange",
    why: "Tulip's own brand; the orange is 2.8:1 on white",
    primaryColor: "#f97518", secondaryColor: "#1e0d01", backgroundColor: "#ffffff",
    layoutType: "saas-dashboard", features: ["Data Tables", "Line/Bar Charts"],
  },
  {
    id: "pale-yellow",
    why: "Very light primary (1.3:1 on white) on a cream background",
    primaryColor: "#fde047", secondaryColor: "#64748b", backgroundColor: "#fffbeb",
    layoutType: "data-analytics", features: ["Line/Bar Charts", "Date Pickers"],
  },
  {
    id: "near-black",
    why: "Monochrome brand with a vivid secondary",
    primaryColor: "#0a0a0a", secondaryColor: "#e11d48", backgroundColor: "#fafafa",
    layoutType: "feed-social", features: ["User Avatars", "Modal Forms"],
  },
  {
    id: "mid-grey",
    why: "Zero-chroma primary just under AA",
    primaryColor: "#808080", secondaryColor: "#2563eb", backgroundColor: "#f8fafc",
    layoutType: "settings-hub", features: ["Modal Forms"],
  },
  {
    id: "blue-all-features",
    why: "Well-behaved brand with every feature checked",
    primaryColor: "#2563eb", secondaryColor: "#f5f5f4", backgroundColor: "#ffffff",
    layoutType: "saas-dashboard",
    features: ["Data Tables", "Modal Forms", "Line/Bar Charts", "Date Pickers", "User Avatars"],
  },
  {
    id: "dark-background",
    why: "Dark page background with an emerald brand",
    primaryColor: "#10b981", secondaryColor: "#0f172a", backgroundColor: "#0b1120",
    layoutType: "data-analytics", features: ["Data Tables"],
  },
]

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

function exportName(source: string) {
  const match = /export\s+(?:default\s+)?function\s+(\w+)/.exec(source)
  if (!match) throw new Error("No exported function in block")
  return match[1]
}

/** tsc over just the generated files, resolved against this repo's components and tsconfig. */
async function typecheck(outDir: string, files: string[]) {
  const config = {
    extends: path.relative(outDir, path.resolve("tsconfig.json")),
    compilerOptions: { incremental: false, noEmit: true },
    include: [path.relative(outDir, path.resolve("next-env.d.ts")), ...files.map((f) => path.relative(outDir, f))],
    // Override the inherited exclude, which lists .eval and would drop every block.
    exclude: [path.relative(outDir, path.resolve("node_modules"))],
  }
  const configPath = path.join(outDir, "tsconfig.eval.json")
  await writeFile(configPath, JSON.stringify(config, null, 2))
  let output = ""
  try {
    await run("npx", ["tsc", "-p", configPath, "--pretty", "false"], { maxBuffer: 32 * 1024 * 1024 })
  } catch (err) {
    output = String((err as { stdout?: string }).stdout ?? err)
  }
  const errors: Record<string, string[]> = {}
  for (const line of output.split("\n")) {
    const match = /^(.+?\.tsx)\(\d+,\d+\): error (.*)$/.exec(line)
    if (!match) continue
    const file = path.resolve(match[1])
    if (!files.includes(file)) continue // errors inside shared primitives aren't the block's fault
    ;(errors[file] ??= []).push(line.slice(line.indexOf(match[1]) + match[1].length).trim())
  }
  return errors
}

// --- Blind pairwise judge ---

const JUDGE_SYSTEM = `You review product UI for a design studio whose clients pay for taste. You will see two renders, A and B, of the same component for the same client, each at desktop and phone width. They come from different versions of a generator, in random order. Judge only what you see: hierarchy, typography, use of colour, spacing and grouping, information design, polish of details, and how it holds up on a phone. Ignore which one has more features unless it changes the quality.

Reply with one \`\`\`json block: {"winner": "A" | "B" | "tie", "scoreA": 1-10, "scoreB": 1-10, "reasons": "2-4 sentences naming the concrete differences"}. A 5 is competent template work; 8 is what a senior product designer at Linear or Stripe would ship.`

const Verdict = z.object({
  winner: z.enum(["A", "B", "tie"]),
  scoreA: z.number().min(1).max(10),
  scoreB: z.number().min(1).max(10),
  reasons: z.string(),
})

const image = (bytes: Uint8Array) => ({
  type: "image" as const,
  source: { type: "base64" as const, media_type: "image/png" as const, data: Buffer.from(bytes).toString("base64") },
})

export async function judge(name: string, baseline: Render, candidate: Render) {
  const candidateIsA = Math.random() < 0.5
  const [a, b] = candidateIsA ? [candidate, baseline] : [baseline, candidate]
  const reply = await ask(
    JUDGE_SYSTEM,
    [{
      role: "user",
      content: [
        { type: "text", text: `Component: ${name}.\n\nA, desktop:` }, image(a.desktop),
        { type: "text", text: "A, phone:" }, image(a.mobile),
        { type: "text", text: "B, desktop:" }, image(b.desktop),
        { type: "text", text: "B, phone:" }, image(b.mobile),
        { type: "text", text: "Which is better?" },
      ],
    }],
    "high",
  )
  const v = Verdict.parse(JSON.parse(extractFenced(reply.text, "json")))
  const unmask = (w: "A" | "B" | "tie") => (w === "tie" ? "tie" : (w === "A") === candidateIsA ? "new" : "baseline")
  return {
    winner: unmask(v.winner),
    newScore: candidateIsA ? v.scoreA : v.scoreB,
    baselineScore: candidateIsA ? v.scoreB : v.scoreA,
    reasons: v.reasons.replace(/\bA\b/g, candidateIsA ? "new" : "baseline").replace(/\bB\b/g, candidateIsA ? "baseline" : "new"),
    usage: reply.usage,
  }
}

async function main() {
  const args = process.argv.slice(2)
  const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
  const outDir = path.resolve(args.find((a) => !a.startsWith("--")) ?? `.eval/${new Date().toISOString().replace(/[:.]/g, "-")}`)
  const only = flag("only")?.split(",")
  const previewDir = flag("preview-dir")
  const previewUrl = flag("preview-url")
  const baselineDir = flag("baseline") ? path.resolve(flag("baseline")!) : null
  const useDirection = !args.includes("--no-direction")
  // Reuse each brief's direction from an earlier run, so re-generated blocks match their siblings.
  const directionFrom = flag("direction-from")
  const savedDirections: Record<string, Direction> = directionFrom
    ? Object.fromEntries(
        JSON.parse(await readFile(path.resolve(directionFrom, "results.json"), "utf8")).briefs
          .filter((b: { direction: Direction | null }) => b.direction)
          .map((b: { id: string; direction: Direction }) => [b.id, b.direction]),
      )
    : {}
  const briefs = only ? EVAL_BRIEFS.filter((b) => only.includes(b.id)) : EVAL_BRIEFS
  await mkdir(outDir, { recursive: true })

  let usage = emptyUsage()
  const track = (u: Usage) => { usage = addUsage(usage, u) }

  // 1. Tokens and design direction per brief.
  const prepared = await mapLimit(briefs, 3, async (brief) => {
    const derived = deriveTokens(brief)
    let tokens = derived.tokens
    let direction: Direction | undefined
    if (savedDirections[brief.id]) {
      direction = savedDirections[brief.id]
      tokens = applyDirection(tokens, direction)
    } else if (useDirection) {
      const result = await directBrief(brief, tokens, derived.notes)
      track(result.usage)
      direction = result.direction
      tokens = applyDirection(tokens, direction)
      console.log(`  ◆ ${brief.id}: ${direction.typography.heading} / ${direction.typography.body}, ${direction.density}, ${direction.radius}`)
    }
    const render: Renderer | undefined =
      previewDir && previewUrl
        ? createRenderer({ previewDir, previewUrl, tokens, background: derived.background, exportName })
        : undefined
    return { brief, derived, tokens, direction, render }
  })

  // 2. Blocks.
  const onlyBlocks = flag("blocks")?.split(",")
  const jobs = prepared.flatMap((p) =>
    planBlocks(p.brief)
      .filter((spec) => !onlyBlocks || onlyBlocks.includes(slug(spec.name)))
      .map((spec) => ({ ...p, spec })),
  )
  console.log(`Generating ${jobs.length} blocks for ${briefs.length} briefs with ${MODEL}${previewUrl ? " (with visual critique)" : ""}…`)

  const results = await mapLimit(jobs, 4, async (job) => {
    const label = `${job.brief.id} / ${job.spec.name}`
    try {
      const result = await generateBlock(job.brief, job.spec, job.tokens, { direction: job.direction, render: job.render })
      track(result.usage)
      console.log(
        `  ✓ ${label}: ${result.attempts.map((a) => `${a.kind[0]}${a.violations}`).join(" → ")}, ${(result.durationMs / 1000).toFixed(0)}s, $${usageCostUsd(result.usage).toFixed(2)}`,
      )
      return { job, result, error: null as string | null }
    } catch (err) {
      console.log(`  ✗ ${label}: ${err instanceof Error ? err.message : err}`)
      return { job, result: null as BlockResult | null, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 3. Save sources and screenshots.
  const files: string[] = []
  const finalRenders = new Map<string, Render>()
  for (const { job, result } of results) {
    if (!result) continue
    const base = path.join(job.brief.id, slug(job.spec.name))
    const file = path.join(outDir, "blocks", `${base}.tsx`)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, result.source)
    if (result.firstCleanSource && result.firstCleanSource !== result.source) {
      await writeFile(path.join(outDir, "blocks", `${base}.first.tsx`), result.firstCleanSource)
    }
    files.push(file)
    if (job.render) {
      const shotDir = path.join(outDir, "shots", job.brief.id)
      await mkdir(shotDir, { recursive: true })
      const final = await job.render(result.source, `${job.brief.id}-${slug(job.spec.name)}-final`)
      finalRenders.set(base, final)
      await writeFile(path.join(shotDir, `${slug(job.spec.name)}-final-desktop.png`), final.desktop)
      await writeFile(path.join(shotDir, `${slug(job.spec.name)}-final-mobile.png`), final.mobile)
      if (result.firstCleanSource && result.firstCleanSource !== result.source) {
        const first = await job.render(result.firstCleanSource, `${job.brief.id}-${slug(job.spec.name)}-first`)
        await writeFile(path.join(shotDir, `${slug(job.spec.name)}-first-desktop.png`), first.desktop)
        await writeFile(path.join(shotDir, `${slug(job.spec.name)}-first-mobile.png`), first.mobile)
      }
    }
  }

  // 4. Blind judge against an earlier run of the same briefs.
  const verdicts = new Map<string, Awaited<ReturnType<typeof judge>>>()
  if (baselineDir && previewDir && previewUrl) {
    const baseline = JSON.parse(await readFile(path.join(baselineDir, "results.json"), "utf8"))
    for (const { job, result } of results) {
      if (!result) continue
      const base = path.join(job.brief.id, slug(job.spec.name))
      const oldFile = path.join(baselineDir, "blocks", `${base}.tsx`)
      const oldBrief = baseline.briefs.find((b: { id: string }) => b.id === job.brief.id)
      if (!existsSync(oldFile) || !oldBrief) continue
      const oldRender = await createRenderer({
        previewDir, previewUrl, tokens: oldBrief.tokens as ThemeTokens, background: job.derived.background, exportName,
      })(await readFile(oldFile, "utf8"), `${job.brief.id}-${slug(job.spec.name)}-baseline`)
      const shotDir = path.join(outDir, "shots", job.brief.id)
      await writeFile(path.join(shotDir, `${slug(job.spec.name)}-baseline-desktop.png`), oldRender.desktop)
      await writeFile(path.join(shotDir, `${slug(job.spec.name)}-baseline-mobile.png`), oldRender.mobile)
      const verdict = await judge(job.spec.name, oldRender, finalRenders.get(base)!)
      track(verdict.usage)
      verdicts.set(base, verdict)
      console.log(`  ⚖ ${base}: ${verdict.winner} (new ${verdict.newScore} vs baseline ${verdict.baselineScore})`)
    }
  }
  await closeRenderer()

  // 5. Type check and report.
  let tsErrors: Record<string, string[]> = {}
  if (files.length > 0) {
    console.log("Type-checking against components/ui…")
    tsErrors = await typecheck(outDir, files)
  }

  const report = prepared.map(({ brief, derived, tokens, direction }) => ({
    ...brief,
    tokens,
    direction: direction ?? null,
    anchors: derived.anchors,
    tokenNotes: derived.notes,
    contrast: tokenContrastPairs(tokens),
    blocks: results
      .filter((r) => r.job.brief.id === brief.id)
      .map(({ job, result, error }) => {
        const base = path.join(brief.id, slug(job.spec.name))
        const file = path.join(outDir, "blocks", `${base}.tsx`)
        return {
          name: job.spec.name,
          file: path.relative(outDir, file),
          error,
          firstDraftFindings: result?.attempts[0]?.violations ?? null,
          finalFindings: result?.violations.length ?? null,
          finalViolations: result?.violations ?? [],
          attempts: result?.attempts ?? [],
          critiqueRounds: result?.attempts.filter((a) => a.kind === "critique").length ?? 0,
          typeErrors: tsErrors[file] ?? [],
          lines: result ? result.source.split("\n").length : 0,
          durationMs: result?.durationMs ?? 0,
          usage: result?.usage ?? emptyUsage(),
          costUsd: result ? Number(usageCostUsd(result.usage).toFixed(4)) : 0,
          verdict: verdicts.get(base) ? { ...verdicts.get(base)!, usage: undefined } : null,
        }
      }),
  }))

  const judged = [...verdicts.values()]
  const summary = {
    model: MODEL,
    ranAt: new Date().toISOString(),
    direction: useDirection,
    visualCritique: Boolean(previewUrl),
    briefs: briefs.length,
    blocks: jobs.length,
    failed: results.filter((r) => !r.result).length,
    cleanFirstDraft: results.filter((r) => r.result?.attempts[0]?.violations === 0).length,
    cleanFinal: results.filter((r) => r.result && r.result.violations.length === 0).length,
    typeClean: results.filter((r) => r.result && !tsErrors[path.join(outDir, "blocks", r.job.brief.id, `${slug(r.job.spec.name)}.tsx`)]).length,
    judge: judged.length
      ? {
          compared: judged.length,
          newWins: judged.filter((v) => v.winner === "new").length,
          baselineWins: judged.filter((v) => v.winner === "baseline").length,
          ties: judged.filter((v) => v.winner === "tie").length,
          meanNew: Number((judged.reduce((s, v) => s + v.newScore, 0) / judged.length).toFixed(1)),
          meanBaseline: Number((judged.reduce((s, v) => s + v.baselineScore, 0) / judged.length).toFixed(1)),
        }
      : null,
    usage,
    costUsd: Number(usageCostUsd(usage).toFixed(2)),
  }

  await writeFile(path.join(outDir, "results.json"), JSON.stringify({ summary, briefs: report }, null, 2))
  console.log(JSON.stringify(summary, null, 2))
  console.log(`Results: ${path.join(outDir, "results.json")}`)
  if (summary.failed === summary.blocks) process.exitCode = 1
}

// Run only when executed directly, so judge() and EVAL_BRIEFS can be imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
