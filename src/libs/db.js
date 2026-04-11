// Null-safe Prisma client singleton.
// Returns null when DATABASE_URL is not set — all callers must null-check before use.

let _prisma = null;

function getDb() {
  if (!process.env.DATABASE_URL) return null;
  if (!_prisma) {
    const { PrismaClient } = require("@prisma/client");
    _prisma = new PrismaClient({ log: ["error", "warn"] });
  }
  return _prisma;
}

module.exports = { getDb };
