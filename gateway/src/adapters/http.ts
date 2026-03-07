import { existsSync, readFileSync } from "fs";
import path from "path";
import Fastify, { type FastifyInstance } from "fastify";
import type { ChannelAdapter, UnifiedMessage, OutboundResponse } from "../types.js";
import { formatResponse, formatForChannel } from "../format.js";
import type { SessionStore } from "../session-store.js";
import { discoverAgents } from "../agents.js";

const SCHEDULER_PING_PATH = path.resolve(import.meta.dir, "..", "..", "data", "scheduler-ping.txt");
const SCHEDULER_STALE_SECONDS = 600; // 10 minutes

export function checkSchedulerPing(): { ok: boolean; lastPing: number | null; ageSeconds: number | null } {
  if (!existsSync(SCHEDULER_PING_PATH)) return { ok: false, lastPing: null, ageSeconds: null };
  const ts = parseInt(readFileSync(SCHEDULER_PING_PATH, "utf-8").trim(), 10);
  if (isNaN(ts)) return { ok: false, lastPing: null, ageSeconds: null };
  const age = Math.floor(Date.now() / 1000) - ts;
  return { ok: age < SCHEDULER_STALE_SECONDS, lastPing: ts, ageSeconds: age };
}

export class HttpAdapter implements ChannelAdapter {
  readonly name = "http" as const;
  private app: FastifyInstance;
  private handlers: ((msg: UnifiedMessage) => void)[] = [];
  private pendingResponses: Map<string, (response: OutboundResponse) => void> = new Map();

  constructor(
    private port: number = 18789,
    private host: string = "127.0.0.1",
    private sessionStore?: SessionStore
  ) {
    this.app = Fastify({ logger: false });
    this.setupRoutes();
  }

  getApp(): FastifyInstance {
    return this.app;
  }

  private setupRoutes() {
    // POST /api/message — receive message from HTTP client
    this.app.post<{
      Body: { text: string; id?: string; sender_id?: string };
    }>("/api/message", async (req, reply) => {
      const body = req.body;
      if (!body?.text) {
        return reply.status(400).send({ error: "text field required" });
      }

      const msgId = crypto.randomUUID();
      const msg: UnifiedMessage = {
        id: msgId,
        channel: "http",
        channelMessageId: body.id || msgId,
        chatId: "http",
        senderId: body.sender_id,
        content: { text: body.text },
        timestamp: new Date().toISOString(),
      };

      // Set up a promise to capture the response
      const responsePromise = new Promise<OutboundResponse>((resolve) => {
        this.pendingResponses.set(msgId, resolve);
        // Timeout after 120s
        setTimeout(() => {
          if (this.pendingResponses.has(msgId)) {
            this.pendingResponses.delete(msgId);
            resolve({
              agent: "system",
              channel: "http",
              chatId: "http",
              content: { text: "Request timed out" },
            });
          }
        }, 120_000);
      });

      this.handlers.forEach((h) => h(msg));

      const response = await responsePromise;
      return {
        status: "ok",
        messageId: msgId,
        agent: response.agent,
        response: formatResponse(response),
      };
    });

    // GET /health
    this.app.get("/health", async () => {
      const scheduler = checkSchedulerPing();
      return {
        status: "ok",
        uptime: process.uptime(),
        activeSessions: this.sessionStore?.activeCount() ?? 0,
        scheduler: {
          ok: scheduler.ok,
          lastPingAge: scheduler.ageSeconds,
        },
      };
    });

    // GET /api/sessions
    this.app.get("/api/sessions", async () => {
      return this.sessionStore?.listSessions() ?? [];
    });

    // GET /api/sessions/:agent/history
    this.app.get<{ Params: { agent: string }; Querystring: { limit?: string } }>(
      "/api/sessions/:agent/history",
      async (req) => {
        const limit = parseInt(req.query.limit || "50", 10);
        return this.sessionStore?.getHistory(req.params.agent, limit) ?? [];
      }
    );

    // POST /api/sessions/:agent/log
    this.app.post<{
      Params: { agent: string };
      Body: { role: "user" | "assistant" | "system"; text: string; channel?: string; source?: string };
    }>("/api/sessions/:agent/log", async (req) => {
      const { role, text, channel, source } = req.body;
      this.sessionStore?.logMessage(req.params.agent, role, text, channel, source || "tropicron");
      return { status: "ok" };
    });

    // GET /api/agents
    this.app.get("/api/agents", async () => {
      return discoverAgents();
    });
  }

  async start() {
    await this.app.listen({ port: this.port, host: this.host });
    console.log(`[gateway] HTTP adapter listening on ${this.host}:${this.port}`);
  }

  async stop() {
    await this.app.close();
  }

  async send(response: OutboundResponse) {
    // For HTTP, responses are returned inline via pendingResponses
    // Find the pending response handler for this message
    const handler = this.pendingResponses.get(response.replyToMessageId || "");
    if (handler) {
      this.pendingResponses.delete(response.replyToMessageId || "");
      handler(response);
    }
  }

  on(event: "message", handler: (msg: UnifiedMessage) => void) {
    this.handlers.push(handler);
  }
}
