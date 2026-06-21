# Sui402 Demo Submission

This is the judge-facing guide for the hackathon demo.

## What Sui402 does

Sui402 is a Sui-native payment layer for agents and paid APIs. It combines:

- HTTP `402 Payment Required` negotiation.
- User-owned Sui wallets and bounded payment sessions.
- Publisher onboarding and marketplace discovery.
- Public scan/evidence pages for payments, sessions, and settlements.
- CLI tooling agents can actually run.

The demo story is simple: discover an API, pay for it, receive the response,
then inspect the payment evidence.

## Quick verification

From the repo root:

```powershell
npm run build -w @sui402/console-api
npm run build -w @sui402/pay
npm run demo:check
```

`demo:check` verifies:

- demo docs exist;
- a temporary seeded console API agrees with `sui402-pay scan stats`;
- the latest funded Testnet rehearsal evidence file is machine-checkable.

For the captured Testnet proof:

```powershell
npm run rehearsal:evidence:check -- --file docs/runbooks/testnet-rehearsal-evidence-2026-06-18.md
```

## Live demo script

### 1. Show the marketplace

Open the dashboard/marketplace and show a listed API. Point out:

- price;
- network;
- resource scope;
- session support;
- copyable agent command;
- scan/evidence link.

### 2. Show the agent command

Run or display:

```powershell
npx @sui402/pay search weather --marketplace-url <console-api-url>
npx @sui402/pay marketplace detail atlas-api --marketplace-url <console-api-url>
```

The important part is that the command includes bounded spend behavior. Agents
should not blindly spend.

### 3. Pay from a user-owned Sui wallet/session

For the live Testnet path, use the rehearsal runbook:

```powershell
docs/runbooks/testnet-rehearsal.md
```

The captured proof is:

```powershell
docs/runbooks/testnet-rehearsal-evidence-2026-06-18.md
```

### 4. Show scan evidence

Use either UI or CLI:

```powershell
npx @sui402/pay scan stats --marketplace-url <console-api-url>
npx @sui402/pay scan payment <digest> --marketplace-url <console-api-url>
npx @sui402/pay scan settlement <digest-or-id> --marketplace-url <console-api-url>
```

For local seeded agreement:

```powershell
npm run scan:agreement:check -- --url <console-api-url>
```

## What is real

- Protocol schemas and verification code.
- Gateway and provider middleware.
- Local non-custodial Sui signing/CLI posture.
- Sui session planning/open/fund/spend/close flows.
- Publisher application and review surfaces.
- Marketplace and scan APIs/pages.
- Machine-checkable Testnet rehearsal evidence.
- Release/package checks.

## What is not claimed as complete

- Mainnet production launch.
- External security audit.
- Legal/regulatory review.
- Production on-call and monitoring.
- KMS/HSM-backed receipt signing evidence.
- Custodial wallet infrastructure.
- Gas-free Sui stablecoin payments.

Real talk: the serious launch gate intentionally fails without those external
evidence items. That is a feature, not a bug.

## Fallback if Testnet is flaky

If Sui RPC, faucet, or wallet setup flakes during judging:

1. Run `npm run demo:check`.
2. Show the local marketplace/scan surfaces.
3. Open `docs/runbooks/testnet-rehearsal-evidence-2026-06-18.md`.
4. Run the evidence checker.
5. Explain that the live network proof is captured and machine-verified, while
   the local flow demonstrates the UX.

## Final submission checklist

- [ ] Demo video recorded.
- [ ] Screenshots saved.
- [ ] `npm run demo:check` passes.
- [ ] `npm run release:check` passes.
- [ ] `npm run rehearsal:evidence:check -- --file docs/runbooks/testnet-rehearsal-evidence-2026-06-18.md` passes.
- [ ] Submission text says "demo-ready / production-oriented", not "mainnet production launched".

