"use client"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button, Callout, Field } from "@/app/components/ui"

type Phase = "DESIGN" | "BUILD"

interface UploadedMedia {
  objectKey: string
  contentType: string
  type: "IMAGE" | "VIDEO"
}

export function SessionForm({
  projectId,
  slug,
  defaultPhase,
}: Readonly<{ projectId: string; slug: string; defaultPhase: Phase }>) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>(defaultPhase)
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [hours, setHours] = useState("1")
  const [hoursSource, setHoursSource] = useState<"MANUAL" | "HACKATIME_TRACKED">("MANUAL")
  const [media, setMedia] = useState<UploadedMedia[]>([])
  const [timelapseUrl, setTimelapseUrl] = useState("")
  const [coveredMinutes, setCoveredMinutes] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function upload(file: File) {
    const body = new FormData()
    body.set("file", file)
    body.set("folder", "sessions")
    const res = await fetch("/api/upload", { method: "POST", body })
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
      throw new Error(payload.error?.message ?? "Upload failed")
    }
    const data = (await res.json()) as { objectKey: string }
    setMedia((current) => [
      ...current,
      {
        objectKey: data.objectKey,
        contentType: file.type,
        type: file.type.startsWith("video/") ? "VIDEO" : "IMAGE",
      },
    ])
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phase,
          title,
          content: content || undefined,
          hoursClaimed: Number(hours),
          hoursSource,
          media: media.map((m) => ({
            type: m.type,
            objectKey: m.objectKey,
            contentType: m.contentType,
          })),
          timelapses: timelapseUrl
            ? [
                {
                  playbackUrl: timelapseUrl,
                  coveredSeconds: coveredMinutes ? Number(coveredMinutes) * 60 : undefined,
                },
              ]
            : [],
        }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(payload.error?.message ?? `Failed (${res.status})`)
        return
      }
      router.push(`/dashboard/${slug}`)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="hl-stack">
      {error ? <Callout tone="danger">{error}</Callout> : null}

      <Field label="Phase">
        <select
          className="hl-select"
          value={phase}
          onChange={(e) => setPhase(e.target.value as Phase)}
        >
          <option value="DESIGN">Design</option>
          <option value="BUILD">Build</option>
        </select>
      </Field>

      <Field label="What did you do?">
        <input
          className="hl-input"
          value={title}
          maxLength={200}
          required
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>

      <Field label="Notes" hint="What you tried, what broke, what you learned.">
        <textarea
          className="hl-textarea"
          value={content}
          maxLength={20000}
          onChange={(e) => setContent(e.target.value)}
        />
      </Field>

      <Field label="Hours">
        <input
          className="hl-input"
          type="number"
          min="0"
          max="24"
          step="0.25"
          value={hours}
          required
          onChange={(e) => setHours(e.target.value)}
        />
      </Field>

      <Field
        label="Where do these hours come from?"
        hint="Pick Hackatime if this time is already tracked by a linked Hackatime project — otherwise it gets counted twice."
      >
        <select
          className="hl-select"
          value={hoursSource}
          onChange={(e) => setHoursSource(e.target.value as "MANUAL" | "HACKATIME_TRACKED")}
        >
          <option value="MANUAL">Logged by hand (counts toward your total)</option>
          <option value="HACKATIME_TRACKED">Already tracked by Hackatime (counts once, there)</option>
        </select>
      </Field>

      <Field label="Photos or video" hint="Evidence of the work. Images and short clips.">
        <input
          className="hl-input"
          type="file"
          accept="image/*,video/*"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (!file) return
            try {
              await upload(file)
            } catch (err) {
              setError(err instanceof Error ? err.message : "Upload failed")
            }
            e.target.value = ""
          }}
        />
      </Field>
      {media.length > 0 ? (
        <p className="hl-hint">{media.length} file(s) attached.</p>
      ) : null}

      <Field label="Timelapse URL" hint="Optional. A link to a timelapse of this session.">
        <input
          className="hl-input"
          value={timelapseUrl}
          placeholder="https://…"
          onChange={(e) => setTimelapseUrl(e.target.value)}
        />
      </Field>
      {timelapseUrl ? (
        <Field
          label="Minutes of real time the timelapse covers"
          hint="The wall-clock time it represents, not the length of the video."
        >
          <input
            className="hl-input"
            type="number"
            min="0"
            value={coveredMinutes}
            onChange={(e) => setCoveredMinutes(e.target.value)}
          />
        </Field>
      ) : null}

      <div>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Saving…" : "Log this session"}
        </Button>
      </div>
    </form>
  )
}
