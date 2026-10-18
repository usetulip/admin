// Copied from usetulip/customer lib/token-schema.ts. Keep in sync.

import { z } from "zod";

// Strict theme tokens. Every object rejects unknown keys, colours must be
// 6-digit hex, lengths are bounded, and component overrides may only set
// `--kebab-case` variables to a literal or a reference to an existing token.

// --- Primitives ---

export const HexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Must be a 6-digit hex color, e.g. #1f2937");

const ROOT_FONT_SIZE_PX = 16;

export const LengthSchema = z
  .string()
  .regex(/^(0|\d+(\.\d+)?(px|rem))$/, "Must be 0 or a positive px/rem length");

export function lengthToPx(length: string) {
  const value = Number.parseFloat(length);
  return length.endsWith("rem") ? value * ROOT_FONT_SIZE_PX : value;
}

// --- Colour scales ---

export const COLOR_STEPS = [
  "50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950",
] as const;

export type ColorStep = (typeof COLOR_STEPS)[number];

// WCAG relative luminance, used to check that a scale runs light → dark.
function relativeLuminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const ColorScaleSchema = z
  .strictObject(
    Object.fromEntries(COLOR_STEPS.map((step) => [step, HexColorSchema])) as Record<
      ColorStep,
      typeof HexColorSchema
    >,
  )
  .superRefine((scale, ctx) => {
    for (let i = 1; i < COLOR_STEPS.length; i++) {
      const lighter = COLOR_STEPS[i - 1];
      const darker = COLOR_STEPS[i];
      if (relativeLuminance(scale[darker]) > relativeLuminance(scale[lighter])) {
        ctx.addIssue({
          code: "custom",
          path: [darker],
          message: `Step ${darker} must not be lighter than step ${lighter}`,
        });
      }
    }
  });

export const ColorTokensSchema = z.strictObject({
  primary: ColorScaleSchema,
  secondary: ColorScaleSchema,
});

// --- Typography stacks ---

export const GENERIC_FONT_FAMILIES = [
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
] as const;

const genericFamilies = new Set<string>(GENERIC_FONT_FAMILIES);

// Plain family names only: no quotes, commas or CSS syntax that could break
// out of a `font-family` declaration.
export const FontFamilyNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 \-]*$/, "Font family names may only contain letters, digits, spaces and hyphens");

// An ordered stack that must end in a generic family as the final fallback.
export const FontStackSchema = z
  .array(FontFamilyNameSchema)
  .min(2, "A stack needs at least one named font and a generic fallback")
  .max(8)
  .refine((stack) => genericFamilies.has(stack[stack.length - 1]), {
    message: `The last entry must be a generic family (${GENERIC_FONT_FAMILIES.join(", ")})`,
  })
  .refine((stack) => new Set(stack.map((f) => f.toLowerCase())).size === stack.length, {
    message: "Font stack contains duplicate families",
  });

export const TypographyTokensSchema = z.strictObject({
  heading: FontStackSchema,
  body: FontStackSchema,
  mono: FontStackSchema.refine(
    (stack) => ["monospace", "ui-monospace"].includes(stack[stack.length - 1]),
    { message: "The mono stack must fall back to monospace or ui-monospace" },
  ),
});

// --- Radius ---

export const RADIUS_STEPS = ["sm", "md", "lg", "xl"] as const;
export const RADIUS_MAX_PX = 48;

export const RadiusValueSchema = LengthSchema.refine(
  (length) => lengthToPx(length) <= RADIUS_MAX_PX,
  { message: `Radius must be at most ${RADIUS_MAX_PX}px (${RADIUS_MAX_PX / ROOT_FONT_SIZE_PX}rem)` },
);

export const RadiusTokensSchema = z
  .strictObject({
    sm: RadiusValueSchema,
    md: RadiusValueSchema,
    lg: RadiusValueSchema,
    xl: RadiusValueSchema,
  })
  .superRefine((radius, ctx) => {
    for (let i = 1; i < RADIUS_STEPS.length; i++) {
      const smaller = RADIUS_STEPS[i - 1];
      const larger = RADIUS_STEPS[i];
      if (lengthToPx(radius[larger]) < lengthToPx(radius[smaller])) {
        ctx.addIssue({
          code: "custom",
          path: [larger],
          message: `radius.${larger} must be >= radius.${smaller}`,
        });
      }
    }
  });

// --- Component-level variable overrides ---

export const COMPONENTS = [
  "button",
  "input",
  "card",
  "badge",
  "dialog",
  "navbar",
  "tooltip",
] as const;

export const CssVariableNameSchema = z
  .string()
  .regex(/^--[a-z][a-z0-9]*(-[a-z0-9]+)*$/, "Must be a --kebab-case CSS custom property");

// `{colors.primary.500}`, `{radius.md}` or `{typography.body}`.
export const TokenReferenceSchema = z
  .string()
  .regex(
    /^\{(colors\.(primary|secondary)\.\d{2,3}|radius\.[a-z]+|typography\.[a-z]+)\}$/,
    "Must reference a token, e.g. {colors.primary.500}",
  );

export const OverrideValueSchema = z.union([
  TokenReferenceSchema,
  HexColorSchema,
  LengthSchema,
]);

export const ComponentOverridesSchema = z.partialRecord(
  z.enum(COMPONENTS),
  z
    .record(CssVariableNameSchema, OverrideValueSchema)
    .refine((vars) => Object.keys(vars).length <= 32, {
      message: "At most 32 variable overrides per component",
    }),
);

// --- Theme ---

function resolveTokenPath(tokens: Record<string, unknown>, reference: string) {
  return reference
    .slice(1, -1)
    .split(".")
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === "object" && Object.hasOwn(node, key)
          ? (node as Record<string, unknown>)[key]
          : undefined,
      tokens,
    );
}

export const ThemeTokensSchema = z
  .strictObject({
    version: z.literal(1),
    colors: ColorTokensSchema,
    typography: TypographyTokensSchema,
    radius: RadiusTokensSchema,
    components: ComponentOverridesSchema.default({}),
  })
  .superRefine((theme, ctx) => {
    for (const [component, vars] of Object.entries(theme.components)) {
      for (const [name, value] of Object.entries(vars ?? {})) {
        if (value.startsWith("{") && resolveTokenPath(theme, value) === undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["components", component, name],
            message: `Unknown token reference ${value}`,
          });
        }
      }
    }
  });

// --- Types ---

export type HexColor = z.infer<typeof HexColorSchema>;
export type ColorScale = z.infer<typeof ColorScaleSchema>;
export type TypographyTokens = z.infer<typeof TypographyTokensSchema>;
export type RadiusTokens = z.infer<typeof RadiusTokensSchema>;
export type ComponentName = (typeof COMPONENTS)[number];
export type ComponentOverrides = z.infer<typeof ComponentOverridesSchema>;
export type ThemeTokensInput = z.input<typeof ThemeTokensSchema>;
export type ThemeTokens = z.output<typeof ThemeTokensSchema>;
