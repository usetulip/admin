import {
  bigint,
  integer,
  jsonb,
  pgSchema,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"
import type { ThemeTokens } from "@/lib/token-schema"
import type {
  BlockStatus,
  FlagCategory,
  FlagSeverity,
  TasteChecklist,
} from "@/lib/review-constants"

export * from "@/lib/review-constants"

// Tables in tulip-db. `projects` is owned by usetulip/customer
// (supabase/migrations/20261018000000_create_projects.sql); the rest come from
// supabase/migrations/20261018100000_operator_review_pipeline.sql here.
// Migrations are plain SQL applied through Supabase, not drizzle-kit push.

export type PipelineStepStatus = "pending" | "active" | "completed"

export type PipelineStep = {
  id: string
  label: string
  status: PipelineStepStatus
}

export const PROJECT_STATUSES = [
  "pending_approval",
  "processing",
  "delivered",
] as const

export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

const timestamptz = (name: string) => timestamp(name, { withTimezone: true })

// Read-only view of Supabase Auth users, for client names and emails.
const auth = pgSchema("auth")

export const authUsers = auth.table("users", {
  id: uuid("id").primaryKey(),
  email: text("email"),
  rawUserMetaData: jsonb("raw_user_meta_data").$type<Record<string, unknown>>(),
})

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  status: text("status").$type<ProjectStatus>().notNull(),
  primaryColor: text("primary_color").notNull(),
  secondaryColor: text("secondary_color").notNull(),
  backgroundColor: text("background_color").notNull(),
  layoutType: text("layout_type").notNull(),
  features: jsonb("features").$type<string[]>().notNull(),
  pipelineSteps: jsonb("pipeline_steps").$type<PipelineStep[]>().notNull(),
  processingStartedAt: timestamptz("processing_started_at"),
  deliveredAt: timestamptz("delivered_at"),
  approvedAt: timestamptz("approved_at"),
  approvedBy: text("approved_by"),
  figmaFileUrl: text("figma_file_url"),
  figmaFileName: text("figma_file_name"),
  githubUrl: text("github_url"),
  zipFileUrl: text("zip_file_url"),
  zipFileName: text("zip_file_name"),
  s3Bucket: text("s3_bucket"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
})

export const clientTokenSets = pgTable("client_token_sets", {
  clientId: text("client_id").primaryKey(),
  tokens: jsonb("tokens").$type<ThemeTokens>().notNull(),
  version: integer("version").notNull().default(1),
  publishedAt: timestamptz("published_at").notNull().defaultNow(),
  publishedBy: text("published_by").notNull(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
})

export const componentBlocks = pgTable("component_blocks", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull(),
  name: text("name").notNull(),
  archetype: text("archetype").notNull(),
  source: text("source").notNull(),
  sourceHash: text("source_hash").notNull(),
  tokens: jsonb("tokens").$type<ThemeTokens>().notNull(),
  figmaUrl: text("figma_url"),
  status: text("status").$type<BlockStatus>().notNull().default("in_review"),
  publishedSource: text("published_source"),
  publishedHash: text("published_hash"),
  publishedVersion: integer("published_version").notNull().default(0),
  publishedAt: timestamptz("published_at"),
  publishedBy: text("published_by"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
})

export const tasteReviews = pgTable("taste_reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  blockId: uuid("block_id")
    .notNull()
    .references(() => componentBlocks.id, { onDelete: "cascade" }),
  sourceHash: text("source_hash").notNull(),
  checks: jsonb("checks").$type<TasteChecklist>().notNull(),
  notes: text("notes"),
  reviewedBy: text("reviewed_by").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
})

export const layoutFlags = pgTable("layout_flags", {
  id: uuid("id").primaryKey().defaultRandom(),
  blockId: uuid("block_id")
    .notNull()
    .references(() => componentBlocks.id, { onDelete: "cascade" }),
  category: text("category").$type<FlagCategory>().notNull(),
  severity: text("severity").$type<FlagSeverity>().notNull().default("medium"),
  message: text("message").notNull(),
  line: integer("line"),
  status: text("status").$type<"open" | "resolved">().notNull().default("open"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamptz("resolved_at"),
  resolution: text("resolution"),
})

export const operatorAuditLog = pgTable("operator_audit_log", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
})
