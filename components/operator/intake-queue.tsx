"use client"

import { useState } from "react"
import { formatDistanceToNow } from "date-fns"
import { Trash2, Type } from "lucide-react"
import {
  approveProject,
  deleteProject,
  deliverProject,
  updatePipeline,
  updateProjectAssets,
} from "@/app/dashboard/actions"
import { IntakeBriefDetails } from "@/components/intake-brief-details"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { ThemeTokens } from "@/lib/token-schema"
import type { PipelineStepStatus, Project, ProjectStatus } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useAction } from "./use-action"

const STATUS_LABEL: Record<ProjectStatus, string> = {
  pending_approval: "Pending approval",
  processing: "Processing",
  delivered: "Delivered",
}

export function statusLabel(project: Project) {
  if (project.status === "delivered") return STATUS_LABEL.delivered
  return project.approvedAt ? STATUS_LABEL.processing : STATUS_LABEL.pending_approval
}

export function statusClass(project: Project) {
  if (project.status === "delivered") return "bg-emerald-100 text-emerald-800"
  return project.approvedAt ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-800"
}

type QueueFilter = "all" | "pending" | "processing" | "delivered"

function matchesFilter(project: Project, filter: QueueFilter) {
  switch (filter) {
    case "pending":
      return project.status !== "delivered" && !project.approvedAt
    case "processing":
      return project.status !== "delivered" && Boolean(project.approvedAt)
    case "delivered":
      return project.status === "delivered"
    default:
      return true
  }
}

export function IntakeQueueList({
  projects,
  selectedId,
  onSelect,
  blockCounts,
}: {
  projects: Project[]
  selectedId: string | null
  onSelect: (id: string) => void
  blockCounts: Map<string, number>
}) {
  const [filter, setFilter] = useState<QueueFilter>("all")
  const visible = projects.filter((project) => matchesFilter(project, filter))
  const pendingCount = projects.filter((p) => matchesFilter(p, "pending")).length

  return (
    <Card className="lg:sticky lg:top-6 lg:max-h-[calc(100svh-3rem)] lg:overflow-hidden">
      <CardHeader>
        <CardTitle className="text-base">Intake queue</CardTitle>
        <CardDescription>
          {projects.length} request{projects.length === 1 ? "" : "s"} · {pendingCount} awaiting approval
        </CardDescription>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={filter}
          onValueChange={(value) => value && setFilter(value as QueueFilter)}
          className="mt-2 w-full"
        >
          <ToggleGroupItem value="all" className="flex-1">All</ToggleGroupItem>
          <ToggleGroupItem value="pending" className="flex-1">Pending</ToggleGroupItem>
          <ToggleGroupItem value="processing" className="flex-1">Active</ToggleGroupItem>
          <ToggleGroupItem value="delivered" className="flex-1">Done</ToggleGroupItem>
        </ToggleGroup>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 lg:overflow-y-auto">
        {visible.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No requests in this view. New briefs from app.usetulip.co appear here live.
          </p>
        ) : (
          visible.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => onSelect(project.id)}
              aria-current={selectedId === project.id}
              className={cn(
                "rounded-lg border px-3 py-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selectedId === project.id ? "border-primary bg-primary/5" : "hover:bg-muted/80",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-sm font-medium">{project.layoutType}</span>
                <Badge variant="secondary" className={cn("shrink-0 text-xs", statusClass(project))}>
                  {statusLabel(project)}
                </Badge>
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {project.userEmail ?? project.userId.slice(0, 8)}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <div className="flex -space-x-1" aria-label="Brand colours">
                  {[project.primaryColor, project.secondaryColor, project.backgroundColor].map(
                    (color, index) => (
                      <span
                        key={index}
                        title={color}
                        className="size-4 rounded-full border border-background ring-1 ring-border"
                        style={{ backgroundColor: color }}
                      />
                    ),
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {project.features.length} feature{project.features.length === 1 ? "" : "s"}
                  {blockCounts.get(project.id) ? ` · ${blockCounts.get(project.id)} block(s)` : ""}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(project.createdAt), { addSuffix: true })}
                </span>
              </div>
            </button>
          ))
        )}
      </CardContent>
    </Card>
  )
}

function TypographyConstraints({ tokens, source }: { tokens: ThemeTokens | null; source: string }) {
  if (!tokens) {
    return (
      <p className="text-sm text-muted-foreground">
        No token set yet. Typography stacks come from the first component block&apos;s tokens.
      </p>
    )
  }
  const rows: [string, string[]][] = [
    ["Heading", tokens.typography.heading],
    ["Body", tokens.typography.body],
    ["Mono", tokens.typography.mono],
  ]
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">From {source}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {rows.map(([label, stack]) => (
          <div key={label} className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 truncate text-sm font-medium" style={{ fontFamily: stack.join(", ") }}>
              {stack[0]}
            </p>
            <p className="truncate font-mono text-xs text-muted-foreground">{stack.join(", ")}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Radius sm {tokens.radius.sm} · md {tokens.radius.md} · lg {tokens.radius.lg} · xl {tokens.radius.xl}
      </p>
    </div>
  )
}

const emptyToNull = (value: string) => (value.trim() === "" ? null : value.trim())

// The parent keys this by project id and updatedAt, so a realtime refresh that
// changes the project remounts it with fresh form state.
export function ProjectBriefPanel({
  project,
  tokens,
  tokensSource,
}: {
  project: Project
  tokens: ThemeTokens | null
  tokensSource: string
}) {
  const { run, isPending } = useAction()
  const [steps, setSteps] = useState(project.pipelineSteps)
  const [assets, setAssets] = useState({
    figmaFileUrl: project.figmaFileUrl ?? "",
    figmaFileName: project.figmaFileName ?? "",
    githubUrl: project.githubUrl ?? "",
    zipFileUrl: project.zipFileUrl ?? "",
    zipFileName: project.zipFileName ?? "",
    s3Bucket: project.s3Bucket ?? "",
  })

  function changeStep(stepId: string, status: PipelineStepStatus) {
    const next = steps.map((step) => (step.id === stepId ? { ...step, status } : step))
    setSteps(next)
    run("pipeline", () => updatePipeline(project.id, next))
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">Intake brief</CardTitle>
            <Badge className={statusClass(project)}>{statusLabel(project)}</Badge>
          </div>
          <CardDescription>
            Client parameters, archetype and colour constraints submitted from app.usetulip.co
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <IntakeBriefDetails project={project} />
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Type className="size-4 text-muted-foreground" aria-hidden="true" />
              <h4 className="text-sm font-semibold">Typography constraints</h4>
            </div>
            <TypographyConstraints tokens={tokens} source={tokensSource} />
          </div>
          {!project.approvedAt ? (
            <Button
              disabled={isPending("approve")}
              onClick={() => run("approve", () => approveProject(project.id), { success: "Sprint approved" })}
            >
              {isPending("approve") ? "Approving…" : "Approve sprint"}
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pipeline status</CardTitle>
          <CardDescription>Changes save immediately and show on the client portal</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {steps.map((step) => (
            <div key={step.id} className="flex items-center justify-between gap-4">
              <span className="text-sm font-medium">{step.label}</span>
              <Select
                value={step.status}
                disabled={isPending("pipeline")}
                onValueChange={(value) => changeStep(step.id, value as PipelineStepStatus)}
              >
                <SelectTrigger className="w-36" aria-label={`${step.label} status`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Deliverable links</CardTitle>
          <CardDescription>
            Figma file, code repository and archive links the asset viewer inspects
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              run(
                "assets",
                () =>
                  updateProjectAssets(project.id, {
                    figmaFileUrl: emptyToNull(assets.figmaFileUrl),
                    figmaFileName: emptyToNull(assets.figmaFileName),
                    githubUrl: emptyToNull(assets.githubUrl),
                    zipFileUrl: emptyToNull(assets.zipFileUrl),
                    zipFileName: emptyToNull(assets.zipFileName),
                    s3Bucket: emptyToNull(assets.s3Bucket),
                  }),
                { success: "Links saved" },
              )
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {(
                [
                  ["figmaFileUrl", "Figma file URL (.fig or figma.com)", "https://www.figma.com/design/…"],
                  ["figmaFileName", "Figma file name", "acme-system.fig"],
                  ["githubUrl", "GitHub repository URL", "https://github.com/org/repo"],
                  ["s3Bucket", "S3 bucket", "project-assets"],
                  ["zipFileUrl", "Code archive URL (.zip)", "https://…/views.zip"],
                  ["zipFileName", "Code archive name", "views.zip"],
                ] as const
              ).map(([key, label, placeholder]) => (
                <div key={key} className="flex flex-col gap-2">
                  <Label htmlFor={`asset-${key}`}>{label}</Label>
                  <Input
                    id={`asset-${key}`}
                    value={assets[key]}
                    placeholder={placeholder}
                    onChange={(event) => setAssets({ ...assets, [key]: event.target.value })}
                  />
                </div>
              ))}
            </div>
            <Button type="submit" variant="outline" disabled={isPending("assets")} className="self-start">
              {isPending("assets") ? "Saving…" : "Save links"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Delivery</CardTitle>
          <CardDescription>
            {project.status === "delivered"
              ? `Delivered ${project.deliveredAt ? new Date(project.deliveredAt).toLocaleString() : ""}`
              : "Mark delivered once the pipeline is complete and blocks are published."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {project.status !== "delivered" ? (
            <Button
              disabled={isPending("deliver") || !project.approvedAt}
              onClick={() => run("deliver", () => deliverProject(project.id), { success: "Marked as delivered" })}
            >
              {isPending("deliver") ? "Delivering…" : "Mark as delivered"}
            </Button>
          ) : null}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={isPending("delete")}>
                <Trash2 className="size-4" aria-hidden="true" />
                Delete project
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this project?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently deletes the intake brief for{" "}
                  <span className="font-medium text-foreground">
                    {project.userEmail ?? project.userName ?? "this client"}
                  </span>{" "}
                  and all of its component blocks, reviews and flags. It cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => run("delete", () => deleteProject(project.id), { success: "Project deleted" })}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  )
}
