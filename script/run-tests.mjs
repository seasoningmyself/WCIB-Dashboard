import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

function findTests(directory) {
  const tests = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      tests.push(...findTests(path));
    } else if (/\.test\.tsx?$/.test(entry.name)) {
      tests.push(path);
    }
  }

  return tests;
}

const testFiles = ["server", "shared", "client"]
  .filter(existsSync)
  .flatMap(findTests)
  .sort();

if (testFiles.length === 0) {
  console.error("No backend test files were found");
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", ...testFiles],
  { stdio: "inherit" },
);

process.exit(result.status ?? 1);
