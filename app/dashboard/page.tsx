import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { OperatorDashboard } from "@/components/operator/operator-dashboard"
import { loadDashboard } from "@/lib/dal"
import { getOperator } from "@/lib/operator"

// Server Actions run on this route; block generation continues after the
// response (next/server after()) and can take several minutes.
export const maxDuration = 800

export const metadata: Metadata = {
  title: "Operator Taste Dashboard · TulipAI Admin",
}

export default async function DashboardPage() {
  const operator = await getOperator()
  if (!operator) {
    redirect("/login")
  }

  const data = await loadDashboard()
  return <OperatorDashboard operator={operator} data={data} />
}
