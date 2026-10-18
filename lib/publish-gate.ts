import { TASTE_CHECKS, type TasteChecklist } from "@/lib/review-constants"
import { auditBlock } from "@/lib/taste-inspector"
import { ThemeTokensSchema } from "@/lib/token-schema"

// The conditions a block must meet before it can be published. The publish
// Server Action re-runs this on locked rows inside its transaction; the
// dashboard runs the same function to show the operator what is missing.

export type GateCheck = {
  id: "tokens_valid" | "audit_clean" | "review_approved" | "flags_resolved" | "has_changes"
  label: string
  passed: boolean
  detail: string
}

export type GateInput = {
  source: string
  tokens: unknown
  sourceHash: string
  publishedHash: string | null
  latestReview: { sourceHash: string; checks: TasteChecklist } | null
  openFlagCount: number
}

export function publishGate(input: GateInput): GateCheck[] {
  const tokens = ThemeTokensSchema.safeParse(input.tokens)
  const violations = tokens.success ? auditBlock(input.source, tokens.data) : []
  const review = input.latestReview
  const reviewCurrent = review?.sourceHash === input.sourceHash
  const uncheckedRules = review
    ? TASTE_CHECKS.filter((check) => !review.checks[check])
    : [...TASTE_CHECKS]

  return [
    {
      id: "tokens_valid",
      label: "Brand tokens validate against ThemeTokensSchema",
      passed: tokens.success,
      detail: tokens.success ? "Valid" : tokens.error.issues[0]?.message ?? "Invalid tokens",
    },
    {
      id: "audit_clean",
      label: "Automated taste audit passes",
      passed: tokens.success && violations.length === 0,
      detail: tokens.success
        ? violations.length === 0
          ? "No violations"
          : `${violations.length} violation${violations.length === 1 ? "" : "s"}`
        : "Fix tokens first",
    },
    {
      id: "review_approved",
      label: "Manual review approved for this exact revision",
      passed: reviewCurrent && uncheckedRules.length === 0,
      detail: !review
        ? "Not reviewed"
        : !reviewCurrent
          ? "Source or tokens changed since the last review"
          : uncheckedRules.length
            ? `Unchecked: ${uncheckedRules.join(", ")}`
            : `Approved`,
    },
    {
      id: "flags_resolved",
      label: "No open layout flags",
      passed: input.openFlagCount === 0,
      detail: input.openFlagCount === 0 ? "None open" : `${input.openFlagCount} open`,
    },
    {
      id: "has_changes",
      label: "Revision differs from what is live",
      passed: input.publishedHash !== input.sourceHash,
      detail: input.publishedHash === input.sourceHash ? "Already live" : "New revision",
    },
  ]
}
