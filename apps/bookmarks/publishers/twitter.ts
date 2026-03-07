import { TwitterApi } from "twitter-api-v2";

export interface PublishPayload {
  url: string;
  title: string;
  summaryShort: string;
  summaryLong: string;
  imagePath: string | null;
}

export interface Publisher {
  readonly name: string;
  publish(payload: PublishPayload): Promise<void>;
}

export class TwitterPublisher implements Publisher {
  readonly name = "twitter";
  private client: TwitterApi;

  constructor() {
    const appKey = process.env.TWITTER_API_KEY;
    const appSecret = process.env.TWITTER_API_SECRET;
    const accessToken = process.env.TWITTER_ACCESS_TOKEN;
    const accessSecret = process.env.TWITTER_ACCESS_SECRET;

    if (!appKey || !appSecret || !accessToken || !accessSecret) {
      throw new Error("Twitter API credentials not configured");
    }

    this.client = new TwitterApi({
      appKey,
      appSecret,
      accessToken,
      accessSecret,
    });
  }

  async publish(payload: PublishPayload): Promise<void> {
    const tweetText = `${payload.summaryShort}\n\n${payload.url}`;

    if (payload.imagePath) {
      const mediaId = await this.client.v1.uploadMedia(payload.imagePath);
      await this.client.v2.tweet({
        text: tweetText,
        media: { media_ids: [mediaId] },
      });
    } else {
      await this.client.v2.tweet({ text: tweetText });
    }

    console.log(`[twitter] Published: ${payload.url}`);
  }
}
