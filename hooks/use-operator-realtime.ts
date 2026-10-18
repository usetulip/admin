"use client"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"

// Listens on the public `operator-queue` Realtime topic. The database trigger
// (notify_operator_queue) broadcasts only { table, op }, never row data, so
// the anon key is enough; on each event we refetch through the operator's
// authenticated server render.

export type RealtimeStatus = "connecting" | "live" | "offline" | "disabled"

const REFRESH_DEBOUNCE_MS = 400

let browserClient: SupabaseClient | null = null

function getBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    return null
  }
  browserClient ??= createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return browserClient
}

export function useOperatorRealtime() {
  const router = useRouter()
  const [status, setStatus] = useState<RealtimeStatus>(() =>
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      ? "connecting"
      : "disabled",
  )
  const [lastEventAt, setLastEventAt] = useState<Date | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const supabase = getBrowserClient()
    if (!supabase) {
      return
    }

    const channel = supabase
      .channel("operator-queue", { config: { private: false } })
      .on("broadcast", { event: "changed" }, () => {
        setLastEventAt(new Date())
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => router.refresh(), REFRESH_DEBOUNCE_MS)
      })
      .subscribe((state) => {
        if (state === "SUBSCRIBED") {
          setStatus("live")
          // Catch anything that changed while we were disconnected.
          router.refresh()
        } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") {
          setStatus("offline")
        }
      })

    return () => {
      if (timer.current) clearTimeout(timer.current)
      supabase.removeChannel(channel)
    }
  }, [router])

  return { status, lastEventAt }
}
