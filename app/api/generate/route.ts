import { timingSafeEqual } from "node:crypto"
import { after, NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { claimGeneration, runGeneration } from "@/lib/generator/run"

// Starts block generation for a new brief. Called by the tulip-db trigger in
// supabase/migrations/20261021100000_generate_on_brief.sql (pg_net) with the
// shared GENERATOR_WEBHOOK_SECRET. Returns 202 at once; the run continues
// after the response and reports through operator_audit_log.

export const maxDuration = 800

// Either a Supabase database-webhook payload or a bare { projectId }.
const Body = z.union([
  z.object({ projectId: z.uuid() }),
  z.object({ type: z.literal("INSERT"), table: z.literal("projects"), record: z.object({ id: z.uuid() }) }),
])

function authorized(request: NextRequest) {
  const secret = process.env.GENERATOR_WEBHOOK_SECRET
  const header = request.headers.get("authorization") ?? ""
  if (!secret || !header.startsWith("Bearer ")) return false
  const given = Buffer.from(header.slice("Bearer ".length))
  const expected = Buffer.from(secret)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let parsed: z.infer<typeof Body>
  try {
    parsed = Body.parse(await request.json())
  } catch {
    return NextResponse.json({ error: "Expected { projectId } or a projects INSERT webhook" }, { status: 400 })
  }
  const projectId = "projectId" in parsed ? parsed.projectId : parsed.record.id

  if (!(await claimGeneration(projectId, "webhook"))) {
    return NextResponse.json({ status: "already_running", projectId }, { status: 409 })
  }
  after(() => runGeneration(projectId))
  return NextResponse.json({ status: "started", projectId }, { status: 202 })
}
