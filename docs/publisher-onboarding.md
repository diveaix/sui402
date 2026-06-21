# Publisher API onboarding

This is the publisher-facing path for adding an upstream API to Sui402, checking
whether it is listed, and proving the paid route is launch-ready. It is written
for serious launch prep: the commands are copy/pasteable, but the gates are
intentionally not bypassable.

## What this flow does

- Creates a pending publisher application from one upstream API URL.
- Gives the publisher an exact `.well-known/sui402-publisher.json` proof, plus a
  DNS TXT fallback.
- Lets the publisher poll status with a private publisher access token.
- Lets the publisher/operator probe the approved listing and paid-test evidence.
- Lets anyone inspect the public marketplace listing after approval.

What it does not do: auto-approve a seller, fake a paid test, prove legal/KYB
fitness, or let a publisher change payout wallet/network/coin without review.

## Before you start

You need:

- a console API base URL, for example `http://127.0.0.1:4030`;
- an HTTPS upstream API URL that the publisher controls;
- a Sui payout wallet address;
- a price in atomic units, for example `1000000` MIST for `0.001 SUI`;
- optional: a JSON OpenAPI URL and either `openApiOperationId` or
  `openApiMethod` + `openApiPath`.

Guardrails:

- Do not put console admin/operator keys in a browser publisher form.
- Do not approve an upstream-backed application before ownership proof is
  `verified`.
- Do not call a listing public-launch-ready until the publisher probe has real
  verified paid-test evidence.
- Treat the header-authenticated publisher access token as a bootstrap secret.
  Prefer the short-lived publisher session for browser/portal status and probe
  calls. Do not put publisher tokens in copied URLs.
- Keep `application.verification.accessToken` private. The
  `.well-known`/DNS TXT `verificationToken` is public proof material, not a
  bearer credential.
- Expect the raw publisher access token only in the draft/create response and
  explicit rotation response. Status, probe, verification, operator list/review,
  and overview views expose only token presence/hash markers after that.
- Keep public intake rate limiting enabled for hosted production; public
  publisher intake is abuse-prone even when publish is review-gated.
- Configure public intake host allow/block policy for invite-only launches or
  active abuse response:
  `SUI402_CONSOLE_PUBLIC_INTAKE_ALLOWED_HOSTS` and
  `SUI402_CONSOLE_PUBLIC_INTAKE_BLOCKED_HOSTS`. Entries are comma-separated
  exact hosts or wildcard suffixes such as `*.trusted.example`.
- Use the `abuseControls` object returned on application, draft, and status
  responses during operator review. It includes the review SLA, rate-limit
  posture, host-policy posture, required abuse checks, pending rejection route,
  published merchant pause route, and audit/escalation links. This is an
  operational workflow; CAPTCHA, invite-only access, KYB, sanctions, or identity
  checks are still separate production controls when your launch risk model
  requires them.

## 1. Add an API draft

PowerShell:

```powershell
$Console = "http://127.0.0.1:4030"
$ApiUrl = "https://api.example.com/v1/search"
$OpenApiUrl = "https://api.example.com/openapi.json"
$PayoutWallet = "0x..."

New-Item -ItemType Directory -Force .sui402 | Out-Null

$DraftBody = @{
  apiUrl = $ApiUrl
  openApiUrl = $OpenApiUrl
  openApiOperationId = "search"
  merchant = $PayoutWallet
  network = "sui:testnet"
  coinType = "0x2::sui::SUI"
  price = "1000000"
  applicantEmail = "seller@example.com"
  organization = "Seller Co"
} | ConvertTo-Json -Depth 20

$Draft = Invoke-RestMethod `
  -Method Post `
  -Uri "$Console/v1/publisher/apis/draft" `
  -ContentType "application/json" `
  -Body $DraftBody

$Draft | ConvertTo-Json -Depth 30 | Set-Content .sui402/publisher-draft.json
$Draft.nextSteps.verificationDocument | ConvertTo-Json -Depth 10
```

Bash:

```bash
CONSOLE="http://127.0.0.1:4030"
API_URL="https://api.example.com/v1/search"
OPENAPI_URL="https://api.example.com/openapi.json"
PAYOUT_WALLET="0x..."

mkdir -p .sui402

curl -sS -X POST "$CONSOLE/v1/publisher/apis/draft" \
  -H "content-type: application/json" \
  -d "{
    \"apiUrl\": \"$API_URL\",
    \"openApiUrl\": \"$OPENAPI_URL\",
    \"openApiOperationId\": \"search\",
    \"merchant\": \"$PAYOUT_WALLET\",
    \"network\": \"sui:testnet\",
    \"coinType\": \"0x2::sui::SUI\",
    \"price\": \"1000000\",
    \"applicantEmail\": \"seller@example.com\",
    \"organization\": \"Seller Co\"
  }" | tee .sui402/publisher-draft.json

jq '.nextSteps.verificationDocument' .sui402/publisher-draft.json
```

Optional stateless preview before creating the application:

```bash
curl -sS -X POST "$CONSOLE/v1/publisher/apis/preview" \
  -H "content-type: application/json" \
  -d "{
    \"apiUrl\": \"$API_URL\",
    \"openApiUrl\": \"$OPENAPI_URL\",
    \"merchant\": \"$PAYOUT_WALLET\",
    \"network\": \"sui:testnet\",
    \"coinType\": \"0x2::sui::SUI\",
    \"price\": \"1000000\"
  }" | jq '.preview.openApi.suggestedEndpoints'
```

The preview endpoint returns `schemaVersion:
"sui402.publisher-api-preview.v1"`, `preview`, and `conflicts`. It does not
create a merchant application, publisher token, gateway route, or listing. Use
it to select an OpenAPI operation/resource scope before submitting the draft.

If the OpenAPI operation is selected and the draft did not explicitly set
`resourceScope`, the console uses the operation's suggested scope. Real talk:
that is a convenience, not pricing policy. Review the selected scope before
approval.

## 2. Publish ownership proof

Host the exact JSON from `nextSteps.verificationDocument` at the returned
`nextSteps.verificationUrl`, usually:

```text
https://api.example.com/.well-known/sui402-publisher.json
```

The JSON shape is:

```json
{
  "sui402": "publisher-verification-v1",
  "applicationId": "mapp_...",
  "merchantId": "api-example-com-v1",
  "upstreamUrl": "https://api.example.com/v1/search",
  "verificationToken": "sui402v_..."
}
```

If serving `.well-known` JSON is awkward, publish the exact DNS TXT fallback
from `nextSteps.dnsTxtName` and `nextSteps.dnsTxtValue`.

## 3. Attach payout wallet proof

Wallet proof shows the payout wallet signed the current application terms. It
does not prove API/domain ownership, so upstream-backed APIs still need the
`.well-known` or DNS proof before operator approval.

Sign this exact message with the payout wallet listed in the draft:

```text
Sui402 publisher payout wallet proof
applicationId=mapp_...
merchantId=api-example-com-v1
payoutWallet=0x...
network=sui:testnet
coinType=0x2::sui::SUI
price=1000000
resourceScope=api:api-example-com-v1
upstreamUrl=https://api.example.com/v1/search
```

Then submit the Sui personal-message signature:

```bash
APPLICATION_ID="$(jq -r '.application.id' .sui402/publisher-draft.json)"
SIGNATURE="..."

curl -sS -X POST "$CONSOLE/v1/merchant-applications/$APPLICATION_ID/wallet-proof" \
  -H "content-type: application/json" \
  -d "{
    \"message\": \"Sui402 publisher payout wallet proof\napplicationId=$APPLICATION_ID\nmerchantId=api-example-com-v1\npayoutWallet=$PAYOUT_WALLET\nnetwork=sui:testnet\ncoinType=0x2::sui::SUI\nprice=1000000\nresourceScope=api:api-example-com-v1\nupstreamUrl=$API_URL\",
    \"signature\": \"$SIGNATURE\"
  }" | jq .
```

The console stores safe proof evidence only: address, method, timestamps, and
hashes of the message/signature. It does not store the raw signature in
application views or audit metadata.

## 4. Run ownership verification

PowerShell:

```powershell
$Draft = Get-Content .sui402/publisher-draft.json | ConvertFrom-Json
$ApplicationId = $Draft.application.id

Invoke-RestMethod `
  -Method Post `
  -Uri "$Console/v1/merchant-applications/$ApplicationId/verify" |
  ConvertTo-Json -Depth 30
```

Bash:

```bash
APPLICATION_ID="$(jq -r '.application.id' .sui402/publisher-draft.json)"

curl -sS -X POST "$CONSOLE/v1/merchant-applications/$APPLICATION_ID/verify" |
  jq .
```

Expected next phase after a successful proof: `operator_review`. If verification
fails, fix the hosted JSON or DNS TXT record first; do not ask an operator to
approve around the failure.

## 5. Create a short-lived publisher session

Use the private publisher access token as a bootstrap secret, then prefer the
short-lived Bearer session for browser/portal status and probe calls. Public
`.well-known`/DNS verification tokens are intentionally rejected here.

PowerShell:

```powershell
$Draft = Get-Content .sui402/publisher-draft.json | ConvertFrom-Json
$ApplicationId = $Draft.application.id
$Token = $Draft.application.verification.accessToken

$Session = Invoke-RestMethod `
  -Method Post `
  -Headers @{ "x-sui402-publisher-token" = $Token } `
  -ContentType "application/json" `
  -Body '{ "ttlSeconds": 900 }' `
  -Uri "$Console/v1/publisher/apis/$ApplicationId/session"

$PublisherSession = $Session.publisherSessionToken
```

Bash:

```bash
APPLICATION_ID="$(jq -r '.application.id' .sui402/publisher-draft.json)"
TOKEN="$(jq -r '.application.verification.accessToken' .sui402/publisher-draft.json)"

SESSION_JSON="$(curl -sS -X POST \
  -H "x-sui402-publisher-token: $TOKEN" \
  -H "content-type: application/json" \
  -d '{"ttlSeconds":900}' \
  "$CONSOLE/v1/publisher/apis/$APPLICATION_ID/session")"

PUBLISHER_SESSION="$(printf '%s' "$SESSION_JSON" | jq -r '.publisherSessionToken')"
```

Rotating the publisher access token invalidates outstanding publisher sessions.

## 6. Check publisher status

PowerShell:

```powershell
$Draft = Get-Content .sui402/publisher-draft.json | ConvertFrom-Json
$ApplicationId = $Draft.application.id

Invoke-RestMethod `
  -Headers @{ Authorization = "Bearer $PublisherSession" } `
  -Uri "$Console/v1/publisher/apis/$ApplicationId/status" |
  ConvertTo-Json -Depth 30
```

Bash:

```bash
APPLICATION_ID="$(jq -r '.application.id' .sui402/publisher-draft.json)"

curl -sS \
  -H "Authorization: Bearer $PUBLISHER_SESSION" \
  "$CONSOLE/v1/publisher/apis/$APPLICATION_ID/status" |
  jq .
```

Use `nextSteps.selfServeActions` for publisher UI checklists and
`nextSteps.operatorActions` for operator queues. Do not expose operator actions
as if the publisher can self-approve.

If the browser refreshes or review takes hours, resume with the application id
and the private publisher access token from the original create response:

```bash
curl -sS \
  -H "x-sui402-publisher-token: $SUI402_PUBLISHER_TOKEN" \
  "$CONSOLE/v1/publisher/apis/$APPLICATION_ID/status" |
  jq .
```

Publisher UIs should keep that token in memory only. Do not put it in URLs,
local storage, analytics, or logs. Exchange it for a short-lived publisher
session again before status/probe workflows when possible.

If this draft was created before private publisher access tokens existed, or if
the access token may have been leaked, ask an operator to rotate it:

```bash
curl -sS -X POST \
  -H "x-sui402-admin-key: $SUI402_OPERATOR_KEY" \
  "$CONSOLE/v1/merchant-applications/$APPLICATION_ID/publisher-access-token/rotate" |
  jq .
```

Use the returned `publisherAccessToken` as `SUI402_PUBLISHER_TOKEN`, then create
a fresh short-lived publisher session. The public `.well-known`/DNS verification
token is intentionally rejected by session/status/probe routes.

## 7. List the published API

The marketplace shows approved listings, not pending drafts.

```bash
curl -sS "$CONSOLE/v1/marketplace/apis?q=api-example-com-v1&network=sui:testnet" |
  jq .
```

With the Sui402 payer CLI:

```bash
npx @sui402/pay marketplace detail api-example-com-v1 \
  --marketplace-url "$CONSOLE"
```

The listing is not public-launch-ready just because it appears. Check
`readiness.ready`, `readiness.reasons`, and paid-test evidence.

## 8. Probe readiness

The publisher probe returns `409` until all readiness gates pass, including real
paid-test evidence.

PowerShell using `curl.exe` so non-2xx bodies are still printed:

```powershell
$Draft = Get-Content .sui402/publisher-draft.json | ConvertFrom-Json
$ApplicationId = $Draft.application.id

curl.exe -sS -X POST `
  -H "Authorization: Bearer $PublisherSession" `
  "$Console/v1/publisher/apis/$ApplicationId/probe"
```

Bash:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $PUBLISHER_SESSION" \
  "$CONSOLE/v1/publisher/apis/$APPLICATION_ID/probe" |
  jq .
```

Read the probe this way:

- `ready: false` with `paidProbe.evidence.status: "missing"` means the gateway
  may be configured, but no verified paid test has been observed yet.
- `unpaidProbe` shows the protected URL and the expected `402` challenge shape.
  It does not reserve or consume a live challenge.
- `paidProbe.nextAction.command` is the safest copyable paid-test command after
  publish because it caps one-shot fallback spend at the listing price.
- Paid-test evidence only counts when it matches the current published listing
  terms exactly: network, merchant wallet, coin type, atomic price, resource
  scope, and resource-scope hash. Old payments from before a price/resource
  change still remain visible in scan, but they do not make the current listing
  launch-ready.
- `paidTestWizard.steps` is the ordered human/agent checklist for this same
  flow. Show `paidTestWizard.currentGate`, the step statuses, and the copyable
  commands in publisher UI instead of asking publishers to infer what to do from
  raw readiness checks.
- `paidTestWizard.commands.paidCall`, when present, is the canonical capped paid
  test call. It still requires a funded, user-owned local Sui wallet; Sui402 does
  not custody payer funds for this step.

If you want to confirm the live unpaid challenge, call the protected URL without
payment:

```bash
PROTECTED_URL="$(curl -sS -X POST -H "Authorization: Bearer $PUBLISHER_SESSION" "$CONSOLE/v1/publisher/apis/$APPLICATION_ID/probe" | jq -r '.unpaidProbe.protectedResourceUrl')"
curl -i "$PROTECTED_URL"
```

Then run the paid test command returned by the probe, or use the marketplace
detail command's `Agent commands` section.

## Operator approval checklist

Before approval:

- ownership proof is `verified`;
- payout wallet proof is attached, or the missing proof is explicitly accepted
  as an operator review risk;
- upstream URL is an allowed public target, not localhost/private metadata;
- price, coin type, network, payout wallet, and resource scope are intentional;
- `preview.reviewDraft.gatewayMerchant` and
  `preview.reviewDraft.registryListing` match the reviewed request;
- unsafe terms, abuse risk, and support/contact details were reviewed.

After approval:

- marketplace detail exists for the merchant/listing id;
- an unpaid call returns a fresh `402` challenge;
- a real payer wallet completes a paid call;
- the publisher probe reports paid evidence and `ready: true`;
- scan/detail pages do not expose request payloads, private upstream config, or
  admin/operator/seller secrets.
