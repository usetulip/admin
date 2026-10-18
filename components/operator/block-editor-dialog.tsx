"use client"

import { useState } from "react"
import { Pencil, Plus } from "lucide-react"
import { createBlock, updateBlock } from "@/app/dashboard/actions"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { ComponentBlock, Project } from "@/lib/types"
import { useAction } from "./use-action"

const ARCHETYPES = [
  "saas-dashboard",
  "form-wizard",
  "settings-hub",
  "data-analytics",
  "feed-social",
  "button",
  "card",
  "dialog",
  "navbar",
]

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
}

/** Register a generated block for review, or save a new revision of one. */
export function BlockEditorDialog({
  project,
  block,
  defaultTokensJson,
  onCreated,
}: {
  project: Project
  block?: ComponentBlock
  defaultTokensJson: string
  onCreated?: (id: string) => void
}) {
  const editing = Boolean(block)
  const [open, setOpen] = useState(false)
  const { run, isPending } = useAction()
  const initial = () => ({
    name: block?.name ?? "",
    clientId: block?.clientId ?? slugify(project.userEmail?.split("@")[1]?.split(".")[0] ?? ""),
    archetype: block?.archetype ?? project.layoutType,
    figmaUrl: block?.figmaUrl ?? (project.figmaFileUrl?.includes("figma.com") ? project.figmaFileUrl : ""),
    source: block?.source ?? "",
    tokensJson: block ? JSON.stringify(block.tokens, null, 2) : defaultTokensJson,
  })
  const [form, setForm] = useState(initial)

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const figmaUrl = form.figmaUrl.trim() || null
    if (block) {
      run(
        "save-block",
        () => updateBlock({ blockId: block.id, source: form.source, tokensJson: form.tokensJson, figmaUrl }),
        { success: "Revision saved and re-audited", onSuccess: () => setOpen(false) },
      )
    } else {
      run(
        "save-block",
        () =>
          createBlock({
            projectId: project.id,
            clientId: form.clientId,
            name: form.name,
            archetype: form.archetype,
            source: form.source,
            tokensJson: form.tokensJson,
            figmaUrl,
          }),
        {
          success: "Block registered for review",
          onSuccess: (result) => {
            setOpen(false)
            onCreated?.(result.data.id)
          },
        },
      )
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setForm(initial())
        setOpen(next)
      }}
    >
      <DialogTrigger asChild>
        <Button variant={editing ? "outline" : "default"} size="sm">
          {editing ? <Pencil className="size-4" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
          {editing ? "New revision" : "Add block"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{editing ? `New revision of ${block?.name}` : "Register a generated block"}</DialogTitle>
            <DialogDescription>
              Paste the React output of compile_component (or a hand-built block) and the client tokens it
              was themed with. Saving runs the automated taste audit and resets manual review.
            </DialogDescription>
          </DialogHeader>
          {!editing ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="block-name">Name</Label>
                <Input
                  id="block-name"
                  required
                  maxLength={120}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Billing overview"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="block-client">Client ID</Label>
                <Input
                  id="block-client"
                  required
                  pattern="[a-z0-9][a-z0-9\-]{0,62}"
                  value={form.clientId}
                  onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                  placeholder="acme-corp"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="block-archetype">Archetype</Label>
                <Input
                  id="block-archetype"
                  required
                  list="block-archetypes"
                  pattern="[a-z0-9][a-z0-9\-]{0,62}"
                  value={form.archetype}
                  onChange={(e) => setForm({ ...form, archetype: e.target.value })}
                />
                <datalist id="block-archetypes">
                  {ARCHETYPES.map((archetype) => (
                    <option key={archetype} value={archetype} />
                  ))}
                </datalist>
              </div>
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor="block-figma">Figma frame URL (optional)</Label>
            <Input
              id="block-figma"
              type="url"
              value={form.figmaUrl}
              onChange={(e) => setForm({ ...form, figmaUrl: e.target.value })}
              placeholder="https://www.figma.com/design/…?node-id=…"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="block-source">React source</Label>
            <Textarea
              id="block-source"
              required
              spellCheck={false}
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
              className="max-h-80 min-h-48 font-mono text-xs"
              placeholder={'import { Button } from "@/components/ui/button"\n…'}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="block-tokens">Theme tokens (ThemeTokensSchema JSON)</Label>
            <Textarea
              id="block-tokens"
              required
              spellCheck={false}
              value={form.tokensJson}
              onChange={(e) => setForm({ ...form, tokensJson: e.target.value })}
              className="max-h-80 min-h-32 font-mono text-xs"
              placeholder='{ "version": 1, "colors": { … }, "typography": { … }, "radius": { … } }'
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending("save-block")}>
              {isPending("save-block") ? "Saving…" : editing ? "Save revision" : "Register block"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
