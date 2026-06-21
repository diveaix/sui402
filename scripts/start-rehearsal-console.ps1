param(
  [string]$EnvPath = ".env.testnet-rehearsal.example",
  [string]$ReceiptPrivateKeyPemBase64
)

$ErrorActionPreference = "Stop"

Set-Location -LiteralPath (Resolve-Path "$PSScriptRoot\..")
& "$PSScriptRoot\load-env.ps1" $EnvPath

if (!(Test-Path Env:SUI402_RECEIPT_SIGNER_ID)) {
  $env:SUI402_RECEIPT_SIGNER_ID = $env:SUI402_MERCHANT_ADDRESS
}

if ($ReceiptPrivateKeyPemBase64) {
  $env:SUI402_RECEIPT_PRIVATE_KEY_PEM_BASE64 = $ReceiptPrivateKeyPemBase64
}

npm run dev:console-api
