"use client"

import { useMemo, useState } from "react"
import { ExternalLink, FileCode2, PenTool } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { themeVariables } from "@/lib/governance"
import { diffLines } from "@/lib/line-diff"
import {
  TASTE_RULE_LABELS,
  auditBlock,
  matchHexToTokens,
  tokenContrastPairs,
  usedPrimitives,
  type TasteViolation,
} from "@/lib/taste-inspector"
import type { ComponentBlock, Project } from "@/lib/types"
import { cn } from "@/lib/utils"

// --- Figma ---

function figmaEmbedUrl(url: string) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === "https:" && /^(www\.)?figma\.com$/.test(parsed.hostname)) {
      return `https://www.figma.com/embed?embed_host=tulip-admin&url=${encodeURIComponent(url)}`
    }
  } catch {
    // not a URL
  }
  return null
}

function FigmaPanel({ block, project }: { block: ComponentBlock | null; project: Project }) {
  const url = block?.figmaUrl ?? project.figmaFileUrl
  const embed = url ? figmaEmbedUrl(url) : null

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <PenTool className="size-4" aria-hidden="true" />
            Figma reference
          </CardTitle>
          {url ? (
            <Button variant="ghost" size="sm" asChild>
              <a href={url} target="_blank" rel="noreferrer noopener">
                <ExternalLink className="size-4" aria-hidden="true" />
                Open
              </a>
            </Button>
          ) : null}
        </div>
        <CardDescription>
          {block?.figmaUrl ? "Frame linked to this block" : project.figmaFileName ?? "Project design file"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {embed ? (
          <iframe
            title="Figma preview"
            src={embed}
            className="aspect-video w-full rounded-lg border bg-muted"
            allowFullScreen
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-popups"
          />
        ) : url ? (
          <div className="flex flex-col gap-2 rounded-lg border border-dashed p-6 text-sm">
            <p className="font-medium">{project.figmaFileName ?? url.split("/").pop()}</p>
            <p className="text-muted-foreground">
              Uploaded .fig files can&apos;t be rendered in the browser. Open it in Figma, then link the frame
              (figma.com URL) on the block for a live side-by-side preview.
            </p>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No Figma link yet. Add one in Deliverable links or on the block.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// --- Code views ---

function SourceView({ source, violations }: { source: string; violations: TasteViolation[] }) {
  const byLine = useMemo(() => {
    const map = new Map<number, TasteViolation[]>()
    for (const violation of violations) {
      if (violation.line) map.set(violation.line, [...(map.get(violation.line) ?? []), violation])
    }
    return map
  }, [violations])

  return (
    <ScrollArea className="h-[28rem] rounded-lg border bg-muted/30">
      <pre className="min-w-max py-2 font-mono text-xs leading-5">
        {source.split("\n").map((line, index) => {
          const hits = byLine.get(index + 1)
          return (
            <div
              key={index}
              className={cn("flex", hits && "bg-destructive/10")}
              title={hits?.map((hit) => hit.message).join("\n")}
            >
              <span className="w-10 shrink-0 pr-3 text-right text-muted-foreground select-none">{index + 1}</span>
              <span className="pr-4 whitespace-pre">{line || " "}</span>
              {hits ? (
                <span className="pr-4 text-destructive select-none">● {hits.length}</span>
              ) : null}
            </div>
          )
        })}
      </pre>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  )
}

function DiffView({ before, after }: { before: string | null; after: string }) {
  const rows = useMemo(() => diffLines(before ?? "", after), [before, after])
  if (before === null) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Nothing published yet. The diff compares this revision with the live version after the first publish.
      </p>
    )
  }
  const added = rows.filter((row) => row.kind === "added").length
  const removed = rows.filter((row) => row.kind === "removed").length

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Live (left) → this revision (right): <span className="text-emerald-700">+{added}</span>{" "}
        <span className="text-destructive">−{removed}</span>
      </p>
      <ScrollArea className="h-[28rem] rounded-lg border">
        <div className="grid min-w-max grid-cols-2 font-mono text-xs leading-5">
          {rows.map((row, index) => (
            <div key={index} className="contents">
              <div
                className={cn(
                  "flex border-r",
                  row.kind === "removed" && "bg-destructive/10",
                  row.kind === "added" && "bg-muted/40",
                )}
              >
                <span className="w-10 shrink-0 pr-3 text-right text-muted-foreground select-none">
                  {row.kind !== "added" ? row.leftNo : ""}
                </span>
                <span className="pr-4 whitespace-pre">{row.kind !== "added" ? row.left || " " : ""}</span>
              </div>
              <div
                className={cn(
                  "flex",
                  row.kind === "added" && "bg-emerald-500/10",
                  row.kind === "removed" && "bg-muted/40",
                )}
              >
                <span className="w-10 shrink-0 pr-3 text-right text-muted-foreground select-none">
                  {row.kind !== "removed" ? row.rightNo : ""}
                </span>
                <span className="pr-4 whitespace-pre">{row.kind !== "removed" ? row.right || " " : ""}</span>
              </div>
            </div>
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  )
}

function TokenInspector({ block }: { block: ComponentBlock }) {
  const tokens = block.tokens
  const hexMatches = useMemo(() => matchHexToTokens(block.source, tokens), [block.source, tokens])
  const contrast = useMemo(() => tokenContrastPairs(tokens), [tokens])
  const primitives = useMemo(() => usedPrimitives(block.source), [block.source])
  const vars = useMemo(
    () => themeVariables(tokens, ["button", "input", "card", "badge", "dialog", "navbar", "tooltip"]),
    [tokens],
  )

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h4 className="text-sm font-semibold">Primitives rendered with these tokens</h4>
        <div
          style={vars as React.CSSProperties}
          className="flex flex-col gap-4 rounded-lg border bg-background p-4 [font-family:var(--font-body)]"
        >
          <p className="text-lg font-semibold [font-family:var(--font-heading)]">Heading binds --font-heading</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Badge>Badge</Badge>
            <Input className="w-48" placeholder="Input" aria-label="Sample input" />
          </div>
          <p className="text-sm text-muted-foreground">Body copy binds --font-body.</p>
        </div>
        <p className="text-xs text-muted-foreground">
          shadcn primitives imported by this block:{" "}
          {primitives.length ? primitives.map((name) => <code key={name} className="mr-1">{name}</code>) : "none"}
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h4 className="text-sm font-semibold">Colour literals vs brand tokens</h4>
        {hexMatches.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hex literals. Colours come from CSS variables.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {hexMatches.map((match, index) => (
              <div key={index} className="flex items-center gap-3 text-sm">
                <span className="size-5 rounded border" style={{ backgroundColor: match.hex }} />
                <code className="w-20">{match.hex}</code>
                <span className="text-muted-foreground">line {match.line}</span>
                <span className="text-muted-foreground">→</span>
                <span className="size-5 rounded border" style={{ backgroundColor: match.nearest.hex }} />
                <code>{match.nearest.token}</code>
                <Badge variant={match.exact ? "secondary" : "destructive"} className="ml-auto">
                  {match.exact ? "token" : `off by ${match.nearest.distance}`}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h4 className="text-sm font-semibold">WCAG contrast (AA ≥ 4.5:1)</h4>
        <div className="grid gap-2 sm:grid-cols-2">
          {contrast.map((pair) => (
            <div key={pair.label} className="flex items-center gap-3 rounded-lg border p-2 text-sm">
              <span
                className="flex h-8 w-12 items-center justify-center rounded text-xs font-semibold"
                style={{ color: pair.foreground, backgroundColor: pair.background }}
              >
                Aa
              </span>
              <span className="flex-1">{pair.label}</span>
              <Badge variant={pair.passesAA ? "secondary" : "destructive"}>{pair.ratio.toFixed(2)}:1</Badge>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h4 className="text-sm font-semibold">CSS variables applied to the block root</h4>
        <div className="grid gap-x-6 gap-y-1 font-mono text-xs sm:grid-cols-2">
          {Object.entries(vars).map(([name, value]) => (
            <div key={name} className="flex justify-between gap-3 border-b py-1">
              <span>{name}</span>
              <span className="truncate text-muted-foreground" title={value}>{value}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

// --- Workspace ---

export function AssetViewer({
  project,
  block,
  blockPicker,
}: {
  project: Project
  block: ComponentBlock | null
  blockPicker: React.ReactNode
}) {
  const [query, setQuery] = useState("")
  const violations = useMemo(() => (block ? auditBlock(block.source, block.tokens) : []), [block])
  const filteredSource = useMemo(() => {
    if (!block || !query.trim()) return null
    return block.source
      .split("\n")
      .map((line, index) => ({ line, number: index + 1 }))
      .filter(({ line }) => line.toLowerCase().includes(query.toLowerCase()))
  }, [block, query])

  return (
    <div className="flex flex-col gap-6">
      {blockPicker}
      <div className="grid gap-6 2xl:grid-cols-2">
        <FigmaPanel block={block} project={project} />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileCode2 className="size-4" aria-hidden="true" />
              Generated React code
            </CardTitle>
            <CardDescription>
              {block
                ? `${block.archetype} · ${block.clientId} · revision ${block.sourceHash.slice(0, 8)}`
                : "Select or add a block to inspect its code"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {block ? (
              <Tabs defaultValue="source">
                <TabsList>
                  <TabsTrigger value="source">
                    Source
                    {violations.length ? <Badge variant="destructive">{violations.length}</Badge> : null}
                  </TabsTrigger>
                  <TabsTrigger value="diff">Diff vs live</TabsTrigger>
                  <TabsTrigger value="inspector">Token inspector</TabsTrigger>
                </TabsList>
                <TabsContent value="source" className="flex flex-col gap-3">
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Find in source, e.g. className or size-4"
                    aria-label="Find in source"
                  />
                  {filteredSource ? (
                    <div className="max-h-[28rem] overflow-auto rounded-lg border bg-muted/30 py-2 font-mono text-xs leading-5">
                      {filteredSource.length === 0 ? (
                        <p className="px-3 text-muted-foreground">No matches</p>
                      ) : (
                        filteredSource.map(({ line, number }) => (
                          <div key={number} className="flex">
                            <span className="w-10 shrink-0 pr-3 text-right text-muted-foreground">{number}</span>
                            <span className="whitespace-pre">{line}</span>
                          </div>
                        ))
                      )}
                    </div>
                  ) : (
                    <SourceView source={block.source} violations={violations} />
                  )}
                  {violations.length ? (
                    <ul className="flex flex-col gap-1 text-xs">
                      {violations.slice(0, 8).map((violation, index) => (
                        <li key={index} className="flex gap-2">
                          <Badge variant="outline" className="shrink-0">{TASTE_RULE_LABELS[violation.rule]}</Badge>
                          <span className="text-muted-foreground">
                            {violation.line ? `L${violation.line}: ` : ""}
                            {violation.message}
                          </span>
                        </li>
                      ))}
                      {violations.length > 8 ? (
                        <li className="text-muted-foreground">
                          …and {violations.length - 8} more. See Governance.
                        </li>
                      ) : null}
                    </ul>
                  ) : null}
                </TabsContent>
                <TabsContent value="diff">
                  <DiffView before={block.publishedSource} after={block.source} />
                </TabsContent>
                <TabsContent value="inspector">
                  <TokenInspector block={block} />
                </TabsContent>
              </Tabs>
            ) : (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                No block selected.
                {project.githubUrl ? (
                  <>
                    {" "}Repository:{" "}
                    <a className="underline" href={project.githubUrl} target="_blank" rel="noreferrer noopener">
                      {project.githubUrl}
                    </a>
                  </>
                ) : null}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
