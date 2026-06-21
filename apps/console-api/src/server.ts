import { ZodError } from "zod";
import { createConfiguredConsoleStores, createConsoleApp } from "./app.js";
import { loadConsoleConfig } from "./config.js";

try {
  const config = loadConsoleConfig();
  const stores = await createConfiguredConsoleStores(config, config.NODE_ENV !== "production");
  const app = createConsoleApp(config, { stores, seed: config.NODE_ENV !== "production" });
  const server = app.listen(config.PORT, () => {
    console.log(`sui402-console-api listening on http://localhost:${config.PORT}`);
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      server.close(() => {
        void stores.close?.().finally(() => {
          process.exit(0);
        });
      });
    });
  }
} catch (error) {
  if (error instanceof ZodError) {
    console.error("Invalid console API configuration");
    console.error(JSON.stringify(error.issues, null, 2));
    process.exit(1);
  }

  throw error;
}
