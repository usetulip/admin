import "server-only"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schema"

// Direct Postgres connection to tulip-db (the Supabase pooler URL). This role
// bypasses RLS, so only server code that has passed requireOperator() may use it.

function createDb() {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error("DATABASE_URL is not set")
  }
  // prepare: false for the Supabase transaction-mode pooler (port 6543).
  const client = postgres(url, { prepare: false, max: 5 })
  return drizzle({ client, schema })
}

export type Db = ReturnType<typeof createDb>

declare global {
  var tulipAdminDb: Db | undefined
}

// Created on first use so builds don't need DATABASE_URL, and reused across
// dev hot reloads so they don't leak pools.
export function getDb() {
  globalThis.tulipAdminDb ??= createDb()
  return globalThis.tulipAdminDb
}
