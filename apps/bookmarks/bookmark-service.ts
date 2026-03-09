import { Database } from "bun:sqlite";
import path from "path";
import { mkdirSync } from "fs";
import type { AgentPool } from "../../gateway/src/agent-pool.js";
import type { Publisher } from "./publishers/twitter.js";

const MEDIA_DIR = path.resolve(import.meta.dir, "media");

export type VideoCategory = "music_video" | "dj_mix" | "trailer" | "cooking" | "other";

export interface Bookmark {
  id: number;
  url: string;
  title: string;
  description: string;
  summaryShort: string;
  summaryLong: string;
  imageUrl: string | null;
  imagePath: string | null;
  imagePaths: string[];
  tags: string[];
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
    // Add image_paths column if missing (migration for existing DBs)
    try {
      this.db.exec("ALTER TABLE bookmarks ADD COLUMN image_paths TEXT DEFAULT '[]'");
    } catch {
      // Column already exists
    }
    try {
      this.db.exec("ALTER TABLE bookmarks ADD COLUMN tags TEXT DEFAULT '[]'");
    } catch {
      // Column already exists
    }
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

    // Download media
    let imagePath: string | null = null;
    let imagePaths: string[] = [];

    let transcript = "";
    let tags: string[] = [];
    if (isYouTubeUrl(url)) {
      // Download video → 10-frame GIF + transcript + classification in parallel
      const [gifPaths, subs, category] = await Promise.all([
        fetchYouTubeGif(url, MEDIA_DIR),
        fetchYouTubeTranscript(url),
        classifyYouTubeVideo(url),
      ]);
      imagePaths = gifPaths;
      imagePath = imagePaths[0] || null;
      transcript = subs;
      tags = ["youtube", category];
    } else if (isInstagramUrl(url)) {
      // Use yt-dlp for Instagram posts/reels
      imagePaths = await fetchInstagramMedia(url, MEDIA_DIR);
      imagePath = imagePaths[0] || null;
    } else if (meta.image) {
      try {
        const ext = (meta.image.split(".").pop()?.split("?")[0] || "jpg").replace(/[^a-zA-Z0-9]/g, "");
        const filename = `${Date.now()}.${ext.slice(0, 4) || "jpg"}`;
        imagePath = path.join(MEDIA_DIR, filename);
        await downloadFile(meta.image, imagePath);
        imagePaths = [imagePath];
      } catch {
        imagePath = null;
      }
    }

    // Store initial bookmark (before summary)
    const stmt = this.db.prepare(
      "INSERT INTO bookmarks (url, title, description, image_url, image_path, image_paths, tags) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    const result = stmt.run(url, meta.title, meta.description, meta.image, imagePath, JSON.stringify(imagePaths), JSON.stringify(tags));
    const bookmarkId = Number(result.lastInsertRowid);

    // Generate AI summaries
    let summaryShort = meta.description.slice(0, 140);
    let summaryLong = meta.description;
    try {
      const summaries = await this.generateSummaries(url, meta.title, meta.description, transcript || bodyText || meta.bodyText);
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
          imagePaths,
          tags,
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
      imagePaths,
      tags,
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
      imagePaths: JSON.parse(row.image_paths || "[]"),
      tags: JSON.parse(row.tags || "[]"),
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

function isInstagramUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?instagram\.com\/(p|reel|reels)\//.test(url);
}

async function fetchInstagramMedia(url: string, destDir: string): Promise<string[]> {
  const { readdirSync } = await import("fs");
  const subdir = path.join(destDir, `ig-${Date.now()}`);
  mkdirSync(subdir, { recursive: true });

  const proc = Bun.spawn(
    [
      "yt-dlp",
      "--cookies-from-browser", "chrome",
      "--write-thumbnail",
      "--convert-thumbnails", "jpg",
      "-o", path.join(subdir, "%(autonumber)s.%(ext)s"),
      url,
    ],
    { stdout: "pipe", stderr: "pipe" }
  );
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    console.error(`[bookmark] yt-dlp failed (exit ${exitCode}): ${stderr}`);
  }

  // Collect all image files downloaded
  const files = readdirSync(subdir)
    .filter((f: string) => /\.(jpg|jpeg|png|webp)$/i.test(f))
    .sort()
    .map((f: string) => path.join(subdir, f));

  console.log(`[bookmark] Instagram media: ${files.length} image(s) downloaded`);
  return files;
}

function isYouTubeUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?(youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts\/)/.test(url);
}

function extractYouTubeId(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/))([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

async function fetchYouTubeGif(url: string, destDir: string): Promise<string[]> {
  const { unlinkSync, existsSync } = await import("fs");
  const subdir = path.join(destDir, `yt-${Date.now()}`);
  mkdirSync(subdir, { recursive: true });

  const videoPath = path.join(subdir, "video.mp4");
  const gifPath = path.join(subdir, "preview.gif");
  const thumbPath = path.join(subdir, "thumbnail.jpg");

  // Always download the YouTube thumbnail as fallback
  const videoId = extractYouTubeId(url);
  if (videoId) {
    for (const res of ["maxresdefault", "sddefault", "hqdefault"]) {
      try {
        await downloadFile(`https://img.youtube.com/vi/${videoId}/${res}.jpg`, thumbPath);
        console.log(`[bookmark] YouTube: thumbnail downloaded (${res})`);
        break;
      } catch {}
    }
  }

  // Try to download video for GIF
  console.log(`[bookmark] YouTube: downloading video for GIF...`);
  const dl = Bun.spawn(
    ["yt-dlp", "--cookies-from-browser", "chrome", "-f", "worstvideo[ext=mp4]/worst[ext=mp4]/worst", "--no-playlist", "-o", videoPath, url],
    { stdout: "pipe", stderr: "pipe" }
  );
  const dlExit = await dl.exited;
  if (dlExit !== 0) {
    const stderr = await new Response(dl.stderr).text();
    console.warn(`[bookmark] YouTube: video download failed, using thumbnail. (${stderr.split("\n").pop()?.trim()})`);
    return existsSync(thumbPath) ? [thumbPath] : [];
  }

  // Get video duration
  const probe = Bun.spawn(
    ["ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", videoPath],
    { stdout: "pipe", stderr: "pipe" }
  );
  await probe.exited;
  const duration = parseFloat((await new Response(probe.stdout).text()).trim()) || 0;
  if (duration <= 0) {
    console.warn("[bookmark] YouTube: could not determine duration, using thumbnail");
    try { unlinkSync(videoPath); } catch {}
    return existsSync(thumbPath) ? [thumbPath] : [];
  }

  // Extract 10 evenly spaced frames and assemble into GIF
  const interval = duration / 10;
  console.log(`[bookmark] YouTube: creating GIF from ${duration.toFixed(1)}s video (1 frame every ${interval.toFixed(1)}s)`);
  const ff = Bun.spawn(
    [
      "ffmpeg", "-y", "-i", videoPath,
      "-vf", `fps=1/${interval},scale=480:-1:flags=lanczos`,
      "-frames:v", "10",
      "-loop", "0",
      gifPath,
    ],
    { stdout: "pipe", stderr: "pipe" }
  );
  const ffExit = await ff.exited;

  // Cleanup video
  try { unlinkSync(videoPath); } catch {}

  if (ffExit !== 0) {
    console.warn("[bookmark] YouTube: GIF creation failed, using thumbnail");
    return existsSync(thumbPath) ? [thumbPath] : [];
  }

  // Cleanup thumbnail since we have the GIF
  try { unlinkSync(thumbPath); } catch {}

  console.log(`[bookmark] YouTube: GIF created at ${gifPath}`);
  return [gifPath];
}

async function fetchYouTubeTranscript(url: string): Promise<string> {
  const { readdirSync, readFileSync, unlinkSync } = await import("fs");
  const subdir = path.join(MEDIA_DIR, `yt-subs-${Date.now()}`);
  mkdirSync(subdir, { recursive: true });

  // Use yt-dlp to download subtitles (auto-generated or manual)
  const proc = Bun.spawn(
    [
      "yt-dlp",
      "--skip-download",
      "--write-subs",
      "--write-auto-subs",
      "--sub-langs", "en.*,en",
      "--sub-format", "vtt",
      "--convert-subs", "srt",
      "-o", path.join(subdir, "subs.%(ext)s"),
      url,
    ],
    { stdout: "pipe", stderr: "pipe" }
  );
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    console.warn(`[bookmark] YouTube transcript: yt-dlp failed (${stderr.split("\n").pop()?.trim()})`);
    return "";
  }

  // Find the .srt file
  const srtFiles = readdirSync(subdir).filter((f: string) => f.endsWith(".srt"));
  if (srtFiles.length === 0) {
    console.warn("[bookmark] YouTube transcript: no subtitle files found");
    return "";
  }

  const raw = readFileSync(path.join(subdir, srtFiles[0]), "utf-8");

  // Cleanup subtitle files
  for (const f of readdirSync(subdir)) {
    try { unlinkSync(path.join(subdir, f)); } catch {}
  }
  try { const { rmdirSync } = await import("fs"); rmdirSync(subdir); } catch {}

  // Strip SRT formatting: remove sequence numbers, timestamps, and duplicate lines
  const lines: string[] = [];
  let prev = "";
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    // Skip sequence numbers, timestamps, and empty lines
    if (!trimmed || /^\d+$/.test(trimmed) || /^\d{2}:\d{2}/.test(trimmed)) continue;
    // Strip inline tags like <font> and VTT positioning
    const clean = trimmed.replace(/<[^>]+>/g, "").trim();
    if (clean && clean !== prev) {
      lines.push(clean);
      prev = clean;
    }
  }

  const transcript = lines.join(" ").slice(0, 5000);
  console.log(`[bookmark] YouTube transcript: extracted ${transcript.length} chars`);
  return transcript;
}

async function classifyYouTubeVideo(url: string): Promise<VideoCategory> {
  try {
    const proc = Bun.spawn(
      ["yt-dlp", "--dump-json", "--no-download", "--no-playlist", url],
      { stdout: "pipe", stderr: "pipe" }
    );
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      console.warn("[bookmark] YouTube classify: yt-dlp --dump-json failed");
      return "other";
    }

    const json = JSON.parse(await new Response(proc.stdout).text());
    const cat = (json.categories?.[0] || "").toLowerCase();
    const tags = (json.tags || []).join(" ").toLowerCase();
    const title = (json.title || "").toLowerCase();
    const desc = (json.description || "").slice(0, 500).toLowerCase();
    const dur = json.duration || 0;
    const combined = `${title} ${tags} ${desc}`;

    // DJ mix: Music category + long duration or mix/set keywords
    if (cat === "music" && (dur > 1200 || /\b(mix|set|session|b2b|marathon|continuous)\b/.test(combined))) {
      console.log(`[bookmark] YouTube classify: dj_mix (duration=${dur}s, cat=${cat})`);
      return "dj_mix";
    }

    // Music video: Music category, typical single-track duration
    if (cat === "music") {
      console.log(`[bookmark] YouTube classify: music_video (duration=${dur}s, cat=${cat})`);
      return "music_video";
    }

    // Trailer: short + trailer/teaser keywords
    if (/\b(trailer|teaser|official\s+trailer)\b/.test(combined) && dur < 300) {
      console.log(`[bookmark] YouTube classify: trailer (duration=${dur}s)`);
      return "trailer";
    }

    // Cooking: food/recipe keywords in title, tags, or description
    if (/\b(recipe|cook(ing|ed)?|bak(e|ing)|cuisine|kitchen|chef|meal\s+prep|food)\b/.test(combined)) {
      console.log(`[bookmark] YouTube classify: cooking`);
      return "cooking";
    }

    console.log(`[bookmark] YouTube classify: other (cat=${cat}, duration=${dur}s)`);
    return "other";
  } catch (err) {
    console.warn("[bookmark] YouTube classify failed:", err);
    return "other";
  }
}
