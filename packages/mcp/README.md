# @sui402/mcp

MCP server and client helpers for Sui402-protected tool calls.

```bash
npm install @sui402/mcp
```

Use this package when exposing paid MCP tools or consuming Sui402-protected MCP
capabilities.

## Ready-to-run server

The package ships two binaries:

- `sui402-mcp`: stdio MCP server for one or more paid tools.
- `sui402-mcp-config`: config generator for Claude, Cursor, and other MCP
  clients that accept the `mcpServers` shape.

```bash
sui402-mcp-config \
  --merchant 0x... \
  --price 1000000 \
  --tool-name premium_context
```

For multiple paid tools, set `SUI402_MCP_TOOLS_JSON`:

```json
[
  {
    "name": "premium_context",
    "description": "Premium context for agents",
    "amount": "1000000",
    "resource": "mcp:research/premium_context",
    "responseJson": { "ok": true }
  }
]
```

In production, configure Redis and Postgres. Redis stores challenges; Postgres
stores payment records and blocks transaction digest replay.

## Custom tool servers

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
  verifier,
  store: challengeStore,
  records: paymentRecords,
  handler: async () => ({
    content: [{ type: "text", text: JSON.stringify({ ok: true }) }]
  })
});
```

See `docs/mcp.md` and `docs/product-quickstart.md` from the repository root for
the full setup.
