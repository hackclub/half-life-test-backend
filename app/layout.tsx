import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Half-Life",
  description: "A 10-week hardware program from Hack Club.",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
