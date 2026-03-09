import type { Bot } from "grammy";
import { InputFile } from "grammy";
import type { Publisher, PublishPayload } from "./twitter.js";

export class TelegramChannelPublisher implements Publisher {
  readonly name = "telegram-channel";

  constructor(
    private bot: Bot,
    private channelId: string
  ) {}

  async publish(payload: PublishPayload): Promise<void> {
    const hashtags = (payload.tags || []).map((t) => `#${t.replace(/[^a-zA-Z0-9]/g, "")}`).join(" ");
    const text = `**${payload.title}**\n\n${payload.summaryLong}\n\n${hashtags ? `${hashtags}\n\n` : ""}${payload.url}`;

    if (payload.imagePath) {
      await this.bot.api.sendPhoto(this.channelId, new InputFile(payload.imagePath), {
        caption: text,
      });
    } else {
      await this.bot.api.sendMessage(this.channelId, text, {
        link_preview_options: { is_disabled: false },
      });
    }

    console.log(`[telegram-channel] Published to ${this.channelId}: ${payload.url}`);
  }
}
