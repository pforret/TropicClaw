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
