#!/usr/bin/env node

const { execSync } = require("child_process");

// Skip entirely if no DATABASE_URL is configured
if (!process.env.DATABASE_URL) {
  console.log("DATABASE_URL not set — skipping database setup.");
  process.exit(0);
}

const env = process.env.NODE_ENV || "development";

console.log(`Setting up database for ${env} environment...`);

try {
  if (env === "development") {
    console.log("Using SQLite for development...");
    execSync("yarn dev:db:generate", { stdio: "inherit" });
    execSync("yarn dev:db:push", { stdio: "inherit" });
    console.log("✅ Development database setup complete!");
  } else {
    console.log("Using PostgreSQL for production...");
    execSync("yarn db:generate", { stdio: "inherit" });

    // Prefer migrations in production; fall back to db push if no migrations exist yet
    try {
      execSync("yarn db:migrate:prod", { stdio: "inherit" });
    } catch {
      console.log("Migration failed, falling back to db push...");
      execSync("yarn db:push", { stdio: "inherit" });
    }
    console.log("✅ Production database setup complete!");
  }
  process.exit(0);
} catch (error) {
  console.error("❌ Database setup failed:", error.message);
  process.exit(1);
}
