import { ZodError } from "zod";
import { createProviderApp } from "./app.js";
import { loadProviderConfig } from "./config.js";
import { createProviderStorage } from "./storage.js";

try {
  const config = loadProviderConfig();
  const storage = await createProviderStorage(config);
  const app = createProviderApp(config, {
    challengeStore: storage.challengeStore,
    paymentRecords: storage.paymentRecords,
    receiptSequenceStore: storage.receiptSequenceStore,
    rateLimiter: storage.rateLimiter,
    readinessChecks: storage.readinessChecks
  });

  const server = app.listen(config.PORT, () => {
    console.log(`${config.SUI402_SERVICE_NAME} listening on http://localhost:${config.PORT}`);
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      server.close(async () => {
        await storage.close();
        process.exit(0);
      });
    });
  }
} catch (error) {
  if (error instanceof ZodError) {
    console.error("Invalid provider configuration");
    console.error(JSON.stringify(error.issues, null, 2));
    process.exit(1);
  }

  throw error;
}
