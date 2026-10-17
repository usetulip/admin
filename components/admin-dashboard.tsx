"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { authClient } from "@/lib/auth-client"
import {
  approveProject,
  deleteProject,
  deliverProject,
  listProjects,
  updateAssets,
  updatePipeline,
  uploadProjectFile,
  type PipelineStep,
  type PipelineStepStatus,
  type Project,
} from "@/lib/api"
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { IntakeBriefDetails } from "@/components/intake-brief-details"
import { cn } from "@/lib/utils"
import { Trash2 } from "lucide-react"

function getProjectLabel(project: Project) {
  if (project.status === "delivered") {
    return "Delivered"
  }
  if (!project.approvedAt) {
    return "Pending Approval"
  }
  return "Processing"
}

function getProjectColor(project: Project) {
  if (project.status === "delivered") {
    return "bg-emerald-100 text-emerald-800"
  }
  if (!project.approvedAt) {
    return "bg-amber-100 text-amber-800"
  }
  return "bg-blue-100 text-blue-800"
}

function formatDate(value: string | null) {
  if (!value) {
    return "—"
  }
  return new Date(value).toLocaleString()
}

export function AdminDashboard() {
  const router = useRouter()
  const { data: session } = authClient.useSession()
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const selected = projects.find((p) => p.id === selectedId) ?? null

  const [githubUrl, setGithubUrl] = useState("")
  const [s3Bucket, setS3Bucket] = useState("")
  const [pipelineSteps, setPipelineSteps] = useState<PipelineStep[]>([])

  const loadProjects = useCallback(async () => {
    try {
      const { projects: loaded } = await listProjects()
      setProjects(loaded)
      setError(null)
      if (!selectedId && loaded.length > 0) {
        setSelectedId(loaded[0]!.id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects")
    } finally {
      setIsLoading(false)
    }
  }, [selectedId])

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  useEffect(() => {
    if (selected) {
      setGithubUrl(selected.githubUrl ?? "")
      setS3Bucket(selected.s3Bucket ?? "")
      setPipelineSteps(selected.pipelineSteps)
    }
  }, [selected])

  async function runAction(key: string, action: () => Promise<void>) {
    setActionLoading(key)
    setError(null)
    try {
      await action()
      await loadProjects()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed")
    } finally {
      setActionLoading(null)
    }
  }

  async function handleStepStatusChange(
    stepId: string,
    status: PipelineStepStatus,
  ) {
    if (!selected) {
      return
    }

    const updatedSteps = pipelineSteps.map((step) =>
      step.id === stepId ? { ...step, status } : step
    )

    setPipelineSteps(updatedSteps)
    setActionLoading("pipeline")
    setError(null)

    try {
      await updatePipeline(selected.id, updatedSteps)
      await loadProjects()
    } catch (err) {
      setPipelineSteps(selected.pipelineSteps)
      setError(err instanceof Error ? err.message : "Failed to save pipeline")
    } finally {
      setActionLoading(null)
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <p className="text-muted-foreground">Loading projects...</p>
      </div>
    )
  }

  return (
    <div className="min-h-svh bg-muted p-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold">Admin Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Review intake briefs, manage pipeline, and deliver assets
            </p>
            <div className="mt-2 flex flex-col gap-1 text-sm">
              {session?.user?.email ? (
                <p>
                  <span className="font-medium text-foreground">Admin:</span>{" "}
                  <span className="text-muted-foreground">
                    {session.user.email}
                  </span>
                </p>
              ) : null}
              {selected?.userEmail ? (
                <p>
                  <span className="font-medium text-foreground">Client:</span>{" "}
                  <span className="text-muted-foreground">
                    {selected.userEmail}
                  </span>
                </p>
              ) : null}
            </div>
          </div>
          <Button
            variant="outline"
            className="shrink-0"
            onClick={async () => {
              await authClient.signOut()
              router.replace("/login")
              router.refresh()
            }}
          >
            Sign out
          </Button>
        </div>

        {error ? (
          <p className="rounded-lg bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Projects</CardTitle>
              <CardDescription>
                {projects.length} total submission{projects.length !== 1 ? "s" : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {projects.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No intake briefs submitted yet.
                </p>
              ) : (
                projects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => setSelectedId(project.id)}
                    className={cn(
                      "rounded-lg border px-3 py-3 text-left transition-colors",
                      selectedId === project.id
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/80"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">
                        {project.layoutType}
                      </span>
                      <Badge
                        variant="secondary"
                        className={cn("shrink-0 text-xs", getProjectColor(project))}
                      >
                        {getProjectLabel(project)}
                      </Badge>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {project.userEmail ?? project.userId.slice(0, 8)}
                    </p>
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          {selected ? (
            <div className="flex flex-col gap-6">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Intake Brief</CardTitle>
                    <Badge className={getProjectColor(selected)}>
                      {getProjectLabel(selected)}
                    </Badge>
                  </div>
                  <CardDescription>
                    Submitted {formatDate(selected.createdAt)}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-6">
                  <IntakeBriefDetails project={selected} />
                  {!selected.approvedAt ? (
                    <Button
                      disabled={actionLoading === "approve"}
                      onClick={() =>
                        runAction("approve", async () => {
                          await approveProject(selected.id)
                        })
                      }
                    >
                      {actionLoading === "approve"
                        ? "Approving..."
                        : "Approve Sprint"}
                    </Button>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Pipeline Status</CardTitle>
                  <CardDescription>
                    Changes save automatically and reflect on the client portal
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {actionLoading === "pipeline" ? (
                    <p className="text-xs text-muted-foreground">Saving...</p>
                  ) : null}
                  {pipelineSteps.map((step) => (
                    <div
                      key={step.id}
                      className="flex items-center justify-between gap-4"
                    >
                      <span className="text-sm font-medium">{step.label}</span>
                      <Select
                        value={step.status}
                        disabled={actionLoading === "pipeline"}
                        onValueChange={(value) =>
                          handleStepStatusChange(
                            step.id,
                            value as PipelineStepStatus
                          )
                        }
                      >
                        <SelectTrigger className="w-36">
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
                  <CardTitle className="text-base">Deliverable Assets</CardTitle>
                  <CardDescription>
                    Upload files to Supabase storage and set GitHub URL
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="github-url">GitHub Repository URL</Label>
                      <Input
                        id="github-url"
                        value={githubUrl}
                        onChange={(e) => setGithubUrl(e.target.value)}
                        placeholder="https://github.com/org/repo"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="s3-bucket">S3 Bucket Name</Label>
                      <Input
                        id="s3-bucket"
                        value={s3Bucket}
                        onChange={(e) => setS3Bucket(e.target.value)}
                        placeholder="project-assets"
                      />
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    disabled={actionLoading === "assets"}
                    onClick={() =>
                      runAction("assets", async () => {
                        await updateAssets(selected.id, {
                          githubUrl: githubUrl || null,
                          s3Bucket: s3Bucket || null,
                        })
                      })
                    }
                  >
                    {actionLoading === "assets" ? "Saving..." : "Save URLs & Bucket"}
                  </Button>

                  <Separator />

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="figma-file">Figma System File (.fig)</Label>
                      <Input
                        id="figma-file"
                        type="file"
                        accept=".fig"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (!file) {
                            return
                          }
                          runAction("figma", async () => {
                            await uploadProjectFile(selected.id, "figma", file)
                          })
                        }}
                      />
                      {selected.figmaFileName ? (
                        <p className="text-xs text-muted-foreground">
                          Uploaded: {selected.figmaFileName}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="zip-file">Custom View Code (.zip)</Label>
                      <Input
                        id="zip-file"
                        type="file"
                        accept=".zip"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (!file) {
                            return
                          }
                          runAction("zip", async () => {
                            await uploadProjectFile(selected.id, "zip", file)
                          })
                        }}
                      />
                      {selected.zipFileName ? (
                        <p className="text-xs text-muted-foreground">
                          Uploaded: {selected.zipFileName}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {selected.status !== "delivered" ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Mark as Delivered</CardTitle>
                    <CardDescription>
                      Once all pipeline steps are complete and assets are uploaded,
                      deliver the project to the client portal.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button
                      disabled={actionLoading === "deliver"}
                      onClick={() =>
                        runAction("deliver", async () => {
                          await deliverProject(selected.id)
                        })
                      }
                    >
                      {actionLoading === "deliver"
                        ? "Delivering..."
                        : "Mark as Delivered"}
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="py-6">
                    <p className="text-sm text-emerald-700">
                      Delivered on {formatDate(selected.deliveredAt)}
                    </p>
                  </CardContent>
                </Card>
              )}

              <Card className="border-destructive/30">
                <CardHeader>
                  <CardTitle className="text-base text-destructive">
                    Danger Zone
                  </CardTitle>
                  <CardDescription>
                    Permanently remove this project entry and all associated data.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" disabled={actionLoading === "delete"}>
                        <Trash2 className="size-4" />
                        Delete Project
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this project?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently delete the intake brief for{" "}
                          <span className="font-medium text-foreground">
                            {selected.userEmail ?? selected.userName ?? "this client"}
                          </span>
                          . This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          disabled={actionLoading === "delete"}
                          onClick={() =>
                            runAction("delete", async () => {
                              await deleteProject(selected.id)
                              setSelectedId(null)
                            })
                          }
                        >
                          {actionLoading === "delete" ? "Deleting..." : "Delete"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card>
              <CardContent className="flex min-h-64 items-center justify-center py-12">
                <p className="text-sm text-muted-foreground">
                  Select a project to manage
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
