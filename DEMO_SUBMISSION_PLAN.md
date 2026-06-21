# Sui402 Demo Submission Plan

Deadline mode: optimize for a clear, honest, working demo. Do not chase full
production launch in the final window.

## One-sentence demo

Sui402 lets an agent discover a paid API, pay from a user-owned Sui wallet or
bounded session, call the API, and inspect payment evidence in marketplace/scan
surfaces.

## Demo scope

### Must show

1. Marketplace discovery for a listed API.
2. Agent-safe copyable command with explicit max spend.
3. Non-custodial Sui payment path: local signer/session, not a hosted balance.
4. Successful paid API response.
5. Scan/evidence page or CLI lookup showing digest/session/settlement evidence.
6. Machine checks proving the repo and rehearsal evidence are coherent.

### Must not claim

- Production mainnet readiness.
- Custodial wallet infrastructure.
- Gas-free USDC transfers on Sui.
- External audit completion.
- Legal/on-call/KMS/monitoring readiness.

## Final 20-hour plan

| Window | Output | Commands / evidence |
| --- | --- | --- |
| 0-2h | Freeze the exact story and fallback path. | `DEMO_SUBMISSION_PLAN.md`, `docs/demo-submission.md` |
| 2-6h | Verify golden path and fix only demo-breaking issues. | `npm run demo:check`, `npm run rehearsal:evidence:check -- --file docs/runbooks/testnet-rehearsal-evidence-2026-06-18.md` |
| 6-10h | Polish marketplace/scan wording and screenshots. | Browser on dashboard/marketplace/scan; no new protocol work unless broken |
| 10-13h | Record live demo once. | Save video + screenshots under `artifacts/demo/` or submission portal |
| 13-16h | Prepare fallback recording and commands. | Seeded/local marketplace + existing Testnet evidence |
| 16-19h | Final verification pass. | `npm run release:check`, `npm run demo:check`, launch gate expected external-evidence failures only |
| 19-20h | Submit. | README, video, repo/archive, evidence links |

## Primary live flow

Use this if Testnet/RPC and the local wallet are behaving.

1. Start console API.
2. Open dashboard/marketplace.
3. Show API card and copy the agent command.
4. Run paid call from `sui402-pay` / session demo.
5. Show successful API response.
6. Show scan lookup and evidence digest/session/settlement.
7. Run `npm run demo:check`.

## Fallback flow

Use this if Testnet/RPC/wallet flakes during judging.

1. Show seeded marketplace and scan locally.
2. Run `npm run demo:check`.
3. Open `docs/runbooks/testnet-rehearsal-evidence-2026-06-18.md`.
4. Run:

```powershell
npm run rehearsal:evidence:check -- --file docs/runbooks/testnet-rehearsal-evidence-2026-06-18.md
```

5. Explain: "The live network proof was captured in the evidence file; the local
   demo shows the product flow and surfaces."

## Final check commands

```powershell
npm run build -w @sui402/console-api
npm run build -w @sui402/pay
npm run demo:check
npm run release:check
$env:SUI402_SERIOUS_LAUNCH="true"; npm run launch:check
```

Expected result:

- `demo:check` passes.
- `release:check` passes.
- serious `launch:check` fails only on external audit/legal/on-call/KMS/monitoring evidence unless those are actually complete.

## Submission positioning

Say this plainly:

> Sui402 is demo-ready and production-oriented, but not claiming mainnet
> production launch today. The demo proves the Sui-native agent payment loop and
> public evidence surfaces; the launch gate intentionally blocks until external
> audit, legal, monitoring, on-call, and KMS/signing evidence exists.

