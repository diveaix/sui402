#!/usr/bin/env node

const providerUrl = process.env.SUI402_PROVIDER_HEALTH_URL ?? "http://127.0.0.1:4020/health/ready";
const consoleUrl = process.env.SUI402_CONSOLE_HEALTH_URL ?? "http://127.0.0.1:4030/health/ready";
const dashboardUrl = process.env.SUI402_DASHBOARD_URL ?? "http://127.0.0.1:4040";

await checkJson("provider", providerUrl);
await checkJson("console", consoleUrl);
await checkText("dashboard", dashboardUrl);

console.log("\nProduction deployment smoke check passed.");

async function checkJson(name, url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${name} health check failed: ${response.status} ${await response.text()}`);
  }
  const body = await response.json();
  if (!body.ok) {
    throw new Error(`${name} health check returned ok=false`);
  }
  console.log(`[ok] ${name}: ${url}`);
}

async function checkText(name, url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${name} check failed: ${response.status} ${await response.text()}`);
  }
  console.log(`[ok] ${name}: ${url}`);
}
