import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = mkdtempSync(join(tmpdir(), "fastify-kit-clean-consumer-"));
const packageDir = join(tempRoot, "consumer");

try {
  execFileSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", "build"],
    {
      cwd: root,
      stdio: "inherit",
    },
  );

  const packOutput = execFileSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", tempRoot],
    { cwd: root, encoding: "utf8" },
  );

  const packageFile = JSON.parse(packOutput)[0]?.filename;
  if (typeof packageFile !== "string") {
    throw new Error("npm pack did not return a package filename.");
  }

  mkdirSync(packageDir);
  writeFileSync(
    join(packageDir, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2),
  );
  const packageJson = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  );
  execFileSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      "--prefix",
      packageDir,
      `fastify@${packageJson.peerDependencies.fastify}`,
      `@sinclair/typebox@${packageJson.peerDependencies["@sinclair/typebox"]}`,
      join(tempRoot, packageFile),
    ],
    { cwd: root, stdio: "inherit" },
  );

  const installedScriptsDir = join(
    packageDir,
    "node_modules/@neunoro/fastify-kit/dist/cache/redis/scripts",
  );
  for (const script of [
    "release-lock.lua",
    "set-while-holding-lock.lua",
    "delete-while-holding-lock.lua",
    "delete-if-unchanged.lua",
    "set-version-monotonically.lua",
  ]) {
    if (!existsSync(join(installedScriptsDir, script))) {
      throw new Error(`Published package is missing ${script}.`);
    }
  }

  const smoke = `
    import { FastifyKit, Module } from "@neunoro/fastify-kit";

    class SmokeModule {}
    const metadata = {};
    Object.defineProperty(SmokeModule, Symbol.metadata, { value: metadata });
    Module({})(SmokeModule, { kind: "class", metadata });

    for (const optional of ["ioredis", "bullmq", "mediasoup"]) {
      try {
        await import(optional);
        throw new Error(optional + " was unexpectedly installed");
      } catch (error) {
        if (error instanceof Error && !String(error.message).includes("Cannot find package")) throw error;
      }
    }

    const app = await FastifyKit.create({ module: SmokeModule, fastifyOptions: { logger: false } });
    await app.ready();
    await app.close();
  `;
  const hiddenScriptsDir = `${installedScriptsDir}.hidden`;
  renameSync(installedScriptsDir, hiddenScriptsDir);
  try {
    execFileSync(process.execPath, ["--input-type=module", "-e", smoke], {
      cwd: packageDir,
      stdio: "inherit",
    });
  } finally {
    renameSync(hiddenScriptsDir, installedScriptsDir);
  }
  console.log("Clean consumer smoke test passed without optional peers.");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
