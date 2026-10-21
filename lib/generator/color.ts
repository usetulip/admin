import { COLOR_STEPS, type ColorScale, type ColorStep } from "@/lib/token-schema"

// Colour scale generation in OKLCH (Björn Ottosson's OKLab). Lightness is
// perceptual, so equal steps look evenly spaced across hues; chroma is reduced
// until each step fits in sRGB. Pure functions, no I/O.

type Oklch = { l: number; c: number; h: number }

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const linearToSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

export function normalizeHex(hex: string) {
  const value = hex.trim().replace(/^#?/, "#").toLowerCase()
  if (/^#[0-9a-f]{3}$/.test(value)) {
    return `#${[...value.slice(1)].map((c) => c + c).join("")}`
  }
  if (!/^#[0-9a-f]{6}$/.test(value)) {
    throw new Error(`Invalid hex colour: ${hex}`)
  }
  return value
}

function hexToLinearRgb(hex: string) {
  const full = normalizeHex(hex)
  return [1, 3, 5].map((i) => srgbToLinear(Number.parseInt(full.slice(i, i + 2), 16) / 255))
}

export function hexToOklch(hex: string): Oklch {
  const [r, g, b] = hexToLinearRgb(hex)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { l: L, c: Math.hypot(A, B), h: Math.atan2(B, A) }
}

function oklchToLinearRgb({ l: L, c, h }: Oklch) {
  const A = c * Math.cos(h)
  const B = c * Math.sin(h)
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

const inGamut = (rgb: number[]) => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4)

/** OKLCH to hex, reducing chroma (never lightness or hue) until it fits sRGB. */
export function oklchToHex(color: Oklch) {
  let rgb = oklchToLinearRgb(color)
  if (!inGamut(rgb)) {
    let lo = 0
    let hi = color.c
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      if (inGamut(oklchToLinearRgb({ ...color, c: mid }))) lo = mid
      else hi = mid
    }
    rgb = oklchToLinearRgb({ ...color, c: lo })
  }
  return `#${rgb
    .map((c) => Math.round(Math.min(1, Math.max(0, linearToSrgb(Math.min(1, Math.max(0, c))))) * 255))
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("")}`
}

export function relativeLuminance(hex: string) {
  const [r, g, b] = hexToLinearRgb(hex)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string) {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// Target OKLab lightness and share of the brand chroma per step, tuned to
// read like the Tailwind palette: pale tints at 50-200, the brand around
// 500-600, deep shades at 900-950.
const STEP_LIGHTNESS: Record<ColorStep, number> = {
  "50": 0.975, "100": 0.945, "200": 0.89, "300": 0.82, "400": 0.735, "500": 0.65,
  "600": 0.565, "700": 0.49, "800": 0.42, "900": 0.35, "950": 0.27,
}
const STEP_CHROMA: Record<ColorStep, number> = {
  "50": 0.12, "100": 0.25, "200": 0.45, "300": 0.7, "400": 0.9, "500": 1,
  "600": 1, "700": 0.92, "800": 0.8, "900": 0.68, "950": 0.55,
}

// WCAG AA for normal text against white: step 600 carries primary buttons
// and links, so it must clear 4.5:1 whichever brand hex the client picked.
const AA = 4.5

export type ScaleResult = {
  scale: ColorScale
  /** The step that holds the client's exact brand hex, or null if it could not be placed. */
  anchorStep: ColorStep | null
  /** Notes for the operator when the brand hex had to move or be adjusted. */
  notes: string[]
}

function isMonotonic(scale: ColorScale) {
  for (let i = 1; i < COLOR_STEPS.length; i++) {
    if (relativeLuminance(scale[COLOR_STEPS[i]]) > relativeLuminance(scale[COLOR_STEPS[i - 1]])) {
      return false
    }
  }
  return true
}

/**
 * Builds a light-to-dark 11-step scale around a brand hex. The exact brand
 * hex is placed on the step closest to its lightness, unless that would break
 * the scale's ordering or put a sub-AA colour on step 600.
 */
export function buildScale(brandHex: string, name: string): ScaleResult {
  const brand = normalizeHex(brandHex)
  const base = hexToOklch(brand)
  const notes: string[] = []

  const scale = Object.fromEntries(
    COLOR_STEPS.map((step) => [
      step,
      oklchToHex({ l: STEP_LIGHTNESS[step], c: base.c * STEP_CHROMA[step], h: base.h }),
    ]),
  ) as ColorScale

  // Darken 600 (and everything below it, to keep the order) until it clears AA on white.
  let l600 = STEP_LIGHTNESS["600"]
  while (contrastRatio(scale["600"], "#ffffff") < AA && l600 > 0.3) {
    l600 -= 0.01
    const shift = STEP_LIGHTNESS["600"] - l600
    for (const step of ["600", "700", "800", "900", "950"] as const) {
      scale[step] = oklchToHex({
        l: Math.max(0.12, STEP_LIGHTNESS[step] - shift),
        c: base.c * STEP_CHROMA[step],
        h: base.h,
      })
    }
  }

  // Anchor the exact brand hex on the nearest step it can legally occupy.
  const candidates = [...COLOR_STEPS].sort(
    (a, b) => Math.abs(STEP_LIGHTNESS[a] - base.l) - Math.abs(STEP_LIGHTNESS[b] - base.l),
  )
  let anchorStep: ColorStep | null = null
  for (const step of candidates.slice(0, 3)) {
    const trial = { ...scale, [step]: brand }
    const breaksAA = step === "600" && contrastRatio(brand, "#ffffff") < AA
    if (!breaksAA && isMonotonic(trial)) {
      Object.assign(scale, trial)
      anchorStep = step
      break
    }
  }

  const onWhite = contrastRatio(brand, "#ffffff")
  if (anchorStep === null) {
    notes.push(`${name} ${brand} could not sit on the scale without breaking its light-to-dark order; nearest steps were generated instead.`)
  } else if (anchorStep !== "600" && onWhite < AA) {
    notes.push(
      `${name} ${brand} is ${onWhite.toFixed(2)}:1 on white (AA needs ${AA}:1), so it sits on step ${anchorStep} and step 600 uses a darker ${scale["600"]}.`,
    )
  } else if (anchorStep !== "600" && anchorStep !== "500") {
    notes.push(`${name} ${brand} sits on step ${anchorStep} because of its lightness.`)
  }

  return { scale, anchorStep, notes }
}
