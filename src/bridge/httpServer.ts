import http from "node:http";
import { BRIDGE_HOST, BRIDGE_PORT, BRIDGE_TOKEN, STUDIO_TIMEOUT_MS } from "../config.js";
import { BridgeState } from "./state.js";
import { StudioCommand } from "./state.js";

export interface BridgeHttpServer {
  listen(): void;
  close(): void;
}

function parseJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
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

export function createBridgeHttpServer(state: BridgeState): BridgeHttpServer {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${BRIDGE_HOST}:${BRIDGE_PORT}`);
      const token = req.headers["x-openstudio-token"] ?? url.searchParams.get("token");

      if (token !== BRIDGE_TOKEN) {
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
          studioConnected: state.isStudioConnected(10_000),
          pendingCommands: state.pendingCount(),
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
            })),
          );
        }
        json(res, 200, { ok: true });
        return;
      }

      if (req.method === "GET" && url.pathname === "/commands") {
        const commands = state.dequeueAll();
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

      json(res, 404, { ok: false, error: "not_found" });
    } catch (error) {
      json(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return {
    listen(): void {
      server.listen(BRIDGE_PORT, BRIDGE_HOST, () => {
        // eslint-disable-next-line no-console
        console.error(`[OpenStudio] bridge listening on http://${BRIDGE_HOST}:${BRIDGE_PORT}`);
      });
    },
    close(): void {
      server.close();
    },
  };
}
