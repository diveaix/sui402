# Console Operator Key Rotation

Owner: Sui402 operators

Use OIDC/JWKS for hosted production when you can. Static operator keys are a
fallback for early deployments, staging, and break-glass access. They must be
role-scoped and rotated with overlapping validity windows.

## 1. Generate The Replacement Key

```powershell
npm run console:operator-key -- `
  --id merchant-admin-2026q3 `
  --roles merchant_admin `
  --not-before 2026-07-01T00:00:00.000Z `
  --expires-at 2026-10-01T00:00:00.000Z `
  --existing $env:SUI402_CONSOLE_OPERATOR_KEYS_JSON
```

The command prints the new key entry and a complete
`SUI402_CONSOLE_OPERATOR_KEYS_JSON` value.

## 2. Deploy With Overlap

Deploy the merged JSON while the old key is still active. Keep the overlap long
enough for all console API replicas, indexer workers, dashboards, and runbooks
to receive the replacement credential.

Recommended overlap:

- staging: at least 1 hour
- production: at least 24 hours
- incident rotation: shortest safe window, then force-restart consumers

## 3. Verify The New Key

```powershell
$env:NEW_KEY="..."
Invoke-RestMethod `
  -Headers @{ Authorization = "Bearer $env:NEW_KEY" } `
  -Uri http://127.0.0.1:4030/health/ready
```

Then verify a role-scoped route. For example, a `viewer` key should read
overview but fail merchant creation.

## 4. Retire The Old Key

After the overlap window:

1. Remove the old key from `SUI402_CONSOLE_OPERATOR_KEYS_JSON`, or set its
   `expiresAt` in the past.
2. Redeploy all console API replicas.
3. Confirm old credentials return `401`.
4. Check `/v1/audit-events` for unexpected usage attempts.

## 5. Real Talk

Static keys are bearer secrets. Anyone who gets the value has the role until the
key expires or is removed. Prefer OIDC for named operators, short token TTLs,
centralized offboarding, and cleaner audit trails.
