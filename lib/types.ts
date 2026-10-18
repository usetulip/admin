// View models passed from server code to the dashboard's client components.
// Dates are ISO strings so they serialize across the server/client boundary.

import type {
  BlockStatus,
  FlagCategory,
  FlagSeverity,
  PipelineStep,
  PipelineStepStatus,
  ProjectStatus,
  TasteChecklist,
} from "@/db/schema"
import type { ThemeTokens } from "@/lib/token-schema"

export type { PipelineStep, PipelineStepStatus, ProjectStatus }

export type Project = {
  id: string
  userId: string
  userName: string | null
  userEmail: string | null
  status: ProjectStatus
  primaryColor: string
  secondaryColor: string
  backgroundColor: string
  layoutType: string
  features: string[]
  pipelineSteps: PipelineStep[]
  processingStartedAt: string | null
  deliveredAt: string | null
  approvedAt: string | null
  approvedBy: string | null
  figmaFileUrl: string | null
  figmaFileName: string | null
  githubUrl: string | null
  zipFileUrl: string | null
  zipFileName: string | null
  s3Bucket: string | null
  createdAt: string
  updatedAt: string
  secondsRemaining: number
  processingDeadline: string | null
}

export type TasteReview = {
  id: string
  sourceHash: string
  checks: TasteChecklist
  notes: string | null
  reviewedBy: string
  createdAt: string
}

export type LayoutFlag = {
  id: string
  blockId: string
  category: FlagCategory
  severity: FlagSeverity
  message: string
  line: number | null
  status: "open" | "resolved"
  createdBy: string
  createdAt: string
  resolvedBy: string | null
  resolvedAt: string | null
  resolution: string | null
}

export type ComponentBlock = {
  id: string
  projectId: string
  clientId: string
  name: string
  archetype: string
  source: string
  sourceHash: string
  tokens: ThemeTokens
  figmaUrl: string | null
  status: BlockStatus
  publishedSource: string | null
  publishedHash: string | null
  publishedVersion: number
  publishedAt: string | null
  publishedBy: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  /** Latest manual review, whichever source hash it was for. */
  latestReview: TasteReview | null
  flags: LayoutFlag[]
}

export type AuditLogEntry = {
  id: number
  actor: string
  action: string
  entityType: string
  entityId: string
  details: Record<string, unknown>
  createdAt: string
}

export type ClientTokenSet = {
  clientId: string
  tokens: ThemeTokens
  version: number
  publishedAt: string
  publishedBy: string
}

export type DashboardData = {
  projects: Project[]
  blocks: ComponentBlock[]
  tokenSets: ClientTokenSet[]
  auditLog: AuditLogEntry[]
}

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string }
