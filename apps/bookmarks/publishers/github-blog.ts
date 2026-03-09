import { mkdirSync, existsSync } from "fs";
import path from "path";
import type { Publisher, PublishPayload } from "./twitter.js";

const PUBLISH_DIR = path.resolve(import.meta.dir, "..", "publish");
const CONTENT_DIR = "src/content/blog";
const PUBLIC_IMG_DIR = "public/bookmarks";

export class GitHubBlogPublisher implements Publisher {
  readonly name = "github-blog";
  private contentPath: string;
  private publicImgPath: string;

  constructor() {
    this.contentPath = path.join(PUBLISH_DIR, CONTENT_DIR);
    this.publicImgPath = path.join(PUBLISH_DIR, PUBLIC_IMG_DIR);
    mkdirSync(this.contentPath, { recursive: true });
    mkdirSync(this.publicImgPath, { recursive: true });
  }

  async publish(payload: PublishPayload): Promise<void> {
    const slug = this.titleToSlug(payload.title);
    const date = new Date().toISOString().slice(0, 10);
    const filename = `${date}-${slug}.md`;
    const filepath = path.join(this.contentPath, filename);

    if (existsSync(filepath)) {
      console.log(`[github-blog] Post already exists: ${filename}`);
      return;
    }

    // Copy images to public/ so they're served as static assets
    let heroImageUrl: string | null = null;
    const allImageUrls: string[] = [];
    const sources = payload.imagePaths?.length ? payload.imagePaths : payload.imagePath ? [payload.imagePath] : [];

    for (const imgPath of sources) {
      const imgFilename = path.basename(imgPath);
      const imgDest = path.join(this.publicImgPath, imgFilename);
      await Bun.write(imgDest, Bun.file(imgPath));
      const publicUrl = `/bookmarks/${imgFilename}`;
      allImageUrls.push(publicUrl);
      if (!heroImageUrl) heroImageUrl = publicUrl;
    }

    const tagsList = payload.tags?.length
      ? `tags:\n${payload.tags.map((t) => `  - "${t}"`).join("\n")}`
      : null;

    const frontmatter = [
      "---",
      `title: "${payload.title.replace(/"/g, '\\"')}"`,
      `description: "${payload.summaryShort.replace(/"/g, '\\"')}"`,
      `pubDate: "${new Date().toISOString()}"`,
      `url: "${payload.url}"`,
      heroImageUrl ? `heroImage: "${heroImageUrl}"` : null,
      tagsList,
      "---",
    ]
      .filter(Boolean)
      .join("\n");

    // Build image gallery markdown for extra images (beyond hero)
    const extraImages = allImageUrls.slice(1);
    const galleryMd = extraImages.length
      ? "\n\n" + extraImages.map((u, i) => `![image ${i + 2}](${u})`).join("\n\n")
      : "";

    const content = `${frontmatter}\n\n${payload.summaryLong}${galleryMd}\n\n[Read more](${payload.url})\n`;

    await Bun.write(filepath, content);

    const proc = Bun.spawn(
      ["sh", "-c", "git add -A && git commit -m 'bookmark: " + payload.title.replace(/'/g, "'\\''") + "' && git push"],
      { cwd: PUBLISH_DIR, stdout: "pipe", stderr: "pipe" }
    );
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      console.error(`[github-blog] git push failed (file saved locally): ${stderr}`);
      return;
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
