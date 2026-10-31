"use client"

import { formatDistanceToNow } from "date-fns"
import { PackageIcon, SparklesIcon } from "lucide-react"
import { buildDeliveryBundle, startGeneration } from "@/app/dashboard/actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { AuditLogEntry, ComponentBlock, Project } from "@/lib/types"
import { useAction } from "./use-action"

// Matches STALE_RUN_MS in lib/generator/run.ts.
const STALE_RUN_MS = 20 * 60_000

type RunSummary = {
  blocks?: { name: string; attempts: number; residualViolations: number }[]
  tokenNotes?: string[]
  costUsd?: number
  error?: string
}

function latestRun(entries: AuditLogEntry[], projectId: string) {
  const last = entries
    .filter((e) => e.entityType === "project" && e.entityId === projectId && e.action.startsWith("generation."))
    .sort((a, b) => b.id - a.id)[0]
  if (!last) return null
  const age = Date.now() - new Date(last.createdAt).getTime()
  const state =
    last.action === "generation.started"
      ? age < STALE_RUN_MS ? "running" : "failed"
      : last.action === "generation.completed" ? "completed" : "failed"
  const details = (last.action === "generation.started" && state === "failed"
    ? { error: "Run timed out" }
    : last.details) as RunSummary
  return { state, at: last.createdAt, details }
}

export function GenerationCard({
  project,
  auditLog,
  blocks,
}: {
  project: Project
  auditLog: AuditLogEntry[]
  blocks: ComponentBlock[]
}) {
  const { run, isPending } = useAction()
  const last = latestRun(auditLog, project.id)
  const running = last?.state === "running"
  const published = blocks.filter((b) => b.projectId === project.id && b.publishedAt).length

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">AI generation</CardTitle>
          {last ? (
            <Badge variant={last.state === "failed" ? "destructive" : "secondary"}>
              {last.state === "running" ? "Running" : last.state === "completed" ? "Drafts ready" : "Failed"}
            </Badge>
          ) : null}
        </div>
        <CardDescription>
          Writes one block per brief item from the client&apos;s tokens, self-audits and repairs, then queues the drafts
          for your review. Nothing reaches the client until you publish.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {last ? (
          <div className="flex flex-col gap-2 text-sm">
            <p className="text-muted-foreground">
              Last run {formatDistanceToNow(new Date(last.at), { addSuffix: true })}
              {typeof last.details.costUsd === "number" ? ` · $${last.details.costUsd.toFixed(2)}` : ""}
            </p>
            {last.details.error ? <p className="text-destructive">{last.details.error}</p> : null}
            {last.details.blocks?.length ? (
              <ul className="flex flex-col gap-1">
                {last.details.blocks.map((b) => (
                  <li key={b.name} className="flex items-center justify-between gap-2">
                    <span>{b.name}</span>
                    <span className="text-muted-foreground">
                      {b.residualViolations === 0
                        ? `clean · ${b.attempts} ${b.attempts === 1 ? "pass" : "passes"}`
                        : `${b.residualViolations} findings left · ${b.attempts} passes`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {last.details.tokenNotes?.map((note) => (
              <p key={note} className="text-muted-foreground">
                {note}
              </p>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No generation run yet for this brief.</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={running || isPending("generate") || project.status === "delivered"}
            onClick={() =>
              run("generate", () => startGeneration(project.id), {
                success: "Generation started. Drafts appear in the asset viewer when it finishes.",
              })
            }
          >
            <SparklesIcon aria-hidden="true" />
            {running ? "Generating…" : last ? "Regenerate drafts" : "Generate drafts"}
          </Button>
          <Button
            variant="outline"
            disabled={published === 0 || isPending("bundle")}
            title={published === 0 ? "Publish at least one block first" : undefined}
            onClick={() => run("bundle", () => buildDeliveryBundle(project.id), { success: "Bundle uploaded and linked" })}
          >
            <PackageIcon aria-hidden="true" />
            {isPending("bundle") ? "Building…" : `Build delivery bundle (${published})`}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
