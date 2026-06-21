import { z } from "zod";

export const ConsoleArtifactExportSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["payment-ledger", "receipt-bundle", "audit-head"]),
  artifactId: z.string().regex(/^[a-f0-9]{64}$/i),
  artifactKind: z.string().min(1),
  blobId: z.string().min(1),
  objectId: z.string().min(1).optional(),
  endEpoch: z.number().int().nonnegative().optional(),
  paymentCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export type ConsoleArtifactExport = z.infer<typeof ConsoleArtifactExportSchema>;

export type ArtifactExportStore = {
  record(exportRecord: ConsoleArtifactExport): Promise<void> | void;
  get(id: string): Promise<ConsoleArtifactExport | undefined> | ConsoleArtifactExport | undefined;
  list(limit?: number): Promise<ConsoleArtifactExport[]> | ConsoleArtifactExport[];
};

export class MemoryArtifactExportStore implements ArtifactExportStore {
  readonly #exports = new Map<string, ConsoleArtifactExport>();

  record(exportRecord: ConsoleArtifactExport): void {
    this.#exports.set(exportRecord.id, exportRecord);
  }

  get(id: string): ConsoleArtifactExport | undefined {
    return this.#exports.get(id);
  }

  list(limit = 100): ConsoleArtifactExport[] {
    return [...this.#exports.values()]
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, limit);
  }
}
