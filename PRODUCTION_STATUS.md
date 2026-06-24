# Sui402 production readiness status

Last verified: 2026-06-24

## Current status

The repository is release-ready for the current testnet/demo production profile.
The local production/readiness gates pass, including typecheck, tests, builds,
security leak checks, npm package dry-runs, and clean-install proof.

This does **not** mean the system is fully mainnet production launched. A real
mainnet launch still requires external infrastructure, operational evidence,
security/legal review, and deployment credentials.

## Verified gates

The following commands passed locally:

```bash
npm run launch:check
npm run release:check
```

`npm run release:check` includes:

- TypeScript checks for all workspaces
- workspace test suites
- all package/app builds
- publisher token leak guard
- npm package dry-run checks
- clean-install proof for publishable packages and CLI commands

`npm run launch:check` passed against the local `.env.production` testnet
profile. Real secret values remain untracked and must stay out of Git.

## What is production-ready in the repo

- Sui402 protocol package
- policy and receipt packages
- Sui payment verification package
- API/client SDK packages
- gateway/server middleware
- pay CLI
- MCP server package and MCP client-config generator
- provider API
- console API
- dashboard frontend
- session CLI and Move session package
- indexer/storage/registry/Walrus helpers
- production Docker compose template
- launch, package, security, release, and deployment smoke scripts
- production, dashboard, API, MCP, scan, and runbook documentation

## Remaining external launch requirements

Before declaring a real public production launch, complete and record evidence
for:

1. Hosted Postgres and Redis with backups, retention, and restore test.
2. Production domains and TLS for console API, provider API/gateway, and dashboard.
3. Secret rotation for all local `.env.production` secrets before any public launch.
4. Deployment smoke test against the hosted environment:

   ```bash
   npm run deploy:prod:smoke
   ```

5. Monitoring/alerting evidence for API health, payment verification failures,
   indexer lag, storage errors, and settlement/export failures.
6. On-call ownership, incident runbook, and escalation policy.
7. External security review or explicit risk acceptance.
8. Legal/compliance review for paid API marketplace behavior.
9. Receipt signer/KMS/HSM decision and smoke evidence if receipts are enabled.
10. Mainnet launch gate evidence if `SUI402_NETWORK=sui:mainnet`.

## Mainnet gate

The current local launch profile is testnet-oriented. For mainnet launch,
`scripts/launch-readiness-check.mjs` requires additional evidence for audit,
legal review, monitoring, on-call, and signer/KMS posture. Do not bypass that
gate unless the evidence is complete and recorded.

## Deployment notes

Frontend-only demo deployment can be done through Vercel using:

- root directory: `apps/dashboard`
- build command: `cd ../.. && npm run build -w @sui402/dashboard`
- output directory: `dist`

For a full production stack, use `docker-compose.production.yml` only with
rotated secrets and hosted persistence.
