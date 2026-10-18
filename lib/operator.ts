import "server-only"
import { cache } from "react"
import { headers } from "next/headers"

// Operators sign in through the existing better-auth admin login, served by
// usetulip/backend under /api/admin-auth (proxied here as /api/auth). Server
// code verifies the session by forwarding the request cookies to that
// backend's get-session endpoint, then checks the admin role.

export type Operator = {
  id: string
  email: string
  name: string | null
}

type BetterAuthSession = {
  user?: { id?: string; email?: string; name?: string | null; role?: string }
} | null

export class UnauthorizedError extends Error {
  constructor() {
    super("Operator session required")
  }
}

export const getOperator = cache(async (): Promise<Operator | null> => {
  const cookie = (await headers()).get("cookie")
  if (!cookie) {
    return null
  }

  const apiUrl = process.env.API_URL ?? "http://localhost:4000"
  let session: BetterAuthSession
  try {
    const response = await fetch(`${apiUrl}/api/admin-auth/get-session`, {
      headers: { cookie },
      cache: "no-store",
    })
    if (!response.ok) {
      return null
    }
    session = (await response.json()) as BetterAuthSession
  } catch {
    return null
  }

  const user = session?.user
  if (!user?.id || !user.email || user.role !== "admin") {
    return null
  }
  return { id: user.id, email: user.email, name: user.name ?? null }
})

/** Every Server Function and data read must call this first. */
export async function requireOperator() {
  const operator = await getOperator()
  if (!operator) {
    throw new UnauthorizedError()
  }
  return operator
}
