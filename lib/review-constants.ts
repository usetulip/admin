// Enumerations shared by the Drizzle schema, Server Actions and client UI.
// Kept free of drizzle imports so client components can use them.

export const TASTE_CHECKS = [
  "icon_sizing",
  "font_hierarchy",
  "padding_density",
  "wcag_contrast",
] as const

export type TasteCheck = (typeof TASTE_CHECKS)[number]
export type TasteChecklist = Record<TasteCheck, boolean>

export const FLAG_CATEGORIES = [
  "layout_regression",
  "spacing",
  "typography",
  "icon_sizing",
  "contrast",
  "other",
] as const

export type FlagCategory = (typeof FLAG_CATEGORIES)[number]

export const FLAG_SEVERITIES = ["low", "medium", "high"] as const

export type FlagSeverity = (typeof FLAG_SEVERITIES)[number]

export const BLOCK_STATUSES = [
  "in_review",
  "changes_requested",
  "approved",
  "published",
] as const

export type BlockStatus = (typeof BLOCK_STATUSES)[number]
