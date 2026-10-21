import { z } from "zod"
import { ThemeTokensSchema, type ThemeTokens } from "@/lib/token-schema"
import { layoutLabel, type Brief } from "./brief"
import type Anthropic from "@anthropic-ai/sdk"
import { addUsage, ask, extractFenced, GenerationError, type Usage } from "./generate-block"

// Art direction: one Claude call per brief, before any block is written. It
// turns three hex codes and an archetype into a design language every block
// follows, so the set reads as one product instead of separate templates.
// Operators see it in the run log and can regenerate with a new one.

// Google Fonts families we can load in the client starter and the preview.
export const FONT_CHOICES = {
  sans: [
    "Inter", "Geist", "IBM Plex Sans", "Manrope", "DM Sans", "Figtree", "Public Sans",
    "Instrument Sans", "Schibsted Grotesk", "Plus Jakarta Sans", "Onest", "Hanken Grotesk",
  ],
  display: [
    "Inter Tight", "Instrument Sans", "Schibsted Grotesk", "Bricolage Grotesque", "Sora",
    "Fraunces", "Newsreader", "Familjen Grotesk", "Geist", "Manrope",
  ],
  mono: ["JetBrains Mono", "IBM Plex Mono", "Geist Mono", "DM Mono"],
} as const

export const DirectionSchema = z.object({
  personality: z.string().min(20).max(1200),
  references: z.array(z.string().max(300)).min(2).max(4),
  typography: z.object({
    heading: z.enum(FONT_CHOICES.display),
    body: z.enum(FONT_CHOICES.sans),
    mono: z.enum(FONT_CHOICES.mono),
    rationale: z.string().max(800),
  }),
  density: z.enum(["compact", "comfortable", "spacious"]),
  radius: z.enum(["sharp", "soft", "round"]),
  surfaces: z.string().max(1200),
  brandUsage: z.string().max(1200),
  statusSemantics: z.string().max(1200),
  dataViz: z.string().max(1200),
  signatureDetails: z.array(z.string().max(500)).min(2).max(4),
  avoid: z.array(z.string().max(400)).min(3).max(8),
})

export type Direction = z.infer<typeof DirectionSchema>

const RADIUS = {
  sharp: { sm: "0.125rem", md: "0.25rem", lg: "0.375rem", xl: "0.5rem" },
  soft: { sm: "0.25rem", md: "0.5rem", lg: "0.75rem", xl: "1rem" },
  round: { sm: "0.375rem", md: "0.75rem", lg: "1rem", xl: "1.5rem" },
} as const

/** Applies the direction's type pairing and radius to the derived tokens. */
export function applyDirection(tokens: ThemeTokens, direction: Direction): ThemeTokens {
  return ThemeTokensSchema.parse({
    ...tokens,
    typography: {
      heading: [direction.typography.heading, "Helvetica Neue", "Arial", "sans-serif"],
      body: [direction.typography.body, "Helvetica Neue", "Arial", "sans-serif"],
      mono: [direction.typography.mono, "Menlo", "Consolas", "monospace"],
    },
    radius: RADIUS[direction.radius],
  })
}

/** Google Fonts stylesheet URL for the direction's three families. */
export function googleFontsHref(tokens: ThemeTokens) {
  const families = [...new Set([tokens.typography.heading[0], tokens.typography.body[0], tokens.typography.mono[0]])]
  const params = families.map((f) => `family=${f.replace(/ /g, "+")}:wght@400;500;600;700`).join("&")
  return `https://fonts.googleapis.com/css2?${params}&display=swap`
}

const DIRECTION_SYSTEM = `You are the design director at Tulip, a studio that ships product UI for B2B software teams. Your work sits next to Linear, Stripe, Vercel, Ramp and Mercury, and clients pay for taste: a coherent point of view that makes their product look considered rather than assembled from a component kit.

For each new client you write a short design direction that every engineer and every generated screen will follow. Be decisive and specific. "Clean and modern" says nothing; "hierarchy from weight and size, not boxes; one hairline divider per section; numbers set large in the heading face with tabular figures" is a direction.

Constraints you design within:
- Colours come only from the client's tokens: a primary scale, a secondary scale, their page background, plus neutral surfaces derived from the secondary scale. Raw hex values are forbidden in code.
- Components are shadcn/ui primitives styled with Tailwind utilities on a 4px spacing grid.
- Fonts must come from the lists given.

Reply with one \`\`\`json code block matching the requested shape, and nothing else.`

export function directionPrompt(brief: Brief, tokens: ThemeTokens, notes: string[]) {
  const { primary, secondary } = tokens.colors
  return `New client brief:
- Layout archetype: ${layoutLabel(brief.layoutType)}
- Features: ${brief.features.join(", ") || "none beyond the layout"}
- Brand colours: primary ${brief.primaryColor}, secondary ${brief.secondaryColor}, page background ${brief.backgroundColor}
- Derived primary scale (50→950): ${Object.values(primary).join(" ")}
- Derived secondary scale (50→950): ${Object.values(secondary).join(" ")}
${notes.length ? `- Colour notes: ${notes.join(" ")}` : ""}

Write the design direction as JSON with exactly these keys. Keep each prose field under about 600 characters and each list item under about 250; be specific rather than long.
{
  "personality": "2-3 sentences: who this product is for and how it should feel",
  "references": ["2-4 shipped products whose craft this should channel, with what to take from each"],
  "typography": {
    "heading": one of ${JSON.stringify(FONT_CHOICES.display)},
    "body": one of ${JSON.stringify(FONT_CHOICES.sans)},
    "mono": one of ${JSON.stringify(FONT_CHOICES.mono)},
    "rationale": "why this pairing suits the brand"
  },
  "density": "compact" | "comfortable" | "spacious",
  "radius": "sharp" | "soft" | "round",
  "surfaces": "how containers, borders, fills and shadows are used and where they are not",
  "brandUsage": "exactly where the primary colour appears and where it must not",
  "statusSemantics": "how positive, negative, warning and neutral states are expressed, including which states stay quiet",
  "dataViz": "chart and number styling",
  "signatureDetails": ["2-4 concrete details repeated across every screen that make this product recognisable"],
  "avoid": ["3-8 specific things that would make this look like a template"]
}`
}

function parseDirection(text: string) {
  try {
    return DirectionSchema.safeParse(JSON.parse(extractFenced(text, "json")))
  } catch (err) {
    return { success: false as const, error: err instanceof Error ? err.message : String(err) }
  }
}

const issues = (error: z.ZodError | string) => (typeof error === "string" ? error : z.prettifyError(error))

/** Writes the direction, sending validation errors back once before giving up. */
export async function directBrief(brief: Brief, tokens: ThemeTokens, notes: string[]): Promise<{ direction: Direction; usage: Usage }> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: directionPrompt(brief, tokens, notes) }]
  const first = await ask(DIRECTION_SYSTEM, messages, "high")
  let parsed = parseDirection(first.text)
  let usage = first.usage
  if (!parsed.success) {
    messages.push({ role: "assistant", content: first.message.content })
    messages.push({ role: "user", content: `That JSON failed validation:\n${issues(parsed.error)}\nReply with the corrected JSON in one \`\`\`json block.` })
    const second = await ask(DIRECTION_SYSTEM, messages, "high")
    usage = addUsage(usage, second.usage)
    parsed = parseDirection(second.text)
  }
  if (!parsed.success) {
    throw new GenerationError(`Design direction failed validation: ${issues(parsed.error)}`)
  }
  return { direction: parsed.data, usage }
}

/** The direction as the block prompt shows it. */
export function directionBrief(direction: Direction) {
  return `Design direction for this client (follow it exactly; it is shared by every block in their product):
- Personality: ${direction.personality}
- Channel: ${direction.references.join("; ")}
- Type: headings in ${direction.typography.heading}, body in ${direction.typography.body}, figures and code in ${direction.typography.mono}. ${direction.typography.rationale}
- Density: ${direction.density}. Corner radius: ${direction.radius}.
- Surfaces: ${direction.surfaces}
- Brand colour: ${direction.brandUsage}
- Status: ${direction.statusSemantics}
- Data: ${direction.dataViz}
- Signature details (use them): ${direction.signatureDetails.map((d) => `\n  - ${d}`).join("")}
- Avoid: ${direction.avoid.map((d) => `\n  - ${d}`).join("")}`
}
