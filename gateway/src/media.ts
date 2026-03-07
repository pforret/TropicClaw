import { mkdirSync, existsSync, rmSync } from "fs";
import path from "path";
import type { UnifiedMessage } from "./types.js";

const MEDIA_DIR = path.resolve(import.meta.dir, "..", "media");

export async function stageMedia(message: UnifiedMessage): Promise<string | undefined> {
  if (!message.content.media?.url && !message.content.media?.fileId) return undefined;

  const dir = path.join(MEDIA_DIR, message.id);
  mkdirSync(dir, { recursive: true });

  const ext = mimeToExt(message.content.media.mimeType);
  const fileName = message.content.media.fileName || `attachment.${ext}`;
  const localPath = path.join(dir, fileName);

  // URL-based download (HTTP adapter, etc.)
  if (message.content.media.url) {
    await downloadFile(message.content.media.url, localPath);
    message.content.media.localPath = localPath;
    return localPath;
  }

  // fileId-based download is handled by TelegramAdapter.downloadMedia()
  // Just set the expected path so the adapter can download to it
  message.content.media.localPath = localPath;
  return localPath;
}

export async function stageInboundMedia(
  adapter: { downloadMedia(fileId: string, destPath: string): Promise<string> },
  message: UnifiedMessage
): Promise<void> {
  if (!message.content.media?.fileId) return;

  const dir = path.join(MEDIA_DIR, message.id);
  mkdirSync(dir, { recursive: true });

  const ext = mimeToExt(message.content.media.mimeType);
  const fileName = message.content.media.fileName || `attachment.${ext}`;
  const localPath = path.join(dir, fileName);

  await adapter.downloadMedia(message.content.media.fileId, localPath);
  message.content.media.localPath = localPath;
}

function mimeToExt(mime?: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "audio/ogg": "ogg",
    "video/mp4": "mp4",
    "application/pdf": "pdf",
    "application/octet-stream": "bin",
  };
  return map[mime || ""] || "bin";
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
