import { randomUUID } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type Logger = {
  log: (level: LogLevel, event: string, fields?: Record<string, unknown>) => void;
};

export function createJsonLogger(service: string): Logger {
  return {
    log(level, event, fields = {}) {
      const entry = {
        timestamp: new Date().toISOString(),
        level,
        service,
        event,
        ...fields
      };

      const line = JSON.stringify(entry);
      if (level === "error") {
        console.error(line);
      } else if (level === "warn") {
        console.warn(line);
      } else {
        console.log(line);
      }
    }
  };
}

export function requestContext(logger: Logger): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    const requestId = req.header("x-request-id") ?? randomUUID();
    res.locals.requestId = requestId;
    res.setHeader("x-request-id", requestId);

    res.on("finish", () => {
      logger.log("info", "http_request", {
        requestId,
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
        ip: req.ip
      });
    });

    next();
  };
}

export function securityHeaders(): RequestHandler {
  return (_req, res, next) => {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("x-frame-options", "DENY");
    next();
  };
}
