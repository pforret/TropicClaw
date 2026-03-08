import type { ChannelName, UnifiedMessage } from "./types.js";
import os from "os";

/**
 * Per-channel capability definitions.
 * Modeled after OpenClaw's channel-aware system prompt injection.
 */

export interface ChannelCapabilities {
  /** Human-readable channel name */
  label: string;
  /** Supported actions */
  actions: string[];
  /** Max message length (chars) before splitting */
  maxMessageLength: number;
  /** Supports inline buttons / keyboards */
  inlineButtons: boolean;
  /** Supports reactions */
  reactions: boolean;
  /** Supports markdown formatting */
  markdown: "full" | "limited" | "none";
  /** Supports media attachments in responses */
  media: string[];
  /** Supports voice messages */
  voice: boolean;
  /** Formatting notes for the LLM */
  formattingNotes?: string;
}

const CHANNEL_CAPABILITIES: Record<ChannelName, ChannelCapabilities> = {
  telegram: {
    label: "Telegram",
    actions: ["reply", "edit", "react"],
    maxMessageLength: 4096,
    inlineButtons: true,
    reactions: true,
    markdown: "limited",
    media: ["image", "audio", "video", "file"],
    voice: true,
    formattingNotes:
      "Use Telegram-flavored Markdown: *bold*, _italic_, `code`, ```pre```. " +
      "No headings (#). Keep messages under 4096 chars. " +
      "Avoid complex tables — use simple lists instead.",
  },
  slack: {
    label: "Slack",
    actions: ["reply", "edit", "react", "thread"],
    maxMessageLength: 40000,
    inlineButtons: true,
    reactions: true,
    markdown: "limited",
    media: ["image", "file"],
    voice: false,
    formattingNotes:
      "Use Slack mrkdwn: *bold*, _italic_, `code`, ```code block```. " +
      "No standard Markdown headings; use *bold text* on its own line for section headers.",
  },
  discord: {
    label: "Discord",
    actions: ["reply", "edit", "react"],
    maxMessageLength: 2000,
    inlineButtons: true,
    reactions: true,
    markdown: "full",
    media: ["image", "file"],
    voice: false,
    formattingNotes:
      "Use standard Markdown. Messages over 2000 chars will be split. " +
      "Use ```lang for code blocks.",
  },
  http: {
    label: "HTTP API",
    actions: ["reply"],
    maxMessageLength: 100000,
    inlineButtons: false,
    reactions: false,
    markdown: "full",
    media: ["image", "file"],
    voice: false,
  },
};

export function getChannelCapabilities(channel: ChannelName): ChannelCapabilities {
  return CHANNEL_CAPABILITIES[channel];
}

/**
 * Build the runtime context block injected into the system prompt.
 * Layer 1: runtime metadata line (channel, host, platform)
 * Layer 3: channel-specific capability guidance
 */
export function buildChannelContext(message: UnifiedMessage): string {
  const caps = CHANNEL_CAPABILITIES[message.channel];
  const lines: string[] = [];

  // Layer 1: Runtime line
  const runtimeParts = [
    `channel=${message.channel}`,
    `host=${os.hostname()}`,
    `platform=${os.platform()}`,
  ];
  if (caps.inlineButtons) runtimeParts.push("capabilities=inlineButtons");
  if (caps.voice) runtimeParts.push("capabilities=voice");
  lines.push(`[runtime] ${runtimeParts.join("  ")}`);

  // Layer 3: Channel-specific guidance
  lines.push("");
  lines.push(`You are responding via ${caps.label}.`);

  // Formatting
  if (caps.formattingNotes) {
    lines.push(caps.formattingNotes);
  }

  // Message length constraint
  if (caps.maxMessageLength < 10000) {
    lines.push(`Max message length: ${caps.maxMessageLength} characters.`);
  }

  // Actions
  const actionList = caps.actions.join(", ");
  lines.push(`Supported actions: ${actionList}.`);

  // Reactions
  if (caps.reactions) {
    lines.push(`Reactions are supported on ${caps.label}.`);
  }

  // Inline buttons
  if (caps.inlineButtons && message.channel !== "http") {
    lines.push(`Inline buttons are available on ${caps.label}.`);
  } else if (!caps.inlineButtons) {
    lines.push(`Inline buttons are not available on ${caps.label}.`);
  }

  // Media
  if (caps.media.length) {
    lines.push(`Supported media types: ${caps.media.join(", ")}.`);
  }

  // Voice
  if (caps.voice) {
    lines.push(`Voice messages are supported. You may receive transcribed voice input.`);
  }

  return lines.join("\n");
}
