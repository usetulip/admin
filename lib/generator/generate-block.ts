import Anthropic from "@anthropic-ai/sdk"
import { auditBlock, type TasteViolation } from "@/lib/taste-inspector"
import type { ThemeTokens } from "@/lib/token-schema"
import type { BlockSpec, Brief } from "./brief"
import type { Direction } from "./direction"
import { SYSTEM_PROMPT, blockPrompt, critiquePrompt, repairPrompt } from "./prompts"
import { referenceBlocks } from "./references"

// Writes one block with Claude. Each draft goes through the same auditBlock()
// the operator dashboard runs, and violations go back for up to MAX_REPAIRS
// rounds. When a renderer is supplied (the eval harness has one; production
// does not yet), Claude then sees screenshots of its block and revises it for
// up to CRITIQUE_ROUNDS rounds. No database access.

export const MODEL = "claude-opus-5-5"
export const MAX_REPAIRS = 3
export const CRITIQUE_ROUNDS = 2

// Claude Opus 5.5 list prices, USD per million tokens.
const PRICE = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 }

export type Usage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export const emptyUsage = (): Usage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
})

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  }
}

export function usageCostUsd(usage: Usage) {
  return (
    (usage.inputTokens * PRICE.input +
      usage.outputTokens * PRICE.output +
      usage.cacheWriteTokens * PRICE.cacheWrite +
      usage.cacheReadTokens * PRICE.cacheRead) /
    1_000_000
  )
}

/** Screenshots of a block revision, as PNG bytes. */
export type Render = { desktop: Uint8Array; mobile: Uint8Array }
export type Renderer = (source: string, revision: string) => Promise<Render>

export type AttemptRecord = {
  attempt: number
  kind: "draft" | "repair" | "critique"
  violations: number
  byRule: Record<string, number>
  /** The critique Claude wrote before revising (critique rounds only). */
  critique?: string
}

export type BlockResult = {
  spec: BlockSpec
  source: string
  /** The first draft that passed the audit, before any visual critique. */
  firstCleanSource: string | null
  /** Violations left in the returned source (code-level only; token contrast is checked separately). */
  violations: TasteViolation[]
  attempts: AttemptRecord[]
  usage: Usage
  model: string
  durationMs: number
}

export class GenerationError extends Error {}

let client: Anthropic | undefined
function getClient() {
  client ??= new Anthropic()
  return client
}

/** The last fenced block of the given language (or any code fence) in a reply. */
export function extractFenced(text: string, lang: "tsx" | "json") {
  const pattern =
    lang === "tsx"
      ? /```(?:tsx|jsx|ts|typescript)?\s*\n([\s\S]*?)```/g
      : /```(?:json)?\s*\n([\s\S]*?)```/g
  const body = [...text.matchAll(pattern)].at(-1)?.[1]?.trim()
  if (!body) {
    throw new GenerationError(`The model reply contained no ${lang} code block`)
  }
  return body
}

export const extractSource = (text: string) => `${extractFenced(text, "tsx")}\n`

// Token-level contrast findings have no line and can't be fixed in code; the
// generator only feeds back what the block itself controls.
export function codeViolations(source: string, tokens: ThemeTokens) {
  return auditBlock(source, tokens).filter((v) => !(v.rule === "wcag_contrast" && v.line === null))
}

function countByRule(violations: TasteViolation[]) {
  const byRule: Record<string, number> = {}
  for (const v of violations) byRule[v.rule] = (byRule[v.rule] ?? 0) + 1
  return byRule
}

export async function ask(
  system: string,
  messages: Anthropic.Beta.BetaMessageParam[],
  effort: "medium" | "high" | "xhigh" = "high",
) {
  const stream = getClient().beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort },
    cache_control: { type: "ephemeral" },
    system,
    messages,
  })
  const message = await stream.finalMessage()

  if (message.stop_reason === "refusal") {
    throw new GenerationError(
      `The model declined this request${message.stop_details?.category ? ` (${message.stop_details.category})` : ""}`,
    )
  }
  if (message.stop_reason === "max_tokens") {
    throw new GenerationError("The reply hit the output limit before it was finished")
  }

  const text = message.content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")

  const usage: Usage = {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
  }
  return { message, text, usage }
}

const png = (bytes: Uint8Array): Anthropic.Beta.BetaImageBlockParam => ({
  type: "image",
  source: { type: "base64", media_type: "image/png", data: Buffer.from(bytes).toString("base64") },
})

export async function generateBlock(
  brief: Brief,
  spec: BlockSpec,
  tokens: ThemeTokens,
  options: { direction?: Direction; render?: Renderer } = {},
): Promise<BlockResult> {
  const started = Date.now()
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: [...referenceBlocks(), { type: "text", text: blockPrompt(brief, spec, options.direction) }] },
  ]
  let usage = emptyUsage()
  const attempts: AttemptRecord[] = []
  let model = MODEL
  let kind: AttemptRecord["kind"] = "draft"

  // Latest revision that passes the audit, and the best fallback if none does.
  let clean: string | null = null
  let firstClean: string | null = null
  let best: { source: string; violations: TasteViolation[] } | null = null
  let repairs = 0
  let critiques = 0

  for (;;) {
    const reply = await ask(SYSTEM_PROMPT, messages)
    usage = addUsage(usage, reply.usage)
    model = reply.message.model

    const source = extractSource(reply.text)
    const violations = codeViolations(source, tokens)
    attempts.push({ attempt: attempts.length + 1, kind, violations: violations.length, byRule: countByRule(violations) })
    if (!best || violations.length <= best.violations.length) best = { source, violations }

    // Append-only history: keep the full assistant turn (thinking included).
    messages.push({ role: "assistant", content: reply.message.content })

    if (violations.length > 0) {
      if (repairs >= MAX_REPAIRS) break
      repairs++
      kind = "repair"
      messages.push({ role: "user", content: repairPrompt(violations) })
      continue
    }

    clean = source
    firstClean ??= source
    if (!options.render || critiques >= CRITIQUE_ROUNDS) break

    critiques++
    repairs = 0
    let shots: Render
    try {
      shots = await options.render(source, `${spec.componentName}-r${attempts.length}`)
    } catch (err) {
      // A failed render ends the critique rounds but keeps the clean revision.
      console.warn(`[generator] render failed for ${spec.name}; keeping the last clean revision`, err)
      break
    }
    messages.push({
      role: "user",
      content: [
        { type: "text", text: "Desktop render at 1280px wide:" },
        png(shots.desktop),
        { type: "text", text: "Phone render at 390px wide:" },
        png(shots.mobile),
        { type: "text", text: critiquePrompt(critiques, options.direction) },
      ],
    })
    kind = "critique"
  }

  // Keep each critique's prose (written before its code block) for the run record.
  const assistantTurns = messages.filter((m) => m.role === "assistant")
  for (const record of attempts) {
    if (record.kind !== "critique") continue
    const turn = assistantTurns[record.attempt - 1]
    const text = Array.isArray(turn?.content)
      ? turn.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join("")
      : ""
    record.critique = text.split("```")[0].trim().slice(0, 4000)
  }

  const final = clean ?? best!.source
  return {
    spec,
    source: final,
    firstCleanSource: firstClean,
    violations: clean ? [] : best!.violations,
    attempts,
    usage,
    model,
    durationMs: Date.now() - started,
  }
}

/** Runs `fn` over `items` with at most `limit` in flight, keeping input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
