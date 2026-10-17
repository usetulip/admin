"use client"

import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import type { Project } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Check, Clock, LayoutGrid, Palette } from "lucide-react"

const LAYOUT_OPTIONS = [
  { value: "saas-dashboard", label: "SaaS Dashboard" },
  { value: "settings-hub", label: "Settings Hub" },
  { value: "data-analytics", label: "Data/Analytics View" },
  { value: "feed-social", label: "Feed/Social" },
] as const

const ALL_FEATURES = [
  "Data Tables",
  "Modal Forms",
  "Line/Bar Charts",
  "Date Pickers",
  "User Avatars",
] as const

function formatDate(value: string | null) {
  if (!value) {
    return "—"
  }
  return new Date(value).toLocaleString()
}

function formatCountdown(totalSeconds: number) {
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  return `${days}d ${hours}h ${minutes}m`
}

function SectionHeading({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-4 text-muted-foreground" />
      <h4 className="text-sm font-semibold">{children}</h4>
    </div>
  )
}

function DetailItem({
  label,
  value,
  mono,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-sm font-medium", mono && "font-mono uppercase")}>
        {value}
      </p>
    </div>
  )
}

function ColorTokenCard({
  label,
  color,
}: {
  label: string
  color: string
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div
        className="h-14 w-full rounded-md border shadow-inner"
        style={{ backgroundColor: color }}
      />
      <p className="font-mono text-sm font-medium uppercase">{color}</p>
    </div>
  )
}

type IntakeBriefDetailsProps = {
  project: Project
}

export function IntakeBriefDetails({ project }: IntakeBriefDetailsProps) {
  const layoutLabel =
    LAYOUT_OPTIONS.find((o) => o.value === project.layoutType)?.label ??
    project.layoutType

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <DetailItem label="Client Name" value={project.userName ?? "—"} />
        <DetailItem label="Client Email" value={project.userEmail ?? "—"} />
        <DetailItem label="Submitted" value={formatDate(project.createdAt)} />
      </div>

      <Separator />

      <div className="flex flex-col gap-3">
        <SectionHeading icon={Palette}>Brand Tokens</SectionHeading>
        <div className="grid gap-3 sm:grid-cols-3">
          <ColorTokenCard label="Primary Brand Color" color={project.primaryColor} />
          <ColorTokenCard label="Secondary Color" color={project.secondaryColor} />
          <ColorTokenCard
            label="Background Preference"
            color={project.backgroundColor}
          />
        </div>
      </div>

      <Separator />

      <div className="flex flex-col gap-3">
        <SectionHeading icon={LayoutGrid}>Core Layout Type</SectionHeading>
        <div className="grid gap-2 sm:grid-cols-2">
          {LAYOUT_OPTIONS.map((option) => {
            const isSelected = project.layoutType === option.value
            return (
              <div
                key={option.value}
                className={cn(
                  "flex items-center gap-3 rounded-lg border px-4 py-3",
                  isSelected
                    ? "border-primary/40 bg-primary/5 ring-1 ring-primary/20"
                    : "bg-muted/20 opacity-50"
                )}
              >
                <span
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full border",
                    isSelected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-muted-foreground/30"
                  )}
                >
                  {isSelected ? <Check className="size-3" strokeWidth={3} /> : null}
                </span>
                <div>
                  <p className="text-sm font-medium">{option.label}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {option.value}
                  </p>
                </div>
                {isSelected ? (
                  <Badge variant="secondary" className="ml-auto text-xs">
                    Selected
                  </Badge>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>

      <Separator />

      <div className="flex flex-col gap-3">
        <SectionHeading icon={Check}>Feature Scope</SectionHeading>
        <div className="flex flex-col gap-2">
          {ALL_FEATURES.map((feature) => {
            const isSelected = project.features.includes(feature)
            return (
              <div
                key={feature}
                className={cn(
                  "flex items-center gap-3 rounded-lg border px-4 py-3",
                  isSelected
                    ? "border-primary/40 bg-primary/5"
                    : "border-dashed bg-muted/10 opacity-60"
                )}
              >
                <span
                  className={cn(
                    "flex size-5 items-center justify-center rounded-[5px] border",
                    isSelected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-muted-foreground/30 bg-background"
                  )}
                >
                  {isSelected ? <Check className="size-3" strokeWidth={3} /> : null}
                </span>
                <span className="text-sm font-medium">{feature}</span>
                <Badge
                  variant="secondary"
                  className={cn(
                    "ml-auto text-xs",
                    isSelected
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {isSelected ? "Included" : "Not selected"}
                </Badge>
              </div>
            )
          })}
        </div>
        {project.features.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            The client did not select any optional features.
          </p>
        ) : null}
      </div>

      <Separator />

      <div className="flex flex-col gap-3">
        <SectionHeading icon={Clock}>Sprint Timeline</SectionHeading>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DetailItem
            label="Sprint Started"
            value={formatDate(project.processingStartedAt)}
          />
          <DetailItem
            label="Processing Deadline"
            value={formatDate(project.processingDeadline)}
          />
          <DetailItem
            label="Time Remaining"
            value={formatCountdown(project.secondsRemaining)}
          />
          <DetailItem
            label="Admin Approved"
            value={formatDate(project.approvedAt)}
          />
          <DetailItem
            label="Delivered"
            value={formatDate(project.deliveredAt)}
          />
          <DetailItem
            label="Status"
            value={
              <span className="capitalize">
                {project.status.replace("_", " ")}
              </span>
            }
          />
        </div>
      </div>
    </div>
  )
}
