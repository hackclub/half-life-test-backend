import "server-only"
import prisma from "@/lib/prisma"
import { THEMES } from "@/lib/config/program"

/**
 * Create the five themed project rows for a participant.
 *
 * Idempotent: `skipDuplicates` plus the `(userId, theme)` unique constraint
 * means running it again is a no-op, so it doubles as a self-heal for anyone
 * whose signup hook failed.
 */
export async function materializeThemeProjects(userId: string): Promise<number> {
  const result = await prisma.themeProject.createMany({
    data: THEMES.map((theme) => ({ userId, theme: theme.id, title: theme.label })),
    skipDuplicates: true,
  })
  return result.count
}
