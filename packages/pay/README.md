# @sui402/pay

Agent-facing CLI for calling Sui402 paid APIs with a user-owned Sui wallet.

This package is intentionally non-custodial: it reads a local Sui signer from
`SUI_SECRET_KEY`, `SUI_MNEMONIC`, or your local Sui CLI keystore, signs Sui
transactions locally, and never sends private keys to Sui402 infrastructure.

```bash
npx @sui402/pay init
npx @sui402/pay readiness
npx @sui402/pay readiness --strict --json
npx @sui402/pay setup
npx @sui402/pay setup --check --json
npx @sui402/pay setup --print-env --marketplace-url https://console.example.com
npx @sui402/pay setup --write-env .sui402/agent.env --marketplace-url https://console.example.com
npx @sui402/pay wallet
npx @sui402/pay wallet --human --balance
npx @sui402/pay search weather
npx @sui402/pay search weather --network sui:testnet --limit 10
npx @sui402/pay marketplace detail atlas-api
npx @sui402/pay scan stats
npx @sui402/pay scan payment digest-atlas-1
npx @sui402/pay scan session 0x...
npx @sui402/pay scan settlement settlement-digest-1
npx @sui402/pay session inspect
npx @sui402/pay session open --package-id 0x... --merchant 0x... --resource https://api.example.com/weather --max-per-request 1000 --funding 10000
npx @sui402/pay curl https://api.example.com/weather --session-only
npx @sui402/pay curl https://api.example.com/weather --max-one-shot-amount 1000
```

## Quick start

Prerequisites for a clean machine:

- Node.js/npm installed.
- Optional but recommended for humans: the Sui CLI configured with a local
  wallet.
- Testnet/devnet SUI for gas before any paid call or session transaction.
- A marketplace/console URL when using search/detail/scan commands outside the
  local default stack.

## Packaged clean-install proof

From the repo root, prove the CLI can be packed, installed into a temporary
clean project, and run without Docker, production secrets, or Sui network
queries:

```bash
npm run package:check
npm run package:clean-install
```

`package:clean-install` packs `@sui402/pay` plus its local Sui402 workspace
dependencies, installs the tarballs into a fresh temp project, and runs the
packaged `sui402-pay` bin through safe commands:

```bash
sui402-pay --help
sui402-pay init --check --json --no-balance
sui402-pay readiness --json --no-balance
sui402-pay search weather --json --marketplace-url http://127.0.0.1:<mock> --limit 1
```

The search check uses a localhost mock marketplace. The init/readiness checks
scrub signer environment variables and use `--no-balance`, so they verify
packaged CLI startup and diagnostics without reading production secrets or
querying Sui gRPC.

1. Point the CLI at a local signer.

   ```bash
   export SUI_SECRET_KEY=suiprivkey...
   # or
   export SUI_MNEMONIC="word word word ..."
   ```

   PowerShell:

   ```powershell
   $env:SUI_SECRET_KEY="suiprivkey..."
   # or
   $env:SUI_MNEMONIC="word word word ..."
   ```

   If you already use the Sui CLI, `@sui402/pay` can auto-detect the local
   Sui CLI wallet at `~/.sui/sui_config/client.yaml` and
   `~/.sui/sui_config/sui.keystore`:

   ```bash
   sui client active-address
   npx @sui402/pay wallet
   ```

   Optional Sui CLI overrides:

   ```bash
   export SUI_CLIENT_CONFIG=/path/to/client.yaml
   export SUI_KEYSTORE_PATH=/path/to/sui.keystore
   export SUI_ADDRESS=0x...
   ```

   PowerShell:

   ```powershell
   $env:SUI_CLIENT_CONFIG="C:\path\to\client.yaml"
   $env:SUI_KEYSTORE_PATH="C:\path\to\sui.keystore"
   $env:SUI_ADDRESS="0x..."
   ```

2. Verify the non-custodial wallet identity:

   ```bash
   npx @sui402/pay readiness
   npx @sui402/pay wallet
   ```

   `readiness` is the human-friendly preflight. It checks the local signer and,
   by default, queries Sui gRPC for SUI gas readiness. Add `--strict` in CI or
   agent startup scripts when not-ready should exit non-zero after printing the
   diagnostic report. Use `--no-balance` for a config-only check.

   `wallet` prints JSON by default so agents can consume it. It never prints or
   writes the private key. For a human-readable status view:

   ```bash
   npx @sui402/pay wallet --human
   ```

   To check whether the wallet has SUI available for gas, ask the CLI to query
   Sui gRPC:

   ```bash
   npx @sui402/pay wallet --balance
   ```

3. Discover APIs from the console marketplace:

   ```bash
   export SUI402_MARKETPLACE_URL=http://127.0.0.1:4030
   npx @sui402/pay search weather
   ```

   PowerShell:

   ```powershell
   $env:SUI402_MARKETPLACE_URL="http://127.0.0.1:4030"
   npx @sui402/pay search weather
   ```

4. Call the protected resource. `curl` signs locally and pays only when the API
   returns a valid Sui402 payment challenge. It rejects tampered challenge IDs,
   expired challenges, and challenge networks that do not match your local
   `SUI402_NETWORK` before signing:

   ```bash
   npx @sui402/pay curl http://127.0.0.1:8080/weather
   ```

## Wallet environment

Use one of:

```bash
SUI_SECRET_KEY=suiprivkey...
```

or:

```bash
SUI_MNEMONIC="..."
```

Or use an existing local Sui CLI wallet:

```bash
sui client active-address
npx @sui402/pay wallet
```

The CLI reads the local Sui CLI keystore file and signs locally. It supports
standard Sui ED25519, Secp256k1, and Secp256r1 keys for paid calls. Use
`SUI_ADDRESS` to pick an address when the keystore contains multiple local keys.
For humans, prefer the Sui CLI keystore over long-lived mnemonic/private-key
environment variables; shells, process managers, and crash logs can accidentally
retain environment values.

Optional network config:

```bash
SUI402_NETWORK=sui:testnet
SUI_GRPC_URL=https://fullnode.testnet.sui.io:443
```

Optional session-first config:

```bash
SUI402_SESSION_PACKAGE_ID=0x...
SUI402_MAX_ONE_SHOT_AMOUNT=1000
```

Optional marketplace/search config:

```bash
SUI402_MARKETPLACE_URL=https://console.example.com
# or
SUI402_CONSOLE_API_URL=https://console.example.com
```

When `SUI402_SESSION_PACKAGE_ID` is set, `sui402-pay curl` first tries to spend
from a matching user-owned Sui402 session. If no usable session is found, it
falls back to a one-shot Sui payment only when `--max-one-shot-amount` or
`SUI402_MAX_ONE_SHOT_AMOUNT` sets an explicit atomic-unit spend cap. Without a
cap, fallback one-shot payment fails before signing.

## Setup diagnostics

`setup` is guidance-first by default:

```bash
npx @sui402/pay init
npx @sui402/pay setup
```

Agents and CI can ask for a non-secret readiness report before attempting a
paid call:

```bash
npx @sui402/pay readiness --strict --json
npx @sui402/pay setup --check --json
```

The report includes:

- custody posture: always `user-owned`;
- whether a local signer is configured;
- signer source, never the signer secret;
- derived address when available;
- selected Sui402 network and gRPC URL;
- structured SUI gas funding guidance for the selected network;
- optional session package id;
- optional marketplace URL;
- skipped/ok/failed SUI gas balance check.

Invalid signer diagnostics name the misconfigured environment variable, such as
`SUI_SECRET_KEY` or `SUI_MNEMONIC`, without echoing the private key or mnemonic.
Sui CLI keystore diagnostics may show the local file path, but never print the
keystore entry or private key.

The JSON status includes a `funding` object so agents and UIs do not need to
parse prose:

```json
{
  "funding": {
    "custody": "user-owned",
    "purpose": "sui_gas",
    "coinType": "0x2::sui::SUI",
    "network": "sui:testnet",
    "address": "0x...",
    "summary": "For Testnet gas, request SUI at https://faucet.sui.io for 0x...",
    "actions": [
      {
        "kind": "web_faucet",
        "label": "Request Testnet SUI",
        "url": "https://faucet.sui.io"
      }
    ]
  }
}
```

For Mainnet, the funding action is a `deposit` instruction to send SUI to the
user-owned wallet address. The CLI never requests, sponsors, stores, or bridges
funds for the user.

Use `--balance` when you want the CLI to query Sui gRPC for gas readiness:

```bash
npx @sui402/pay readiness
npx @sui402/pay setup --check --json --balance
```

For pay.sh-like agent bootstrapping, `setup` can also print or write a
non-secret environment profile:

```bash
npx @sui402/pay setup \
  --print-env \
  --network sui:testnet \
  --marketplace-url https://console.example.com \
  --session-package-id 0x...

npx @sui402/pay setup \
  --write-env .sui402/agent.env \
  --marketplace-url https://console.example.com
```

The generated profile includes network, gRPC, marketplace, session package, and
optional spend-cap defaults. It intentionally does not include `SUI_SECRET_KEY`
or `SUI_MNEMONIC`; keep signer material in the Sui CLI keystore or inject it
through your own secret manager. Existing profile files are not overwritten
unless you pass `--force`.

## Session UX

Sessions are user-owned Sui objects. This CLI keeps that posture explicit:

- it reads owned session objects over Sui gRPC;
- it signs locally only when a command needs the local wallet;
- it never sends `SUI_SECRET_KEY`, `SUI_MNEMONIC`, or Sui CLI keystore entries
  to Sui402 infrastructure.

Inspect the configured wallet's sessions:

```bash
npx @sui402/pay session inspect
```

Inspect an address without loading a local signer:

```bash
npx @sui402/pay session inspect --owner 0x... --json
```

Check whether sessions are ready for a specific merchant/resource/amount:

```bash
npx @sui402/pay session inspect \
  --merchant 0x... \
  --resource https://api.example.com/weather \
  --amount 1000
```

`session inspect` is intentionally bounded. It defaults to 25 matching sessions
and 10 owned-object pages. Increase these only when needed:

```bash
npx @sui402/pay session inspect --limit 100 --max-pages 25
```

Useful commands:

```bash
npx @sui402/pay session setup
npx @sui402/pay session inspect --help
npx @sui402/pay session open --package-id 0x... --merchant 0x... --resource https://api.example.com/weather --max-per-request 1000 --funding 10000
npx @sui402/pay session fund --package-id 0x... --session-id 0x... --funding 10000
npx @sui402/pay session close --package-id 0x... --session-id 0x...
```

Amounts are atomic units for the selected coin. For SUI, `1000000000` atomic
units equals 1 SUI; the examples above use tiny test amounts. Session amounts
and expiry timestamps are validated as positive Move `u64` values.

Opening, funding, and closing sessions are state-changing operations. The CLI
prints a plan and does not submit anything unless you add `--yes`. In human
mode with `--yes`, it also prints the signer address, network, and gRPC URL to
stderr before submitting:

```bash
npx @sui402/pay session open \
  --package-id 0x... \
  --merchant 0x... \
  --resource https://api.example.com/weather \
  --max-per-request 1000 \
  --funding 10000 \
  --yes
```

For non-SUI session funding, pass `--coin-type` plus `--coin-object-id`.
Find candidate coin object IDs with Sui tooling such as `sui client gas` for SUI
gas coins or explorer/SDK coin-object queries for custom coins. Non-SUI funding
still requires enough SUI in the signer wallet for gas unless a future sponsored
flow is used.
All session lifecycle commands sign locally with the same non-custodial wallet
resolver used by `wallet` and `curl`.

## Marketplace and scan

Agents can search a Sui402 marketplace/console before paying:

```bash
npx @sui402/pay search weather
npx @sui402/pay search image --network sui:mainnet --json
npx @sui402/pay search --tag mcp --transport mcp
npx @sui402/pay search weather --limit 10
npx @sui402/pay marketplace detail atlas-api
npx @sui402/pay marketplace detail atlas-api --json
```

Human-readable search results include a ready-to-copy call command when the API
has a protected resource URL, and a session-manager URL when the listing
publishes one:

```bash
sui402-pay curl https://console.example.com/gateway/merchants/weather/pay
session manager: https://console.example.com/gateway/merchants/weather/sessions
```

`--limit` defaults to 20 and is capped at 100 to match the console marketplace
API contract.

For one exact API, `marketplace detail` fetches the public
`GET /v1/marketplace/apis/:apiId` read model and prints the same agent commands
and trust checks shown in the dashboard detail panel:

```bash
sui402-pay marketplace detail atlas-api
sui402-pay marketplace detail atlas-api --json
```

Marketplace detail also prints an `Agent safety` section. For autonomous agents,
use `agentSafety.shouldAutoPay` from `--json` output as the machine-readable
gate. It fails closed when readiness is missing, false, paused, has no protected
endpoint, or lacks verified paid-call evidence. Even when it is true, keep local
wallet policy and max-spend limits in force:

```bash
sui402-pay readiness --strict
sui402-pay curl https://console.example.com/gateway/merchants/atlas-api/pay --max-one-shot-amount 1000
```

Scan-style ecosystem stats are also available:

```bash
npx @sui402/pay scan stats
npx @sui402/pay scan stats --json
npx @sui402/pay scan payment digest-atlas-1
npx @sui402/pay scan merchant atlas-api --json
npx @sui402/pay scan session 0x...
npx @sui402/pay scan settlement settlement-digest-1
```

These commands are read-only and do not require a wallet. They use
`SUI402_MARKETPLACE_URL`, `SUI402_CONSOLE_API_URL`, or `--marketplace-url`.
Scan data is a marketplace/console read model: some fields are indexed on-chain
events or signed receipts, while listing metadata and labels are operator or
publisher metadata. Treat it as evidence with provenance, not as raw chain state
for every displayed field.

## Curl and sessions

`sui402-pay curl` behaves like an agent-safe paid fetch:

- with `SUI_SECRET_KEY`, `SUI_MNEMONIC`, or a discovered Sui CLI keystore key,
  it handles one-shot Sui402 payments from the local wallet;
- it verifies the server challenge id and expiry before any payment handler can
  sign;
- it enforces the selected local `SUI402_NETWORK` against the challenge network
  before session or one-shot payment;
- before signing, it simulates the exact Sui transaction with validation checks
  enabled so insufficient gas, bad object state, or Move errors fail before
  local signer approval;
- after a Sui transaction is accepted, it waits for transaction finality/indexing
  before retrying the protected API or returning session command results;
- with `SUI402_SESSION_PACKAGE_ID` set, it first looks for a matching
  user-owned `AgentPaymentSession` object and spends from that session when
  possible;
- if no session is usable, it can fall back to one-shot payment instead of
  taking custody of funds, but only with an explicit local spend cap.

Use `--session-only` when fallback spending must fail closed:

```bash
npx @sui402/pay curl https://api.example.com/weather --session-only
```

Use `--max-one-shot-amount` or `SUI402_MAX_ONE_SHOT_AMOUNT` to enable and cap
fallback one-shot spend in atomic units:

```bash
npx @sui402/pay curl https://api.example.com/weather --max-one-shot-amount 1000
```

Use `session inspect` before a run when you want to know whether a session is
ready for a merchant/resource/amount:

```bash
npx @sui402/pay session inspect \
  --merchant 0x... \
  --resource https://api.example.com/weather \
  --amount 1000
```
