"use client"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button, Callout, Field } from "@/app/components/ui"

export function HackatimeLinkForm({
  projectId,
  linked,
}: Readonly<{ projectId: string; linked: boolean }>) {
  const router = useRouter()
  const [name, setName] = useState("")
  const [phase, setPhase] = useState<"DESIGN" | "BUILD">("BUILD")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!linked) {
    return (
      <p className="hl-hint">
        Link your Hackatime account from the sign-in page to pull firmware and code hours in
        automatically.
      </p>
    )
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/hackatime`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hackatimeProject: name, phase }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(payload.error?.message ?? `Failed (${res.status})`)
        return
      }
      setName("")
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="hl-stack hl-stack--tight">
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <Field label="Hackatime project name">
        <input
          className="hl-input"
          value={name}
          required
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Counts toward">
        <select
          className="hl-select"
          value={phase}
          onChange={(e) => setPhase(e.target.value as "DESIGN" | "BUILD")}
        >
          <option value="BUILD">Build</option>
          <option value="DESIGN">Design</option>
        </select>
      </Field>
      <div>
        <Button type="submit" disabled={busy || !name}>
          {busy ? "Linking…" : "Link project"}
        </Button>
      </div>
    </form>
  )
}
