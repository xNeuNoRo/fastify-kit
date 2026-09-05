import { cpSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

cpSync(
  resolve(root, "src/cache/redis/scripts"),
  resolve(root, "dist/cache/redis/scripts"),
  { recursive: true },
);
