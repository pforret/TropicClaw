import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import path from "path";
import type { UnifiedMessage, OutboundResponse, GatewayConfig, ChannelAdapter } from "./types.js";
import { SessionStore } from "./session-store.js";
import { AgentPool } from "./agent-pool.js";
import { discoverAgents, getAgent } from "./agents.js";
import { formatResponse, formatForChannel } from "./format.js";
import { stageMedia } from "./media.js";

const AGENTS_DIR = path.resolve(import.meta.dir, "..", "agents");
const TEMPLATES_DIR = path.resolve(import.meta.dir, "..", "templates");

export class Router {
  private adapters: Map<string, ChannelAdapter> = new Map();

  constructor(
    private config: GatewayConfig,
    private sessionStore: SessionStore,
    private agentPool: AgentPool
  ) {}

  registerAdapter(adapter: ChannelAdapter) {
    this.adapters.set(adapter.name, adapter);
    adapter.on("message", (msg) => this.handleMessage(msg));
  }

  private isOwner(message: UnifiedMessage): boolean {
    if (message.channel === "http") return true;

    const ownerIds: Record<string, string | undefined> = {
      telegram: this.config.owner.telegram_id,
      slack: this.config.owner.slack_id,
      discord: this.config.owner.discord_id,
    };

    const expectedId = ownerIds[message.channel];
    if (!expectedId) return true; // No owner configured for this channel — allow
    return message.senderId === expectedId;
  }

  async handleMessage(message: UnifiedMessage) {
    // Layer 1: Owner verification
    if (!this.isOwner(message)) return; // silent drop

    // Stage media if present
    if (message.content.media?.url) {
      try {
        await stageMedia(message);
      } catch {
        // Continue without media
      }
    }

    const text = message.content.text.trim();

    // Check for /command prefix
    if (text.startsWith("/")) {
      const response = await this.handleCommand(text, message);
      if (response) {
        await this.sendResponse(response, message);
        return;
      }
    }

    // Resolve current agent for this channel
    const agentName = this.sessionStore.getCurrentAgent(message.channel, message.chatId);
    const agent = getAgent(agentName);

    if (!agent) {
      await this.sendResponse(
        this.makeResponse("system", message, `Agent "${agentName}" not found. Falling back to main.`),
        message
      );
      this.sessionStore.switchAgent(message.channel, message.chatId, "main");
      return;
    }

    // Log inbound message
    this.sessionStore.logMessage(agentName, "user", text, message.channel);

    // Build prompt with media context
    let prompt = text;
    if (message.content.media?.localPath) {
      prompt = `[Attached ${message.content.media.type}: ${message.content.media.localPath}] ${text}`;
    }

    // Dispatch to agent pool
    const startTime = Date.now();
    try {
      const result = await this.agentPool.dispatch(agent, prompt, message);
      const latencyMs = Date.now() - startTime;

      // Log response
      this.sessionStore.logMessage(agentName, "assistant", result, message.channel, "gateway", latencyMs);

      // Send response
      const response = this.makeResponse(agentName, message, result);
      await this.sendResponse(response, message);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      const response = this.makeResponse(agentName, message, `Error: ${errorMsg}`);
      await this.sendResponse(response, message);
    }
  }

  private async handleCommand(
    text: string,
    message: UnifiedMessage
  ): Promise<OutboundResponse | null> {
    const parts = text.split(/\s+/);
    const command = parts[0].toLowerCase();

    switch (command) {
      case "/agents": {
        const agents = discoverAgents();
        const currentAgent = this.sessionStore.getCurrentAgent(message.channel, message.chatId);
        const lines = agents.map((a) => {
          const current = a.name === currentAgent ? " (current)" : "";
          return `  ${a.name} — ${a.description || "no description"}${current}`;
        });
        return this.makeResponse("system", message, `Available agents:\n${lines.join("\n")}`);
      }

      case "/switch": {
        const name = parts[1];
        if (!name) {
          return this.makeResponse("system", message, "Usage: /switch <agent-name>");
        }
        const agent = getAgent(name);
        if (!agent) {
          return this.makeResponse("system", message, `Agent "${name}" not found. Use /agents to list.`);
        }
        this.sessionStore.switchAgent(message.channel, message.chatId, name);
        return this.makeResponse(name, message, "Ready. What are we working on?");
      }

      case "/current": {
        const current = this.sessionStore.getCurrentAgent(message.channel, message.chatId);
        return this.makeResponse("system", message, `Current agent: ${current}`);
      }

      case "/back": {
        const prev = this.sessionStore.getPreviousAgent(message.channel, message.chatId);
        if (!prev) {
          return this.makeResponse("system", message, "No previous agent to switch back to.");
        }
        this.sessionStore.switchAgent(message.channel, message.chatId, prev);
        return this.makeResponse(prev, message, "Welcome back.");
      }

      case "/new": {
        const name = parts[1];
        if (!name) {
          return this.makeResponse("system", message, "Usage: /new <name> [description]");
        }
        const desc = parts.slice(2).join(" ") || "";
        return this.scaffoldAgent(name, desc, message);
      }

      default:
        return null; // Not a gateway command, pass through to agent
    }
  }

  private scaffoldAgent(
    name: string,
    description: string,
    message: UnifiedMessage
  ): OutboundResponse {
    const agentDir = path.join(AGENTS_DIR, name);

    if (existsSync(agentDir)) {
      return this.makeResponse("system", message, `Agent "${name}" already exists.`);
    }

    // Scaffold directory
    mkdirSync(path.join(agentDir, ".claude"), { recursive: true });

    // Use default template
    const templatePath = path.join(TEMPLATES_DIR, "default-agent.md");
    let claudeMd: string;
    if (existsSync(templatePath)) {
      const template = readFileSync(templatePath, "utf-8");
      claudeMd = template.replace(/\{name\}/g, name).replace(/\{description\}/g, description);
    } else {
      claudeMd = `# Agent: ${name}\n\n${description}\n\n## Behavior\n- Be concise and direct\n- Ask for clarification when the task is ambiguous\n`;
    }

    writeFileSync(path.join(agentDir, "CLAUDE.md"), claudeMd);
    writeFileSync(
      path.join(agentDir, "agent.yaml"),
      `description: "${description}"\nmodel: sonnet\nmax_turns: 20\ntrust_tier: 1\ntimeout: 120\n`
    );
    writeFileSync(path.join(agentDir, ".claude", "settings.json"), "{}");

    // Switch to new agent
    this.sessionStore.switchAgent(message.channel, message.chatId, name);

    return this.makeResponse(
      name,
      message,
      `Ready. I'm a new agent created from template. What should I know about my role?`
    );
  }

  private makeResponse(agent: string, message: UnifiedMessage, text: string): OutboundResponse {
    return {
      agent,
      channel: message.channel,
      chatId: message.chatId,
      content: { text },
      replyToMessageId: message.channelMessageId,
    };
  }

  private async sendResponse(response: OutboundResponse, _message: UnifiedMessage) {
    const adapter = this.adapters.get(response.channel);
    if (!adapter) return;
    await adapter.send(response);
  }

  // Used by tropicron to deliver output to channels
  async deliver(
    channel: string,
    chatId: string,
    text: string,
    agent: string = "system"
  ) {
    const adapter = this.adapters.get(channel);
    if (!adapter) throw new Error(`Channel "${channel}" not configured`);

    const response: OutboundResponse = {
      agent,
      channel: channel as any,
      chatId,
      content: { text },
    };
    await adapter.send(response);
  }
}
