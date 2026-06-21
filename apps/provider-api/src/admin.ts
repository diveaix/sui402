import { timingSafeEqual } from "node:crypto";
import express from "express";
import { listObservedAgentPaymentSessions, type PaymentRecordStore } from "@sui402/server";

export type AdminRouterOptions = {
  apiKey: string;
  paymentRecords?: PaymentRecordStore;
  maxPayments: number;
};

export function createAdminRouter(options: AdminRouterOptions): express.Router {
  const router = express.Router();

  router.use((req, res, next) => {
    if (!isAuthorized(req.header("authorization"), req.header("x-sui402-admin-key"), options.apiKey)) {
      res.status(401).json({
        error: "unauthorized",
        message: "Admin API key is required"
      });
      return;
    }

    next();
  });

  router.get("/payments", async (req, res, next) => {
    try {
      if (!options.paymentRecords) {
        res.status(503).json({
          error: "payment_records_unavailable",
          message: "Payment record storage is not configured"
        });
        return;
      }

      const limit = readLimit(req.query.limit, options.maxPayments);
      const recipient = readOptionalQuery(req.query.recipient);
      const records = recipient
        ? await listByRecipient(options.paymentRecords, recipient, limit)
        : await listRecent(options.paymentRecords, limit);

      res.json({
        records,
        count: records.length
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/payments/:id", async (req, res, next) => {
    try {
      if (!options.paymentRecords) {
        res.status(503).json({
          error: "payment_records_unavailable",
          message: "Payment record storage is not configured"
        });
        return;
      }

      const record = await options.paymentRecords.get(req.params.id);
      if (!record) {
        res.status(404).json({
          error: "payment_record_not_found",
          message: "Payment record was not found"
        });
        return;
      }

      res.json({ record });
    } catch (error) {
      next(error);
    }
  });

  router.get("/sessions", async (req, res, next) => {
    try {
      if (!options.paymentRecords) {
        res.status(503).json({
          error: "payment_records_unavailable",
          message: "Payment record storage is not configured"
        });
        return;
      }

      const sessions = await listObservedAgentPaymentSessions({
        records: options.paymentRecords,
        limit: readLimit(req.query.limit, options.maxPayments),
        payer: readOptionalQuery(req.query.payer),
        merchant: readOptionalQuery(req.query.merchant),
        sessionId: readOptionalQuery(req.query.sessionId)
      });

      res.json({
        sessions,
        count: sessions.length
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/sessions/:sessionId", async (req, res, next) => {
    try {
      if (!options.paymentRecords) {
        res.status(503).json({
          error: "payment_records_unavailable",
          message: "Payment record storage is not configured"
        });
        return;
      }

      const sessions = await listObservedAgentPaymentSessions({
        records: options.paymentRecords,
        limit: 1,
        sessionId: req.params.sessionId
      });
      const session = sessions[0];
      if (!session) {
        res.status(404).json({
          error: "session_not_found",
          message: "Observed payment session was not found"
        });
        return;
      }

      res.json({ session });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function isAuthorized(authorization: string | undefined, headerKey: string | undefined, expected: string): boolean {
  const provided = parseBearerToken(authorization) ?? headerKey;
  if (!provided) {
    return false;
  }

  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

function parseBearerToken(authorization: string | undefined): string | undefined {
  if (!authorization) {
    return undefined;
  }

  const [scheme, token] = authorization.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : undefined;
}

async function listRecent(store: PaymentRecordStore, limit: number) {
  if (!store.listRecent) {
    throw new Error("Payment record store does not support recent payment listing");
  }

  return store.listRecent(limit);
}

async function listByRecipient(store: PaymentRecordStore, recipient: string, limit: number) {
  if (!store.listByRecipient) {
    throw new Error("Payment record store does not support recipient payment listing");
  }

  return (await store.listByRecipient(recipient)).slice(0, limit);
}

function readLimit(value: unknown, max: number): number {
  const parsed = readOptionalQuery(value);
  if (!parsed) {
    return max;
  }

  const limit = Number(parsed);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("limit query parameter must be a positive integer");
  }

  return Math.min(limit, max);
}

function readOptionalQuery(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return readOptionalQuery(value[0]);
  }

  return typeof value === "string" && value.length > 0 ? value : undefined;
}
