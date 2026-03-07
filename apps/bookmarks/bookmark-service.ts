import { Database } from "bun:sqlite";
import path from "path";
import { mkdirSync } from "fs";
import type { AgentPool } from "../../gateway/src/agent-pool.js";
import type { Publisher } from "./publishers/twitter.js";

const MEDIA_DIR = path.resolve(import.meta.dir, "media");

export interface Bookmark {
  id: number;
  url: string;
  title: string;
  description: string;
  summaryShort: string;
  summaryLong: string;
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
    // Check for duplicate
    const existing = this.getByUrl(url);
    if (existing) return existing;

    // Fetch metadata (og:tags) and article body (via Jina Reader) in parallel
    const [meta, bodyText] = await Promise.all([
      fetchMetadata(url),
      fetchBodyViaJina(url),
    ]);

    // Download image
    let imagePath: string | null = null;
    if (meta.image) {
      try {
        const ext = meta.image.split(".").pop()?.split("?")[0] || "jpg";
        const filename = `${Date.now()}.${ext.slice(0, 4)}`;
        imagePath = path.join(MEDIA_DIR, filename);
        await downloadFile(meta.image, imagePath);
      } catch {
        imagePath = null;
      }
    }

    // Store initial bookmark (before summary)
    const stmt = this.db.prepare(
      "INSERT INTO bookmarks (url, title, description, image_url, image_path) VALUES (?, ?, ?, ?, ?)"
    );
    const result = stmt.run(url, meta.title, meta.description, meta.image, imagePath);
    const bookmarkId = Number(result.lastInsertRowid);

    // Generate AI summaries
    let summaryShort = meta.description.slice(0, 140);
    let summaryLong = meta.description;
    try {
      const summaries = await this.generateSummaries(url, meta.title, meta.description, bodyText || meta.bodyText);
      summaryShort = summaries.short;
      summaryLong = summaries.long;
    } catch (err) {
      console.warn("[bookmark] Summary generation failed, using description:", err);
    }

    // Update with summaries
    this.db.run(
      "UPDATE bookmarks SET summary_short = ?, summary_long = ?, updated_at = datetime('now') WHERE id = ?",
      [summaryShort, summaryLong, bookmarkId]
    );

    // Publish to configured destinations
    const publishedTo: string[] = [];
    for (const publisher of this.publishers) {
      try {
        await publisher.publish({
          url,
          title: meta.title,
          summaryShort,
          summaryLong,
          imagePath,
        });
        publishedTo.push(publisher.name);
      } catch (err) {
        console.warn(`[bookmark] Publish to ${publisher.name} failed:`, err);
      }
    }

    // Update published_to
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
    description: string,
    bodyText: string = ""
  ): Promise<{ short: string; long: string }> {
    const body = bodyText.trim().slice(0, 3000);
    const prompt = `You are a bookmark summarizer. Given a web page, produce two summaries in JSON format.

URL: ${url}
Title: ${title}
Description: ${description}
${body ? `\nArticle body:\n${body}\n` : ""}
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
         WHERE title LIKE ? OR description LIKE ? OR summary_short LIKE ? OR summary_long LIKE ? OR url LIKE ?
         ORDER BY created_at DESC LIMIT ?`
      )
      .all(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, limit) as any[];
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

// --- Metadata extraction ---

interface PageMetadata {
  title: string;
  description: string;
  image: string | null;
  siteName: string | null;
  bodyText: string;
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
    bodyText: "",
  };

  let captureParagraphs = false;

  const rewriter = new HTMLRewriter()
    .on("title", {
      text(text) {
        meta.title += text.text;
      },
    })
    .on("article, .post-content, .entry-content, .article-content, .body.markup", {
      element() {
        captureParagraphs = true;
      },
    })
    .on("p", {
      element() {
        if (captureParagraphs && meta.bodyText.length < 5000) {
          meta.bodyText += "\n\n";
        }
      },
      text(text) {
        if (captureParagraphs && meta.bodyText.length < 5000) {
          meta.bodyText += text.text;
        }
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

async function fetchBodyViaJina(url: string): Promise<string> {
  try {
    const response = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Accept: "text/plain" },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return "";
    const text = await response.text();
    return text.slice(0, 5000);
  } catch (err) {
    console.warn("[bookmark] Jina Reader failed, falling back to HTMLRewriter body:", err);
    return "";
  }
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  const buffer = await response.arrayBuffer();
  await Bun.write(destPath, buffer);
}
