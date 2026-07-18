import path from "node:path";
import { config } from "dotenv";
import { defineConfig } from "@prisma/config";

const envFile = process.env.NODE_ENV === "production" ? ".env.production" : ".env";
config({ path: path.resolve(process.cwd(), envFile), override: false });

if (!process.env.DIRECT_URL && process.env.DATABASE_URL) {
  process.env.DIRECT_URL = process.env.DATABASE_URL;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
});