"use client"

import { useMemo } from "react"
import { CircleCheck, CircleX, Rocket } from "lucide-react"
import { publishBlock } from "@/app/dashboard/actions"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { publishGate } from "@/lib/publish-gate"
import type { AuditLogEntry, ClientTokenSet, ComponentBlock } from "@/lib/types"
import { AuditTrail } from "./governance-panel"
import { useAction } from "./use-action"

export function PublishPanel({
  block,
  tokenSet,
  auditLog,
  blockPicker,
}: {
  block: ComponentBlock | null
  tokenSet: ClientTokenSet | null
  auditLog: AuditLogEntry[]
  blockPicker: React.ReactNode
}) {
  const { run, isPending } = useAction()
  const gate = useMemo(
    () =>
      block
        ? publishGate({
            source: block.source,
            tokens: block.tokens,
            sourceHash: block.sourceHash,
            publishedHash: block.publishedHash,
            latestReview: block.latestReview,
            openFlagCount: block.flags.filter((flag) => flag.status === "open").length,
          })
        : [],
    [block],
  )
  const ready = gate.length > 0 && gate.every((check) => check.passed)

  if (!block) {
    return (
      <div className="flex flex-col gap-6">
        {blockPicker}
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Add and review a component block before publishing.
        </p>
      </div>
    )
  }

  const publishLog = auditLog.filter(
    (entry) =>
      entry.entityId === block.id &&
      (entry.action === "block.published" || entry.action.startsWith("mcp.notify")),
  )

  return (
    <div className="flex flex-col gap-6">
      {blockPicker}
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Rocket className="size-4" aria-hidden="true" />
              Publish to the developer protocol engine
            </CardTitle>
            <CardDescription>
              Publishing commits this revision and the client&apos;s tokens to Supabase in one transaction. The MCP
              server (mcp.usetulip.co) serves them from there: tulip://tokens/{block.clientId} and the
              client&apos;s approved blocks.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ul className="flex flex-col gap-2">
              {gate.map((check) => (
                <li key={check.id} className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm">
                  {check.passed ? (
                    <CircleCheck className="size-4 text-emerald-600" aria-hidden="true" />
                  ) : (
                    <CircleX className="size-4 text-destructive" aria-hidden="true" />
                  )}
                  <span className="flex-1">{check.label}</span>
                  <span className="text-xs text-muted-foreground">{check.detail}</span>
                  <span className="sr-only">{check.passed ? "passed" : "failing"}</span>
                </li>
              ))}
            </ul>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="lg" disabled={!ready || isPending("publish")} className="self-start">
                  <Rocket className="size-5" aria-hidden="true" />
                  {isPending("publish") ? "Publishing…" : `Publish v${block.publishedVersion + 1}`}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Publish {block.name} live?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Revision {block.sourceHash.slice(0, 12)} becomes v{block.publishedVersion + 1} for{" "}
                    <span className="font-medium text-foreground">{block.clientId}</span>, and its tokens replace
                    the client&apos;s live token set
                    {tokenSet ? ` (currently v${tokenSet.version})` : ""}. Developers using the MCP server get it
                    on their next request.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      run("publish", () => publishBlock({ blockId: block.id, expectedHash: block.sourceHash }), {
                        success: "Published. Live in Supabase for the MCP server.",
                      })
                    }
                  >
                    Publish
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Live state</CardTitle>
            <CardDescription>What the MCP server serves right now</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Block</span>
              {block.publishedAt ? (
                <Badge variant="secondary">v{block.publishedVersion}</Badge>
              ) : (
                <Badge variant="outline">Not live</Badge>
              )}
            </div>
            {block.publishedAt ? (
              <>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Revision</span>
                  <code className="text-xs">{block.publishedHash?.slice(0, 12)}</code>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Published</span>
                  <span className="text-right text-xs">
                    {new Date(block.publishedAt).toLocaleString()}
                    <br />
                    {block.publishedBy}
                  </span>
                </div>
              </>
            ) : null}
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Token set</span>
              {tokenSet ? <Badge variant="secondary">v{tokenSet.version}</Badge> : <Badge variant="outline">None</Badge>}
            </div>
            {block.publishedHash && block.publishedHash !== block.sourceHash ? (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                This block has unpublished changes. The MCP server still serves v{block.publishedVersion}.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
      <AuditTrail entries={publishLog} title="Publish history" />
    </div>
  )
}
