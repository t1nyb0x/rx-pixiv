import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";

const probeDirectory = "src/core";
const probePath = `${probeDirectory}/.architecture-lint-probe.ts`;
const createdDirectory = !existsSync(probeDirectory);
mkdirSync(probeDirectory, { recursive: true });
writeFileSync(probePath, readFileSync("tests/fixtures/lint/project/src/core/violation.ts", "utf8"));

const result = spawnSync(
  process.execPath,
  ["node_modules/oxlint/bin/oxlint", "-c", "oxlint.json", probePath],
  {
    encoding: "utf8",
  },
);

unlinkSync(probePath);
if (createdDirectory) rmdirSync(probeDirectory);

const output = `${result.stdout}${result.stderr}`;
if (result.status === 0 || !output.includes("no-restricted-imports")) {
  process.stderr.write("Expected the core layer import fixture to fail no-restricted-imports.\n");
  process.stderr.write(output);
  process.exit(1);
}

process.stdout.write("Architecture import guard verified.\n");
