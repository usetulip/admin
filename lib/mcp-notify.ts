import "server-only"
import { createHmac } from "node:crypto"

// Optional "push" half of publishing. Supabase is the source of truth: the MCP
// server (mcp.usetulip.co) serves tulip://tokens/{client_id} from
// client_token_sets and approved blocks from component_blocks, so a publish
// is live once its transaction commits. When MCP_PUBLISH_WEBHOOK_URL is set we
// also POST a signed notice so the server can drop any cached copy at once.
//
//   POST $MCP_PUBLISH_WEBHOOK_URL
//   x-tulip-signature: sha256=<hex HMAC-SHA256 of the raw body, key MCP_PUBLISH_WEBHOOK_SECRET>
//   { "event": "block.published", "client_id", "block_id", "version", "hash", "published_at" }

export type PublishNotice = {
  event: "block.published"
  client_id: string
  block_id: string
  version: number
  hash: string
  published_at: string
}

export type NotifyResult =
  | { status: "skipped"; reason: string }
  | { status: "delivered"; httpStatus: number }
  | { status: "failed"; reason: string }

export async function notifyMcpServer(notice: PublishNotice): Promise<NotifyResult> {
  const url = process.env.MCP_PUBLISH_WEBHOOK_URL
  const secret = process.env.MCP_PUBLISH_WEBHOOK_SECRET
  if (!url) {
    return { status: "skipped", reason: "MCP_PUBLISH_WEBHOOK_URL not set; MCP reads Supabase directly" }
  }
  if (!secret) {
    return { status: "failed", reason: "MCP_PUBLISH_WEBHOOK_SECRET is required with MCP_PUBLISH_WEBHOOK_URL" }
  }
  if (!url.startsWith("https://") && process.env.NODE_ENV === "production") {
    return { status: "failed", reason: "MCP_PUBLISH_WEBHOOK_URL must be https in production" }
  }

  const body = JSON.stringify(notice)
  const signature = createHmac("sha256", secret).update(body).digest("hex")
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-tulip-signature": `sha256=${signature}`,
      },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    })
    return response.ok
      ? { status: "delivered", httpStatus: response.status }
      : { status: "failed", reason: `HTTP ${response.status}` }
  } catch (err) {
    return { status: "failed", reason: err instanceof Error ? err.message : "Request failed" }
  }
}
