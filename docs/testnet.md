# Testnet Publish and Session Operations

## 1. Verify Sui CLI

```powershell
sui --version
sui client active-env
sui client active-address
```

This workspace installed `suiup` and `sui 1.72.1` locally.

## 2. Fund Testnet Gas

Check the active address:

```powershell
sui client active-address
```

If there is no gas, first confirm the address has no usable gas objects:

```powershell
sui client gas
```

For Testnet, request gas from the web faucet at <https://faucet.sui.io> using
the active address. Do not rely on `sui client faucet` for Testnet; that CLI
faucet flow is for Devnet/Localnet where supported.

You can also ask `@sui402/pay` to check the local wallet and print the next
safe action:

```powershell
sui402-pay wallet --human --balance
```

## 3. Build Move Package

```powershell
cd F:\Downloads\sui-hack\move\sui402_sessions
sui move build
sui move test
```

## 4. Publish Session Package

```powershell
cd F:\Downloads\sui-hack\move\sui402_sessions
sui client publish --gas-budget 100000000
```

Copy the published package id from the output and set:

```powershell
$env:SUI402_SESSION_PACKAGE_ID="0x..."
$env:SUI_GRPC_URL="https://fullnode.testnet.sui.io:443"
```

Current testnet deployment:

```powershell
$env:SUI402_SESSION_PACKAGE_ID="0x1fee62ada105f56b7ab2288087519ed2dc22de92923db12582b5466c1e0010f9"
```

See `docs/deployments.md` for transaction digests.

## 5. Export a Session Signing Key

Use either a Sui bech32 private key:

```powershell
$env:SUI_SECRET_KEY="suiprivkey..."
```

Or an Ed25519 mnemonic:

```powershell
$env:SUI_MNEMONIC="word word word ..."
```

## 6. Open a Session

```powershell
$env:SUI402_MERCHANT_ADDRESS="0x..."
$env:SUI402_RESOURCE_SCOPE="api:*"
$env:SUI402_MAX_PER_REQUEST="1000000"
$env:SUI402_SESSION_FUNDING="10000000"
npm run session:open
```

Copy the printed `sessionId`.

## 7. Spend From a Session

```powershell
$env:SUI402_SESSION_ID="0x..."
$env:SUI402_SPEND_AMOUNT="1000000"
npm run session:spend
```

In the real HTTP/MCP flow, use the server-issued challenge id. For a standalone
CLI spend, the script creates a fresh challenge id.

## 8. Close a Session

```powershell
$env:SUI402_SESSION_ID="0x..."
npm run session:close
```

## 9. Run Provider API Session Payment Flow

Start the provider API:

```powershell
$env:SUI402_SESSION_PACKAGE_ID="0x1fee62ada105f56b7ab2288087519ed2dc22de92923db12582b5466c1e0010f9"
$env:SUI402_MERCHANT_ADDRESS="0x..."
$env:SUI402_RESOURCE_SCOPE="api:*"
$env:SUI402_PRICE="1000000"
npm run dev:provider
```

In another terminal, use an active Sui CLI keystore session. If
`SUI402_SESSION_ID` is set, the script spends that exact session. If it is not
set, the script discovers a funded owned session that matches the challenge
merchant, coin type, resource scope, amount, and expiry.

```powershell
npm run session:fetch
```

Expected result:

```text
402 challenge -> sessions::spend -> retry -> 200 paid response
```
