"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { authClient } from "@/lib/auth-client"

export function AdminAuthRedirect({
  children,
  redirectTo = "/dashboard",
}: {
  children: React.ReactNode
  redirectTo?: string
}) {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const { data: session, isPending } = authClient.useSession()

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted || isPending || !session) {
      return
    }

    const role =
      session.user && "role" in session.user
        ? String(session.user.role)
        : "user"

    if (role === "admin") {
      router.replace(redirectTo)
    }
  }, [mounted, isPending, session, router, redirectTo])

  if (!mounted) {
    return <>{children}</>
  }

  if (isPending) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (session) {
    const role =
      session.user && "role" in session.user
        ? String(session.user.role)
        : "user"

    if (role === "admin") {
      return (
        <div className="flex min-h-svh items-center justify-center">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      )
    }
  }

  return <>{children}</>
}
