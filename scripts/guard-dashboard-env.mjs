#!/usr/bin/env node

const forbidden = "VITE_SUI402_CONSOLE_ADMIN_API_KEY";

if (process.env[forbidden]) {
  console.error(
    [
      `Refusing to build dashboard with ${forbidden} set.`,
      "",
      "VITE_* variables are bundled into browser JavaScript. A console admin/operator key in the dashboard bundle",
      "would give every dashboard user the same backend authority.",
      "",
      "Use OIDC/JWKS or a backend session layer for hosted production dashboard auth."
    ].join("\n")
  );
  process.exit(1);
}
