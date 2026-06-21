import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createProviderScaffold, renderProviderScaffold } from "../src/index.js";

const MERCHANT = `0x${"a".repeat(64)}`;

describe("create-sui402", () => {
  it("renders a provider scaffold", () => {
    const files = renderProviderScaffold({
      name: "paid-provider",
      merchant: MERCHANT,
      price: "1000",
      resourceScope: "api:*"
    });

    expect(files.map((file) => file.path)).toEqual([
      "package.json",
      "tsconfig.json",
      ".env.example",
      "src/server.ts",
      "README.md"
    ]);
    expect(files.find((file) => file.path === ".env.example")?.contents).toContain(`SUI402_MERCHANT_ADDRESS=${MERCHANT}`);
    expect(files.find((file) => file.path === "src/server.ts")?.contents).toContain("createProviderApp");
  });

  it("writes scaffold files without overwriting existing files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sui402-create-"));

    try {
      await createProviderScaffold(dir, {
        name: "paid-provider",
        merchant: MERCHANT,
        price: "1000"
      });

      await expect(readFile(join(dir, "src/server.ts"), "utf8")).resolves.toContain("@sui402/provider-api");
      await expect(
        createProviderScaffold(dir, {
          name: "paid-provider",
          merchant: MERCHANT,
          price: "1000"
        })
      ).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
