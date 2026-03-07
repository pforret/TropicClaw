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
    const text = `**${payload.title}**\n\n${payload.summaryLong}\n\n${payload.url}`;

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
