"use client"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button, Callout, Field } from "@/app/components/ui"

export function ProjectMetaForm({
  projectId,
  initial,
  disabled,
}: Readonly<{
  projectId: string
  initial: { title: string; description: string; githubRepo: string }
  disabled?: boolean
}>) {
  const router = useRouter()
  const [form, setForm] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          githubRepo: form.githubRepo.trim() === "" ? null : form.githubRepo.trim(),
        }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(payload.error?.message ?? `Save failed (${res.status})`)
        return
      }
      setSaved(true)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="hl-stack hl-stack--tight">
      {error ? <Callout tone="danger">{error}</Callout> : null}
      {saved ? <Callout>Saved.</Callout> : null}
      <Field label="Title">
        <input
          className="hl-input"
          value={form.title}
          maxLength={120}
          disabled={disabled}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
      </Field>
      <Field label="Description" hint="What you are making, and why.">
        <textarea
          className="hl-textarea"
          value={form.description}
          maxLength={4000}
          disabled={disabled}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </Field>
      <Field label="Repository URL" hint="Where the design files and code live.">
        <input
          className="hl-input"
          value={form.githubRepo}
          placeholder="https://github.com/you/project"
          disabled={disabled}
          onChange={(e) => setForm({ ...form, githubRepo: e.target.value })}
        />
      </Field>
      <div>
        <Button type="submit" variant="primary" disabled={busy || disabled}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
      {disabled ? (
        <p className="hl-hint">Locked while a phase is in review. Unsubmit to edit.</p>
      ) : null}
    </form>
  )
}
