"use client"

import { useMemo, useState } from "react"
import { formatDistanceToNow } from "date-fns"
import { Flag, RefreshCw, ShieldCheck } from "lucide-react"
import {
  createFlag,
  resolveFlag,
  runAutomatedAudit,
  submitReview,
} from "@/app/dashboard/actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import {
  FLAG_CATEGORIES,
  FLAG_SEVERITIES,
  TASTE_CHECKS,
  type FlagCategory,
  type FlagSeverity,
  type TasteCheck,
  type TasteChecklist,
} from "@/lib/review-constants"
import { GOVERNANCE_RULES } from "@/lib/governance"
import { TASTE_RULE_LABELS, auditBlock, type TasteRule, type TasteViolation } from "@/lib/taste-inspector"
import type { AuditLogEntry, ComponentBlock, LayoutFlag } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useAction } from "./use-action"

const CHECK_COPY: Record<TasteCheck, { title: string; detail: string }> = {
  icon_sizing: {
    title: "Button icon sizing",
    detail: "size-4 in default/sm/icon buttons, size-5 in lg buttons and nav items; decorative icons aria-hidden.",
  },
  font_hierarchy: {
    title: "Font hierarchy bindings",
    detail: "Headings bind --font-heading, the root binds --font-body; no arbitrary sizes or generic families.",
  },
  padding_density: {
    title: "Padding density",
    detail: "Spacing stays on the scale (no off-grid or arbitrary values) and matches the archetype's density.",
  },
  wcag_contrast: {
    title: "WCAG contrast",
    detail: "Text and interactive states meet AA (4.5:1), and focus rings (ring-2 ring-primary) are visible.",
  },
}

const RULE_TO_CHECK: Partial<Record<TasteRule, TasteCheck>> = {
  icon_sizing: "icon_sizing",
  font_hierarchy: "font_hierarchy",
  padding_density: "padding_density",
  wcag_contrast: "wcag_contrast",
  focus_ring: "wcag_contrast",
}

const RULE_TO_FLAG: Record<TasteRule, FlagCategory> = {
  icon_sizing: "icon_sizing",
  font_hierarchy: "typography",
  padding_density: "spacing",
  wcag_contrast: "contrast",
  focus_ring: "contrast",
  brand_tokens: "other",
}

const CATEGORY_LABEL: Record<FlagCategory, string> = {
  layout_regression: "Layout regression",
  spacing: "Unaligned spacing",
  typography: "Typography",
  icon_sizing: "Icon sizing",
  contrast: "Contrast",
  other: "Other",
}

const SEVERITY_CLASS: Record<FlagSeverity, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-amber-100 text-amber-800",
  high: "bg-destructive/10 text-destructive",
}

const emptyChecklist = (): TasteChecklist =>
  Object.fromEntries(TASTE_CHECKS.map((check) => [check, false])) as TasteChecklist

type FlagDraft = { category: FlagCategory; severity: FlagSeverity; line: string; message: string }

function AutomatedAudit({
  block,
  violations,
  onFlag,
}: {
  block: ComponentBlock
  violations: TasteViolation[]
  onFlag: (violation: TasteViolation) => void
}) {
  const { run, isPending } = useAction()
  const grouped = useMemo(() => {
    const groups = new Map<TasteRule, TasteViolation[]>()
    for (const violation of violations) {
      groups.set(violation.rule, [...(groups.get(violation.rule) ?? []), violation])
    }
    return [...groups.entries()]
  }, [violations])

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4" aria-hidden="true" />
            Automated taste audit
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            disabled={isPending("audit")}
            onClick={() =>
              run("audit", () => runAutomatedAudit(block.id), { success: "Audit re-run and logged" })
            }
          >
            <RefreshCw className={cn("size-4", isPending("audit") && "animate-spin")} aria-hidden="true" />
            Re-run &amp; log
          </Button>
        </div>
        <CardDescription>
          auditTaste() from the MCP compiler plus operator checks for spacing, typography and contrast.
          Every run is written to the audit log.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {violations.length === 0 ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            No violations in revision {block.sourceHash.slice(0, 8)}.
          </p>
        ) : (
          grouped.map(([rule, items]) => (
            <div key={rule} className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold">{TASTE_RULE_LABELS[rule]}</h4>
                <Badge variant="destructive">{items.length}</Badge>
              </div>
              <ul className="flex flex-col gap-1">
                {items.map((violation, index) => (
                  <li key={index} className="flex items-start gap-2 rounded-md border px-3 py-2 text-xs">
                    <span className="w-10 shrink-0 font-mono text-muted-foreground">
                      {violation.line ? `L${violation.line}` : "—"}
                    </span>
                    <span className="flex-1">{violation.message}</span>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => onFlag(violation)}
                      aria-label={`Flag: ${violation.message}`}
                    >
                      <Flag className="size-4" aria-hidden="true" />
                      Flag
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Governance rules enforced by compile_component</summary>
          <ul className="mt-2 list-disc pl-5">
            {GOVERNANCE_RULES.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </details>
      </CardContent>
    </Card>
  )
}

function ManualReview({ block, violations }: { block: ComponentBlock; violations: TasteViolation[] }) {
  const { run, isPending } = useAction()
  const review = block.latestReview
  const reviewIsCurrent = review?.sourceHash === block.sourceHash
  const [checks, setChecks] = useState<TasteChecklist>(() =>
    reviewIsCurrent && review ? review.checks : emptyChecklist(),
  )
  const [notes, setNotes] = useState("")

  const automatedHits = useMemo(() => {
    const counts: Partial<Record<TasteCheck, number>> = {}
    for (const violation of violations) {
      const check = RULE_TO_CHECK[violation.rule]
      if (check) counts[check] = (counts[check] ?? 0) + 1
    }
    return counts
  }, [violations])

  const allChecked = TASTE_CHECKS.every((check) => checks[check])

  function submit(decision: "approve" | "request_changes") {
    run(
      decision,
      () =>
        submitReview({
          blockId: block.id,
          sourceHash: block.sourceHash,
          checks,
          notes: notes.trim() || null,
          decision,
        }),
      { success: decision === "approve" ? "Review approved" : "Changes requested" },
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Manual taste review</CardTitle>
        <CardDescription>
          {review
            ? `Last ${reviewIsCurrent ? "" : "(older revision) "}review by ${review.reviewedBy}, ${formatDistanceToNow(new Date(review.createdAt), { addSuffix: true })}`
            : "Not reviewed yet"}
          {review?.notes ? ` · “${review.notes}”` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {TASTE_CHECKS.map((check) => (
          <div key={check} className="flex items-start gap-3">
            <Checkbox
              id={`check-${check}`}
              checked={checks[check]}
              onCheckedChange={(value) => setChecks({ ...checks, [check]: value === true })}
              className="mt-0.5"
            />
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor={`check-${check}`} className="flex items-center gap-2">
                {CHECK_COPY[check].title}
                {automatedHits[check] ? (
                  <Badge variant="destructive" className="text-xs">
                    {automatedHits[check]} automated finding{automatedHits[check] === 1 ? "" : "s"}
                  </Badge>
                ) : null}
              </Label>
              <p className="text-xs text-muted-foreground">{CHECK_COPY[check].detail}</p>
            </div>
          </div>
        ))}
        <div className="flex flex-col gap-2">
          <Label htmlFor="review-notes">Notes</Label>
          <Textarea
            id="review-notes"
            value={notes}
            maxLength={4000}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What you checked, or what needs to change"
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <Button disabled={!allChecked || isPending()} onClick={() => submit("approve")}>
            {isPending("approve") ? "Saving…" : "Approve revision"}
          </Button>
          <Button variant="outline" disabled={isPending()} onClick={() => submit("request_changes")}>
            {isPending("request_changes") ? "Saving…" : "Request changes"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function FlagRow({ flag }: { flag: LayoutFlag }) {
  const { run, isPending } = useAction()
  const [resolution, setResolution] = useState("")
  const [resolving, setResolving] = useState(false)

  return (
    <li className={cn("flex flex-col gap-2 rounded-lg border p-3", flag.status === "resolved" && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{CATEGORY_LABEL[flag.category]}</Badge>
        <Badge className={SEVERITY_CLASS[flag.severity]}>{flag.severity}</Badge>
        {flag.line ? <span className="font-mono text-xs text-muted-foreground">L{flag.line}</span> : null}
        <span className="ml-auto text-xs text-muted-foreground">
          {flag.createdBy} · {formatDistanceToNow(new Date(flag.createdAt), { addSuffix: true })}
        </span>
      </div>
      <p className="text-sm">{flag.message}</p>
      {flag.status === "resolved" ? (
        <p className="text-xs text-muted-foreground">
          Resolved by {flag.resolvedBy}: {flag.resolution}
        </p>
      ) : resolving ? (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            run("resolve", () => resolveFlag({ flagId: flag.id, resolution }), { success: "Flag resolved" })
          }}
        >
          <Input
            autoFocus
            required
            value={resolution}
            maxLength={2000}
            onChange={(e) => setResolution(e.target.value)}
            placeholder="How was it fixed?"
            aria-label="Resolution"
          />
          <Button type="submit" size="sm" disabled={isPending("resolve")}>
            Resolve
          </Button>
        </form>
      ) : (
        <Button size="sm" variant="outline" className="self-start" onClick={() => setResolving(true)}>
          Resolve…
        </Button>
      )}
    </li>
  )
}

function LayoutFlags({
  block,
  draft,
  setDraft,
}: {
  block: ComponentBlock
  draft: FlagDraft
  setDraft: (draft: FlagDraft) => void
}) {
  const { run, isPending } = useAction()
  const open = block.flags.filter((flag) => flag.status === "open")
  const resolved = block.flags.filter((flag) => flag.status === "resolved")

  return (
    <Card id="layout-flags">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Flag className="size-4" aria-hidden="true" />
          Layout regressions &amp; alignment flags
        </CardTitle>
        <CardDescription>
          {open.length} open · {resolved.length} resolved. Open flags block publishing.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form
          className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-[1fr_1fr_6rem]"
          onSubmit={(event) => {
            event.preventDefault()
            run(
              "flag",
              () =>
                createFlag({
                  blockId: block.id,
                  category: draft.category,
                  severity: draft.severity,
                  message: draft.message,
                  line: draft.line ? Number(draft.line) : null,
                }),
              {
                success: "Flag raised",
                onSuccess: () => setDraft({ ...draft, message: "", line: "" }),
              },
            )
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="flag-category">Category</Label>
            <NativeSelect
              id="flag-category"
              className="w-full"
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value as FlagCategory })}
            >
              {FLAG_CATEGORIES.map((category) => (
                <NativeSelectOption key={category} value={category}>
                  {CATEGORY_LABEL[category]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="flag-severity">Severity</Label>
            <NativeSelect
              id="flag-severity"
              className="w-full"
              value={draft.severity}
              onChange={(e) => setDraft({ ...draft, severity: e.target.value as FlagSeverity })}
            >
              {FLAG_SEVERITIES.map((severity) => (
                <NativeSelectOption key={severity} value={severity}>
                  {severity}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="flag-line">Line</Label>
            <Input
              id="flag-line"
              type="number"
              min={1}
              value={draft.line}
              onChange={(e) => setDraft({ ...draft, line: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1 sm:col-span-3">
            <Label htmlFor="flag-message">What regressed?</Label>
            <Textarea
              id="flag-message"
              required
              maxLength={2000}
              value={draft.message}
              onChange={(e) => setDraft({ ...draft, message: e.target.value })}
              placeholder="e.g. Card header padding is p-5 but siblings use p-6; title baseline is misaligned"
            />
          </div>
          <Button type="submit" size="sm" className="self-start" disabled={isPending("flag")}>
            Raise flag
          </Button>
        </form>
        {block.flags.length ? (
          <ul className="flex flex-col gap-2">
            {[...open, ...resolved].map((flag) => (
              <FlagRow key={flag.id} flag={flag} />
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function AuditTrail({ entries, title = "Audit log" }: { entries: AuditLogEntry[]; title?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>Automated audits, reviews, flags and publishes, newest first</CardDescription>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing logged yet.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {entries.slice(0, 30).map((entry) => {
              const details = entry.details as { passed?: boolean; total?: number; version?: number; reason?: string }
              return (
                <li key={entry.id} className="flex flex-wrap items-baseline gap-2 border-b pb-2 text-xs last:border-0">
                  <code className="font-medium">{entry.action}</code>
                  {entry.action === "audit.automated" ? (
                    <Badge variant={details.passed ? "secondary" : "destructive"}>
                      {details.passed ? "pass" : `${details.total} violation(s)`}
                    </Badge>
                  ) : null}
                  {details.version ? <Badge variant="outline">v{details.version}</Badge> : null}
                  {details.reason ? <span className="text-muted-foreground">{details.reason}</span> : null}
                  <span className="ml-auto text-muted-foreground">
                    {entry.actor} · {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}
                  </span>
                </li>
              )
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

export function GovernancePanel({
  block,
  auditLog,
  blockPicker,
}: {
  block: ComponentBlock | null
  auditLog: AuditLogEntry[]
  blockPicker: React.ReactNode
}) {
  const violations = useMemo(() => (block ? auditBlock(block.source, block.tokens) : []), [block])
  const [draft, setDraft] = useState<FlagDraft>({
    category: "layout_regression",
    severity: "medium",
    line: "",
    message: "",
  })

  if (!block) {
    return (
      <div className="flex flex-col gap-6">
        {blockPicker}
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Add a component block in Assets to review it.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {blockPicker}
      <div className="grid gap-6 xl:grid-cols-2">
        <AutomatedAudit
          block={block}
          violations={violations}
          onFlag={(violation) => {
            setDraft({
              category: RULE_TO_FLAG[violation.rule],
              severity: "medium",
              line: violation.line ? String(violation.line) : "",
              message: violation.message,
            })
            document.getElementById("layout-flags")?.scrollIntoView({ behavior: "smooth" })
          }}
        />
        {/* Remounts on a new block, revision or review so the checklist starts over. */}
        <ManualReview
          key={`${block.id}:${block.sourceHash}:${block.latestReview?.id ?? ""}`}
          block={block}
          violations={violations}
        />
      </div>
      <LayoutFlags block={block} draft={draft} setDraft={setDraft} />
      <AuditTrail entries={auditLog.filter((entry) => entry.entityId === block.id)} title="Block audit log" />
    </div>
  )
}
