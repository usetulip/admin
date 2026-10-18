"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import type { ActionResult } from "@/lib/types"

/** Runs a Server Action, toasts the outcome and refreshes the server render. */
export function useAction() {
  const router = useRouter()
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function run<T>(
    key: string,
    action: () => Promise<ActionResult<T>>,
    options: { success?: string; onSuccess?: (result: ActionResult<T> & { ok: true }) => void } = {},
  ) {
    setPendingKey(key)
    startTransition(async () => {
      try {
        const result = await action()
        if (result.ok) {
          if (options.success) toast.success(options.success)
          options.onSuccess?.(result)
          router.refresh()
        } else {
          toast.error(result.error)
        }
      } catch {
        toast.error("Request failed. Check your connection and try again.")
      } finally {
        setPendingKey(null)
      }
    })
  }

  return {
    run,
    isPending: (key?: string) => isPending && (key === undefined || pendingKey === key),
  }
}
