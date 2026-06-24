# Production Security Checklist

Use this before exposing Sui402 services to real users or funds.

## Required

- Configure Redis for challenge storage.
- Configure Postgres for payment records.
- Enable Postgres migrations before first deploy.
- Use long random admin API keys.
- Never put console admin or operator keys in `VITE_*` dashboard variables; they
  are public browser bundle inputs.
- Prefer OIDC/JWKS or role-scoped console operator keys over a single
  all-powerful console admin key.
- Configure short-lived OIDC operator tokens with least-privilege role claims.
- For hosted seller portals, prefer short-lived OIDC/JWKS seller tokens with
  `seller_viewer`/`seller_admin` roles and merchant-scoped claims over static
  seller keys.
- Enable durable console audit logging and restrict audit reads to admin
  operators.
- Verify audit metadata redaction is enabled before exporting or anchoring audit
  logs; raw headers, cookies, API keys, publisher tokens, verification tokens,
  request bodies, and private-key material must not be retained.
- Keep wallet private keys out of provider and gateway servers.
- Pin the deployed session Move package id per network.
- Run `npm run check`, `npm run test`, and `npm run build`.
- Run `npm run production:certify` with Docker running before claiming a
  production-ready build.
- Run `sui move test` for the Move package.
- Verify `/.well-known/sui402` points to the intended merchant, coin type, price,
  resource scope, and network.
- Confirm transaction digest replay protection is backed by durable storage.
- Configure rate limiting across instances, not only per process.
- Configure public merchant intake throttling and upstream abuse controls before
  broad seller onboarding.
- Use external/KMS-backed receipt signing for production receipt issuers when
  available; avoid raw PEM env vars for high-value deployments.
- Verify a known receipt signature with each KMS/HSM public key before routing
  live receipt traffic to a new signer id.

## Before Mainnet

- Complete external Move audit.
- Complete external SDK/backend audit.
- Configure the alerts and dashboards in `docs/monitoring.md`.
- Exercise key rotation for admin API keys, console operator keys, and receipt
  signing keys in a staging environment.
- Set `expiresAt` on static console operator keys and use overlapping
  `notBefore` windows when rotating keys.
- Export or anchor audit logs to append-only infrastructure for stronger
  post-incident evidence.
- Assign the incident-response owner, backup, and disclosure contact in
  `docs/runbooks/incident-response.md`.
- Review terms, privacy policy, and regulatory posture with counsel.
- Run `npm run launch:check` against `.env.production`. When
  `SUI402_NETWORK=sui:mainnet` or `SUI402_SERIOUS_LAUNCH=true`, the checker now
  requires concrete launch evidence for hosted staging, funded rehearsal,
  external audits, legal review, secret management, OIDC/JWKS, on-call,
  KMS/receipt signing, monitoring, backup/restore, Sui RPC ownership, and seller
  intake controls.

### Launch Evidence Gate

For mainnet or any serious production launch, provide evidence either directly
in `.env.production` or through a JSON evidence file referenced by
`SUI402_LAUNCH_EVIDENCE_FILE`.

Create a local evidence file template:

```bash
npm run launch:evidence:init -- launch-evidence.local.json
```

Fill every field with real references, keep that file out of public commits if
it contains private links, then point the launch checker at it:

```bash
SUI402_LAUNCH_EVIDENCE_FILE=launch-evidence.local.json SUI402_SERIOUS_LAUNCH=true npm run launch:check
```

Accepted env vars:

- `SUI402_STAGING_EVIDENCE`
- `SUI402_FUNDED_REHEARSAL_EVIDENCE`
- `SUI402_EXTERNAL_AUDIT_EVIDENCE`
- `SUI402_MOVE_AUDIT_EVIDENCE`
- `SUI402_BACKEND_SDK_AUDIT_EVIDENCE`
- `SUI402_LEGAL_REVIEW_EVIDENCE`
- `SUI402_SECRET_MANAGEMENT_EVIDENCE`
- `SUI402_OIDC_EVIDENCE`
- `SUI402_ONCALL_EVIDENCE`
- `SUI402_KMS_EVIDENCE` or `SUI402_RECEIPT_SIGNER_EVIDENCE`
- `SUI402_MONITORING_EVIDENCE`
- `SUI402_BACKUP_RESTORE_EVIDENCE`
- `SUI402_RPC_EVIDENCE`
- `SUI402_SELLER_INTAKE_EVIDENCE`
- `SUI402_MAINNET_GOVERNANCE_EVIDENCE` when launching mainnet

Accepted JSON fields in the evidence file:

```json
{
  "staging": "STAGE-10 hosted staging runbook passed 2026-06-15 https://deploy.acme.co/sui402-staging",
  "fundedRehearsal": "REHEARSE-12 evidence note docs/runbooks/testnet-rehearsal-evidence-2026-06-15.md",
  "externalAudit": "AUDIT-123 final report https://security.acme.co/reports/sui402-mainnet",
  "moveAudit": "MOVEAUD-17 final report file:/evidence/move-audit.pdf",
  "backendSdkAudit": "BEAUD-18 final report file:/evidence/backend-sdk-audit.pdf",
  "legalReview": "LEGAL-45 approved 2026-06-15",
  "secretManagement": "SEC-9 vault access review and rotation drill 2026-06-15",
  "oidc": "OIDC-11 negative auth test report 2026-06-15",
  "onCall": "PagerDuty escalation policy https://pagerduty.acme.co/policies/P123",
  "kms": "KMS smoke test 2026-06-15 verified signer digest sha256:0123456789abcdef",
  "monitoring": "Grafana dashboard https://grafana.acme.co/d/sui402-mainnet and alert policy ALERT-9",
  "backupRestore": "BACKUP-22 restore drill 2026-06-15 RPO/RTO approved",
  "suiRpc": "RPC-4 archive-capable provider quota/retention memo 2026-06-15",
  "sellerIntake": "INTAKE-7 CAPTCHA/email/KYB risk acceptance 2026-06-15",
  "mainnetGovernance": "GOV-5 multisig UpgradeCap policy and gas dry-run 2026-06-15"
}
```

Snake-case aliases such as `external_audit`, `legal_review`, `on_call`, and
`receipt_signer` are also accepted.

Evidence values must be concrete references, not booleans. Use report URLs,
ticket IDs, dated memos, runbook paths, dashboard links, alert-policy IDs, or
digests. Placeholder values such as `true`, `done`, `todo`, `tbd`, `example`,
or `pending` intentionally fail.

## Not Safe

- Running production with in-memory challenge or payment record stores.
- Letting an LLM construct arbitrary transaction bytes for signing.
- Sharing user wallet private keys with provider infrastructure.
- Treating registry listings or provider manifests as payment authorization.
- Calling receipt replay accounting a full settlement protocol before escrowed
  fund movement, finality, dispute handling, and audit exist.
