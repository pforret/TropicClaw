import { readFileSync, existsSync } from "fs";
import path from "path";
import { parse as parseYaml } from "yaml";
import type { GatewayConfig } from "./types.js";
import { SessionStore } from "./session-store.js";
import { AgentPool } from "./agent-pool.js";
import { Router } from "./router.js";
import { HttpAdapter } from "./adapters/http.js";
import { TelegramAdapter } from "./adapters/telegram.js";
import { discoverAgents } from "./agents.js";
import { registerWebRoutes, buildChannelInfo } from "./web.js";
import { checkSchedulerPing } from "./adapters/http.js";

// Strip CLAUDECODE env var so spawned claude processes don't detect nesting
if (process.env.CLAUDECODE) {
  console.warn("[gateway] CLAUDECODE env var detected — clearing it to allow claude -p subprocesses");
  delete process.env.CLAUDECODE;
}

// Load gateway config
const CONFIG_PATH = path.resolve(import.meta.dir, "..", "config", "gateway.yaml");
let gatewayYaml: Record<string, any> = {};
if (existsSync(CONFIG_PATH)) {
  gatewayYaml = parseYaml(readFileSync(CONFIG_PATH, "utf-8")) ?? {};
}

const config: GatewayConfig = {
  owner: {
    telegram_id: gatewayYaml.owner?.telegram_id || process.env.TELEGRAM_OWNER_ID || process.env.OWNER_TELEGRAM_ID,
    slack_id: gatewayYaml.owner?.slack_id ?? process.env.OWNER_SLACK_ID,
    discord_id: gatewayYaml.owner?.discord_id ?? process.env.OWNER_DISCORD_ID,
  },
  port: parseInt(process.env.GATEWAY_PORT || String(gatewayYaml.port || 18789), 10),
  host: process.env.GATEWAY_HOST || gatewayYaml.host || "127.0.0.1",
  max_concurrent_agents: parseInt(
    process.env.MAX_CONCURRENT_AGENTS || String(gatewayYaml.max_concurrent_agents || 3),
    10
  ),
};

// Initialize components
const sessionStore = new SessionStore();
const agentPool = new AgentPool(config.max_concurrent_agents);
const router = new Router(config, sessionStore, agentPool);

// Discover agents
const agents = discoverAgents();
console.log(`[gateway] Discovered ${agents.length} agent(s): ${agents.map((a) => a.name).join(", ") || "none"}`);

// Start HTTP adapter (always)
const httpAdapter = new HttpAdapter(config.port, config.host, sessionStore);

// Wire up /api/deliver endpoint to the router
const app = httpAdapter.getApp();
app.post<{
  Body: { channel: string; target: string; text: string; agent?: string };
}>("/api/deliver", async (req) => {
  const { channel, target, text, agent } = req.body;
  await router.deliver(channel, target, text, agent || "system");
  return { status: "delivered" };
});

// Build channel info and register web dashboard routes
const channelInfos = buildChannelInfo();
registerWebRoutes(app, sessionStore, channelInfos);

router.registerAdapter(httpAdapter);

// Set up typing callback
agentPool.setTypingCallback((channel, chatId) => {
  const adapter = channel === "telegram" ? telegramAdapter : undefined;
  adapter?.sendTyping?.(chatId);
});

// Start Telegram adapter (if token provided)
let telegramAdapter: TelegramAdapter | undefined;
const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
if (telegramToken) {
  const ownerId = config.owner.telegram_id || "";
  telegramAdapter = new TelegramAdapter(telegramToken, ownerId);
  router.registerAdapter(telegramAdapter);
}

// Start all adapters
async function start() {
  console.log("[gateway] Starting TropicClaw Gateway...");

  await httpAdapter.start();

  if (telegramAdapter) {
    await telegramAdapter.start();
    const tgInfo = channelInfos.find((c) => c.name === "telegram");
    if (tgInfo) tgInfo.running = true;
  }

  // Check scheduler heartbeat
  const ping = checkSchedulerPing();
  if (!ping.ok) {
    if (ping.lastPing === null) {
      console.warn("[gateway] Scheduler ping file not found — tropicron may not be running");
    } else {
      console.warn(`[gateway] Scheduler last ping ${ping.ageSeconds}s ago (>600s) — tropicron may be down`);
    }
  }

  console.log("[gateway] Gateway ready.");
}

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`\n[gateway] ${signal} received, shutting down...`);
  if (telegramAdapter) await telegramAdapter.stop();
  await httpAdapter.stop();
  sessionStore.close();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

start().catch((err) => {
  console.error("[gateway] Failed to start gateway:", err);
  process.exit(1);
});
