# PRP: Intelligent Bookmark Manager for TropicClaw Gateway

**Date:** 2026-03-07
**Confidence Score:** 8/10 (architecture fits existing gateway patterns, Bun HTMLRewriter eliminates dependencies, Twitter API well-documented; Substack publishing is unofficial/fragile — deferred to v2)

## Objective

Add an intelligent bookmark pipeline to the TropicClaw gateway: when a user sends a bare URL via any channel (Telegram, HTTP), the system automatically fetches the page, extracts metadata (title, description, og:image), generates an AI summary via Claude, stores everything in SQLite, and optionally publishes to Twitter/X, a Telegram channel, and/or an Astro blog via GitHub Pages.

All bookmark-specific code lives in `apps/bookmarks/` — the first app in a pattern where each gateway application gets its own folder. The Astro blog repo for publishing lives in `apps/bookmarks/publish/`.

### What This PRP Covers

- URL detection in the router (bare URL messages)
- Page metadata extraction using Bun's native HTMLRewriter (zero new dependencies)
- Bookmark storage in SQLite (`bookmarks` table in sessions.db)
- AI summary generation via the existing agent pool
- og:image download to local staging
- Twitter/X publishing via `twitter-api-v2` npm package
- Telegram Channel publishing (forward to a public channel — zero new dependencies)
- `/bookmarks` command for listing/searching saved bookmarks
- Telegram confirmation message with title + summary + image preview

### What This PRP Does NOT Cover

- Substack publishing (no stable API)
- Full-text content extraction / readability parsing (just metadata + AI summary for now)
- Bookmark tagging / categorization
- Duplicate URL detection beyond exact match
- Non-HTML URLs (PDFs, images, videos) — stored as URL-only, no metadata extraction

## Architecture

```
User sends URL via Telegram/HTTP
      |
      v
┌──────────────────────────────┐
│  Router                      │
│                              │
│  1. Detect bare URL          │  <1ms: regex test
│  2. Route to BookmarkService │
└──────────┬───────────────────┘
           |
           v
┌──────────────────────────────┐
│  BookmarkService             │
│                              │
│  3. Fetch URL (Bun fetch)    │  ~1-3s
│  4. Extract metadata         │  <10ms: Bun HTMLRewriter
│     (title, desc, og:image)  │
│  5. Download og:image        │  ~1-2s
│  6. Store in SQLite          │  <1ms
│  7. Generate AI summary      │  ~3-8s: claude -p (one-turn)
│  8. Update DB with summary   │  <1ms
│  9. Publish to Twitter/X     │  ~1-2s (if configured)
│  10. Send confirmation       │  via adapter.send()
└──────────────────────────────┘
```

**Total time: ~6-15s.** The bottleneck is the AI summary (step 7). Steps 3-6 run before the summary so the user gets a fast "processing..." acknowledgment.

## URL Detection

The router detects messages that are just a URL — this is the format produced by iPhone's Share Sheet -> Telegram (sends the URL as the entire message body, sometimes with a trailing newline or extra whitespace).

```typescript
// In router.ts — add before command detection
const URL_REGEX = /^\s*(https?:\/\/[^\s]+)\s*$/i;

function extractBareUrl(text: string): string | null {
  const match = text.match(URL_REGEX);
  return match ? match[1] : null;
}
```

### Router Integration

```typescript
// In Router.handleMessage(), after owner check, before command detection:

const bareUrl = extractBareUrl(text);
if (bareUrl) {
  await this.handleBookmark(bareUrl, message);
  return;
}
```

```typescript
private async handleBookmark(url: string, message: UnifiedMessage) {
  // Acknowledge immediately
  const adapter = this.adapters.get(message.channel);
  adapter?.sendTyping?.(message.chatId);

  try {
    const bookmark = await this.bookmarkService.process(url);

    // Build confirmation message
    const lines = [
      `**${bookmark.title}**`,
      "",
      bookmark.summaryLong,
      "",
      `${bookmark.url}`,
    ];
    if (bookmark.publishedTo.length > 0) {
      lines.push("", `Published to: ${bookmark.publishedTo.join(", ")}`);
    }

    const response = this.makeResponse("bookmarks", message, lines.join("\n"));

    // Attach image if available
    if (bookmark.imagePath) {
      response.content.media = { type: "image", localPath: bookmark.imagePath };
    }

    await this.sendResponse(response, message);

    // Log
    this.sessionStore.logMessage("bookmarks", "user", url, message.channel);
    this.sessionStore.logMessage("bookmarks", "assistant", lines.join("\n"), message.channel);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[router] Bookmark error for ${url}:`, msg);
    await this.sendResponse(
      this.makeResponse("bookmarks", message, `Bookmark failed: ${msg}`),
      message
    );
  }
}
```

## BookmarkService

```typescript
// apps/bookmarks/bookmark-service.ts
import { Database } from "bun:sqlite";
import path from "path";
import { mkdirSync } from "fs";
import { AgentPool } from "../../gateway/src/agent-pool.js";

const MEDIA_DIR = path.resolve(import.meta.dir, "media");

export interface Bookmark {
  id: number;
  url: string;
  title: string;
  description: string;
  summaryShort: string;   // <140 chars — for Twitter
  summaryLong: string;    // <1000 chars — for blog post / Telegram channel
  imageUrl: string | null;
  imagePath: string | null;
  publishedTo: string[];
  createdAt: string;
}

export class BookmarkService {
  constructor(
    private db: Database,
    private agentPool: AgentPool,
    private publishers: Publisher[] = []
  ) {
    this.migrate();
    mkdirSync(MEDIA_DIR, { recursive: true });
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bookmarks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL DEFAULT '',
        description TEXT DEFAULT '',
        summary_short TEXT DEFAULT '',
        summary_long TEXT DEFAULT '',
        image_url TEXT,
        image_path TEXT,
        published_to TEXT DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_bookmarks_url ON bookmarks(url);
      CREATE INDEX IF NOT EXISTS idx_bookmarks_created ON bookmarks(created_at);
    `);
  }

  async process(url: string): Promise<Bookmark> {
    // 1. Check for duplicate
    const existing = this.getByUrl(url);
    if (existing) return existing;

    // 2. Fetch and extract metadata
    const meta = await fetchMetadata(url);

    // 3. Download image
    let imagePath: string | null = null;
    if (meta.image) {
      try {
        const ext = meta.image.split(".").pop()?.split("?")[0] || "jpg";
        const filename = `${Date.now()}.${ext.slice(0, 4)}`;
        imagePath = path.join(MEDIA_DIR, filename);
        await downloadFile(meta.image, imagePath);
      } catch {
        imagePath = null; // Continue without image
      }
    }

    // 4. Store initial bookmark (before summary)
    const stmt = this.db.prepare(`
      INSERT INTO bookmarks (url, title, description, image_url, image_path)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(url, meta.title, meta.description, meta.image, imagePath);
    const bookmarkId = Number(result.lastInsertRowid);

    // 5. Generate AI summaries (short for Twitter, long for blog)
    let summaryShort = meta.description.slice(0, 140);
    let summaryLong = meta.description;
    try {
      const summaries = await this.generateSummaries(url, meta.title, meta.description);
      summaryShort = summaries.short;
      summaryLong = summaries.long;
    } catch (err) {
      console.warn("[bookmark] Summary generation failed, using description:", err);
    }

    // 6. Update with summaries
    this.db.run(
      "UPDATE bookmarks SET summary_short = ?, summary_long = ?, updated_at = datetime('now') WHERE id = ?",
      [summaryShort, summaryLong, bookmarkId]
    );

    // 7. Publish to configured destinations
    const publishedTo: string[] = [];
    for (const publisher of this.publishers) {
      try {
        await publisher.publish({
          url, title: meta.title, summaryShort, summaryLong, imagePath,
        });
        publishedTo.push(publisher.name);
      } catch (err) {
        console.warn(`[bookmark] Publish to ${publisher.name} failed:`, err);
      }
    }

    // 8. Update published_to
    this.db.run("UPDATE bookmarks SET published_to = ? WHERE id = ?", [
      JSON.stringify(publishedTo),
      bookmarkId,
    ]);

    return {
      id: bookmarkId,
      url,
      title: meta.title,
      description: meta.description,
      summaryShort,
      summaryLong,
      imageUrl: meta.image,
      imagePath,
      publishedTo,
      createdAt: new Date().toISOString(),
    };
  }

  private async generateSummaries(
    url: string,
    title: string,
    description: string
  ): Promise<{ short: string; long: string }> {
    const prompt = `You are a bookmark summarizer. Given a web page, produce two summaries in JSON format.

URL: ${url}
Title: ${title}
Description: ${description}

Respond with ONLY valid JSON, no markdown fences:
{"short": "<max 140 chars, one-liner for Twitter>", "long": "<max 1000 chars, 2-4 paragraphs for a blog post>"}`;

    const summaryAgent = {
      name: "bookmark-summarizer",
      description: "Generates bookmark summaries",
      model: "haiku",
      max_turns: 1,
      trust_tier: 0,
      timeout: 30,
      directory: process.cwd(),
    };

    const raw = await this.agentPool.dispatch(summaryAgent, prompt);

    try {
      const parsed = JSON.parse(raw);
      return {
        short: String(parsed.short || "").slice(0, 140),
        long: String(parsed.long || "").slice(0, 1000),
      };
    } catch {
      // Fallback: use raw output as long, truncate for short
      return {
        short: raw.slice(0, 140),
        long: raw.slice(0, 1000),
      };
    }
  }

  getByUrl(url: string): Bookmark | null {
    const row = this.db
      .query("SELECT * FROM bookmarks WHERE url = ?")
      .get(url) as any;
    return row ? this.rowToBookmark(row) : null;
  }

  list(limit: number = 20, offset: number = 0): Bookmark[] {
    const rows = this.db
      .query("SELECT * FROM bookmarks ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .all(limit, offset) as any[];
    return rows.map((r) => this.rowToBookmark(r));
  }

  search(query: string, limit: number = 20): Bookmark[] {
    const rows = this.db
      .query(
        `SELECT * FROM bookmarks
         WHERE title LIKE ? OR description LIKE ? OR summary LIKE ? OR url LIKE ?
         ORDER BY created_at DESC LIMIT ?`
      )
      .all(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, limit) as any[];
    return rows.map((r) => this.rowToBookmark(r));
  }

  count(): number {
    const row = this.db.query("SELECT COUNT(*) as count FROM bookmarks").get() as any;
    return row.count;
  }

  private rowToBookmark(row: any): Bookmark {
    return {
      id: row.id,
      url: row.url,
      title: row.title,
      description: row.description,
      summaryShort: row.summary_short,
      summaryLong: row.summary_long,
      imageUrl: row.image_url,
      imagePath: row.image_path,
      publishedTo: JSON.parse(row.published_to || "[]"),
      createdAt: row.created_at,
    };
  }
}
```

## Metadata Extraction (Bun HTMLRewriter)

Uses Bun's native HTMLRewriter — **zero new dependencies**.

```typescript
// gateway/src/bookmark-service.ts (continued)

interface PageMetadata {
  title: string;
  description: string;
  image: string | null;
  siteName: string | null;
}

async function fetchMetadata(url: string): Promise<PageMetadata> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "TropicClaw/1.0 (bookmark bot)",
      Accept: "text/html",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
  }

  const meta: PageMetadata = {
    title: "",
    description: "",
    image: null,
    siteName: null,
  };

  const rewriter = new HTMLRewriter()
    .on("title", {
      text(text) {
        meta.title += text.text;
      },
    })
    .on('meta[property^="og:"]', {
      element(el) {
        const property = el.getAttribute("property");
        const content = el.getAttribute("content");
        if (!property || !content) return;
        switch (property) {
          case "og:title":
            meta.title = content;
            break;
          case "og:description":
            meta.description = content;
            break;
          case "og:image":
            meta.image = content;
            break;
          case "og:site_name":
            meta.siteName = content;
            break;
        }
      },
    })
    .on('meta[name="description"]', {
      element(el) {
        if (!meta.description) {
          meta.description = el.getAttribute("content") || "";
        }
      },
    })
    .on('meta[name^="twitter:"]', {
      element(el) {
        const name = el.getAttribute("name");
        const content = el.getAttribute("content");
        if (!name || !content) return;
        if (name === "twitter:image" && !meta.image) meta.image = content;
        if (name === "twitter:title" && !meta.title) meta.title = content;
        if (name === "twitter:description" && !meta.description) meta.description = content;
      },
    });

  // Transform processes the response body through the rewriter
  await rewriter.transform(response).text();

  // Resolve relative image URLs
  if (meta.image && !meta.image.startsWith("http")) {
    meta.image = new URL(meta.image, url).href;
  }

  // Fallback title from URL
  if (!meta.title) {
    meta.title = new URL(url).hostname;
  }

  return meta;
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  const buffer = await response.arrayBuffer();
  await Bun.write(destPath, buffer);
}
```

### Why Bun HTMLRewriter over Cheerio

| Approach | Dependency | Memory | Speed |
|----------|-----------|--------|-------|
| **Bun HTMLRewriter** | None (built-in) | Streaming, O(1) | Fast |
| Cheerio | `cheerio` (~1MB) | Loads full DOM | Slower for large pages |

HTMLRewriter is streaming — it processes the HTML as it arrives without building a full DOM tree. Perfect for metadata extraction where we only need a few tags.

Reference: https://bun.com/docs/guides/html-rewriter/extract-social-meta

## Twitter/X Publisher

```typescript
// apps/bookmarks/publishers/twitter.ts
import { TwitterApi } from "twitter-api-v2";
import { readFileSync } from "fs";

export interface PublishPayload {
  url: string;
  title: string;
  summaryShort: string;  // <140 chars — for Twitter
  summaryLong: string;   // <1000 chars — for blog / Telegram channel
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
    const tweetText = this.formatTweet(payload);

    if (payload.imagePath) {
      // Upload image first (uses v1 API — required for media upload)
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

  private formatTweet(payload: PublishPayload): string {
    // summaryShort is already <140 chars. URL takes ~23 chars (t.co shortening).
    return `${payload.summaryShort}\n\n${payload.url}`;
  }
}
```

### Twitter API Setup

1. Go to https://developer.twitter.com/en/portal/dashboard
2. Create a project + app (Free tier: 1,500 tweets/month)
3. Generate OAuth 1.0a tokens (needed for media upload + tweet posting)
4. Add to `gateway/.env`:
   ```bash
   TWITTER_API_KEY=your_api_key
   TWITTER_API_SECRET=your_api_secret
   TWITTER_ACCESS_TOKEN=your_access_token
   TWITTER_ACCESS_SECRET=your_access_secret
   ```

**Important:** The Free tier of the Twitter API v2 allows posting tweets. Media upload uses the v1 API endpoint which is also included. The `twitter-api-v2` npm package handles both v1 and v2 seamlessly.

Reference: https://www.npmjs.com/package/twitter-api-v2

## Telegram Channel Publisher

Easiest possible publisher: forward the bookmark to a public Telegram channel. Zero new dependencies — reuses the existing grammY bot instance.

```typescript
// apps/bookmarks/publishers/telegram-channel.ts
import type { Bot } from "grammy";
import type { Publisher, PublishPayload } from "./twitter.js";
import { InputFile } from "grammy";

export class TelegramChannelPublisher implements Publisher {
  readonly name = "telegram-channel";

  constructor(
    private bot: Bot,
    private channelId: string // e.g. "@mybookmarks" or "-1001234567890"
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
```

### Setup

1. Create a public Telegram channel (e.g. `@mybookmarks`)
2. Add your bot as an admin with "Post Messages" permission
3. Add to `gateway/.env`:
   ```bash
   TELEGRAM_CHANNEL_ID=@mybookmarks
   ```

### Why This Is the Easiest Publisher

- No new dependencies (reuses grammY bot already in the gateway)
- No API keys beyond the existing bot token
- Telegram channels support link previews, images, and formatting natively
- The channel becomes a public bookmark feed that anyone can subscribe to

## Astro Blog Publisher (GitHub Pages)

Creates a markdown blog post in the Astro site at `apps/bookmarks/publish/`, commits and pushes. A GitHub Action builds Astro and deploys to GitHub Pages. This also produces an RSS feed via `@astrojs/rss`.

The publish repo lives inside the project at `apps/bookmarks/publish/` — it's a separate git repo (its own `.git`) that pushes to its own GitHub Pages repository.

```typescript
// apps/bookmarks/publishers/github-blog.ts
import { mkdirSync, existsSync } from "fs";
import path from "path";
import type { Publisher, PublishPayload } from "./twitter.js";

const PUBLISH_DIR = path.resolve(import.meta.dir, "..", "publish");
const CONTENT_DIR = "src/content/blog"; // PaperAstro blog collection

export class GitHubBlogPublisher implements Publisher {
  readonly name = "github-blog";
  private contentPath: string;

  constructor() {
    this.contentPath = path.join(PUBLISH_DIR, CONTENT_DIR);
    mkdirSync(this.contentPath, { recursive: true });
  }

  async publish(payload: PublishPayload): Promise<void> {
    const slug = this.titleToSlug(payload.title);
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const filename = `${date}-${slug}.md`;
    const filepath = path.join(this.contentPath, filename);

    if (existsSync(filepath)) {
      console.log(`[github-blog] Post already exists: ${filename}`);
      return;
    }

    // PaperAstro blog frontmatter
    const frontmatter = [
      "---",
      `title: "${payload.title.replace(/"/g, '\\"')}"`,
      `description: "${payload.summaryShort.replace(/"/g, '\\"')}"`,
      `pubDate: "${new Date().toISOString()}"`,
      `url: "${payload.url}"`,
      payload.imagePath ? `heroImage: "./${path.basename(payload.imagePath)}"` : null,
      "---",
    ]
      .filter(Boolean)
      .join("\n");

    const content = `${frontmatter}\n\n${payload.summaryLong}\n\n[Read more](${payload.url})\n`;

    // Copy image to content dir if available
    if (payload.imagePath) {
      const imgDest = path.join(this.contentPath, path.basename(payload.imagePath));
      await Bun.write(imgDest, Bun.file(payload.imagePath));
    }

    // Write markdown file
    await Bun.write(filepath, content);

    // Git add, commit, push — log errors, don't throw
    const proc = Bun.spawn(
      ["git", "add", "-A", "&&", "git", "commit", "-m", `bookmark: ${payload.title}`, "&&", "git", "push"],
      { cwd: PUBLISH_DIR, shell: true, stdout: "pipe", stderr: "pipe" }
    );
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      console.error(`[github-blog] git push failed (file saved locally): ${stderr}`);
      return; // Don't throw — bookmark is saved in DB, markdown is on disk
    }

    console.log(`[github-blog] Published: ${filename}`);
  }

  private titleToSlug(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
  }
}
```

### Setup

1. Create a GitHub repo for the bookmark blog (e.g. `my-bookmarks`)
2. Clone PaperAstro template into `apps/bookmarks/publish/`:
   ```bash
   npm create astro@latest -- --template @fabform/paperastro apps/bookmarks/publish
   cd apps/bookmarks/publish
   git init && git remote add origin git@github.com:youruser/my-bookmarks.git
   ```
3. Override `src/content.config.ts` to add the `url` field (see schema above)
4. Update `src/consts.ts` with your site title/description
5. Add a GitHub Action for Astro deployment (`.github/workflows/deploy.yml` — use Astro's official template)
6. No env vars needed — the path is hardcoded to `apps/bookmarks/publish/`

### PaperAstro Content Collection Schema

PaperAstro's built-in blog schema (`src/content.config.ts`) already defines:

```typescript
// title, description, pubDate, updatedDate, heroImage
// We extend this with a url field for the bookmark link
```

```typescript
// apps/bookmarks/publish/src/content.config.ts (override PaperAstro default)
import { glob } from "astro/loaders";
import { defineCollection, z } from "astro:content";

const blog = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/blog" }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      pubDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      heroImage: image().optional(),
      url: z.string().url(), // bookmark source URL — added for bookmarks
    }),
});

export const collections = { blog };
```

### How It Works

```
URL arrives -> BookmarkService.process() -> GitHubBlogPublisher.publish()
  |
  ├── Write {date}-{title-slug}.md to apps/bookmarks/publish/src/content/blog/
  ├── Copy og:image to same directory (if available)
  ├── git add -A && git commit && git push (log errors, don't throw)
  |
  └── GitHub Action builds Astro -> deploys to GitHub Pages + RSS feed
```

### Why PaperAstro

- Clean, sketch-inspired aesthetic (PaperCSS) — lightweight and distinctive
- Built on Astro 5 with content collections, MDX, RSS, and sitemap out of the box
- `@astrojs/rss` included — RSS feed uses `summaryLong` as content
- Sharp for automatic image optimization (resizes og:images)
- Simple blog schema (title, description, pubDate, heroImage) — just add `url` field
- Repo: https://github.com/fabformhub/paperastro

## Other Easy Publishing Platforms (Future)

| Platform | Effort | API Status | Notes |
|----------|--------|-----------|-------|
| **Telegram Channel** | Trivial | Stable | Already have the bot. v1. |
| **Astro blog (GitHub Pages)** | Low | N/A (git push) | Astro + content collections. Auto-builds. Free RSS. v1. |
| **Mastodon** | Low | Stable REST API | App token auth, simple `POST /api/v1/statuses`. |
| **Bluesky** | Low | Stable AT Protocol | `@atproto/api` npm. App password auth. |
| **Notion database** | Low | Official API | Good for personal searchable archive. |
| **LinkedIn** | Medium | Official API | OAuth 2.0 required, more setup. |
| **Substack** | Hard | No official API | Unofficial, fragile. Not recommended. |

## /bookmarks Command

```typescript
// Add to Router.handleCommand() switch statement:

case "/bookmarks": {
  const subcommand = parts[1] || "list";

  if (subcommand === "list") {
    const bookmarks = this.bookmarkService.list(10);
    if (bookmarks.length === 0) {
      return this.makeResponse("bookmarks", message, "No bookmarks saved yet.");
    }
    const lines = bookmarks.map(
      (b, i) => `${i + 1}. **${b.title}**\n   ${b.url}\n   ${b.summaryShort}`
    );
    const total = this.bookmarkService.count();
    return this.makeResponse(
      "bookmarks",
      message,
      `Bookmarks (${total} total):\n\n${lines.join("\n\n")}`
    );
  }

  if (subcommand === "search") {
    const query = parts.slice(2).join(" ");
    if (!query) {
      return this.makeResponse("bookmarks", message, "Usage: /bookmarks search <query>");
    }
    const results = this.bookmarkService.search(query, 10);
    if (results.length === 0) {
      return this.makeResponse("bookmarks", message, `No bookmarks matching "${query}".`);
    }
    const lines = results.map(
      (b) => `- **${b.title}**\n  ${b.url}`
    );
    return this.makeResponse("bookmarks", message, `Search results:\n\n${lines.join("\n\n")}`);
  }

  return this.makeResponse(
    "bookmarks",
    message,
    "Usage: /bookmarks [list|search <query>]"
  );
}
```

## Gateway Wiring

```typescript
// In gateway/src/index.ts — add after sessionStore/agentPool init:

import { BookmarkService } from "../../apps/bookmarks/bookmark-service.js";
import { TwitterPublisher } from "../../apps/bookmarks/publishers/twitter.js";
import { TelegramChannelPublisher } from "../../apps/bookmarks/publishers/telegram-channel.js";
import { GitHubBlogPublisher } from "../../apps/bookmarks/publishers/github-blog.js";

// Initialize publishers
const publishers: Publisher[] = [];

// Telegram Channel publisher (easiest — reuses existing bot)
if (process.env.TELEGRAM_CHANNEL_ID && telegramAdapter) {
  publishers.push(
    new TelegramChannelPublisher(telegramAdapter.getBot(), process.env.TELEGRAM_CHANNEL_ID)
  );
  console.log(`[gateway] Telegram Channel publisher enabled: ${process.env.TELEGRAM_CHANNEL_ID}`);
}

// Astro blog publisher (always enabled if publish/ dir exists)
const publishDir = path.resolve(import.meta.dir, "..", "..", "apps", "bookmarks", "publish");
if (existsSync(path.join(publishDir, ".git"))) {
  publishers.push(new GitHubBlogPublisher());
  console.log("[gateway] Astro blog publisher enabled");
}

// Twitter publisher (optional)
if (process.env.TWITTER_API_KEY) {
  try {
    publishers.push(new TwitterPublisher());
    console.log("[gateway] Twitter publisher enabled");
  } catch (err) {
    console.warn("[gateway] Twitter publisher disabled:", err);
  }
}

// Initialize bookmark service (reuses sessions.db)
const bookmarkService = new BookmarkService(sessionStore.getDb(), agentPool, publishers);

// Pass bookmarkService to Router constructor
const router = new Router(config, sessionStore, agentPool, bookmarkService);
```

Note: two small accessor additions needed:

```typescript
// Add to SessionStore class:
getDb(): Database {
  return this.db;
}

// Add to TelegramAdapter class:
getBot(): Bot {
  return this.bot;
}
```

## Dependencies

| Package | Purpose | Version | New? |
|---------|---------|---------|------|
| `twitter-api-v2` | Twitter/X API client | ^1.x | YES |
| `bun:sqlite` | Bookmark storage | built-in | No |
| Bun HTMLRewriter | Metadata extraction | built-in | No |
| `grammy` | Telegram adapter | existing | No |
| `fastify` | HTTP adapter | existing | No |

Only **one new dependency**: `twitter-api-v2`.

## Tasks (Implementation Order)

1. **Add `bookmarks` table migration to BookmarkService**
   - Create `apps/bookmarks/bookmark-service.ts`
   - Table: `bookmarks` (id, url, title, description, summary_short, summary_long, image_url, image_path, published_to, created_at, updated_at)
   - Unique index on `url`

2. **Implement `fetchMetadata()` using Bun HTMLRewriter**
   - Extract og:title, og:description, og:image, og:site_name
   - Fallbacks: `<title>`, `meta[name=description]`, `twitter:*` tags
   - Resolve relative image URLs to absolute
   - User-Agent header to avoid bot blocking

3. **Implement `downloadFile()` for og:image**
   - Download to `apps/bookmarks/media/`
   - Handle failures gracefully (continue without image)

4. **Implement `BookmarkService.process()`**
   - Duplicate check (exact URL match)
   - Fetch metadata -> download image -> store -> generate summary -> update -> publish
   - Return `Bookmark` object

5. **Implement `generateSummaries()` via agent pool**
   - Use haiku model for speed
   - Returns JSON with `short` (<140 chars) and `long` (<1000 chars)
   - One-turn, 30s timeout
   - Fallback to description if generation fails

6. **Add `getDb()` to SessionStore**
   - Expose database handle for BookmarkService

7. **Add URL detection in Router**
   - `URL_REGEX` for bare URL detection
   - `handleBookmark()` method
   - Wire before command detection in `handleMessage()`

8. **Add `/bookmarks` command to Router**
   - `/bookmarks list` — show recent 10
   - `/bookmarks search <query>` — LIKE search across title, description, summary, url

9. **Install `twitter-api-v2`**
   ```bash
   cd gateway && bun add twitter-api-v2
   ```

10. **Implement TwitterPublisher**
    - `apps/bookmarks/publishers/twitter.ts`
    - OAuth 1.0a auth (needed for media upload)
    - Tweet format: summaryShort (<140 chars) + URL + image
    - Image upload via v1 API, tweet via v2 API

11. **Wire BookmarkService + publishers into gateway index.ts**
    - Conditional Twitter publisher (only if env vars set)
    - Pass BookmarkService to Router

12. **Implement TelegramChannelPublisher**
    - `apps/bookmarks/publishers/telegram-channel.ts`
    - Reuse existing grammY bot instance
    - Post with image (sendPhoto) or text with link preview (sendMessage)

13. **Add `getBot()` to TelegramAdapter**
    - Expose bot instance for TelegramChannelPublisher

14. **Implement GitHubBlogPublisher**
    - `apps/bookmarks/publishers/github-blog.ts`
    - Write markdown with Astro content collection frontmatter
    - Title-based slug (`titleToSlug()`)
    - Copy og:image to content dir
    - `git add && git commit && git push` — log errors, don't throw

15. **Initialize PaperAstro blog in `apps/bookmarks/publish/`**
    - `npm create astro@latest -- --template @fabform/paperastro apps/bookmarks/publish`
    - Override `src/content.config.ts` to add `url` field
    - Update `src/consts.ts` with site title/description
    - Add GitHub Action for Astro deployment
    - RSS feed: configure `@astrojs/rss` to use `summaryLong` as item content

16. **Add env vars to `.env.example`**
    ```
    TELEGRAM_CHANNEL_ID=@mybookmarks
    TWITTER_API_KEY=
    TWITTER_API_SECRET=
    TWITTER_ACCESS_TOKEN=
    TWITTER_ACCESS_SECRET=
    ```

13. **Test: bare URL via HTTP adapter**
    ```bash
    curl -X POST http://127.0.0.1:18789/api/message \
      -H "Content-Type: application/json" \
      -d '{"text": "https://example.com"}'
    ```
    Expected: bookmark saved, summary generated, confirmation returned

14. **Test: bare URL via Telegram**
    - Send URL to bot
    - Expected: typing indicator, then confirmation with title + summary

15. **Test: /bookmarks list**
    - Expected: list of saved bookmarks with titles and truncated summaries

16. **Test: /bookmarks search**
    - `/bookmarks search example`
    - Expected: matching bookmarks

17. **Test: duplicate URL**
    - Send same URL twice
    - Expected: returns existing bookmark, no duplicate

18. **Test: Twitter publishing (if configured)**
    - Send URL with Twitter credentials configured
    - Expected: tweet posted with summary + URL + image

19. **Test: URL with no og:image**
    - Send URL to a page without og:image
    - Expected: bookmark saved without image, tweet without image

20. **Test: unreachable URL**
    - Send `https://this-does-not-exist-404.example`
    - Expected: error message returned to user

## Validation Gates

```bash
# Type checking
cd gateway && bun run tsc --noEmit

# Verify twitter-api-v2 installed
bun run -e "import { TwitterApi } from 'twitter-api-v2'; console.log('twitter-api-v2 OK')"

# Verify bookmark service compiles
bun run -e "import { BookmarkService } from '../apps/bookmarks/bookmark-service.js'; console.log('BookmarkService OK')"

# Start gateway
bun run src/index.ts

# Test metadata extraction (standalone)
bun run -e "
  const res = await fetch('https://example.com');
  const meta = {};
  const rw = new HTMLRewriter()
    .on('title', { text(t) { meta.title = (meta.title || '') + t.text; } })
    .on('meta[property=\"og:title\"]', { element(el) { meta.ogTitle = el.getAttribute('content'); } });
  await rw.transform(res).text();
  console.log(meta);
"

# Test bookmark via HTTP
curl -s -X POST http://127.0.0.1:18789/api/message \
  -H "Content-Type: application/json" \
  -d '{"text": "https://github.com"}' | head -c 500

# Health check
curl http://127.0.0.1:18789/health

# Test /bookmarks command via HTTP
curl -s -X POST http://127.0.0.1:18789/api/message \
  -H "Content-Type: application/json" \
  -d '{"text": "/bookmarks list"}' | head -c 500
```

## Error Handling

| Scenario | Behavior |
|----------|----------|
| URL returns 404/5xx | Return error to user: "Could not fetch URL (status code)" |
| URL returns non-HTML (PDF, image) | Store URL + filename as title. Skip metadata extraction. |
| No og:image found | Store bookmark without image. Tweet without image. |
| og:image download fails | Continue without image. Log warning. |
| AI summary fails | Fall back to meta description. Log warning. |
| Claude timeout (>30s) | Use description as summary. |
| Twitter API error | Log error, continue. Bookmark still saved. Don't fail the whole pipeline. |
| Twitter rate limit | `twitter-api-v2` handles 429 with retry headers. |
| Duplicate URL | Return existing bookmark. No error. |
| Malformed URL | Return error: "Not a valid URL" |
| Very long page (>10MB) | Bun HTMLRewriter is streaming, handles this fine. Set fetch timeout. |
| Redirect chains | `fetch()` with `redirect: "follow"` handles this. |
| Git push fails | Log error. Markdown file is still on disk. Push will succeed on next bookmark (git add -A picks up old files). |

## Configuration

```yaml
# gateway/config/gateway.yaml (add bookmarks section)
bookmarks:
  enabled: true
  auto_detect_urls: true     # route bare URLs to bookmark pipeline
  summary_model: haiku       # model for summary generation
  # Publishers are configured via env vars — each activates when its env var is set
```

## File Structure

```
apps/
  bookmarks/                             # First gateway app — pattern for future apps
    bookmark-service.ts                  # NEW: BookmarkService class + fetchMetadata + downloadFile
    publishers/
      twitter.ts                         # NEW: TwitterPublisher (uses summaryShort)
      telegram-channel.ts               # NEW: TelegramChannelPublisher (uses summaryLong)
      github-blog.ts                     # NEW: GitHubBlogPublisher (Astro, title-based slug, log git errors)
    media/                               # Downloaded og:images
    publish/                             # Separate git repo: PaperAstro blog for GitHub Pages
      src/content/blog/                  # Blog posts land here (PaperAstro convention)
      src/content.config.ts              # Content collection schema (add url field)
      src/consts.ts                      # Site title/description
      .github/workflows/deploy.yml       # Astro GitHub Pages build action
      astro.config.mjs

gateway/src/
  router.ts                  # MODIFIED: add URL detection + /bookmarks command + handleBookmark
  session-store.ts           # MODIFIED: add getDb() method
  adapters/telegram.ts       # MODIFIED: add getBot() method
  index.ts                   # MODIFIED: wire BookmarkService + publishers
  types.ts                   # MODIFIED: add Publisher interface
```

## Key References

- **Bun HTMLRewriter OG extraction:** https://bun.com/docs/guides/html-rewriter/extract-social-meta
- **twitter-api-v2 npm:** https://www.npmjs.com/package/twitter-api-v2
- **twitter-api-v2 examples:** https://github.com/PLhery/node-twitter-api-v2/blob/master/doc/examples.md
- **twitter-api-v2 media upload (v1):** https://github.com/plhery/node-twitter-api-v2/blob/master/doc/v1.md
- **Twitter API v2 tweet endpoint:** https://github.com/PLhery/node-twitter-api-v2/blob/master/doc/v2.md
- **Twitter developer portal:** https://developer.twitter.com/en/portal/dashboard
- **PaperAstro theme:** https://github.com/fabformhub/paperastro
- **PaperAstro on Astro themes:** https://astro.build/themes/details/paperastro/
- **Astro content collections:** https://docs.astro.build/en/guides/content-collections/
- **Astro RSS:** https://docs.astro.build/en/guides/rss/
- **Astro GitHub Pages deploy:** https://docs.astro.build/en/guides/deploy/github/
- **Gateway PRP (parent architecture):** `docs/todo/PRPs/2026-03-07-gateway.md`
- **Telegram adapter PRP:** `docs/todo/PRPs/2026-03-07-telegram-channel.md`

## Resolved Design Decisions

1. **Metadata extraction:** Bun HTMLRewriter (built-in, streaming, zero dependencies). Not Cheerio.
2. **Storage:** Reuse sessions.db (same SQLite file). New `bookmarks` table. Not a separate DB.
3. **Summary model:** Haiku for speed (~2-3s). One-turn, no tools needed.
4. **URL detection:** Bare URL regex in router. Not a separate agent — deterministic pipeline is more reliable.
5. **Twitter auth:** OAuth 1.0a (needed for media upload). Not OAuth 2.0 PKCE.
6. **Tweet format:** Summary + URL. Image attached if available. Keep under 280 chars.
7. **Duplicate handling:** Exact URL match. Return existing bookmark silently.
8. **Image storage:** `apps/bookmarks/media/` directory. Named by timestamp.
9. **Pipeline order:** Fetch -> extract -> store -> summarize -> publish. Store before summarize so bookmark is saved even if summary fails.
10. **Publisher pattern:** Interface-based. Easy to add Mastodon, Bluesky, LinkedIn later.
11. **Two summary lengths:** Short (<140 chars) for Twitter, long (<1000 chars) for blog/Telegram channel. Single Claude call returns both as JSON.
12. **URL detection trigger:** Always auto-detect bare URLs. Designed for iPhone Share Sheet -> Telegram workflow. No `/bookmark` prefix needed.
13. **No tags/categories.** Keep it simple.
14. **No Substack.** No stable API, not worth the fragility.
15. **PaperAstro theme** (https://github.com/fabformhub/paperastro). PaperCSS styling, Astro 5, content collections, RSS + sitemap built-in.
16. **No throttling.** Single user, low volume.
17. **App folder pattern:** `apps/bookmarks/` — first app, sets the pattern for future gateway apps.
18. **Title-based slug:** `titleToSlug()` for readable URLs. Fallback to hostname if title is empty.
19. **Git error handling:** Log and continue. Markdown is saved to disk regardless. Next bookmark's `git add -A` picks up any un-pushed files.
20. **Publish repo location:** `apps/bookmarks/publish/` — separate git repo inside the project.
21. **RSS feed content:** `summaryLong` as item content (full description in feed reader).

## Unresolved Questions

None — all design decisions resolved.
