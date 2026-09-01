"use client"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button, Callout } from "@/app/components/ui"

interface ApiError {
  error?: { message?: string }
}

/**
 * One button that POSTs a JSON body and refreshes the server components on the
 * page. Client components here own interaction only — the data on screen came
 * from the server, so a refresh is the whole update path.
 */
export function ActionButton({
  url,
  method = "POST",
  body,
  label,
  pendingLabel,
  variant = "default",
  confirm,
  disabled,
  onDone,
}: Readonly<{
  url: string
  method?: "POST" | "PATCH" | "DELETE"
  body?: unknown
  label: string
  pendingLabel?: string
  variant?: "default" | "primary" | "danger"
  confirm?: string
  disabled?: boolean
  onDone?: () => void
}>) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (confirm && !window.confirm(confirm)) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as ApiError
        setError(payload.error?.message ?? `Request failed (${res.status})`)
        return
      }
      onDone?.()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="hl-stack hl-stack--tight">
      <Button variant={variant} disabled={busy || disabled} onClick={submit}>
        {busy ? (pendingLabel ?? "Working…") : label}
      </Button>
      {error ? <Callout tone="danger">{error}</Callout> : null}
    </span>
  )
}
