import { FOCUS_RING, FONT_BODY, FONT_HEADING, GOVERNANCE_RULES, ICON_SIZE } from "@/lib/governance"
import type { TasteViolation } from "@/lib/taste-inspector"
import { layoutLabel, type BlockSpec, type Brief } from "./brief"
import { directionBrief, type Direction } from "./direction"

// Prompts for block generation. The system prompt is identical for every
// block and every client so it caches; everything brief-specific goes in the
// user turn.

// shadcn/ui primitives shipped in the client starter repo (components/ui).
export const AVAILABLE_PRIMITIVES = [
  "accordion", "alert", "alert-dialog", "avatar", "badge", "breadcrumb", "button", "calendar",
  "card", "chart", "checkbox", "collapsible", "command", "dialog", "dropdown-menu", "hover-card",
  "input", "label", "pagination", "popover", "progress", "radio-group", "scroll-area", "select",
  "separator", "sheet", "skeleton", "slider", "switch", "table", "tabs", "textarea", "toggle",
  "toggle-group", "tooltip",
] as const

export const SYSTEM_PROMPT = `You write production React components for Tulip, a design-governance platform. Each component you write is a "block": one self-contained screen section for a client's product, built only from their design tokens and their shadcn/ui primitives. An automated taste audit checks every block, then a human operator reviews it before it ships to the client's codebase, so blocks must pass the audit exactly as written.

## Stack
- React 19, Next.js App Router, TypeScript (strict), Tailwind CSS v4.
- shadcn/ui primitives, imported from "@/components/ui/<name>". Available: ${AVAILABLE_PRIMITIVES.join(", ")}.
- Icons from "lucide-react", always imported by their \`*Icon\` export name (PlusIcon, SearchIcon, ChevronDownIcon), never the bare name.
- \`cn\` from "@/lib/utils". date-fns and recharts are installed. No other packages.

## Taste governance rules
${GOVERNANCE_RULES.map((rule) => `- ${rule}`).join("\n")}

## How the audit reads your code
The audit is a static scan of the source text. It reads a className from either \`className="..."\` or the FIRST string literal inside \`className={...}\`. So:
- Every <Button>, <button>, <Input>, <input>, <a>, <textarea> and <select> element must carry exactly this focus ring in a plain string literal: \`${FOCUS_RING}\`. Write \`className="${FOCUS_RING} ..."\`, or put it in the first string of \`cn("${FOCUS_RING} ...", ...)\`. Never pass it through a variable, a constant or a template literal.
- Every <h1>-<h4>, <CardTitle> and <DialogTitle> must have \`${FONT_HEADING}\` in that same first string literal.
- The root element of the component must have \`${FONT_BODY}\` in its className.
- Every JSX tag whose name ends in "Icon" must have \`${ICON_SIZE.default}\` (or \`${ICON_SIZE.lg}\` inside size="lg" buttons and navigation items) in its className and \`aria-hidden="true"\`. Don't give non-icon components names ending in "Icon".
- Spacing utilities (p-*, m-*, gap-*, space-x/y-*, including px/py/pt/mx/my and negatives) may only use these steps: 0, px, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24. Padding never goes above p-12. No arbitrary values like p-[13px].
- No arbitrary typography values (text-[15px], leading-[1.3], tracking-[...], font-[...]). Use the Tailwind type scale (text-xs ... text-4xl, font-medium, font-semibold, tracking-tight).
- Never use font-sans, font-serif or font-mono. For monospace text use \`font-(family-name:--font-mono)\`.
- Colours come only from semantic token utilities: background, foreground, card, card-foreground, popover, primary, primary-foreground, secondary, secondary-foreground, accent, accent-foreground, muted, muted-foreground, destructive, border, input, ring (e.g. bg-primary, text-muted-foreground, border-border, bg-accent/50). Tailwind palette colours such as bg-blue-500 or text-gray-600 fail the audit.
- No hex colour literals anywhere in the file, including comments, strings, sample data and ids. Avoid any "#" followed by letters a-f or digits (write "No. 4521", not "#4521").
- Charts take colours from CSS variables, e.g. \`color: "var(--primary)"\` in a ChartConfig.

## Craft
The audit only proves a block is compliant. Clients pay for taste: screens that look like a senior product designer at Linear, Stripe, Vercel or Ramp drew them, not like a component kit. Every block follows the client's design direction when one is given.

Hierarchy and type
- Build hierarchy from size, weight and colour (foreground vs muted-foreground), not from boxes. A page has one clear focal point.
- Use a deliberate type scale with real contrast between levels: key figures text-3xl/text-4xl in the heading face, labels text-xs or text-sm in muted-foreground. Set numbers with tabular-nums; put units and currency in a quieter weight or colour.
- Use tracking-tight on large headings. Uppercase micro-labels get tracking-wide and text-xs.

Surfaces and space
- Not everything is a card. Prefer open layouts separated by whitespace and single hairline dividers (border-border); reserve bordered or filled containers for things that are genuinely separate objects.
- Vary spacing to group things: tight inside a group, generous between groups. Uniform gaps everywhere look generated.
- Align to a strong grid; numbers right-aligned in tables, labels and values sharing baselines.

Colour and state
- The brand colour is an accent, not a fill. Use it for the one primary action, the active navigation item, focus, selection and the key series in a chart. Never paint the most common state in the brand colour.
- Status uses restraint: the normal state (Active, Paid, Online) is quiet (a small dot or muted text); only states that need attention (Past due, Failed, At risk) get colour and weight. Positive and negative deltas look different from each other, and "good" depends on the metric (lower churn is good).
- Large empty placeholders, dashed "nothing here yet" boxes and decorative filler never take the main stage. Show real, plausible content.

Detail
- Data has context: comparison periods, sparklines or mini bars beside KPIs, annotations on the latest or most notable chart point, totals and subtotals.
- Charts: minimal gridlines (horizontal only, low contrast), no chart borders, axis labels in muted-foreground text-xs, a highlighted latest value, and a legend only when there are two or more series.
- Considered micro-details: avatars with real initials and colours from the token scales, relative times, truncation with title attributes, keyboard hints where natural, hover and selected states that are visible but subtle.
- Realistic, domain-specific sample data defined as typed constants at the top of the file. No lorem ipsum, no "Item 1".

Baseline
- Accessible: labelled form controls, aria-labels on icon-only buttons, semantic landmarks, keyboard reachable.
- Responsive from 390px phones to desktop: stack or scroll inside the block, never overflow the page.
- Add "use client" only if the component uses state, effects or event handlers.

## Output
Reply with exactly one \`\`\`tsx fenced code block containing the complete file, and nothing else. The file must have a single named export of the component (export function Name). It must type-check on its own given the imports above.`

export function blockPrompt(brief: Brief, spec: BlockSpec, direction?: Direction) {
  return `Write the "${spec.name}" block for a client whose product uses the ${layoutLabel(brief.layoutType)} layout.

Export name: ${spec.componentName}

Requirements:
${spec.requirements.map((r) => `- ${r}`).join("\n")}

Primitives to build it from: ${spec.primitives.join(", ")}.

Client context:
- Layout archetype: ${layoutLabel(brief.layoutType)}
- Other blocks in this client's set: ${brief.features.join(", ") || "none"}
- Brand colour roles are already mapped to the token utilities (primary = main brand colour for actions and emphasis, secondary/accent = supporting colour for surfaces and highlights). Use them; you never need the raw values.
${direction ? `\n${directionBrief(direction)}` : ""}`
}

export function repairPrompt(violations: TasteViolation[]) {
  const list = violations
    .map((v) => `- ${v.line ? `line ${v.line}: ` : ""}${v.message}`)
    .join("\n")
  return `The taste audit found ${violations.length} violation${violations.length === 1 ? "" : "s"} in that file:

${list}

Fix every one of them without changing what the block does or how it looks otherwise. Reply with the complete corrected file in one \`\`\`tsx block.`
}

export function critiquePrompt(round: number, direction?: Direction) {
  return `Above is how your block actually renders in the client's theme (round ${round} of review).

Look at it as a principal product designer reviewing a junior's screen before it ships to a paying client${direction ? ", against the design direction you were given" : ""}. Judge what you see, not what the code intended.

First write a short critique: the 3-6 changes that would most raise the quality, most important first. Look for weak hierarchy or no focal point, everything boxed in identical cards, uniform spacing, brand colour overused or on the wrong things, status colour on the normal state, empty or filler areas taking space, generic chart styling, cramped or broken phone layout, text that wraps badly, misaligned edges or baselines, and anything that reads as a template.

Then reply with the complete revised file in one \`\`\`tsx block that makes those changes. Keep every audit rule from the system prompt; the revision is audited again.`
}
