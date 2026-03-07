import type { OutboundResponse } from "./types.js";

export function formatResponse(response: OutboundResponse): string {
  return `[${response.agent}]: ${response.content.text}`;
}

export function formatForChannel(channel: string, text: string): string {
  switch (channel) {
    case "telegram":
      return toTelegramMarkdownV2(text);
    case "slack":
      return toSlackMrkdwn(text);
    case "discord":
      return text;
    case "http":
      return text;
    default:
      return stripMarkdown(text);
  }
}

function toTelegramMarkdownV2(md: string): string {
  // Telegram MarkdownV2 requires escaping these characters outside of code blocks:
  // _ * [ ] ( ) ~ ` > # + - = | { } . !
  const specialChars = /([_*\[\]()~`>#+\-=|{}.!\\])/g;

  const parts: string[] = [];
  let remaining = md;

  // Process code blocks first (preserve them)
  while (remaining.length > 0) {
    // Match ``` code blocks
    const codeBlockMatch = remaining.match(/```([\s\S]*?)```/);
    if (codeBlockMatch && codeBlockMatch.index !== undefined) {
      // Escape text before code block
      const before = remaining.slice(0, codeBlockMatch.index);
      parts.push(escapeForTelegram(before, specialChars));
      // Keep code block as-is (Telegram supports ```)
      parts.push("```" + codeBlockMatch[1] + "```");
      remaining = remaining.slice(codeBlockMatch.index + codeBlockMatch[0].length);
    } else {
      // Match inline code
      const inlineMatch = remaining.match(/`([^`]+)`/);
      if (inlineMatch && inlineMatch.index !== undefined) {
        const before = remaining.slice(0, inlineMatch.index);
        parts.push(escapeForTelegram(before, specialChars));
        parts.push("`" + inlineMatch[1] + "`");
        remaining = remaining.slice(inlineMatch.index + inlineMatch[0].length);
      } else {
        parts.push(escapeForTelegram(remaining, specialChars));
        break;
      }
    }
  }

  return parts.join("");
}

function escapeForTelegram(text: string, pattern: RegExp): string {
  // Convert **bold** to *bold* (Telegram uses single *)
  let result = text.replace(/\*\*(.+?)\*\*/g, (_, content) => {
    return "*" + content.replace(pattern, "\\$1") + "*";
  });
  // Escape remaining special chars (but not the * we just placed for bold)
  // This is simplified — a production version would need a proper parser
  result = result.replace(/(?<![\\*])[_\[\]()~>#+\-=|{}.!]/g, "\\$&");
  return result;
}

function toSlackMrkdwn(md: string): string {
  let text = md;
  // **bold** → *bold*
  text = text.replace(/\*\*(.+?)\*\*/g, "*$1*");
  // _italic_ stays the same in Slack
  // [text](url) → <url|text>
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>");
  return text;
}

function stripMarkdown(md: string): string {
  let text = md;
  text = text.replace(/\*\*(.+?)\*\*/g, "$1");
  text = text.replace(/\*(.+?)\*/g, "$1");
  text = text.replace(/_(.+?)_/g, "$1");
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/```[\s\S]*?```/g, (match) => match.replace(/```/g, ""));
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  text = text.replace(/^#{1,6}\s+/gm, "");
  return text;
}
