import { defineConfig } from "drizzle-kit"

// Introspection/studio only. Schema changes ship as SQL files in
// supabase/migrations and are applied through Supabase, never `drizzle-kit push`.
export default defineConfig({
  schema: "./db/schema.ts",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
  schemaFilter: ["public"],
  tablesFilter: [
    "projects",
    "client_token_sets",
    "component_blocks",
    "taste_reviews",
    "layout_flags",
    "operator_audit_log",
  ],
})
