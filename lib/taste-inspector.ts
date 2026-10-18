import { auditTaste, themeVariables } from "./governance"
import { COLOR_STEPS, type ThemeTokens } from "./token-schema"

// Operator-side checks layered on the MCP server's auditTaste(): every finding
// is tagged with the Taste Governance Rule it belongs to, and the dashboard
// adds padding-density, typography and WCAG contrast checks that the compiler
// does not enforce yet. Pure functions, used by both server and client code.

export type TasteRule =
  | "icon_sizing"
  | "font_hierarchy"
  | "padding_density"
  | "wcag_contrast"
  | "focus_ring"
  | "brand_tokens"

export const TASTE_RULE_LABELS: Record<TasteRule, string> = {
  icon_sizing: "Button icon sizing",
  font_hierarchy: "Font hierarchy bindings",
  padding_density: "Padding density",
  wcag_contrast: "WCAG contrast",
  focus_ring: "Focus rings",
  brand_tokens: "Brand tokens",
}

export type TasteViolation = {
  rule: TasteRule
  message: string
  line: number | null
}

function lineOf(code: string, index: number) {
  return code.slice(0, index).split("\n").length
}

function classifyGovernanceMessage(entry: string): TasteRule {
  // Classify on the message, not the "line N <TagIcon>:" prefix.
  const message = entry.replace(/^line \d+ <[^>]+>: /, "")
  if (/icon/i.test(message)) return "icon_sizing"
  if (/font-heading|font-body/.test(message)) return "font_hierarchy"
  if (/focus ring/.test(message)) return "focus_ring"
  return "brand_tokens"
}

function fromGovernance(code: string): TasteViolation[] {
  return auditTaste(code).map((entry) => {
    const match = /^line (\d+) /.exec(entry)
    return {
      rule: classifyGovernanceMessage(entry),
      message: entry.replace(/^line \d+ /, ""),
      line: match ? Number(match[1]) : null,
    }
  })
}

// --- Padding density ---

// Spacing steps generated blocks may use: the 4px grid up to 16, then the
// coarse steps. Anything else (p-7, gap-9, p-[13px]) reads as unaligned.
const SPACING_SCALE = new Set([
  "0", "px", "0.5", "1", "1.5", "2", "2.5", "3", "4", "5", "6", "8", "10", "12", "16", "20", "24",
])

// Densest padding allowed on an interactive or container element.
const MAX_PADDING_STEP = 12

const SPACING_UTILITY =
  /(?<![\w-])-?(p[xytrblse]?|m[xytrblse]?|gap(?:-[xy])?|space-[xy])-(\[[^\]\s]+\]|[\d.]+|px)(?![\w.-])/g

function spacingViolations(code: string): TasteViolation[] {
  const violations: TasteViolation[] = []
  for (const match of code.matchAll(SPACING_UTILITY)) {
    const [utility, prefix, value] = match
    const line = lineOf(code, match.index)
    if (value.startsWith("[")) {
      violations.push({
        rule: "padding_density",
        message: `${utility}: arbitrary spacing; use a step from the spacing scale`,
        line,
      })
    } else if (!SPACING_SCALE.has(value)) {
      violations.push({
        rule: "padding_density",
        message: `${utility}: off-grid spacing step ${value}`,
        line,
      })
    } else if (prefix.startsWith("p") && Number(value) > MAX_PADDING_STEP) {
      violations.push({
        rule: "padding_density",
        message: `${utility}: padding above p-${MAX_PADDING_STEP} breaks the density baseline`,
        line,
      })
    }
  }
  return violations
}

// --- Typography ---

const ARBITRARY_TYPE = /(?<![\w-])(text|leading|tracking|font)-\[([^\]\s]+)\]/g

function typographyViolations(code: string): TasteViolation[] {
  const violations: TasteViolation[] = []
  for (const match of code.matchAll(ARBITRARY_TYPE)) {
    const [utility, kind, value] = match
    // font-(family-name:--font-heading) uses parentheses, so it never matches.
    if (kind === "text" && /^(#|rgb|hsl|oklch|var\(--)/.test(value)) {
      continue // a colour, handled by brand token checks
    }
    violations.push({
      rule: "font_hierarchy",
      message: `${utility}: arbitrary ${kind} value; use the type scale and token font bindings`,
      line: lineOf(code, match.index),
    })
  }
  for (const match of code.matchAll(/(?<![\w-])font-(sans|serif|mono)(?![\w-])/g)) {
    violations.push({
      rule: "font_hierarchy",
      message: `${match[0]}: bind --font-heading/--font-body instead of a generic family`,
      line: lineOf(code, match.index),
    })
  }
  return violations
}

// --- Colour ---

// Tailwind palette utilities bypass the client's tokens (bg-blue-500 instead of bg-primary).
const PALETTE_UTILITY =
  /(?<![\w-])(bg|text|border|ring|fill|stroke|from|via|to|outline|decoration|divide|accent|caret|shadow)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(\d{2,3})(?![\w-])/g

function hexToRgb(hex: string) {
  const full =
    hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex.slice(0, 7)
  return [1, 3, 5].map((i) => Number.parseInt(full.slice(i, i + 2), 16))
}

export function relativeLuminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const c = channel / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string) {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

export type TokenMatch = {
  hex: string
  line: number
  nearest: { token: string; hex: string; distance: number }
  exact: boolean
}

function tokenSwatches(tokens: ThemeTokens) {
  const scales = (["primary", "secondary"] as const).flatMap((scale) =>
    COLOR_STEPS.map((step) => ({
      token: `${scale}.${step}`,
      hex: tokens.colors[scale][step].toLowerCase(),
    })),
  )
  // Literal hex overrides the token file defines for a component.
  const overrides = Object.entries(tokens.components).flatMap(([component, vars]) =>
    Object.entries(vars ?? {})
      .filter(([, value]) => value.startsWith("#"))
      .map(([name, value]) => ({ token: `components.${component}.${name}`, hex: value.toLowerCase() })),
  )
  // themeVariables() emits black or white as the readable foreground on --primary.
  const foregrounds = [
    { token: "foreground (black)", hex: "#000000" },
    { token: "foreground (white)", hex: "#ffffff" },
  ]
  return [...scales, ...overrides, ...foregrounds]
}

/** Every hex literal in the code, matched to the nearest brand token. */
export function matchHexToTokens(code: string, tokens: ThemeTokens): TokenMatch[] {
  const swatches = tokenSwatches(tokens)
  const matches: TokenMatch[] = []
  for (const match of code.matchAll(/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g)) {
    const hex = match[0].toLowerCase()
    const [r, g, b] = hexToRgb(hex)
    let nearest = { token: "", hex: "", distance: Number.POSITIVE_INFINITY }
    for (const swatch of swatches) {
      const [sr, sg, sb] = hexToRgb(swatch.hex)
      const distance = Math.round(Math.hypot(r - sr, g - sg, b - sb))
      if (distance < nearest.distance) {
        nearest = { ...swatch, distance }
      }
    }
    matches.push({ hex, line: lineOf(code, match.index), nearest, exact: nearest.distance === 0 })
  }
  return matches
}

function colourViolations(code: string, tokens: ThemeTokens): TasteViolation[] {
  const violations: TasteViolation[] = []
  for (const match of code.matchAll(PALETTE_UTILITY)) {
    violations.push({
      rule: "brand_tokens",
      message: `${match[0]}: Tailwind palette colour bypasses client tokens; use primary/secondary/accent utilities`,
      line: lineOf(code, match.index),
    })
  }
  for (const hex of matchHexToTokens(code, tokens)) {
    if (!hex.exact) {
      violations.push({
        rule: "brand_tokens",
        message: `${hex.hex} is not a brand token (nearest ${hex.nearest.token} ${hex.nearest.hex}, distance ${hex.nearest.distance})`,
        line: hex.line,
      })
    }
  }
  return violations
}

// --- WCAG contrast on the token pairs the generated primitives render ---

export type ContrastPair = {
  label: string
  foreground: string
  background: string
  ratio: number
  passesAA: boolean
}

export function tokenContrastPairs(tokens: ThemeTokens): ContrastPair[] {
  const vars = themeVariables(tokens, [])
  const pairs: [string, string, string][] = [
    ["Primary button", vars["--primary-foreground"], vars["--primary"]],
    ["Secondary button", vars["--secondary-foreground"], vars["--secondary"]],
    ["Accent surface", vars["--accent-foreground"], vars["--accent"]],
    ["Primary text on white", tokens.colors.primary["600"], "#ffffff"],
    ["Body text on primary-50", tokens.colors.primary["900"], tokens.colors.primary["50"]],
  ]
  return pairs.map(([label, foreground, background]) => {
    const ratio = contrastRatio(foreground, background)
    return { label, foreground, background, ratio, passesAA: ratio >= 4.5 }
  })
}

function contrastViolations(tokens: ThemeTokens): TasteViolation[] {
  return tokenContrastPairs(tokens)
    .filter((pair) => !pair.passesAA)
    .map((pair) => ({
      rule: "wcag_contrast" as const,
      message: `${pair.label}: ${pair.foreground} on ${pair.background} is ${pair.ratio.toFixed(2)}:1 (AA needs 4.5:1)`,
      line: null,
    }))
}

/** The full automated taste audit for a generated block. */
export function auditBlock(code: string, tokens: ThemeTokens): TasteViolation[] {
  return [
    ...fromGovernance(code),
    ...spacingViolations(code),
    ...typographyViolations(code),
    ...colourViolations(code, tokens),
    ...contrastViolations(tokens),
  ].sort((a, b) => (a.line ?? 0) - (b.line ?? 0))
}

/** shadcn primitives the block imports, for the inspector's binding table. */
export function usedPrimitives(code: string) {
  const names = new Set<string>()
  for (const match of code.matchAll(/from\s+["']@\/components\/ui\/([\w-]+)["']/g)) {
    names.add(match[1])
  }
  return [...names].sort()
}
