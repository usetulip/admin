import "server-only"
import { createHash } from "node:crypto"
import { desc, eq, inArray } from "drizzle-orm"
import { getDb } from "@/db"
import {
  authUsers,
  clientTokenSets,
  componentBlocks,
  layoutFlags,
  operatorAuditLog,
  projects,
  tasteReviews,
} from "@/db/schema"
import { requireOperator } from "@/lib/operator"
import type { ThemeTokens } from "@/lib/token-schema"
import type {
  AuditLogEntry,
  ComponentBlock,
  DashboardData,
  LayoutFlag,
  Project,
  TasteReview,
} from "@/lib/types"

// Data access layer for the operator dashboard. Every read checks the
// operator session; writes live in app/dashboard/actions.ts.

const PROCESSING_DURATION_HOURS = 48 // matches usetulip/backend
const AUDIT_LOG_LIMIT = 100

const iso = (value: Date | null) => value?.toISOString() ?? null

function processingDeadline(startedAt: Date | null) {
  return startedAt
    ? new Date(startedAt.getTime() + PROCESSING_DURATION_HOURS * 3_600_000)
    : null
}

function serializeProject(
  row: typeof projects.$inferSelect,
  user: { email: string | null; meta: Record<string, unknown> | null } | null,
): Project {
  const deadline = processingDeadline(row.processingStartedAt)
  const name = user?.meta?.name ?? user?.meta?.full_name
  return {
    ...row,
    userName: typeof name === "string" ? name : null,
    userEmail: user?.email ?? null,
    processingStartedAt: iso(row.processingStartedAt),
    deliveredAt: iso(row.deliveredAt),
    approvedAt: iso(row.approvedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    processingDeadline: iso(deadline),
    secondsRemaining: deadline
      ? Math.max(0, Math.floor((deadline.getTime() - Date.now()) / 1000))
      : PROCESSING_DURATION_HOURS * 3600,
  }
}

function serializeReview(row: typeof tasteReviews.$inferSelect): TasteReview {
  return {
    id: row.id,
    sourceHash: row.sourceHash,
    checks: row.checks,
    notes: row.notes,
    reviewedBy: row.reviewedBy,
    createdAt: row.createdAt.toISOString(),
  }
}

function serializeFlag(row: typeof layoutFlags.$inferSelect): LayoutFlag {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: iso(row.resolvedAt),
  }
}

export async function loadDashboard(): Promise<DashboardData> {
  await requireOperator()
  const db = getDb()

  const [projectRows, blockRows, tokenRows, logRows] = await Promise.all([
    db
      .select({
        project: projects,
        email: authUsers.email,
        meta: authUsers.rawUserMetaData,
      })
      .from(projects)
      .leftJoin(authUsers, eq(projects.userId, authUsers.id))
      .orderBy(desc(projects.createdAt)),
    db.select().from(componentBlocks).orderBy(desc(componentBlocks.updatedAt)),
    db.select().from(clientTokenSets),
    db
      .select()
      .from(operatorAuditLog)
      .orderBy(desc(operatorAuditLog.createdAt))
      .limit(AUDIT_LOG_LIMIT),
  ])

  const blockIds = blockRows.map((block) => block.id)
  const [reviewRows, flagRows] = blockIds.length
    ? await Promise.all([
        db
          .select()
          .from(tasteReviews)
          .where(inArray(tasteReviews.blockId, blockIds))
          .orderBy(desc(tasteReviews.createdAt)),
        db
          .select()
          .from(layoutFlags)
          .where(inArray(layoutFlags.blockId, blockIds))
          .orderBy(desc(layoutFlags.createdAt)),
      ])
    : [[], []]

  const latestReview = new Map<string, TasteReview>()
  for (const review of reviewRows) {
    if (!latestReview.has(review.blockId)) {
      latestReview.set(review.blockId, serializeReview(review))
    }
  }

  const blocks: ComponentBlock[] = blockRows.map((block) => ({
    ...block,
    publishedAt: iso(block.publishedAt),
    createdAt: block.createdAt.toISOString(),
    updatedAt: block.updatedAt.toISOString(),
    latestReview: latestReview.get(block.id) ?? null,
    flags: flagRows.filter((flag) => flag.blockId === block.id).map(serializeFlag),
  }))

  const auditLog: AuditLogEntry[] = logRows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  }))

  return {
    projects: projectRows.map((row) =>
      serializeProject(row.project, { email: row.email, meta: row.meta }),
    ),
    blocks,
    tokenSets: tokenRows.map((row) => ({
      clientId: row.clientId,
      tokens: row.tokens,
      version: row.version,
      publishedAt: row.publishedAt.toISOString(),
      publishedBy: row.publishedBy,
    })),
    auditLog,
  }
}

// --- Hashing ---

// JSON with sorted keys, so equal token sets always hash the same.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`
  }
  return JSON.stringify(value)
}

/** sha256 over the block source and its tokens; reviews and publishes pin to it. */
export function blockHash(source: string, tokens: ThemeTokens) {
  return createHash("sha256").update(source).update("\n\0\n").update(canonicalJson(tokens)).digest("hex")
}
