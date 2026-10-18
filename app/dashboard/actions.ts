"use server"

import { and, desc, eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { getDb } from "@/db"
import {
  FLAG_CATEGORIES,
  FLAG_SEVERITIES,
  TASTE_CHECKS,
  clientTokenSets,
  componentBlocks,
  layoutFlags,
  operatorAuditLog,
  projects,
  tasteReviews,
  type PipelineStep,
} from "@/db/schema"
import { blockHash, canonicalJson } from "@/lib/dal"
import { notifyMcpServer, type NotifyResult } from "@/lib/mcp-notify"
import { UnauthorizedError, requireOperator, type Operator } from "@/lib/operator"
import { publishGate } from "@/lib/publish-gate"
import { auditBlock } from "@/lib/taste-inspector"
import { ThemeTokensSchema, type ThemeTokens } from "@/lib/token-schema"
import type { ActionResult } from "@/lib/types"

// Server Actions for the operator dashboard. Each one is a public POST
// endpoint: it authenticates the operator, validates its input with Zod, and
// writes through Drizzle. Every mutation lands in operator_audit_log.

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0]

class ActionError extends Error {}

async function run<T>(
  fn: (operator: Operator) => Promise<T>,
): Promise<ActionResult<T extends void ? undefined : T>> {
  try {
    const operator = await requireOperator()
    const data = await fn(operator)
    revalidatePath("/dashboard")
    return (data === undefined ? { ok: true } : { ok: true, data }) as ActionResult<
      T extends void ? undefined : T
    >
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ActionError) {
      return { ok: false, error: err.message }
    }
    if (err instanceof z.ZodError) {
      return { ok: false, error: z.prettifyError(err) }
    }
    console.error("[operator action]", err)
    return { ok: false, error: "Something went wrong. Check the server logs." }
  }
}

async function log(
  tx: Tx,
  operator: Operator,
  action: string,
  entityType: string,
  entityId: string,
  details: Record<string, unknown> = {},
) {
  await tx.insert(operatorAuditLog).values({
    actor: operator.email,
    action,
    entityType,
    entityId,
    details,
  })
}

const Uuid = z.uuid()
const ClientId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, "client_id must be a lowercase slug, e.g. acme-corp")
const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/, "Use a lowercase slug, e.g. saas-dashboard")
const HttpsUrl = z
  .url({ protocol: /^https$/ })
  .max(2048)
const FigmaUrl = z
  .url({ protocol: /^https$/, hostname: /^(www\.)?figma\.com$/ })
  .max(2048)
const Hash = z.string().regex(/^[0-9a-f]{64}$/)

function parseTokens(json: string): ThemeTokens {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new ActionError("Tokens must be valid JSON")
  }
  const parsed = ThemeTokensSchema.safeParse(raw)
  if (!parsed.success) {
    throw new ActionError(`Tokens failed validation:\n${z.prettifyError(parsed.error)}`)
  }
  return parsed.data
}

function auditSummary(source: string, tokens: ThemeTokens) {
  const violations = auditBlock(source, tokens)
  const byRule: Record<string, number> = {}
  for (const violation of violations) {
    byRule[violation.rule] = (byRule[violation.rule] ?? 0) + 1
  }
  return { passed: violations.length === 0, total: violations.length, byRule, violations: violations.slice(0, 50) }
}

// --- Module 1: intake queue ---

export async function approveProject(projectId: string) {
  return run(async (operator) => {
    const id = Uuid.parse(projectId)
    await getDb().transaction(async (tx) => {
      const now = new Date()
      const [row] = await tx
        .update(projects)
        .set({
          approvedAt: now,
          approvedBy: operator.email,
          status: sql`case when ${projects.status} = 'pending_approval' then 'processing' else ${projects.status} end`,
          processingStartedAt: sql`coalesce(${projects.processingStartedAt}, now())`,
          updatedAt: now,
        })
        .where(and(eq(projects.id, id), sql`${projects.approvedAt} is null`))
        .returning({ id: projects.id })
      if (!row) throw new ActionError("Project not found or already approved")
      await log(tx, operator, "project.approved", "project", id)
    })
  })
}

const PipelineStepsSchema = z
  .array(
    z.strictObject({
      id: z.string().min(1).max(64),
      label: z.string().min(1).max(120),
      status: z.enum(["pending", "active", "completed"]),
    }),
  )
  .min(1)
  .max(20)

export async function updatePipeline(projectId: string, steps: PipelineStep[]) {
  return run(async (operator) => {
    const id = Uuid.parse(projectId)
    const pipelineSteps = PipelineStepsSchema.parse(steps)
    await getDb().transaction(async (tx) => {
      const [row] = await tx
        .update(projects)
        .set({ pipelineSteps, updatedAt: new Date() })
        .where(eq(projects.id, id))
        .returning({ id: projects.id })
      if (!row) throw new ActionError("Project not found")
      await log(tx, operator, "project.pipeline_updated", "project", id, {
        steps: pipelineSteps.map((step) => `${step.id}:${step.status}`),
      })
    })
  })
}

const AssetLinksSchema = z.strictObject({
  figmaFileUrl: HttpsUrl.nullable(),
  figmaFileName: z.string().max(200).nullable(),
  githubUrl: HttpsUrl.nullable(),
  zipFileUrl: HttpsUrl.nullable(),
  zipFileName: z.string().max(200).nullable(),
  s3Bucket: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, "Invalid bucket name").nullable(),
})

export async function updateProjectAssets(projectId: string, assets: z.input<typeof AssetLinksSchema>) {
  return run(async (operator) => {
    const id = Uuid.parse(projectId)
    const values = AssetLinksSchema.parse(assets)
    await getDb().transaction(async (tx) => {
      const [row] = await tx
        .update(projects)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(projects.id, id))
        .returning({ id: projects.id })
      if (!row) throw new ActionError("Project not found")
      await log(tx, operator, "project.assets_updated", "project", id, values)
    })
  })
}

export async function deliverProject(projectId: string) {
  return run(async (operator) => {
    const id = Uuid.parse(projectId)
    await getDb().transaction(async (tx) => {
      const now = new Date()
      const [row] = await tx
        .update(projects)
        .set({ status: "delivered", deliveredAt: now, updatedAt: now })
        .where(and(eq(projects.id, id), sql`${projects.approvedAt} is not null`))
        .returning({ id: projects.id })
      if (!row) throw new ActionError("Approve the project before delivering it")
      await log(tx, operator, "project.delivered", "project", id)
    })
  })
}

export async function deleteProject(projectId: string) {
  return run(async (operator) => {
    const id = Uuid.parse(projectId)
    await getDb().transaction(async (tx) => {
      const [row] = await tx
        .delete(projects)
        .where(eq(projects.id, id))
        .returning({ id: projects.id, userId: projects.userId })
      if (!row) throw new ActionError("Project not found")
      await log(tx, operator, "project.deleted", "project", id, { userId: row.userId })
    })
  })
}

// --- Module 2: component blocks (generated code + Figma reference) ---

const CreateBlockSchema = z.strictObject({
  projectId: Uuid,
  clientId: ClientId,
  name: z.string().trim().min(1).max(120),
  archetype: Slug,
  source: z.string().min(1).max(200_000),
  tokensJson: z.string().min(2).max(100_000),
  figmaUrl: FigmaUrl.nullable(),
})

export async function createBlock(input: z.input<typeof CreateBlockSchema>) {
  return run(async (operator) => {
    const values = CreateBlockSchema.parse(input)
    const tokens = parseTokens(values.tokensJson)
    const sourceHash = blockHash(values.source, tokens)
    return getDb().transaction(async (tx) => {
      const [project] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, values.projectId))
      if (!project) throw new ActionError("Project not found")

      const [block] = await tx
        .insert(componentBlocks)
        .values({
          projectId: values.projectId,
          clientId: values.clientId,
          name: values.name,
          archetype: values.archetype,
          source: values.source,
          sourceHash,
          tokens,
          figmaUrl: values.figmaUrl,
          createdBy: operator.email,
        })
        .returning({ id: componentBlocks.id })
      await log(tx, operator, "block.created", "block", block.id, { sourceHash })
      await log(tx, operator, "audit.automated", "block", block.id, {
        sourceHash,
        ...auditSummary(values.source, tokens),
      })
      return { id: block.id }
    })
  })
}

const UpdateBlockSchema = z.strictObject({
  blockId: Uuid,
  source: z.string().min(1).max(200_000),
  tokensJson: z.string().min(2).max(100_000),
  figmaUrl: FigmaUrl.nullable(),
})

export async function updateBlock(input: z.input<typeof UpdateBlockSchema>) {
  return run(async (operator) => {
    const values = UpdateBlockSchema.parse(input)
    const tokens = parseTokens(values.tokensJson)
    const sourceHash = blockHash(values.source, tokens)
    await getDb().transaction(async (tx) => {
      const [current] = await tx
        .select({ sourceHash: componentBlocks.sourceHash })
        .from(componentBlocks)
        .where(eq(componentBlocks.id, values.blockId))
        .for("update")
      if (!current) throw new ActionError("Block not found")

      const changed = current.sourceHash !== sourceHash
      await tx
        .update(componentBlocks)
        .set({
          source: values.source,
          tokens,
          sourceHash,
          figmaUrl: values.figmaUrl,
          // A new revision needs a fresh review before it can go live.
          ...(changed ? { status: "in_review" as const } : {}),
          updatedAt: new Date(),
        })
        .where(eq(componentBlocks.id, values.blockId))
      await log(tx, operator, "block.updated", "block", values.blockId, {
        previousHash: current.sourceHash,
        sourceHash,
      })
      if (changed) {
        await log(tx, operator, "audit.automated", "block", values.blockId, {
          sourceHash,
          ...auditSummary(values.source, tokens),
        })
      }
    })
  })
}

/** Re-run the automated audit on the stored revision and log the result. */
export async function runAutomatedAudit(blockId: string) {
  return run(async (operator) => {
    const id = Uuid.parse(blockId)
    return getDb().transaction(async (tx) => {
      const [block] = await tx.select().from(componentBlocks).where(eq(componentBlocks.id, id))
      if (!block) throw new ActionError("Block not found")
      const tokens = ThemeTokensSchema.parse(block.tokens)
      const summary = auditSummary(block.source, tokens)
      await log(tx, operator, "audit.automated", "block", id, {
        sourceHash: block.sourceHash,
        ...summary,
      })
      return { passed: summary.passed, total: summary.total }
    })
  })
}

// --- Module 3: manual taste review and layout flags ---

const ReviewSchema = z.strictObject({
  blockId: Uuid,
  sourceHash: Hash,
  checks: z.strictObject(
    Object.fromEntries(TASTE_CHECKS.map((check) => [check, z.boolean()])) as Record<
      (typeof TASTE_CHECKS)[number],
      z.ZodBoolean
    >,
  ),
  notes: z.string().trim().max(4000).nullable(),
  decision: z.enum(["approve", "request_changes"]),
})

export async function submitReview(input: z.input<typeof ReviewSchema>) {
  return run(async (operator) => {
    const values = ReviewSchema.parse(input)
    if (values.decision === "approve" && !TASTE_CHECKS.every((check) => values.checks[check])) {
      throw new ActionError("Tick every governance rule before approving")
    }
    await getDb().transaction(async (tx) => {
      const [block] = await tx
        .select({ sourceHash: componentBlocks.sourceHash, status: componentBlocks.status })
        .from(componentBlocks)
        .where(eq(componentBlocks.id, values.blockId))
        .for("update")
      if (!block) throw new ActionError("Block not found")
      if (block.sourceHash !== values.sourceHash) {
        throw new ActionError("The block changed while you were reviewing it. Reload and review again.")
      }

      await tx.insert(tasteReviews).values({
        blockId: values.blockId,
        sourceHash: values.sourceHash,
        checks: values.checks,
        notes: values.notes || null,
        reviewedBy: operator.email,
      })
      if (block.status !== "published" || values.decision === "request_changes") {
        await tx
          .update(componentBlocks)
          .set({
            status: values.decision === "approve" ? "approved" : "changes_requested",
            updatedAt: new Date(),
          })
          .where(eq(componentBlocks.id, values.blockId))
      }
      await log(tx, operator, `review.${values.decision}`, "block", values.blockId, {
        sourceHash: values.sourceHash,
        checks: values.checks,
      })
    })
  })
}

const FlagSchema = z.strictObject({
  blockId: Uuid,
  category: z.enum(FLAG_CATEGORIES),
  severity: z.enum(FLAG_SEVERITIES),
  message: z.string().trim().min(1).max(2000),
  line: z.number().int().positive().nullable(),
})

export async function createFlag(input: z.input<typeof FlagSchema>) {
  return run(async (operator) => {
    const values = FlagSchema.parse(input)
    await getDb().transaction(async (tx) => {
      const [block] = await tx
        .select({ id: componentBlocks.id })
        .from(componentBlocks)
        .where(eq(componentBlocks.id, values.blockId))
      if (!block) throw new ActionError("Block not found")
      const [flag] = await tx
        .insert(layoutFlags)
        .values({ ...values, createdBy: operator.email })
        .returning({ id: layoutFlags.id })
      await log(tx, operator, "flag.created", "block", values.blockId, {
        flagId: flag.id,
        category: values.category,
        severity: values.severity,
      })
    })
  })
}

const ResolveFlagSchema = z.strictObject({
  flagId: Uuid,
  resolution: z.string().trim().min(1, "Say how it was resolved").max(2000),
})

export async function resolveFlag(input: z.input<typeof ResolveFlagSchema>) {
  return run(async (operator) => {
    const values = ResolveFlagSchema.parse(input)
    await getDb().transaction(async (tx) => {
      const [flag] = await tx
        .update(layoutFlags)
        .set({
          status: "resolved",
          resolvedAt: new Date(),
          resolvedBy: operator.email,
          resolution: values.resolution,
        })
        .where(and(eq(layoutFlags.id, values.flagId), eq(layoutFlags.status, "open")))
        .returning({ blockId: layoutFlags.blockId })
      if (!flag) throw new ActionError("Flag not found or already resolved")
      await log(tx, operator, "flag.resolved", "block", flag.blockId, { flagId: values.flagId })
    })
  })
}

// --- Module 4: one-click publish ---

const PublishSchema = z.strictObject({ blockId: Uuid, expectedHash: Hash })

export async function publishBlock(input: z.input<typeof PublishSchema>) {
  return run(async (operator) => {
    const values = PublishSchema.parse(input)

    const published = await getDb().transaction(async (tx) => {
      // Lock the block so a concurrent edit or publish can't interleave.
      const [block] = await tx
        .select()
        .from(componentBlocks)
        .where(eq(componentBlocks.id, values.blockId))
        .for("update")
      if (!block) throw new ActionError("Block not found")
      if (block.sourceHash !== values.expectedHash) {
        throw new ActionError("The block changed since you loaded it. Reload and re-check before publishing.")
      }

      const tokens = ThemeTokensSchema.parse(block.tokens)
      // Recompute rather than trust the stored hash.
      if (blockHash(block.source, tokens) !== block.sourceHash) {
        throw new ActionError("Stored hash does not match the block contents; save the block again.")
      }

      const [review] = await tx
        .select()
        .from(tasteReviews)
        .where(eq(tasteReviews.blockId, block.id))
        .orderBy(desc(tasteReviews.createdAt))
        .limit(1)
      const [{ openFlags }] = await tx
        .select({ openFlags: sql<number>`count(*)::int` })
        .from(layoutFlags)
        .where(and(eq(layoutFlags.blockId, block.id), eq(layoutFlags.status, "open")))

      const failing = publishGate({
        source: block.source,
        tokens,
        sourceHash: block.sourceHash,
        publishedHash: block.publishedHash,
        latestReview: review ?? null,
        openFlagCount: openFlags,
      }).filter((check) => !check.passed)
      if (failing.length) {
        throw new ActionError(`Not ready to publish: ${failing.map((c) => `${c.label} (${c.detail})`).join("; ")}`)
      }

      const now = new Date()
      const version = block.publishedVersion + 1
      await tx
        .update(componentBlocks)
        .set({
          status: "published",
          publishedSource: block.source,
          publishedHash: block.sourceHash,
          publishedVersion: version,
          publishedAt: now,
          publishedBy: operator.email,
          updatedAt: now,
        })
        .where(eq(componentBlocks.id, block.id))

      // The client's live tokens follow the most recently published block.
      const [existing] = await tx
        .select()
        .from(clientTokenSets)
        .where(eq(clientTokenSets.clientId, block.clientId))
        .for("update")
      const tokensChanged = !existing || canonicalJson(existing.tokens) !== canonicalJson(tokens)
      if (!existing) {
        await tx.insert(clientTokenSets).values({
          clientId: block.clientId,
          tokens,
          publishedAt: now,
          publishedBy: operator.email,
        })
      } else if (tokensChanged) {
        await tx
          .update(clientTokenSets)
          .set({
            tokens,
            version: existing.version + 1,
            publishedAt: now,
            publishedBy: operator.email,
            updatedAt: now,
          })
          .where(eq(clientTokenSets.clientId, block.clientId))
      }

      await log(tx, operator, "block.published", "block", block.id, {
        clientId: block.clientId,
        version,
        hash: block.sourceHash,
        tokensChanged,
        tokenSetVersion: existing ? existing.version + (tokensChanged ? 1 : 0) : 1,
      })

      return { clientId: block.clientId, blockId: block.id, version, hash: block.sourceHash, publishedAt: now }
    })

    // Outside the transaction: the publish is already live in Supabase.
    const notify: NotifyResult = await notifyMcpServer({
      event: "block.published",
      client_id: published.clientId,
      block_id: published.blockId,
      version: published.version,
      hash: published.hash,
      published_at: published.publishedAt.toISOString(),
    })
    await getDb()
      .insert(operatorAuditLog)
      .values({
        actor: operator.email,
        action: `mcp.notify_${notify.status}`,
        entityType: "block",
        entityId: published.blockId,
        details: { version: published.version, ...notify },
      })

    return { version: published.version, notify }
  })
}
