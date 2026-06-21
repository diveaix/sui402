import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Sui402Verifier } from "@sui402/sui";
import { ZodError } from "zod";
import { createPaidMcpServer } from "./index.js";
import { loadMcpConfig, loadMcpToolDefinitions } from "./config.js";
import { createMcpStorage } from "./storage.js";

try {
  const config = loadMcpConfig();
  const storage = await createMcpStorage(config);
  const toolDefinitions = loadMcpToolDefinitions(config);
  const verifier = new Sui402Verifier({
    network: config.SUI402_NETWORK,
    grpcUrl: config.SUI402_GRPC_URL,
    sessionPackageId: config.SUI402_SESSION_PACKAGE_ID
  });
  const server = createPaidMcpServer({
    name: config.SUI402_MCP_SERVER_NAME,
    tools: toolDefinitions.map((tool) => ({
        network: config.SUI402_NETWORK,
        recipient: config.SUI402_MERCHANT_ADDRESS,
        coinType: tool.coinType,
        amount: tool.amount,
        resource: tool.resource,
        ttlSeconds: config.SUI402_CHALLENGE_TTL_SECONDS,
        name: tool.name,
        title: tool.title,
        description: tool.description,
        store: storage.challengeStore,
        records: storage.paymentRecords,
        verifier,
        handler: () => ({
          content: [
            {
              type: "text",
              text: JSON.stringify(tool.responseJson, null, 2)
            }
          ]
        })
      }))
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void server.close().finally(async () => {
        await storage.close();
        process.exit(0);
      });
    });
  }
} catch (error) {
  if (error instanceof ZodError) {
    console.error("Invalid MCP configuration");
    console.error(JSON.stringify(error.issues, null, 2));
    process.exit(1);
  }

  throw error;
}
