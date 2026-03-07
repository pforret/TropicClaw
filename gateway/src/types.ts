export interface UnifiedMessage {
  id: string;
  channel: ChannelName;
  channelMessageId: string;
  chatId: string;
  senderId?: string;
  content: {
    text: string;
    media?: {
      type: "image" | "audio" | "video" | "file";
      url: string;
      localPath?: string;
      mimeType?: string;
      fileId?: string;
      fileName?: string;
    };
    voice?: {
      isVoice: true;
      originalFileId: string;
      duration: number;
      transcription: string;
    };
  };
  timestamp: string;
  replyTo?: string;
}

export interface OutboundResponse {
  agent: string;
  channel: ChannelName;
  chatId: string;
  content: {
    text: string;
    media?: {
      type: "image" | "file";
      localPath: string;
    };
  };
  replyToMessageId?: string;
  replyAs?: "text" | "voice" | "both";
}

export interface AgentConfig {
  name: string;
  description: string;
  model: string;
  max_turns: number;
  trust_tier: number;
  timeout: number;
  allowed_tools?: string[];
  directory: string;
}

export interface GatewayConfig {
  owner: {
    telegram_id?: string;
    slack_id?: string;
    discord_id?: string;
  };
  port: number;
  host: string;
  max_concurrent_agents: number;
}

export type ChannelName = "telegram" | "slack" | "discord" | "http";

export interface ChannelAdapter {
  readonly name: ChannelName;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(response: OutboundResponse): Promise<void>;
  sendTyping?(chatId: string): Promise<void>;
  on(event: "message", handler: (msg: UnifiedMessage) => void): void;
}

/**
 * An app route matches incoming messages by regex and handles them.
 * Routes are tested in priority order (lower = first). First match wins.
 * If no route matches, the message falls through to the LLM agent.
 */
export interface AppRoute {
  /** Unique name for this route (used in /help and logging) */
  name: string;
  /** Short description shown in /help */
  description: string;
  /** Regex tested against the trimmed message text */
  pattern: RegExp;
  /** Lower priority = tested first. Default routes use 100+. Apps should use 50. */
  priority: number;
  /** Handle the message. Return an OutboundResponse, or null to fall through to the next route. */
  handle(
    match: RegExpMatchArray,
    message: UnifiedMessage,
    context: AppRouteContext
  ): Promise<OutboundResponse | null>;
}

export interface AppRouteContext {
  makeResponse(agent: string, message: UnifiedMessage, text: string): OutboundResponse;
  sessionStore: SessionStore;
  agentPool: AgentPool;
  adapters: Map<string, ChannelAdapter>;
}

// Forward-declare to avoid circular imports — actual classes are in their own files
import type { SessionStore } from "./session-store.js";
import type { AgentPool } from "./agent-pool.js";
