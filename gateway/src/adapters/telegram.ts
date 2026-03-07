import { Bot, InputFile, type Context } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import path from "path";
import type { ChannelAdapter, UnifiedMessage, OutboundResponse } from "../types.js";
import { formatResponse, formatForChannel } from "../format.js";
import { transcribeAudio, isSTTAvailable } from "../voice/stt.js";
import { synthesizeSpeech, isTTSAvailable } from "../voice/tts.js";

const MEDIA_DIR = path.resolve(import.meta.dir, "..", "..", "media");
const TELEGRAM_MAX_LENGTH = 4096;
const TTS_MAX_CHARS = 500;

export class TelegramAdapter implements ChannelAdapter {
  readonly name = "telegram" as const;
  private bot: Bot;
  private handlers: ((msg: UnifiedMessage) => void)[] = [];
  private ownerId: string;

  constructor(token: string, ownerId: string) {
    this.bot = new Bot(token);
    this.ownerId = ownerId;

    // Install auto-retry plugin for rate limiting
    this.bot.api.config.use(autoRetry());
  }

  getBot(): Bot {
    return this.bot;
  }

  async start() {
    // Register message handler
    this.bot.on("message", (ctx) => this.handleMessage(ctx));

    // Error handling
    this.bot.catch((err) => {
      console.error("Telegram adapter error:", err.message);
    });

    // Start long polling (non-blocking)
    this.bot.start({
      onStart: (botInfo) => {
        console.log(`[telegram] Telegram bot @${botInfo.username} started (long polling)`);
      },
    });
  }

  async stop() {
    this.bot.stop();
  }

  async send(response: OutboundResponse) {
    const replyAs = response.replyAs || "text";

    // Handle voice replies
    if ((replyAs === "voice" || replyAs === "both") && isTTSAvailable()) {
      const text = response.content.text;
      // Only synthesize if text is short enough
      if (text.length <= TTS_MAX_CHARS) {
        try {
          const oggPath = path.join(MEDIA_DIR, `reply-${Date.now()}.ogg`);
          await synthesizeSpeech(text, oggPath);
          await this.bot.api.sendVoice(
            response.chatId,
            new InputFile(oggPath),
            {
              caption:
                replyAs === "both"
                  ? `[${response.agent}]: ${text}`
                  : undefined,
              ...(response.replyToMessageId && {
                reply_parameters: {
                  message_id: Number(response.replyToMessageId),
                },
              }),
            }
          );
          // Cleanup
          try { await Bun.file(oggPath).exists() && (await import("fs")).unlinkSync(oggPath); } catch {}

          if (replyAs === "voice") return; // Done, no text needed
          if (replyAs === "both") return; // Caption already sent with voice
        } catch (err) {
          console.error("TTS failed, falling back to text:", err);
          // Fall through to text send
        }
      }
      // Text too long for TTS or TTS failed — fall through to text
    }

    // Handle media responses
    if (response.content.media?.localPath) {
      await this.sendMedia(response);
      return;
    }

    // Text response with message splitting
    const fullText = formatResponse(response);
    const chunks = splitMessage(fullText);

    for (let i = 0; i < chunks.length; i++) {
      const formatted = formatForChannel("telegram", chunks[i]);
      try {
        await this.bot.api.sendMessage(response.chatId, formatted, {
          parse_mode: "MarkdownV2",
          // Only reply to original message on first chunk
          ...(i === 0 &&
            response.replyToMessageId && {
              reply_parameters: {
                message_id: Number(response.replyToMessageId),
              },
            }),
        });
      } catch {
        // Fallback: send without MarkdownV2 if formatting fails
        await this.bot.api.sendMessage(response.chatId, chunks[i], {
          ...(i === 0 &&
            response.replyToMessageId && {
              reply_parameters: {
                message_id: Number(response.replyToMessageId),
              },
            }),
        });
      }
    }
  }

  async sendTyping(chatId: string) {
    // Fire-and-forget
    this.bot.api.sendChatAction(chatId, "typing").catch(() => {});
  }

  on(event: "message", handler: (msg: UnifiedMessage) => void) {
    this.handlers.push(handler);
  }

  // Download media from Telegram to local staging
  async downloadMedia(fileId: string, destPath: string): Promise<string> {
    const file = await this.bot.api.getFile(fileId);
    const url = `https://api.telegram.org/file/bot${this.bot.token}/${file.file_path}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);
    const buffer = await response.arrayBuffer();
    await Bun.write(destPath, buffer);
    return destPath;
  }

  // --- Private ---

  private async handleMessage(ctx: Context) {
    const msg = ctx.message;
    if (!msg) return;

    // Owner check: reject non-owner messages (skip if no owner configured)
    if (this.ownerId && String(msg.from?.id) !== this.ownerId) {
      return; // silent drop
    }

    // Handle voice messages with STT
    if (msg.voice && isSTTAvailable()) {
      const unified = await this.handleVoiceMessage(ctx);
      if (unified) {
        for (const handler of this.handlers) handler(unified);
      }
      return;
    }

    const unified = this.normalize(ctx);
    if (!unified) return;

    for (const handler of this.handlers) {
      handler(unified);
    }
  }

  private async handleVoiceMessage(ctx: Context): Promise<UnifiedMessage | null> {
    const msg = ctx.message!;
    const voice = msg.voice!;

    try {
      const { mkdirSync } = await import("fs");
      const dir = path.join(MEDIA_DIR, String(msg.message_id));
      mkdirSync(dir, { recursive: true });

      const oggPath = path.join(dir, `${msg.message_id}.ogg`);
      await this.downloadMedia(voice.file_id, oggPath);
      const transcription = await transcribeAudio(oggPath);

      return {
        id: crypto.randomUUID(),
        channel: "telegram",
        channelMessageId: String(msg.message_id),
        chatId: String(msg.chat.id),
        senderId: String(msg.from!.id),
        content: {
          text: transcription,
          voice: {
            isVoice: true,
            originalFileId: voice.file_id,
            duration: voice.duration,
            transcription,
          },
        },
        timestamp: new Date(msg.date * 1000).toISOString(),
      };
    } catch (err) {
      console.error("Voice message handling failed:", err);
      // Return a message indicating STT failure
      return {
        id: crypto.randomUUID(),
        channel: "telegram",
        channelMessageId: String(msg.message_id),
        chatId: String(msg.chat.id),
        senderId: String(msg.from!.id),
        content: {
          text: `[Voice message (${voice.duration}s) — transcription failed]`,
        },
        timestamp: new Date(msg.date * 1000).toISOString(),
      };
    }
  }

  private normalize(ctx: Context): UnifiedMessage | null {
    const msg = ctx.message!;
    const text = msg.text || msg.caption || "";

    // Allow voice messages without text (handled separately),
    // but require text or media for other message types
    if (!text && !msg.photo && !msg.document && !msg.video) return null;

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
        url: "",
        fileId: largest.file_id,
        mimeType: "image/jpeg",
      };
    }
    if (msg.document) {
      return {
        type: "file",
        url: "",
        fileId: msg.document.file_id,
        mimeType: msg.document.mime_type || "application/octet-stream",
        fileName: msg.document.file_name,
      };
    }
    if (msg.voice) {
      return {
        type: "audio",
        url: "",
        fileId: msg.voice.file_id,
        mimeType: msg.voice.mime_type || "audio/ogg",
      };
    }
    if (msg.video) {
      return {
        type: "video",
        url: "",
        fileId: msg.video.file_id,
        mimeType: msg.video.mime_type || "video/mp4",
      };
    }
    return undefined;
  }

  private async sendMedia(response: OutboundResponse) {
    const media = response.content.media!;
    const caption = `[${response.agent}]: ${response.content.text}`;

    switch (media.type) {
      case "image":
        await this.bot.api.sendPhoto(
          response.chatId,
          new InputFile(media.localPath),
          { caption }
        );
        break;
      case "file":
        await this.bot.api.sendDocument(
          response.chatId,
          new InputFile(media.localPath),
          { caption }
        );
        break;
    }
  }
}

function splitMessage(text: string): string[] {
  if (text.length <= TELEGRAM_MAX_LENGTH) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= TELEGRAM_MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }

    // Find a good split point (paragraph, then newline, then space)
    let splitAt = remaining.lastIndexOf("\n\n", TELEGRAM_MAX_LENGTH);
    if (splitAt < TELEGRAM_MAX_LENGTH / 2) {
      splitAt = remaining.lastIndexOf("\n", TELEGRAM_MAX_LENGTH);
    }
    if (splitAt < TELEGRAM_MAX_LENGTH / 2) {
      splitAt = remaining.lastIndexOf(" ", TELEGRAM_MAX_LENGTH);
    }
    if (splitAt < 1) splitAt = TELEGRAM_MAX_LENGTH;

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}
