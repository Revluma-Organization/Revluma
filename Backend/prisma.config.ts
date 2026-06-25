import "dotenv/config";
import { defineConfig, env } from "@prisma/config";

// Detect if we are running a CLI command that modifies/reads the schema structure
const isCLI = process.argv.some(arg => arg.includes("prisma") || arg.includes("db") || arg.includes("migrate"));

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Uses the direct migration port for CLI tools, and the pooler for your server
    url: isCLI ? env("DIRECT_URL") : env("DATABASE_URL"),
  },
});