import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const scanRoots = ["apps", "packages", "docs", ".env.production.example", ".env.testnet-rehearsal.example"];
const ignoredSegments = new Set(["node_modules", ".git", ".playwright-cli", "test"]);
const allowedExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".md", ".html", ".css", ".env", ".example", ".txt"]);

const forbidden = [
  {
    name: "publisher status query-token URL",
    pattern: /\/v1\/publisher\/apis\/[^"'\s`]+\/status\?token=/i
  },
  {
    name: "publisher probe query-token URL",
    pattern: /\/v1\/publisher\/apis\/[^"'\s`]+\/probe\?token=/i
  },
  {
    name: "concrete publisher bearer token in command",
    pattern: /x-sui402-publisher-token:\s*sui402[vp]_/i
  },
  {
    name: "query-token compatibility guidance",
    pattern: /query tokens? (remain|are still|accepted)|\?token=.*backwards compatibility/i
  }
];

const findings = [];

for (const entry of scanRoots) {
  const absolute = join(root, entry);
  try {
    scanPath(absolute);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

if (findings.length > 0) {
  console.error("Publisher token leak guard failed:");
  for (const finding of findings) {
    console.error(`- ${finding.rule}: ${finding.file}:${finding.line}`);
    console.error(`  ${finding.text.trim()}`);
  }
  process.exit(1);
}

console.log("Publisher token leak guard passed.");

function scanPath(path) {
  const stats = statSync(path);
  if (stats.isDirectory()) {
    const name = path.split(/[\\/]/).at(-1);
    if (ignoredSegments.has(name)) {
      return;
    }
    for (const child of readdirSync(path)) {
      scanPath(join(path, child));
    }
    return;
  }

  if (!shouldScanFile(path)) {
    return;
  }

  const content = readFileSync(path, "utf8");
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const rule of forbidden) {
      if (rule.pattern.test(line)) {
        findings.push({
          rule: rule.name,
          file: relative(root, path).replaceAll("\\", "/"),
          line: index + 1,
          text: line
        });
      }
    }
  }
}

function shouldScanFile(path) {
  const normalized = path.replaceAll("\\", "/");
  if (normalized.includes("/test/") || normalized.includes("/node_modules/")) {
    return false;
  }
  return [...allowedExtensions].some((extension) => normalized.endsWith(extension));
}
