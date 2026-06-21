#!/usr/bin/env node
import { randomBytes } from "node:crypto";

const VALID_ROLES = new Set(["viewer", "merchant_admin", "exporter", "indexer", "admin"]);

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const id = readRequired(args, "id");
const roles = readRoles(readRequired(args, "roles"));
const key = args.key ?? randomBytes(32).toString("base64url");
const entry = omitUndefined({
  id,
  key,
  roles,
  notBefore: args["not-before"],
  expiresAt: args["expires-at"]
});

const existingJson = args.existing ?? process.env.SUI402_CONSOLE_OPERATOR_KEYS_JSON;
const existing = existingJson ? parseExisting(existingJson) : [];
const withoutSameId = existing.filter((candidate) => candidate.id !== id);
if (withoutSameId.length !== existing.length && !args.replace) {
  throw new Error(`Operator id already exists: ${id}. Pass --replace to replace it.`);
}

const merged = [...withoutSameId, entry];

console.log(JSON.stringify(entry, null, 2));
console.log("");
console.log("SUI402_CONSOLE_OPERATOR_KEYS_JSON=");
console.log(JSON.stringify(merged));

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (arg === "--replace") {
      parsed.replace = true;
      continue;
    }

    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const name = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${name}`);
    }

    parsed[name] = value;
    index += 1;
  }

  return parsed;
}

function readRequired(args, name) {
  const value = args[name];
  if (!value) {
    throw new Error(`Missing --${name}`);
  }

  return value;
}

function readRoles(value) {
  const roles = value
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);
  if (roles.length === 0) {
    throw new Error("At least one role is required");
  }

  for (const role of roles) {
    if (!VALID_ROLES.has(role)) {
      throw new Error(`Invalid role: ${role}`);
    }
  }

  return roles;
}

function parseExisting(value) {
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new Error("Existing operator keys JSON must be an array");
  }

  return parsed;
}

function omitUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined));
}

function printHelp() {
  console.log(`Usage:
  node scripts/console-operator-key.mjs --id ops-admin --roles admin --expires-at 2026-12-31T00:00:00.000Z
  node scripts/console-operator-key.mjs --id viewer --roles viewer --existing "$env:SUI402_CONSOLE_OPERATOR_KEYS_JSON"

Options:
  --id <id>                 Stable operator id, 3-80 chars.
  --roles <roles>           Comma-separated roles: viewer, merchant_admin, exporter, indexer, admin.
  --key <key>               Optional pre-generated key. Defaults to 32 random bytes in base64url.
  --not-before <datetime>   Optional ISO activation time.
  --expires-at <datetime>   Optional ISO expiry time.
  --existing <json>         Existing SUI402_CONSOLE_OPERATOR_KEYS_JSON to merge with.
  --replace                 Replace an existing entry with the same id.
`);
}
