import { ThemeTokensSchema, type ThemeTokens } from "@/lib/token-schema"
import { buildScale, normalizeHex } from "./color"

// Turns a customer brief (projects row) into the inputs the generator needs:
// a validated token set and the list of blocks to write. Deterministic, so the
// same brief always yields the same tokens and plan.

export type Brief = {
  primaryColor: string
  secondaryColor: string
  backgroundColor: string
  layoutType: string
  features: string[]
}

export type BlockSpec = {
  /** Display name, also the component_blocks.name. */
  name: string
  /** PascalCase export name for the generated component. */
  componentName: string
  /** What the block must contain, in plain language for the model. */
  requirements: string[]
  /** shadcn primitives the block is expected to use. */
  primitives: string[]
}

// Layout archetypes offered by the customer portal's intake brief
// (usetulip/customer components/client-portal/intake-brief.tsx).
export const LAYOUTS: Record<string, { label: string; shell: BlockSpec }> = {
  "saas-dashboard": {
    label: "SaaS Dashboard",
    shell: {
      name: "Dashboard shell",
      componentName: "DashboardShell",
      requirements: [
        "Collapsible sidebar with the product name, 5-6 navigation items with icons and an active state",
        "Top bar with a page title, a search input and a user menu trigger",
        "A row of 4 KPI cards (label, value, change vs last period with an up/down indicator)",
        "Below the KPIs, a real working section full of realistic data showing what needs attention today, with one clear primary action",
      ],
      primitives: ["button", "card", "input", "badge", "separator", "avatar", "dropdown-menu"],
    },
  },
  "settings-hub": {
    label: "Settings Hub",
    shell: {
      name: "Settings hub",
      componentName: "SettingsHub",
      requirements: [
        "Left-hand section navigation (Profile, Account, Notifications, Billing, Team) with an active state",
        "A Profile section with labelled inputs, a textarea and a Save/Cancel footer",
        "A Notifications section with switches, each with a label and helper text",
        "A danger zone card with a destructive action",
      ],
      primitives: ["button", "card", "input", "label", "textarea", "switch", "separator"],
    },
  },
  "data-analytics": {
    label: "Data/Analytics View",
    shell: {
      name: "Analytics overview",
      componentName: "AnalyticsOverview",
      requirements: [
        "Header with the report title, a period selector (Select) and an Export button",
        "A row of 4 metric cards with value, delta and a short caption",
        "A two-column grid below: a large annotated chart with real data, and a ranked list of top segments with percentages and progress bars",
      ],
      primitives: ["button", "card", "select", "badge", "progress", "separator"],
    },
  },
  "feed-social": {
    label: "Feed/Social",
    shell: {
      name: "Activity feed",
      componentName: "ActivityFeed",
      requirements: [
        "A composer card at the top: avatar, textarea, attach and post buttons",
        "A feed of 4-5 posts: author avatar, name, handle, relative time, body text, and like/comment/share actions with counts",
        "A right rail with 'Who to follow' suggestions (avatar, name, follow button)",
      ],
      primitives: ["button", "card", "avatar", "textarea", "separator", "badge"],
    },
  },
}

// Feature checklist from the intake brief, one block each.
export const FEATURES: Record<string, BlockSpec> = {
  "Data Tables": {
    name: "Data table",
    componentName: "DataTableBlock",
    requirements: [
      "A typed table of 8-10 realistic rows relevant to the layout's domain",
      "Column header sorting (asc/desc indicator), a text filter input and row selection checkboxes with a select-all",
      "Status cells rendered as Badges; a per-row actions DropdownMenu",
      "Pagination controls and an empty state when the filter matches nothing",
    ],
    primitives: ["table", "input", "checkbox", "badge", "button", "dropdown-menu"],
  },
  "Modal Forms": {
    name: "Modal form",
    componentName: "ModalFormBlock",
    requirements: [
      "A Dialog that is open by default, over a realistic page behind it, containing a form relevant to the layout's domain, plus the trigger Button that reopens it",
      "3-5 labelled fields (Input, Select, Textarea) with inline validation messages on submit",
      "Footer with Cancel and a primary submit Button that shows a pending state",
    ],
    primitives: ["dialog", "button", "input", "label", "select", "textarea"],
  },
  "Line/Bar Charts": {
    name: "Chart card",
    componentName: "ChartCardBlock",
    requirements: [
      "A Card with a title, description and a toggle between a line chart and a bar chart",
      "12 points of realistic sample data relevant to the layout's domain, two series",
      "Use the shadcn chart primitives (ChartContainer, ChartTooltip, ChartTooltipContent, ChartConfig) with recharts",
      "Series colours come from CSS variables in the ChartConfig: `var(--primary)` and `var(--secondary-foreground)`",
    ],
    primitives: ["card", "chart", "toggle-group"],
  },
  "Date Pickers": {
    name: "Date range picker",
    componentName: "DateRangePickerBlock",
    requirements: [
      "A Popover trigger Button showing the selected range (formatted with date-fns), opening a two-month Calendar in range mode, with the numbers and chart below it responding to the range",
      "Preset shortcuts (Today, Last 7 days, Last 30 days, This quarter)",
      "Apply and Clear actions",
    ],
    primitives: ["popover", "calendar", "button"],
  },
  "User Avatars": {
    name: "Team members",
    componentName: "TeamMembersBlock",
    requirements: [
      "A team page listing 5-6 members: Avatar with image and initials fallback, name, email, role Badge, online indicator",
      "An overlapping avatar stack summary with a +N overflow count",
      "An Invite button",
    ],
    primitives: ["card", "avatar", "badge", "button"],
  },
}

export function layoutLabel(layoutType: string) {
  return LAYOUTS[layoutType]?.label ?? layoutType
}

/** The shell for the brief's layout, then one block per checked feature. */
export function planBlocks(brief: Brief): BlockSpec[] {
  const shell = LAYOUTS[brief.layoutType]?.shell
  if (!shell) {
    throw new Error(`Unknown layout type: ${brief.layoutType}`)
  }
  const features = brief.features.map((feature) => {
    const spec = FEATURES[feature]
    if (!spec) throw new Error(`Unknown feature: ${feature}`)
    return spec
  })
  return [shell, ...features]
}

export type DerivedTokens = {
  tokens: ThemeTokens
  /** Brief colours outside the token schema (it has no background slot). */
  background: string
  /** Where each brand hex landed, for the operator and the eval report. */
  anchors: { primary: string | null; secondary: string | null }
  notes: string[]
}

/** A schema-valid ThemeTokens set derived from the brief's colours. */
export function deriveTokens(brief: Brief): DerivedTokens {
  const primary = buildScale(brief.primaryColor, "Primary")
  const secondary = buildScale(brief.secondaryColor, "Secondary")

  const tokens = ThemeTokensSchema.parse({
    version: 1,
    colors: { primary: primary.scale, secondary: secondary.scale },
    // The brief does not ask for fonts yet; operators can override these in the block editor.
    // ui-sans-serif/ui-monospace only resolve in Safari, so each stack ends in a CSS generic every browser
    // has. Fallbacks are real family names: governance quotes every entry but the last.
    typography: {
      heading: ["Inter", "Helvetica Neue", "Arial", "sans-serif"],
      body: ["Inter", "Helvetica Neue", "Arial", "sans-serif"],
      mono: ["JetBrains Mono", "Menlo", "Consolas", "monospace"],
    },
    radius: { sm: "0.25rem", md: "0.5rem", lg: "0.75rem", xl: "1rem" },
    components: {},
  })

  return {
    tokens,
    background: normalizeHex(brief.backgroundColor),
    anchors: { primary: primary.anchorStep, secondary: secondary.anchorStep },
    notes: [...primary.notes, ...secondary.notes],
  }
}
