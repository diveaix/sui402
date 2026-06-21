# Paid MCP Tools

`@sui402/mcp` lets a provider protect MCP tools with Sui402 payment challenges.
The package has two surfaces:

- `checkPaidToolCall` for custom tool servers.
- `registerPaidMcpTool` / `createPaidMcpServer` for standard MCP server wiring.

## Production Stdio Server

The bundled `sui402-mcp` binary exposes paid MCP tools over stdio. It supports
both a backwards-compatible single-tool mode and a multi-tool registry mode.

```text
SUI402_NETWORK=sui:testnet
SUI402_GRPC_URL=https://fullnode.testnet.sui.io:443
SUI402_MERCHANT_ADDRESS=0x...
SUI402_COIN_TYPE=0x2::sui::SUI
SUI402_PRICE=1000000
SUI402_MCP_SERVER_NAME=sui402-paid-tools
SUI402_MCP_TOOL_NAME=paid_resource
SUI402_MCP_TOOL_DESCRIPTION=Sui402 protected MCP tool
SUI402_MCP_RESPONSE_JSON={"ok":true,"paid":true}
SUI402_REDIS_URL=redis://localhost:6379
SUI402_POSTGRES_URL=postgres://sui402:sui402@localhost:5432/sui402
```

For multiple paid tools, set `SUI402_MCP_TOOLS_JSON` to a JSON array. Tool-level
`amount`, `coinType`, `description`, and `responseJson` override the defaults.
If a tool omits `resource`, the server binds payment challenges to `mcp:<name>`.

```json
[
  {
    "name": "premium_context",
    "title": "Premium Context",
    "description": "Premium market context for agents",
    "amount": "1000000",
    "responseJson": {
      "ok": true,
      "context": "paid context payload"
    }
  },
  {
    "name": "portfolio_snapshot",
    "resource": "mcp:wallet/portfolio_snapshot",
    "amount": "250000",
    "responseJson": {
      "ok": true,
      "snapshot": []
    }
  }
]
```

In `NODE_ENV=production`, the MCP server refuses to start unless Redis and
Postgres are configured. Redis stores issued challenges; Postgres stores the
payment ledger and blocks `network + txDigest` reuse.

## MCP Client Config

Use `sui402-mcp-config` to generate an MCP client config block for Claude,
Cursor, or any MCP client that accepts the standard `mcpServers` shape.

```bash
sui402-mcp-config \
  --merchant 0x... \
  --price 1000000 \
  --tool-name premium_context
```

The command prints:

```json
{
  "mcpServers": {
    "sui402-paid-tools": {
      "command": "sui402-mcp",
      "args": [],
      "env": {
        "SUI402_NETWORK": "sui:testnet",
        "SUI402_MERCHANT_ADDRESS": "0x...",
        "SUI402_PRICE": "1000000"
      }
    }
  }
}
```

For a local monorepo checkout, point the command at the built server:

```bash
sui402-mcp-config \
  --merchant 0x... \
  --price 1000000 \
  --command node \
  --arg F:/Downloads/sui-hack/packages/mcp/dist/server.js
```

Use `--out <path>` to write a config file. Existing files are not overwritten
unless `--force` is passed.

## Custom Paid Tool

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPaidMcpTool } from "@sui402/mcp";

const server = new McpServer({ name: "seller-tools", version: "1.0.0" });

registerPaidMcpTool({
  server,
  network: "sui:testnet",
  recipient: "0x...",
  coinType: "0x2::sui::SUI",
  amount: "1000000",
  name: "premium_context",
  resource: "mcp:research/premium_context",
  description: "Premium context for agents",
  store: challengeStore,
  records: paymentRecords,
  verifier,
  handler: async () => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(await loadPremiumContext())
      }
    ]
  })
});
```

For production custom tools, pass a durable `ChallengeStore` and
`PaymentRecordStore`. Without `PaymentRecordStore.getByProof`, a tool can still
consume each challenge once, but cannot detect one transaction digest being
replayed against another challenge.
