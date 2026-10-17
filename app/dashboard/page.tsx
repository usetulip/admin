"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { AdminDashboard } from "@/components/admin-dashboard"
import { authClient } from "@/lib/auth-client"

export default function AdminDashboardPage() {
  const router = useRouter()
  const { data: session, isPending } = authClient.useSession()

  useEffect(() => {
    if (isPending) {
      return
    }

    if (!session) {
      router.replace("/login")
      return
    }

    const role =
      session.user && "role" in session.user
        ? String(session.user.role)
        : "user"

    if (role !== "admin") {
      authClient.signOut().finally(() => {
        router.replace("/login")
      })
    }
  }, [isPending, session, router])

  if (isPending) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <p className="text-muted-foreground">Loading admin session...</p>
      </div>
    )
  }

  if (!session) {
    return null
  }

  const role =
    session.user && "role" in session.user
      ? String(session.user.role)
      : "user"

  if (role !== "admin") {
    return null
  }

  return <AdminDashboard />
}
