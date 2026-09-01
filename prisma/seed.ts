import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../app/generated/prisma/client"
import { ShopItemCategory } from "../app/generated/prisma/enums"

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
})

/**
 * Idempotent: `./dev.sh` runs it on every start, and it is safe to run against
 * production to add newly defined shop items.
 */
async function main() {
  const startDate = process.env.PROGRAM_START_DATE ?? "2026-09-07"

  const settings = await prisma.programSettings.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      eventStartDate: new Date(`${startDate}T00:00:00.000Z`),
      programTimezone: process.env.PROGRAM_TIMEZONE ?? "America/New_York",
    },
    // Never clobber settings an admin has already changed.
    update: {},
  })
  console.log(`program settings: start ${settings.eventStartDate.toISOString().slice(0, 10)}`)

  const items = [
    {
      id: "printer-enclosure",
      name: "Printer enclosure",
      description: "Keeps the heat in and the noise down. Fits the stock frame.",
      priceCredits: 120,
      category: ShopItemCategory.PRINTER_UPGRADE,
      sortOrder: 10,
    },
    {
      id: "hardened-nozzle",
      name: "Hardened steel nozzle",
      description: "For abrasive filaments — carbon fibre, glow-in-the-dark, wood fill.",
      priceCredits: 40,
      category: ShopItemCategory.PRINTER_UPGRADE,
      sortOrder: 20,
    },
    {
      id: "filament-bundle",
      name: "Filament bundle",
      description: "Three 1kg spools in colours of your choosing.",
      priceCredits: 60,
      maxPerUser: 3,
      category: ShopItemCategory.CONSUMABLE,
      sortOrder: 30,
    },
    {
      id: "build-plate",
      name: "Textured PEI build plate",
      description: "A spare plate so a failed print does not stop the next one.",
      priceCredits: 35,
      category: ShopItemCategory.PRINTER_UPGRADE,
      sortOrder: 40,
    },
  ]

  for (const item of items) {
    await prisma.shopItem.upsert({
      where: { id: item.id },
      create: item,
      // Price and stock are edited from the admin UI; do not overwrite them.
      update: { name: item.name, description: item.description, sortOrder: item.sortOrder },
    })
  }
  console.log(`shop items: ${items.length} present`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
