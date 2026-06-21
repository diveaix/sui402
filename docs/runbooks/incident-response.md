# Production Incident Response

Owner: assign before launch  
Backup owner: assign before launch  
Security contact: configure from `SECURITY.md`  
Last updated: 2026-06-18

This runbook covers provider, console, storage, indexer, receipt signer, and
payment-verification incidents.

## Severity

- **SEV-1**: suspected key compromise, unauthorized payment acceptance,
  incorrect recipient/amount verification, audit-chain mutation, or material
  loss of funds.
- **SEV-2**: payment service unavailable, durable replay protection unavailable,
  settlement/indexer outage, or broad merchant impact.
- **SEV-3**: degraded latency, isolated merchant issue, review backlog, or
  non-critical export failure.

## First 15 Minutes

1. Name an incident commander and open a timestamped incident channel.
2. Record the deployment version, affected services, first alert time, and
   current readiness responses.
3. Preserve logs, console audit events, current audit verification output, and
   the latest Walrus audit-head blob ID.
4. Stop risky traffic before debugging. Disable the affected merchant, remove
   the service from ingress, or scale the provider to zero when verification or
   signing integrity is uncertain.
5. Do not delete databases, rotate every key at once, or redeploy over evidence.

## Triage

Check:

```powershell
Invoke-WebRequest http://127.0.0.1:4020/health/ready -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:4030/health/ready -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:4020/metrics -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:4030/metrics -UseBasicParsing
npm run deploy:prod:ps
npm run deploy:prod:logs
```

Then determine whether the failure is in:

- Sui RPC or transaction verification
- Redis challenge/replay state
- Postgres payment/audit/console state
- receipt KMS/HSM signing
- indexer checkpoint/event ingestion
- merchant configuration or policy
- ingress, DNS, certificate, or container runtime

## Containment

### Verification or replay anomaly

1. Remove the affected paid route from ingress.
2. Preserve suspicious challenge IDs, proof digests, request IDs, and payment
   records.
3. Query Sui independently for each suspect digest.
4. Verify recipient, coin type, amount, transaction success, and resource
   binding.
5. Keep the route disabled until replay and resource-binding tests pass against
   the deployed build.

### Receipt signer or operator key compromise

1. Disable the affected signer/operator ID.
2. Follow the receipt signer or console operator rotation runbook.
3. Preserve old public keys for historical receipt verification.
4. Publish a new Walrus audit head after containment.
5. Review every action/payment signed during the exposure window.

### Redis or Postgres outage

1. Keep readiness failing so ingress stops new traffic.
2. Do not fail open to memory storage.
3. Restore the dependency or fail over to a tested replica.
4. Confirm challenge replay, payment uniqueness, receipt sequence, audit chain,
   and indexer cursor state before restoring traffic.

### Audit verification failure

1. Treat as SEV-1 until explained.
2. Export the database and application logs read-only.
3. Compare the latest local head with prior Walrus audit-head artifacts.
4. Do not rewrite or “repair” audit rows before evidence review.

## Recovery Gate

Before restoring traffic:

- `/health/ready` is `200` on every service instance.
- Redis and Postgres probes succeed.
- payment verification and replay tests pass.
- the latest audit window verifies.
- settlement reconciliation has no unexplained mismatches.
- indexer cursors advance.
- a canary testnet payment succeeds end to end.
- the incident commander records the recovery decision.

## Aftercare

Within two business days:

1. Write a blameless timeline and root-cause analysis.
2. Record customer/merchant impact and any financial exposure.
3. Add a regression test or operational control for the failure mode.
4. Review alert timing and whether containment was fast enough.
5. Notify affected parties and regulators when required by counsel.
