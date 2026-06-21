# Testnet Demo

This demo proves the one-shot Sui402 loop on Sui testnet.

## Start a Provider

```powershell
$env:NODE_ENV="development"
$env:PORT="4024"
$env:SUI402_NETWORK="sui:testnet"
$env:SUI402_MERCHANT_ADDRESS="0x2222222222222222222222222222222222222222222222222222222222222222"
$env:SUI402_COIN_TYPE="0x2::sui::SUI"
$env:SUI402_PRICE="1000"
$env:SUI402_RESOURCE_SCOPE="api:testnet-demo"
$env:SUI402_SERVICE_NAME="sui402-testnet-demo"
npm run dev -w @sui402/provider-api
```

## Pay and Fetch

In another terminal:

```powershell
$env:SUI402_NETWORK="sui:testnet"
$env:SUI402_PAYMENT_ENDPOINT="http://127.0.0.1:4024/v1/entitlements/current"
npm run payment:fetch
```

The CLI will:

- call the protected endpoint
- receive a `402` challenge
- execute a real Sui testnet payment using `sui client ptb`
- retry with a `sui402-payment` proof header
- print the verified response

Expected result:

```json
{
  "status": 200,
  "proof": {
    "kind": "one-shot",
    "network": "sui:testnet",
    "txDigest": "..."
  }
}
```

Real talk: this spends testnet SUI. Use a testnet wallet with gas and keep the
price tiny while testing.

## Local Verified Wallet Example

Verified locally on June 17, 2026:

```powershell
sui --version
# sui 1.73.1-ff1fe0ec4551-dirty

sui client active-env
# testnet

sui client active-address
# 0x3a887b8701c31de6b7e17356a7322391b89f449805f364ad66b51233d6e934f6

sui client balance
# Sui 1903271760 raw / 1.90 SUI
```

To run the one-shot demo with this wallet as the merchant during local testing:

```powershell
$env:SUI402_MERCHANT_ADDRESS="0x3a887b8701c31de6b7e17356a7322391b89f449805f364ad66b51233d6e934f6"
$env:SUI402_PRICE="1000"
```

Do not use this address as a public production merchant address unless it is
actually controlled by the seller operating the service.

## Session Demo

The session demo proves the lower-cost repeat path: open/fund a session if
needed, spend against the session, then retry the protected API with a session
proof.

Start a session-enabled provider:

```powershell
$env:NODE_ENV="development"
$env:PORT="4025"
$env:SUI402_NETWORK="sui:testnet"
$env:SUI402_MERCHANT_ADDRESS="0x2222222222222222222222222222222222222222222222222222222222222222"
$env:SUI402_COIN_TYPE="0x2::sui::SUI"
$env:SUI402_PRICE="1000"
$env:SUI402_RESOURCE_SCOPE="api:testnet-session-demo"
$env:SUI402_SERVICE_NAME="sui402-testnet-session-demo"
$env:SUI402_SESSION_PACKAGE_ID="0x1fee62ada105f56b7ab2288087519ed2dc22de92923db12582b5466c1e0010f9"
npm run dev -w @sui402/provider-api
```

Then run:

```powershell
$env:SUI402_NETWORK="sui:testnet"
$env:SUI402_SESSION_PACKAGE_ID="0x1fee62ada105f56b7ab2288087519ed2dc22de92923db12582b5466c1e0010f9"
$env:SUI402_SESSION_ENDPOINT="http://127.0.0.1:4025/v1/entitlements/current"
$env:SUI402_SESSION_FUNDING="10000"
npm run session:demo
```

The command reuses an existing usable session when one exists. Otherwise it
opens a new session before spending.
