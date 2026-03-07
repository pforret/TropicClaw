import { mkdirSync, existsSync, rmSync } from "fs";
import path from "path";
import type { UnifiedMessage } from "./types.js";

const MEDIA_DIR = path.resolve(import.meta.dir, "..", "media");

export async function stageMedia(message: UnifiedMessage): Promise<string | undefined> {
  if (!message.content.media?.url) return undefined;

  const dir = path.join(MEDIA_DIR, message.id);
  mkdirSync(dir, { recursive: true });

  const ext = message.content.media.mimeType?.split("/")[1] || "bin";
  const localPath = path.join(dir, `attachment.${ext}`);

  await downloadFile(message.content.media.url, localPath);

  message.content.media.localPath = localPath;
  return localPath;
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  await Bun.write(dest, buffer);
}

export function cleanupMedia(messageId: string) {
  const dir = path.join(MEDIA_DIR, messageId);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}
