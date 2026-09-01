import Link from "next/link"

export default function NotFound() {
  return (
    <main className="hl-shell hl-stack">
      <h1>Not found</h1>
      <p className="hl-muted">That page does not exist, or you cannot see it.</p>
      <p>
        <Link href="/">Back to the start</Link>
      </p>
    </main>
  )
}
