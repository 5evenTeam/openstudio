import http from "node:http";
import crypto from "node:crypto";
import {
  BRIDGE_HOST,
  BRIDGE_PORT,
  BRIDGE_TOKEN,
  MAX_BODY_BYTES,
  MAX_COMMANDS_PER_REQUEST,
} from "../config.js";
import { BridgeState } from "./state.js";

export interface BridgeHttpServer {
  listen(): void;
  close(): void;
}

function safeEqualToken(received: unknown, expected: string): boolean {
  const left = Buffer.from(String(received ?? ""), "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function parseJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function unauthorized(res: http.ServerResponse): void {
  res.statusCode = 401;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("access-control-allow-origin", "*");
  res.end(JSON.stringify(body));
}

function notFound(res: http.ServerResponse): void {
  json(res, 404, { ok: false, error: "not_found" });
}

export function createBridgeHttpServer(state: BridgeState): BridgeHttpServer {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${BRIDGE_HOST}:${BRIDGE_PORT}`);
      const token =
        req.headers["x-openstudio-token"] ?? url.searchParams.get("token");

      if (!safeEqualToken(token, BRIDGE_TOKEN)) {
        unauthorized(res);
        return;
      }

      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.setHeader("access-control-allow-origin", "*");
        res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
        res.setHeader("access-control-allow-headers", "content-type,x-openstudio-token");
        res.end();
        return;
      }

      if (req.method === "GET" && url.pathname === "/health") {
        json(res, 200, {
          ok: true,
          version: "2",
          bridge: "running",
          studioConnected: state.isStudioConnected(),
          connection: state.connection
            ? {
                clientId: state.connection.clientId,
                version: state.connection.version,
                capabilities: state.connection.capabilities ?? [],
                lastHeartbeat: state.connection.lastHeartbeat,
                gameName: state.connection.gameName,
                gameId: state.connection.gameId,
                placeId: state.connection.placeId,
              }
            : null,
          pendingCommands: state.pendingCount(),
          queuedCommands: state.queueSize(),
          logsBuffered: state.peekLogs().length,
          permissionLevel: state.permissionLevel,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/heartbeat") {
        const body = await parseJson(req);
        state.setHeartbeat(
          String(body.clientId ?? "studio"),
          body.version ? String(body.version) : undefined,
          Array.isArray(body.capabilities) ? body.capabilities.map(String) : undefined,
          {
            gameName: body.gameName ? String(body.gameName) : undefined,
            gameId: body.gameId !== undefined ? Number(body.gameId) : undefined,
            placeId: body.placeId !== undefined ? Number(body.placeId) : undefined,
          },
        );
        if (Array.isArray(body.logs)) {
          state.pushLogs(
            body.logs.map((entry: any) => ({
              timestamp: Number(entry.timestamp ?? Date.now()),
              message: String(entry.message ?? ""),
              messageType: entry.messageType ? String(entry.messageType) : undefined,
              source: entry.source ? String(entry.source) : undefined,
            })),
          );
        }
        json(res, 200, { ok: true });
        return;
      }

      if (req.method === "GET" && url.pathname === "/commands") {
        const waitRaw = Number(url.searchParams.get("wait") ?? 0);
        const wait = Number.isFinite(waitRaw) ? waitRaw : 0;
        if (wait > 0) {
          const commands = await state.waitForCommands(wait);
          json(res, 200, { ok: true, commands });
          return;
        }
        const limitRaw = Number(url.searchParams.get("limit") ?? MAX_COMMANDS_PER_REQUEST);
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, MAX_COMMANDS_PER_REQUEST)) : MAX_COMMANDS_PER_REQUEST;
        const commands = state.dequeueAll(limit);
        json(res, 200, { ok: true, commands });
        return;
      }

      if (req.method === "POST" && url.pathname === "/result") {
        const body = await parseJson(req);
        const result = {
          id: String(body.id),
          ok: Boolean(body.ok),
          data: body.data,
          error: body.error ? String(body.error) : undefined,
        };
        const accepted = state.resolvePending(result);
        json(res, 200, { ok: accepted });
        return;
      }

      if (req.method === "POST" && url.pathname === "/results") {
        const body = await parseJson(req);
        const results = Array.isArray(body.results) ? body.results : Array.isArray(body) ? body : [];
        const normalized = results.map((entry: any) => ({
          id: String(entry.id),
          ok: Boolean(entry.ok),
          data: entry.data,
          error: entry.error ? String(entry.error) : undefined,
        }));
        const accepted = state.resolvePendingMany(normalized);
        json(res, 200, { ok: true, accepted, total: normalized.length });
        return;
      }

      if (req.method === "POST" && url.pathname === "/log") {
        const body = await parseJson(req);
        const entries = Array.isArray(body.logs) ? body.logs : [body];
        state.pushLogs(
          entries.map((entry: any) => ({
            timestamp: Number(entry.timestamp ?? Date.now()),
            message: String(entry.message ?? ""),
            messageType: entry.messageType ? String(entry.messageType) : undefined,
            source: entry.source ? String(entry.source) : undefined,
          })),
        );
        json(res, 200, { ok: true });
        return;
      }

      notFound(res);
    } catch (error) {
      json(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return {
    listen(): void {
      server.on("error", (error) => { console.error("[OpenStudio] bridge error:", (error as Error).message); });
      server.listen(BRIDGE_PORT, BRIDGE_HOST, () => {
        console.error(`[OpenStudio] bridge listening on http://${BRIDGE_HOST}:${BRIDGE_PORT}`);
      });
    },
    close(): void {
      server.close();
    },
  };
}

