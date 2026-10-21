import "server-only"
import { randomUUID } from "node:crypto"
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import { getDb } from "@/db"
import {
  authUsers,
  clientTokenSets,
  componentBlocks,
  operatorAuditLog,
  projects,
  type PipelineStep,
  type PipelineStepStatus,
} from "@/db/schema"
import { blockHash } from "@/lib/dal"
import { auditBlock } from "@/lib/taste-inspector"
import { ThemeTokensSchema } from "@/lib/token-schema"
import { deriveTokens, layoutLabel, planBlocks, type Brief } from "./brief"
import { buildBundle } from "./bundle"
import { applyDirection, directBrief } from "./direction"
import {
  GenerationError,
  MODEL,
  addUsage,
  generateBlock,
  mapLimit,
  usageCostUsd,
} from "./generate-block"

// Runs the generator against tulip-db: brief in, draft component_blocks out
// for operator review. Callers authenticate first (operator session or the
// webhook secret); nothing here checks auth.

export const GENERATOR_ACTOR = "tulip-generator"

// A run that started this long ago without finishing is treated as dead.
const STALE_RUN_MS = 20 * 60_000
const CONCURRENCY = 3

const FREE_MAIL = new Set([
  "gmail", "googlemail", "outlook", "hotmail", "live", "yahoo", "icloud", "me", "proton", "protonmail", "aol",
])

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48)
}

/** client_id for a project: its existing blocks' id, else the email's company domain. */
export function deriveClientId(projectId: string, email: string | null, existing: string | null) {
  if (existing) return existing
  const [local = "", domain = ""] = (email ?? "").toLowerCase().split("@")
  const company = domain.split(".")[0] ?? ""
  if (company && !FREE_MAIL.has(company)) return slugify(company) || `client-${projectId.slice(0, 8)}`
  return `${slugify(local) || "client"}-${projectId.slice(0, 6)}`
}

function setStep(steps: PipelineStep[], id: string, status: PipelineStepStatus) {
  return steps.map((step) => (step.id === id ? { ...step, status } : step))
}

async function log(actor: string, action: string, entityType: string, entityId: string, details: Record<string, unknown> = {}) {
  await getDb().insert(operatorAuditLog).values({ actor, action, entityType, entityId, details })
}

export type GenerationState =
  | { state: "idle" }
  | { state: "running"; startedAt: string }
  | { state: "completed" | "failed"; at: string; details: Record<string, unknown> }

type Reader = Pick<ReturnType<typeof getDb>, "select">

/** Latest generator run for a project, read from the audit log. */
export async function generationState(projectId: string, db: Reader = getDb()): Promise<GenerationState> {
  const [last] = await db
    .select()
    .from(operatorAuditLog)
    .where(
      and(
        eq(operatorAuditLog.entityType, "project"),
        eq(operatorAuditLog.entityId, projectId),
        inArray(operatorAuditLog.action, ["generation.started", "generation.completed", "generation.failed"]),
      ),
    )
    .orderBy(desc(operatorAuditLog.id))
    .limit(1)
  if (!last) return { state: "idle" }
  if (last.action === "generation.started") {
    return Date.now() - last.createdAt.getTime() < STALE_RUN_MS
      ? { state: "running", startedAt: last.createdAt.toISOString() }
      : { state: "failed", at: last.createdAt.toISOString(), details: { error: "Run timed out" } }
  }
  return {
    state: last.action === "generation.completed" ? "completed" : "failed",
    at: last.createdAt.toISOString(),
    details: last.details,
  }
}

async function loadProject(projectId: string) {
  const [row] = await getDb()
    .select({ project: projects, email: authUsers.email })
    .from(projects)
    .leftJoin(authUsers, eq(authUsers.id, projects.userId))
    .where(eq(projects.id, projectId))
  return row ?? null
}

/** Claims the run, or returns false if one is already in flight for this project. */
export async function claimGeneration(projectId: string, requestedBy: string) {
  // Transaction-scoped advisory lock, so a webhook and an operator click
  // can't both start a run (session locks don't survive the pooler).
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`generation:${projectId}`}))`)
    const state = await generationState(projectId, tx)
    if (state.state === "running") return false
    await tx.insert(operatorAuditLog).values({
      actor: GENERATOR_ACTOR,
      action: "generation.started",
      entityType: "project",
      entityId: projectId,
      details: { requestedBy, model: MODEL },
    })
    return true
  })
}

/**
 * Generates the full block set for a project and stores it as drafts.
 * Call claimGeneration() first. Never throws: failures are logged.
 */
export async function runGeneration(projectId: string) {
  const db = getDb()
  try {
    const row = await loadProject(projectId)
    if (!row) throw new GenerationError("Project not found")
    const { project } = row
    if (project.status === "delivered") throw new GenerationError("Project is already delivered")

    const brief: Brief = {
      primaryColor: project.primaryColor,
      secondaryColor: project.secondaryColor,
      backgroundColor: project.backgroundColor,
      layoutType: project.layoutType,
      features: project.features,
    }
    const derived = deriveTokens(brief)
    const specs = planBlocks(brief)

    await db
      .update(projects)
      .set({ pipelineSteps: setStep(setStep(project.pipelineSteps, "brief", "completed"), "orchestration", "active"), updatedAt: new Date() })
      .where(eq(projects.id, projectId))

    // One design direction per brief, shared by every block. No renderer here
    // yet, so production skips the visual critique rounds the eval runs.
    const { direction, usage: directionUsage } = await directBrief(brief, derived.tokens, derived.notes)
    const tokens = applyDirection(derived.tokens, direction)
    const results = await mapLimit(specs, CONCURRENCY, (spec) => generateBlock(brief, spec, tokens, { direction }))

    const [existing] = await db
      .select({ clientId: componentBlocks.clientId })
      .from(componentBlocks)
      .where(eq(componentBlocks.projectId, projectId))
      .limit(1)
    const clientId = deriveClientId(projectId, row.email, existing?.clientId ?? null)

    const created = await db.transaction(async (tx) => {
      // Regenerating replaces the generator's own unpublished drafts; operator
      // edits and anything already published stay.
      await tx
        .delete(componentBlocks)
        .where(
          and(
            eq(componentBlocks.projectId, projectId),
            eq(componentBlocks.createdBy, GENERATOR_ACTOR),
            isNull(componentBlocks.publishedAt),
            sql`${componentBlocks.updatedAt} = ${componentBlocks.createdAt}`,
          ),
        )

      const ids: string[] = []
      for (const result of results) {
        const sourceHash = blockHash(result.source, tokens)
        const [block] = await tx
          .insert(componentBlocks)
          .values({
            projectId,
            clientId,
            name: result.spec.name,
            archetype: project.layoutType,
            source: result.source,
            sourceHash,
            tokens,
            createdBy: GENERATOR_ACTOR,
          })
          .returning({ id: componentBlocks.id })
        ids.push(block.id)

        const violations = auditBlock(result.source, tokens)
        const byRule: Record<string, number> = {}
        for (const v of violations) byRule[v.rule] = (byRule[v.rule] ?? 0) + 1
        await tx.insert(operatorAuditLog).values([
          {
            actor: GENERATOR_ACTOR,
            action: "block.created",
            entityType: "block",
            entityId: block.id,
            details: { sourceHash, model: result.model, attempts: result.attempts },
          },
          {
            actor: GENERATOR_ACTOR,
            action: "audit.automated",
            entityType: "block",
            entityId: block.id,
            details: { sourceHash, passed: violations.length === 0, total: violations.length, byRule, violations: violations.slice(0, 50) },
          },
        ])
      }
      return ids
    })

    const usage = results.reduce((sum, r) => addUsage(sum, r.usage), directionUsage)
    const [current] = await db.select({ steps: projects.pipelineSteps }).from(projects).where(eq(projects.id, projectId))
    await db
      .update(projects)
      .set({ pipelineSteps: setStep(setStep(current.steps, "orchestration", "completed"), "qa", "active"), updatedAt: new Date() })
      .where(eq(projects.id, projectId))

    await log(GENERATOR_ACTOR, "generation.completed", "project", projectId, {
      clientId,
      blockIds: created,
      blocks: results.map((r) => ({
        name: r.spec.name,
        attempts: r.attempts.length,
        residualViolations: r.violations.length,
        durationMs: r.durationMs,
      })),
      direction,
      tokenNotes: derived.notes,
      brandAnchors: derived.anchors,
      usage,
      costUsd: Number(usageCostUsd(usage).toFixed(4)),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[generator]", projectId, err)
    await log(GENERATOR_ACTOR, "generation.failed", "project", projectId, { error: message }).catch(() => {})
  }
}

// --- Delivery bundle ---

function storageConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new GenerationError("Set SUPABASE_SERVICE_ROLE_KEY (and NEXT_PUBLIC_SUPABASE_URL) to upload bundles")
  }
  return { url, key, bucket: process.env.SUPABASE_STORAGE_BUCKET ?? "project-assets" }
}

/**
 * Zips the project's published blocks with its live token set, uploads it to
 * Supabase Storage and links it as the project's code archive.
 */
export async function buildProjectBundle(projectId: string, actor: string) {
  const db = getDb()
  const row = await loadProject(projectId)
  if (!row) throw new GenerationError("Project not found")

  const blocks = await db
    .select()
    .from(componentBlocks)
    .where(and(eq(componentBlocks.projectId, projectId), isNotNull(componentBlocks.publishedAt)))
    .orderBy(componentBlocks.createdAt)
  if (blocks.length === 0) throw new GenerationError("Publish at least one block before building the bundle")

  const clientId = blocks[0].clientId
  const [tokenSet] = await db.select().from(clientTokenSets).where(eq(clientTokenSets.clientId, clientId))
  const tokens = ThemeTokensSchema.parse(tokenSet?.tokens ?? blocks[0].tokens)

  const zip = buildBundle({
    clientId,
    layoutLabel: layoutLabel(row.project.layoutType),
    tokens,
    background: row.project.backgroundColor,
    blocks: blocks.map((b) => ({ name: b.name, source: b.publishedSource!, version: b.publishedVersion })),
  })

  const { url, key, bucket } = storageConfig()
  const fileName = `${clientId}-ui-bundle.zip`
  // Unguessable path: the bucket serves public URLs, like the backend's uploads.
  const path = `${projectId}/bundle/${randomUUID()}/${fileName}`
  const response = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/zip" },
    body: Buffer.from(zip),
  })
  if (!response.ok) {
    throw new GenerationError(`Bundle upload failed (${response.status}): ${(await response.text()).slice(0, 200)}`)
  }
  const zipFileUrl = `${url}/storage/v1/object/public/${bucket}/${path}`

  await db.transaction(async (tx) => {
    const [current] = await tx.select({ steps: projects.pipelineSteps }).from(projects).where(eq(projects.id, projectId))
    await tx
      .update(projects)
      .set({
        zipFileUrl,
        zipFileName: fileName,
        pipelineSteps: setStep(setStep(current.steps, "qa", "completed"), "compilation", "completed"),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId))
    await tx.insert(operatorAuditLog).values({
      actor,
      action: "project.bundle_built",
      entityType: "project",
      entityId: projectId,
      details: { zipFileUrl, blocks: blocks.length, bytes: zip.byteLength, tokenSetVersion: tokenSet?.version ?? null },
    })
  })
  return { zipFileUrl, blocks: blocks.length }
}
