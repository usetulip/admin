import { readFileSync } from "node:fs"
import path from "node:path"
import type Anthropic from "@anthropic-ai/sdk"

// The taste bar. These are screens the founder approved, shown to Claude
// before every design direction and every block so it has something concrete
// to reach for. Words alone produced safe, sparse screens; showing the bar did
// not. To raise the bar, add an image here and say what to learn from it.
// Next must trace these files: see outputFileTracingIncludes in next.config.ts.

const DIR = path.join(process.cwd(), "lib/generator/references")

export const REFERENCES = [
  {
    file: "ember-overview.jpg",
    title: "Finance overview",
    learn:
      "A concept you can name in a sentence: a dark ink rail beside a bright workspace. An editorial serif greeting with one italic word in the accent. Monospace figures with a quieter currency sign. Every number carries a comparison. Overdue is split by age. One physical object, the stacked payment cards, gives the screen a soul. One accent, plus one tiny spark of a second colour. The current month is the only saturated bar.",
  },
  {
    file: "editorial-analytics.jpg",
    title: "Editorial analytics",
    learn:
      "It reads like an analyst's notebook. Stats sit in the open, split by hairlines, with no cards. The chart is annotated with what happened ('Checkout outage, 41 min'). Direct labels replace a legend. Segments are ranked, with rows of data and small bars. The page is full of real information, and the brand colour is used with great restraint. Do not copy the yellow bar through the date text: decoration never crosses text.",
  },
  {
    file: "orders-range.jpg",
    title: "Date range in context",
    learn:
      "A small control shown doing its job inside a real slice of product: choosing a range drives the numbers and the chart below, and the selected period is drawn as a shaded band. The chart has an opinion, with one annotated peak. Do not copy the missing side margins or the clipped label at the right edge.",
  },
] as const

let blocks: Anthropic.Beta.BetaContentBlockParam[] | undefined

/** The reference images with their notes, ready to open a user turn. Cached by the API. */
export function referenceBlocks(): Anthropic.Beta.BetaContentBlockParam[] {
  if (blocks) return blocks
  const built: Anthropic.Beta.BetaContentBlockParam[] = [
    {
      type: "text",
      text: "These screens are the quality bar for everything Tulip ships. Match their level of conviction, density and finish. Do not copy their colours, fonts, layout or content; this client gets its own idea.",
    },
  ]
  REFERENCES.forEach((reference, index) => {
    built.push({ type: "text", text: `Reference ${index + 1}, ${reference.title}. What to learn: ${reference.learn}` })
    built.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: readFileSync(path.join(DIR, reference.file)).toString("base64"),
      },
      ...(index === REFERENCES.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
    })
  })
  blocks = built
  return built
}
