#!/usr/bin/env node
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const force = args.includes("--force");
const positional = args.filter((arg) => arg !== "--force");
const outputPath = resolve(positional[0] ?? "launch-evidence.local.json");

if (existsSync(outputPath) && !force) {
  console.error(`${outputPath} already exists. Pass --force to overwrite it.`);
  process.exit(1);
}

const template = {
  _schema: "sui402.launch-evidence.v1",
  _instructions: [
    "Fill every launch evidence field with a concrete reference before setting SUI402_LAUNCH_EVIDENCE_FILE to this path.",
    "Accepted references include report URLs, ticket IDs, dated memos, file paths, dashboard links, alert-policy IDs, or sha256 digests.",
    "Placeholders such as true, done, todo, pending, example, or sample intentionally fail npm run launch:check."
  ],
  externalAudit: "",
  legalReview: "",
  onCall: "",
  kms: "",
  monitoring: ""
};

writeFileSync(outputPath, `${JSON.stringify(template, null, 2)}\n`, { encoding: "utf8", flag: "w" });
console.log(`Wrote launch evidence template: ${outputPath}`);
console.log("Next:");
console.log(`  1. Fill ${outputPath} with real evidence references.`);
console.log(`  2. Set SUI402_LAUNCH_EVIDENCE_FILE=${outputPath}`);
console.log("  3. Run SUI402_SERIOUS_LAUNCH=true npm run launch:check");
