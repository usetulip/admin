"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { LogOut, Radio, RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Toaster } from "@/components/ui/sonner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useOperatorRealtime, type RealtimeStatus } from "@/hooks/use-operator-realtime"
import { authClient } from "@/lib/auth-client"
import type { Operator } from "@/lib/operator"
import type { BlockStatus } from "@/lib/review-constants"
import type { ComponentBlock, DashboardData } from "@/lib/types"
import { cn } from "@/lib/utils"
import { AssetViewer } from "./asset-viewer"
import { BlockEditorDialog } from "./block-editor-dialog"
import { GovernancePanel } from "./governance-panel"
import { IntakeQueueList, ProjectBriefPanel } from "./intake-queue"
import { PublishPanel } from "./publish-panel"

const REALTIME_LABEL: Record<RealtimeStatus, string> = {
  connecting: "Connecting…",
  live: "Live",
  offline: "Offline",
  disabled: "Realtime not configured",
}

const BLOCK_STATUS: Record<BlockStatus, { label: string; className: string }> = {
  in_review: { label: "In review", className: "bg-amber-100 text-amber-800" },
  changes_requested: { label: "Changes requested", className: "bg-destructive/10 text-destructive" },
  approved: { label: "Approved", className: "bg-blue-100 text-blue-800" },
  published: { label: "Published", className: "bg-emerald-100 text-emerald-800" },
}

function BlockPicker({
  blocks,
  selected,
  onSelect,
  actions,
}: {
  blocks: ComponentBlock[]
  selected: ComponentBlock | null
  onSelect: (id: string) => void
  actions: React.ReactNode
}) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3">
        <label htmlFor="block-picker" className="text-sm font-medium">
          Component block
        </label>
        {blocks.length ? (
          <NativeSelect
            id="block-picker"
            value={selected?.id ?? ""}
            onChange={(event) => onSelect(event.target.value)}
            className="min-w-56"
          >
            {blocks.map((block) => (
              <NativeSelectOption key={block.id} value={block.id}>
                {block.name} · {block.archetype}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        ) : (
          <span className="text-sm text-muted-foreground">None yet</span>
        )}
        {selected ? (
          <Badge className={BLOCK_STATUS[selected.status].className}>{BLOCK_STATUS[selected.status].label}</Badge>
        ) : null}
        {selected && selected.publishedAt && selected.publishedHash !== selected.sourceHash ? (
          <Badge variant="outline">v{selected.publishedVersion} live · unpublished changes</Badge>
        ) : null}
        <div className="ml-auto flex gap-2">{actions}</div>
      </CardContent>
    </Card>
  )
}

export function OperatorDashboard({ operator, data }: { operator: Operator; data: DashboardData }) {
  const router = useRouter()
  const { status: realtime, lastEventAt } = useOperatorRealtime()
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(data.projects[0]?.id ?? null)
  const [selectedBlockByProject, setSelectedBlockByProject] = useState<Record<string, string>>({})
  const [tab, setTab] = useState("brief")

  const project = data.projects.find((p) => p.id === selectedProjectId) ?? data.projects[0] ?? null
  const projectBlocks = useMemo(
    () => (project ? data.blocks.filter((block) => block.projectId === project.id) : []),
    [data.blocks, project],
  )
  const block =
    projectBlocks.find((b) => b.id === (project && selectedBlockByProject[project.id])) ?? projectBlocks[0] ?? null
  const tokenSet = block ? data.tokenSets.find((set) => set.clientId === block.clientId) ?? null : null

  const blockCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const b of data.blocks) counts.set(b.projectId, (counts.get(b.projectId) ?? 0) + 1)
    return counts
  }, [data.blocks])

  const projectTokens = block?.tokens ?? tokenSet?.tokens ?? null
  const defaultTokensJson = projectTokens ? JSON.stringify(projectTokens, null, 2) : ""

  function selectBlock(id: string) {
    if (project) setSelectedBlockByProject((current) => ({ ...current, [project.id]: id }))
  }

  const picker = project ? (
    <BlockPicker
      blocks={projectBlocks}
      selected={block}
      onSelect={selectBlock}
      actions={
        <>
          {block ? (
            <BlockEditorDialog key={`edit-${block.id}`} project={project} block={block} defaultTokensJson="" />
          ) : null}
          <BlockEditorDialog
            key={`new-${project.id}`}
            project={project}
            defaultTokensJson={defaultTokensJson}
            onCreated={selectBlock}
          />
        </>
      }
    />
  ) : null

  return (
    <div className="min-h-svh bg-muted p-4 sm:p-6">
      <Toaster richColors />
      <div className="mx-auto flex max-w-[96rem] flex-col gap-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold">Operator Taste Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Intake, inspect, govern and publish component blocks to mcp.usetulip.co
            </p>
            <p className="text-sm">
              <span className="font-medium">Operator:</span>{" "}
              <span className="text-muted-foreground">{operator.email}</span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                "gap-1.5",
                realtime === "live" && "border-emerald-300 text-emerald-700",
                realtime === "offline" && "border-destructive/40 text-destructive",
              )}
              title={lastEventAt ? `Last change ${lastEventAt.toLocaleTimeString()}` : undefined}
            >
              <Radio className="size-4" aria-hidden="true" />
              {REALTIME_LABEL[realtime]}
            </Badge>
            <Button variant="outline" size="icon" onClick={() => router.refresh()} aria-label="Refresh">
              <RefreshCw className="size-4" aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                await authClient.signOut()
                router.replace("/login")
                router.refresh()
              }}
            >
              <LogOut className="size-4" aria-hidden="true" />
              Sign out
            </Button>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
          <IntakeQueueList
            projects={data.projects}
            selectedId={project?.id ?? null}
            onSelect={setSelectedProjectId}
            blockCounts={blockCounts}
          />

          {project ? (
            <Tabs value={tab} onValueChange={setTab} className="min-w-0">
              <TabsList className="self-start">
                <TabsTrigger value="brief">Brief</TabsTrigger>
                <TabsTrigger value="assets">Assets</TabsTrigger>
                <TabsTrigger value="governance">
                  Governance
                  {block && block.flags.some((flag) => flag.status === "open") ? (
                    <Badge variant="destructive">{block.flags.filter((f) => f.status === "open").length}</Badge>
                  ) : null}
                </TabsTrigger>
                <TabsTrigger value="publish">Publish</TabsTrigger>
              </TabsList>
              <TabsContent value="brief">
                <ProjectBriefPanel
                  key={`${project.id}:${project.updatedAt}`}
                  project={project}
                  tokens={projectTokens}
                  tokensSource={
                    block ? `block “${block.name}”` : tokenSet ? `live token set v${tokenSet.version}` : ""
                  }
                />
              </TabsContent>
              <TabsContent value="assets">
                <AssetViewer project={project} block={block} blockPicker={picker} />
              </TabsContent>
              <TabsContent value="governance">
                <GovernancePanel block={block} auditLog={data.auditLog} blockPicker={picker} />
              </TabsContent>
              <TabsContent value="publish">
                <PublishPanel block={block} tokenSet={tokenSet} auditLog={data.auditLog} blockPicker={picker} />
              </TabsContent>
            </Tabs>
          ) : (
            <Card>
              <CardContent className="flex min-h-64 items-center justify-center py-12">
                <p className="text-sm text-muted-foreground">
                  No requests yet. Briefs submitted on app.usetulip.co appear here in real time.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
