// Copied from usetulip/customer mcp-server/src/governance.ts (PR usetulip/customer#2)
// so the dashboard audits with exactly the rules compile_component enforces.
// Keep the two in sync until they move to a shared package.

import type { ThemeTokens } from "./token-schema";

// Taste governance. Templates must build markup from these constants, and
// `auditTaste` re-checks the emitted code so a template can't drift from them.

/** Mandatory WCAG focus indicator for every interactive element. */
export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Icon sizes: size-4 inside default/sm/icon buttons, size-5 inside lg buttons and nav items. */
export const ICON_SIZE = {
  default: "size-4",
  lg: "size-5",
} as const;

/** Font bindings to the client's typography stacks (Tailwind v4 CSS-variable syntax). */
export const FONT_HEADING = "font-(family-name:--font-heading)";
export const FONT_BODY = "font-(family-name:--font-body)";

export const GOVERNANCE_RULES = [
  `Icons inside buttons use ${ICON_SIZE.default} (${ICON_SIZE.lg} for size="lg" buttons and navigation items) and are aria-hidden`,
  `Headings bind --font-heading (${FONT_HEADING}); the component root binds --font-body (${FONT_BODY})`,
  `Every interactive element carries a visible focus ring (ring-2 ring-primary via focus-visible)`,
  "Colours come from client tokens via CSS variables; no raw hex values in class names",
] as const;

// --- Theme variables ---

function relativeLuminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Pick black or white text, whichever has the higher WCAG contrast.
function readableForeground(hex: string) {
  const l = relativeLuminance(hex);
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? "#000000" : "#ffffff";
}

function fontStackCss(stack: string[]) {
  const generic = stack[stack.length - 1];
  return [...stack.slice(0, -1).map((family) => `"${family}"`), generic].join(", ");
}

function resolveTokenValue(tokens: ThemeTokens, value: string) {
  if (!value.startsWith("{")) {
    return value;
  }
  const resolved = value
    .slice(1, -1)
    .split(".")
    .reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], tokens);
  return Array.isArray(resolved) ? fontStackCss(resolved) : String(resolved);
}

export type TokenComponent = keyof ThemeTokens["components"];

/**
 * CSS variables applied on the generated component's root element. They map
 * the client's tokens onto the shadcn variables (`--primary`, `--ring`, ...)
 * and add the component-level overrides the token file defines.
 */
export function themeVariables(tokens: ThemeTokens, components: TokenComponent[]) {
  const { primary, secondary } = tokens.colors;
  const vars: Record<string, string> = {
    "--primary": primary["600"],
    "--primary-foreground": readableForeground(primary["600"]),
    "--secondary": secondary["100"],
    "--secondary-foreground": secondary["900"],
    "--accent": secondary["50"],
    "--accent-foreground": secondary["900"],
    "--ring": primary["500"],
    "--radius": tokens.radius.md,
    "--font-heading": fontStackCss(tokens.typography.heading),
    "--font-body": fontStackCss(tokens.typography.body),
    "--font-mono": fontStackCss(tokens.typography.mono),
  };

  for (const component of components) {
    for (const [name, value] of Object.entries(tokens.components[component] ?? {})) {
      vars[name] = resolveTokenValue(tokens, value);
    }
  }
  return vars;
}

// --- Audit ---

type JsxTag = { name: string; source: string; index: number };

// Collect JSX opening tags, skipping `>` inside `{...}` expressions and strings.
function jsxOpeningTags(code: string): JsxTag[] {
  const tags: JsxTag[] = [];
  const opener = /<([A-Za-z][\w.]*)[\s/>]/g;
  let match: RegExpExecArray | null;

  while ((match = opener.exec(code))) {
    const start = match.index;
    let depth = 0;
    let quote: string | null = null;
    let end = -1;

    for (let i = start + 1; i < code.length; i++) {
      const ch = code[i];
      if (quote) {
        if (ch === quote && code[i - 1] !== "\\") quote = null;
      } else if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
      } else if (ch === ">" && depth === 0) {
        end = i;
        break;
      }
    }

    if (end !== -1) {
      tags.push({ name: match[1], source: code.slice(start, end + 1), index: start });
    }
  }
  return tags;
}

function classNameOf(tag: string) {
  return /className=(?:"([^"]*)"|\{[^}]*?"([^"]*)"[^}]*\})/.exec(tag)?.slice(1).join(" ") ?? "";
}

function lineOf(code: string, index: number) {
  return code.slice(0, index).split("\n").length;
}

const INTERACTIVE_TAGS = new Set(["Button", "button", "Input", "input", "a", "textarea", "select"]);
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "CardTitle", "DialogTitle"]);

export function auditTaste(code: string) {
  const violations: string[] = [];
  const tags = jsxOpeningTags(code);

  for (const tag of tags) {
    const classes = classNameOf(tag.source);
    const at = `line ${lineOf(code, tag.index)} <${tag.name}>`;

    if (INTERACTIVE_TAGS.has(tag.name)) {
      if (!classes.includes("focus-visible:ring-2") || !classes.includes("focus-visible:ring-primary")) {
        violations.push(`${at}: interactive element is missing the ring-2 ring-primary focus ring`);
      }
    }

    if (/Icon$/.test(tag.name)) {
      if (!/(^|\s)size-[45](\s|$)/.test(classes)) {
        violations.push(`${at}: icon must be size-4 or size-5`);
      }
      if (!tag.source.includes('aria-hidden="true"')) {
        violations.push(`${at}: decorative icon must be aria-hidden`);
      }
    }

    if (HEADING_TAGS.has(tag.name) && !classes.includes(FONT_HEADING)) {
      violations.push(`${at}: heading must bind --font-heading`);
    }

    if (/#[0-9a-fA-F]{3,8}\b/.test(classes)) {
      violations.push(`${at}: raw hex colour in className; use token variables`);
    }
  }

  // Icons in large buttons step up to size-5.
  const lgButton = /<Button\b[^>]*size="lg"[^>]*>\s*(?:\{[^}]*\}\s*)?<(\w+Icon)\b[^>]*className="([^"]*)"/g;
  let lg: RegExpExecArray | null;
  while ((lg = lgButton.exec(code))) {
    if (!lg[2].split(/\s+/).includes(ICON_SIZE.lg)) {
      violations.push(`line ${lineOf(code, lg.index)} <${lg[1]}>: icons in size="lg" buttons must be ${ICON_SIZE.lg}`);
    }
  }

  if (!code.includes(FONT_BODY)) {
    violations.push("component root must bind --font-body");
  }

  return violations;
}
