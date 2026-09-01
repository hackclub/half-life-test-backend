import "server-only"

const SLACK_API = "https://slack.com/api"

function token(): string | null {
  return process.env.SLACK_BOT_TOKEN ?? null
}

async function slackCall<T>(method: string, body: Record<string, unknown>): Promise<T | null> {
  const bot = token()
  if (!bot) return null
  try {
    const res = await fetch(`${SLACK_API}/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bot}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
    const data = (await res.json()) as { ok: boolean; error?: string }
    if (!data.ok) {
      console.warn(`[slack] ${method} failed: ${data.error}`)
      return null
    }
    return data as T
  } catch (err) {
    console.warn(`[slack] ${method} threw:`, err)
    return null
  }
}

export async function getSlackProfile(
  slackId: string,
): Promise<{ image: string | null; displayName: string | null } | null> {
  const bot = token()
  if (!bot) return null
  try {
    const res = await fetch(`${SLACK_API}/users.info?user=${encodeURIComponent(slackId)}`, {
      headers: { Authorization: `Bearer ${bot}` },
      signal: AbortSignal.timeout(10_000),
    })
    const data = (await res.json()) as {
      ok: boolean
      user?: { profile?: { image_512?: string; display_name?: string; real_name?: string } }
    }
    if (!data.ok || !data.user?.profile) return null
    return {
      image: data.user.profile.image_512 ?? null,
      displayName: data.user.profile.display_name || data.user.profile.real_name || null,
    }
  } catch {
    return null
  }
}

export async function postMessage(channel: string, text: string): Promise<boolean> {
  const result = await slackCall("chat.postMessage", { channel, text })
  return result !== null
}

export async function sendDM(slackId: string, text: string): Promise<boolean> {
  const opened = await slackCall<{ channel?: { id: string } }>("conversations.open", {
    users: slackId,
  })
  const channel = opened?.channel?.id
  if (!channel) return false
  return postMessage(channel, text)
}
