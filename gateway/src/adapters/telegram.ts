import { Telegraf } from "telegraf";
import type { ChannelAdapter, UnifiedMessage, OutboundResponse } from "../types.js";
import { formatResponse, formatForChannel } from "../format.js";

export class TelegramAdapter implements ChannelAdapter {
  readonly name = "telegram" as const;
  private bot: Telegraf;
  private handlers: ((msg: UnifiedMessage) => void)[] = [];

  constructor(private token: string) {
    this.bot = new Telegraf(token);
  }

  async start() {
    this.bot.on("message", (ctx) => {
      const msg = this.normalize(ctx);
      if (msg) {
        this.handlers.forEach((h) => h(msg));
      }
    });

    // Graceful stop on SIGINT/SIGTERM
    process.once("SIGINT", () => this.bot.stop("SIGINT"));
    process.once("SIGTERM", () => this.bot.stop("SIGTERM"));

    await this.bot.launch();
    console.log("Telegram adapter started (long-polling)");
  }

  async stop() {
    this.bot.stop();
  }

  async send(response: OutboundResponse) {
    const text = formatForChannel("telegram", formatResponse(response));
    try {
      await this.bot.telegram.sendMessage(response.chatId, text, {
        parse_mode: "MarkdownV2",
        ...(response.replyToMessageId
          ? { reply_parameters: { message_id: parseInt(response.replyToMessageId, 10) } }
          : {}),
      });
    } catch {
      // Fallback: send without MarkdownV2 if formatting fails
      const plain = formatResponse(response);
      await this.bot.telegram.sendMessage(response.chatId, plain);
    }
  }

  async sendTyping(chatId: string) {
    try {
      await this.bot.telegram.sendChatAction(chatId, "typing");
    } catch {
      // ignore typing failures
    }
  }

  on(event: "message", handler: (msg: UnifiedMessage) => void) {
    this.handlers.push(handler);
  }

  private normalize(ctx: any): UnifiedMessage | null {
    const msg = ctx.message;
    if (!msg) return null;

    const text = msg.text || msg.caption || "";
    if (!text && !msg.photo && !msg.document) return null;

    return {
      id: crypto.randomUUID(),
      channel: "telegram",
      channelMessageId: String(msg.message_id),
      chatId: String(msg.chat.id),
      senderId: String(msg.from?.id || ""),
      content: {
        text,
        media: this.extractMedia(msg),
      },
      timestamp: new Date(msg.date * 1000).toISOString(),
    };
  }

  private extractMedia(msg: any): UnifiedMessage["content"]["media"] | undefined {
    if (msg.photo) {
      const largest = msg.photo[msg.photo.length - 1];
      return {
        type: "image",
        url: "", // Resolved via getFileLink after normalization
        mimeType: "image/jpeg",
      };
    }
    if (msg.document) {
      return {
        type: "file",
        url: "",
        mimeType: msg.document.mime_type,
      };
    }
    if (msg.voice || msg.audio) {
      return {
        type: "audio",
        url: "",
        mimeType: (msg.voice || msg.audio).mime_type || "audio/ogg",
      };
    }
    return undefined;
  }
}
