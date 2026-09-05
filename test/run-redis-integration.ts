import { spawn } from "node:child_process";

const files = ["test/integration/cache", "test/integration/distributed"];
const command = process.execPath;
const child = spawn(command, ["test", ...files, "--timeout", "30000"], {
  cwd: process.cwd(),
  env: { ...process.env, FASTIFY_KIT_REQUIRE_REDIS: "1" },
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error("Unable to start Bun Redis integration tests:", error);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Redis integration tests terminated with signal ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
