import { describe, expect, it } from "vitest";
import { renderMcpClientConfig, renderSui402McpClientConfig } from "../src/client-config.js";

const MERCHANT = `0x${"a".repeat(64)}`;

describe("MCP client config generator", () => {
  it("renders an MCP client config", () => {
    const rendered = renderMcpClientConfig({
      serverName: "sui402-paid-tools",
      command: "sui402-mcp",
      args: ["--stdio"],
      env: {
        SUI402_PRICE: "1000",
        EMPTY_VALUE: "",
        OMITTED_VALUE: undefined,
        SUI402_NETWORK: "sui:testnet"
      }
    });

    expect(JSON.parse(rendered)).toEqual({
      mcpServers: {
        "sui402-paid-tools": {
          command: "sui402-mcp",
          args: ["--stdio"],
          env: {
            SUI402_NETWORK: "sui:testnet",
            SUI402_PRICE: "1000"
          }
        }
      }
    });
  });

  it("renders a Sui402 MCP single-tool client config", () => {
    const rendered = renderSui402McpClientConfig({
      merchantAddress: MERCHANT,
      price: "1000",
      toolName: "premium_context",
      responseJson: '{"ok":true}'
    });
    const config = JSON.parse(rendered);

    expect(config.mcpServers["sui402-paid-tools"].env).toMatchObject({
      NODE_ENV: "development",
      SUI402_MERCHANT_ADDRESS: MERCHANT,
      SUI402_PRICE: "1000",
      SUI402_MCP_TOOL_NAME: "premium_context",
      SUI402_MCP_RESPONSE_JSON: '{"ok":true}'
    });
  });

  it("renders production config when durable stores are supplied", () => {
    const rendered = renderSui402McpClientConfig({
      merchantAddress: MERCHANT,
      price: "1000",
      redisUrl: "redis://localhost:6379",
      postgresUrl: "postgres://sui402:sui402@localhost:5432/sui402"
    });
    const config = JSON.parse(rendered);

    expect(config.mcpServers["sui402-paid-tools"].env).toMatchObject({
      NODE_ENV: "production",
      SUI402_REDIS_URL: "redis://localhost:6379",
      SUI402_POSTGRES_URL: "postgres://sui402:sui402@localhost:5432/sui402"
    });
  });

  it("renders a multi-tool client config", () => {
    const toolsJson = JSON.stringify([
      {
        name: "premium_context",
        amount: "1000",
        responseJson: { ok: true }
      }
    ]);
    const rendered = renderSui402McpClientConfig({
      merchantAddress: MERCHANT,
      price: "500",
      toolsJson
    });
    const config = JSON.parse(rendered);

    expect(config.mcpServers["sui402-paid-tools"].env.SUI402_MCP_TOOLS_JSON).toBe(toolsJson);
  });

  it("rejects invalid merchant addresses", () => {
    expect(() =>
      renderSui402McpClientConfig({
        merchantAddress: "0x123",
        price: "1000"
      })
    ).toThrow();
  });

  it("rejects invalid response JSON", () => {
    expect(() =>
      renderSui402McpClientConfig({
        merchantAddress: MERCHANT,
        price: "1000",
        responseJson: "{ok:true}"
      })
    ).toThrow("--response-json must be valid JSON");
  });
});
