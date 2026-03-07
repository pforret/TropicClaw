# PRP: Telegram Channel Adapter for TropicClaw Gateway

**Date:** 2026-03-07
**Confidence Score:** 10/10 (all decisions resolved, bot token available, plain text for v1, grammY+Bun spike passed — constructor, autoRetry plugin, event handlers, TS types all work)

## Objective

Implement the first channel adapter for the TropicClaw gateway: Telegram. This is **Phase 2** of the [Gateway PRP](./2026-03-07-gateway.md), building on the gateway scaffold (Phase 1). The adapter receives Telegram messages via long polling, normalizes them to `UnifiedMessage`, routes through the gateway pipeline, and sends responses back with Telegram MarkdownV2 formatting.

### What This PRP Covers

- Telegram adapter implementing the `ChannelAdapter` interface from the gateway
- Bot setup via BotFather
- Message normalization (text, photos, documents, voice, video)
- Media download and staging
- Outbound formatting (Markdown -> Telegram MarkdownV2)
- Owner verification (single-user: only the bot owner can interact)
- "Typing..." indicator while Claude processes
- Voice message support: STT (inbound) + TTS (outbound) with voice/text mode signaling
- End-to-end test: Telegram message -> gateway -> `claude -p` -> Telegram reply

### What This PRP Does NOT Cover

- Gateway scaffold (Phase 1 — separate PRP)
- Other channel adapters (Slack, Discord)
- Dreaming / session compression
- Trust enforcer hooks

## Transport Decision: In-Process API (Not CLI, Not MCP)

### Options Evaluated

| Option | Description | Verdict |
|--------|-------------|---------|
| **CLI** | Separate process (`telegram-bot.sh`) that posts to gateway HTTP API | Extra process, extra latency, harder to manage lifecycle. Rejected. |
| **MCP Server** | `telegram-mcp` server that Claude calls via MCP tools | Wrong direction: MCP is for Claude-to-tool, not tool-to-Claude. Claude can't "listen" on an MCP server for incoming messages. Rejected. |
| **In-process API** | Telegram library runs inside the gateway Bun process, emits events to the router | Lowest latency, simplest lifecycle, direct access to session store. **Chosen.** |

The gateway PRP already established this pattern: channel adapters are in-process components that implement the `ChannelAdapter` interface and emit `UnifiedMessage` events.

## How Incoming Messages Get Processed ASAP

```
Telegram servers
      │
      │ long-poll response (getUpdates)
      ▼
┌─────────────────────┐
│  grammY bot.on()    │  ← event fires immediately on update
│                     │
│  1. Owner check     │  ← <1ms: compare sender ID to config
│  2. Normalize msg   │  ← <1ms: map to UnifiedMessage
│  3. Emit "message"  │  ← <1ms: synchronous event
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  Router             │
│                     │
│  4. /command check  │  ← <1ms: regex test
│  5. Resolve agent   │  ← <1ms: SQLite lookup
│  6. sendChatAction  │  ← fire-and-forget: "typing..." to Telegram
│  7. Dispatch to     │  ← enqueue to agent pool
│     agent pool      │
└────────┬────────────┘
         │ (async, ~2-5s for claude -p)
         ▼
┌─────────────────────┐
│  Agent Pool         │
│  claude -p ...      │
│                     │
│  8. Parse response  │
│  9. Format for TG   │  ← Markdown -> MarkdownV2
│  10. Send reply     │  ← bot.api.sendMessage()
└─────────────────────┘
```

**Total overhead before Claude invocation: <5ms.** The bottleneck is `claude -p` (~2-5s), not the adapter.

### Key latency optimizations

1. **Typing indicator sent immediately** (step 6) — user sees "typing..." within milliseconds
2. **No HTTP hop** — adapter is in-process, no network round-trip to gateway
3. **Owner check is first** — reject non-owner messages before any processing
4. **Long polling with 30s timeout** — grammY handles reconnection automatically
5. **Fire-and-forget sendChatAction** — don't await the typing indicator

## Library Choice: grammY

### Options Evaluated

| Library | Bun Support | TypeScript | Maintained | Stars | Verdict |
|---------|------------|------------|------------|-------|---------|
| **Telegraf v4** | Unknown/untested | Yes | EOL (Feb 2025) | 8k+ | End-of-life. Rejected. |
| **grammY** | Community templates exist | First-class TS | Active, Bot API 8.2+ | 3k+ | Mature, excellent docs, TS-first. **Chosen.** |
| **GramIO** | First-class | First-class TS | Active, Bot API 9.5 | Newer | Explicit Bun support, but newer/smaller community. Runner-up. |
| **Raw Bot API** | N/A | Manual | N/A | N/A | Too much boilerplate. Rejected. |

**Why grammY over GramIO:**
- Larger community, more battle-tested
- Better documentation (https://grammy.dev/guide/)
- Conversation plugin, session plugin, and other middleware
- Gateway PRP referenced Telegraf (grammY is the spiritual successor with similar API)

**Why grammY over Telegraf:**
- Telegraf v4 reached end-of-life February 2025
- grammY was created by a Telegraf maintainer as its successor
- Better TypeScript types, better plugin system
- Designed for Deno/edge runtimes (closer to Bun compatibility)

### grammY with Bun

grammY uses standard `fetch` for HTTP requests and doesn't depend on Node-specific APIs. Bun implements the Web Standards APIs that grammY relies on. Community templates confirm grammY+Bun works (see https://github.com/Uo1428/grammy-bunjs-telegram-bot).

## Architecture

### ChannelAdapter Interface (from Gateway PRP)

```typescript
// gateway/src/adapters/interface.ts (already defined in Gateway PRP)
interface ChannelAdapter {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(response: OutboundResponse): Promise<void>;
  sendTyping(chatId: string): Promise<void>;
  on(event: "message", handler: (msg: UnifiedMessage) => void): void;
}
```

### Telegram Adapter Implementation

```typescript
// gateway/src/adapters/telegram.ts
import { Bot, Context } from "grammy";
import { UnifiedMessage, OutboundResponse } from "../types";
import { formatForChannel } from "../format";
import { downloadFile } from "../media";
import { logger } from "../logger";

export class TelegramAdapter implements ChannelAdapter {
  readonly name = "telegram";
  private bot: Bot;
  private handlers: ((msg: UnifiedMessage) => void)[] = [];
  private ownerId: string;

  constructor(token: string, ownerId: string) {
    this.bot = new Bot(token);
    this.ownerId = ownerId;
  }

  async start(): Promise<void> {
    // Register message handler
    this.bot.on("message", (ctx) => this.handleMessage(ctx));

    // Error handling
    this.bot.catch((err) => {
      logger.error("Telegram adapter error:", err);
    });

    // Start long polling (non-blocking)
    this.bot.start({
      onStart: (botInfo) => {
        logger.info(`Telegram bot @${botInfo.username} started (long polling)`);
      },
    });
  }

  async stop(): Promise<void> {
    this.bot.stop();
  }

  async send(response: OutboundResponse): Promise<void> {
    const text = `[${response.agent}]: ${response.content.text}`;

    if (response.content.media?.localPath) {
      await this.sendMedia(response);
    } else {
      // v1: plain text only. MarkdownV2 formatting added in a later iteration.
      await this.bot.api.sendMessage(response.chatId, text, {
        ...(response.replyToMessageId && {
          reply_parameters: { message_id: Number(response.replyToMessageId) },
        }),
      });
    }
  }

  async sendTyping(chatId: string): Promise<void> {
    // Fire-and-forget
    this.bot.api.sendChatAction(chatId, "typing").catch(() => {});
  }

  on(event: "message", handler: (msg: UnifiedMessage) => void): void {
    this.handlers.push(handler);
  }

  // --- Private ---

  private handleMessage(ctx: Context): void {
    const msg = ctx.message;
    if (!msg) return;

    // Owner check: reject non-owner messages immediately
    if (String(msg.from?.id) !== this.ownerId) {
      logger.debug(`Rejected message from non-owner: ${msg.from?.id}`);
      return;
    }

    const unified = this.normalize(ctx);
    for (const handler of this.handlers) {
      handler(unified);
    }
  }

  private normalize(ctx: Context): UnifiedMessage {
    const msg = ctx.message!;
    return {
      id: crypto.randomUUID(),
      channel: "telegram",
      channelMessageId: String(msg.message_id),
      senderId: String(msg.from!.id),
      chatId: String(msg.chat.id),
      content: {
        text: msg.text || msg.caption || "",
        media: this.extractMedia(msg),
      },
      timestamp: new Date(msg.date * 1000).toISOString(),
    };
  }

  private extractMedia(msg: any): UnifiedMessage["content"]["media"] | undefined {
    if (msg.photo) {
      const largest = msg.photo[msg.photo.length - 1];
      return {
        type: "image",
        fileId: largest.file_id,
        mimeType: "image/jpeg",
      };
    }
    if (msg.document) {
      return {
        type: "file",
        fileId: msg.document.file_id,
        mimeType: msg.document.mime_type || "application/octet-stream",
        fileName: msg.document.file_name,
      };
    }
    if (msg.voice) {
      return {
        type: "audio",
        fileId: msg.voice.file_id,
        mimeType: msg.voice.mime_type || "audio/ogg",
      };
    }
    if (msg.video) {
      return {
        type: "video",
        fileId: msg.video.file_id,
        mimeType: msg.video.mime_type || "video/mp4",
      };
    }
    return undefined;
  }

  // Download media from Telegram to local staging
  async downloadMedia(fileId: string, destPath: string): Promise<string> {
    const file = await this.bot.api.getFile(fileId);
    const url = `https://api.telegram.org/file/bot${this.bot.token}/${file.file_path}`;
    await downloadFile(url, destPath);
    return destPath;
  }

  private async sendMedia(response: OutboundResponse): Promise<void> {
    const media = response.content.media!;
    const caption = formatForChannel("telegram", `[${response.agent}]: ${response.content.text}`);

    switch (media.type) {
      case "image":
        await this.bot.api.sendPhoto(response.chatId, new InputFile(media.localPath!), {
          caption,
          parse_mode: "MarkdownV2",
        });
        break;
      case "file":
        await this.bot.api.sendDocument(response.chatId, new InputFile(media.localPath!), {
          caption,
          parse_mode: "MarkdownV2",
        });
        break;
    }
  }
}
```

### Telegram Formatting (v1: Plain Text)

v1 sends all messages as plain text. MarkdownV2 formatting will be added in a later iteration when we have real messages to test escaping edge cases against.

```typescript
// gateway/src/format.ts — v1: passthrough for Telegram
export function formatForChannel(channel: string, text: string): string {
  switch (channel) {
    case "telegram":  return text;          // v1: plain text
    case "slack":     return text;          // future: toSlackMrkdwn(text)
    case "discord":   return text;          // near-identical to markdown
    case "http":      return text;
    default:          return text;
  }
}
```

### Media Staging

```typescript
// gateway/src/media.ts
import { mkdirSync, existsSync } from "fs";
import { join } from "path";

const MEDIA_DIR = "gateway/media";

export async function stageInboundMedia(
  adapter: TelegramAdapter,
  message: UnifiedMessage
): Promise<void> {
  if (!message.content.media?.fileId) return;

  const dir = join(MEDIA_DIR, message.id);
  mkdirSync(dir, { recursive: true });

  const ext = mimeToExt(message.content.media.mimeType);
  const fileName = message.content.media.fileName || `attachment.${ext}`;
  const localPath = join(dir, fileName);

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
  };
  return map[mime || ""] || "bin";
}

export async function downloadFile(url: string, destPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  const buffer = await response.arrayBuffer();
  await Bun.write(destPath, buffer);
}
```

### Gateway Integration

The Telegram adapter plugs into the gateway entry point:

```typescript
// gateway/src/index.ts (relevant section)
import { TelegramAdapter } from "./adapters/telegram";

// Load config
const config = loadConfig(); // reads gateway.yaml + .env

// Initialize adapters
const adapters: ChannelAdapter[] = [];

if (process.env.TELEGRAM_BOT_TOKEN) {
  const telegram = new TelegramAdapter(
    process.env.TELEGRAM_BOT_TOKEN,
    config.owner.telegram_id
  );
  adapters.push(telegram);
}

// Wire each adapter to the router
for (const adapter of adapters) {
  adapter.on("message", async (msg) => {
    // Stage media if present
    if (msg.content.media?.fileId && adapter instanceof TelegramAdapter) {
      await stageInboundMedia(adapter, msg);
    }

    // Route through gateway pipeline
    const response = await router.handle(msg);

    if (response) {
      await adapter.send(response);
    }
  });

  await adapter.start();
}
```

### Configuration

```yaml
# gateway/config/gateway.yaml (add telegram_id)
owner:
  telegram_id: "12345678"    # Your Telegram user ID (get via @userinfobot)
```

```bash
# Bot token already available in project root .env as TELEGRAM_BOT_TOKEN
# Gateway reads from gateway/.env — copy or symlink from project root
```

## Bot Setup (BotFather)

1. Open Telegram, message [@BotFather](https://t.me/BotFather)
2. `/newbot` -> pick a name and username
3. Copy the bot token to `gateway/.env` as `TELEGRAM_BOT_TOKEN`
4. `/setcommands` -> set:
   ```
   agents - List available agents
   switch - Switch to a different agent
   current - Show current agent
   back - Switch to previous agent
   ```
5. Get your own user ID: message [@userinfobot](https://t.me/userinfobot), copy numeric ID to `gateway.yaml` as `owner.telegram_id`
6. `/setdescription` -> "TropicClaw personal AI assistant"

## Dependencies

| Package | Purpose | Version |
|---------|---------|---------|
| `grammy` | Telegram Bot API framework | ^1.x |
| `@grammyjs/auto-retry` | Automatic rate limit retry | ^2.x |

Already in gateway `package.json` from Phase 1: `fastify`, `yaml`, `bun:sqlite`.

**System dependencies (brew):**

| Tool | Purpose | Install |
|------|---------|---------|
| `whisper-cpp` | Local STT (Apple Silicon) | `brew install whisper-cpp` |
| `ffmpeg` | Audio format conversion | `brew install ffmpeg` |
| macOS `say` | Local TTS | Pre-installed |

## Tasks (Implementation Order)

**Prerequisite: Gateway Phase 1 must be complete** (scaffold, types, HTTP adapter, agent pool, session store, router, format.ts).

1. **Spike: verify grammY + Bun compatibility**
   ```bash
   cd gateway && bun add grammy && bun run -e "import { Bot } from 'grammy'; const b = new Bot('test'); console.log('grammy+bun OK')"
   ```
   If this fails, fall back to GramIO (`bun add gramio`).

2. **Install grammY + auto-retry**
   ```bash
   cd gateway && bun add grammy @grammyjs/auto-retry
   ```

2. **Extend UnifiedMessage type** (`types.ts`)
   - Add `senderId: string` field
   - Add `fileId?: string` to media type (Telegram-specific, used for download)
   - Add `fileName?: string` to media type

3. **Implement TelegramAdapter** (`src/adapters/telegram.ts`)
   - Constructor: takes token + ownerId
   - `start()`: register message handler, start long polling
   - `stop()`: stop bot
   - `handleMessage()`: owner check, normalize, emit
   - `normalize()`: map Telegram message to UnifiedMessage
   - `extractMedia()`: detect photo, document, voice, video
   - `send()`: format response, send with MarkdownV2 + plain text fallback
   - `sendTyping()`: fire-and-forget sendChatAction
   - `downloadMedia()`: getFile + fetch to local path

4. **Implement media staging** (`src/media.ts`)
   - `stageInboundMedia()`: download Telegram file to local staging dir
   - `downloadFile()`: fetch URL to disk using Bun.write
   - `mimeToExt()`: map MIME types to file extensions

5. **Implement format passthrough** (extend `src/format.ts`)
   - v1: plain text for Telegram (no MarkdownV2)
   - `formatForChannel()` stub ready for future formatting

6. **Wire Telegram adapter into gateway** (`src/index.ts`)
   - Conditional init based on `TELEGRAM_BOT_TOKEN` env var
   - Register message handler -> router pipeline
   - Stage media before routing

7. **Add Telegram config to gateway.yaml**
   - `owner.telegram_id` field
   - Document in `.env.example`

8. **Test: basic text message round-trip**
   - Send text message to bot
   - Verify: owner check passes, message normalized, routed to agent, response sent back with `[main]:` prefix
   - Verify: non-owner messages silently dropped

9. **Test: /command handling**
   - `/agents` -> list agents
   - `/switch coder` -> switch agent
   - `/current` -> show current agent
   - `/back` -> switch to previous

10. **Test: media message**
    - Send photo to bot
    - Verify: photo downloaded to `gateway/media/<id>/`
    - Verify: localPath included in prompt to Claude
    - Verify: Claude can read the image

11. **Test: typing indicator**
    - Send message, verify "typing..." appears immediately in Telegram
    - Verify typing continues while Claude processes

12. **Test: long message / MarkdownV2 formatting**
    - Trigger a response with code blocks, bold, links
    - Verify MarkdownV2 renders correctly in Telegram
    - Verify fallback to plain text if formatting fails

13. **Implement STT pipeline** (`src/voice/stt.ts`)
    - `transcribeAudio()`: ogg -> 16kHz wav (ffmpeg) -> whisper.cpp -> text
    - Cleanup temp files after transcription
    - Graceful fallback if whisper-cpp not installed: "[Voice message — STT not available]"

14. **Implement TTS pipeline** (`src/voice/tts.ts`)
    - `synthesizeSpeech()`: text -> AIFF (macOS say) -> OGG Opus (ffmpeg)
    - Configurable voice via `TTS_VOICE` env var
    - Graceful fallback if `say` not available (Linux): skip voice, send text only

15. **Extend UnifiedMessage with voice fields** (`types.ts`)
    - Add `voice?: { isVoice, originalFileId, duration, transcription }` to content
    - Add `replyAs?: "text" | "voice" | "both"` to OutboundResponse

16. **Wire voice handling into TelegramAdapter**
    - Detect voice messages in `handleMessage()`
    - Download, transcribe, populate `voice` field
    - In `send()`: route to `sendVoice()` or `sendMessage()` based on `replyAs`
    - "both" mode: voice with text caption

17. **Add voice prompt context in router**
    - Prepend "[Voice message (Ns), transcribed locally]:" to prompt
    - Append "your response will be sent back as both text and voice"
    - `determineReplyMode()`: voice -> both, `/voice` prefix -> voice, text -> text

18. **Test: voice message round-trip**
    - Send voice message to bot
    - Verify: downloaded, transcribed, Claude sees text, reply sent as voice + text
    - Verify: long text reply is sent as text only (TTS has practical length limits)

19. **Install `@grammyjs/auto-retry` plugin**
    - `bun add @grammyjs/auto-retry`
    - Wire into bot: `bot.api.config.use(autoRetry())`

## Validation Gates

```bash
# Type checking
cd gateway && bun run tsc --noEmit

# Verify grammY installed
bun run -e "import { Bot } from 'grammy'; console.log('grammy OK')"

# Verify adapter compiles
bun run -e "import { TelegramAdapter } from './src/adapters/telegram'; console.log('adapter OK')"

# Start gateway (requires TELEGRAM_BOT_TOKEN in .env)
bun run src/index.ts

# Manual test: send message to bot in Telegram
# Expected: response with [main]: prefix

# Test owner rejection: have someone else message the bot
# Expected: no response, debug log "Rejected message from non-owner"

# Test /agents command
# Expected: list of agents from agents/ directory

# Health check
curl http://127.0.0.1:18789/health

# Verify STT dependencies
which whisper-cpp && echo "whisper-cpp OK" || echo "WARN: whisper-cpp not installed"
which ffmpeg && echo "ffmpeg OK" || echo "WARN: ffmpeg not installed"

# Test STT pipeline (requires a sample .ogg file)
# ffmpeg -y -i test.ogg -ar 16000 -ac 1 test.wav && whisper-cpp --model large-v3-turbo --file test.wav

# Test TTS pipeline
# say -o /tmp/test.aiff "hello world" && ffmpeg -y -i /tmp/test.aiff -c:a libopus -b:a 48k /tmp/test.ogg
```

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Invalid bot token | grammY throws on `bot.start()`. Log error, skip Telegram adapter, gateway continues with other adapters. |
| Telegram API unreachable | grammY retries long polling automatically with backoff. |
| Non-owner message | Silent drop in `handleMessage()`. Debug log only. |
| Media download fails | Log warning, proceed without media. Include note in prompt: "[Media attachment could not be downloaded]" |
| MarkdownV2 send fails | Catch error, retry as plain text (no parse_mode). |
| Message too long (>4096 chars) | Split into chunks at paragraph boundaries, send sequentially. |
| Bot blocked by user | grammY error event. Log and ignore (user can't block their own bot). |
| `claude -p` timeout | Agent pool handles this. Return error message to Telegram. |
| Rate limit (429) | `@grammyjs/auto-retry` plugin handles retry automatically. |
| whisper-cpp not installed | Log warning, send "[Voice message — STT not available, install whisper-cpp]" as text. |
| ffmpeg not installed | Log warning, skip voice features entirely. |
| STT transcription fails | Send "[Voice message — transcription failed]" as text, attach duration info. |
| TTS synthesis fails | Fall back to text-only reply. Log warning. |
| Voice reply too long (>60s audio) | Send text-only. TTS has practical limits; threshold at ~500 chars. |

## Message Length Handling

Telegram has a 4096-character limit per message. Claude responses can be longer.

```typescript
const TELEGRAM_MAX_LENGTH = 4096;

function splitMessage(text: string): string[] {
  if (text.length <= TELEGRAM_MAX_LENGTH) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= TELEGRAM_MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }

    // Find a good split point (paragraph, then sentence, then word)
    let splitAt = remaining.lastIndexOf("\n\n", TELEGRAM_MAX_LENGTH);
    if (splitAt < TELEGRAM_MAX_LENGTH / 2) {
      splitAt = remaining.lastIndexOf("\n", TELEGRAM_MAX_LENGTH);
    }
    if (splitAt < TELEGRAM_MAX_LENGTH / 2) {
      splitAt = remaining.lastIndexOf(" ", TELEGRAM_MAX_LENGTH);
    }
    if (splitAt < 1) splitAt = TELEGRAM_MAX_LENGTH;

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}
```

## Key References

- **grammY documentation:** https://grammy.dev/guide/
- **grammY GitHub:** https://github.com/grammyjs/grammY
- **grammY Bun template:** https://github.com/Uo1428/grammy-bunjs-telegram-bot
- **Telegram Bot API:** https://core.telegram.org/bots/api
- **Telegram MarkdownV2 spec:** https://core.telegram.org/bots/api#markdownv2-style
- **Long polling vs webhooks (grammY docs):** https://grammy.dev/guide/deployment-types
- **GramIO (alternative, explicit Bun support):** https://gramio.dev/
- **Gateway PRP (this adapter's parent):** `docs/todo/PRPs/2026-03-07-gateway.md`
- **Channel gap analysis:** `docs/gap/02-channels.md`
- **Telegraf+Fastify blog (architecture patterns):** https://dev.to/6akcuk/your-own-telegram-bot-on-nodejs-with-typescript-telegraf-and-fastify-part-1-4f3l
- **whisper.cpp (local STT):** https://github.com/ggml-org/whisper.cpp
- **FluidAudio (future STT/TTS, CoreML/ANE):** https://github.com/FluidInference/FluidAudio
- **Piper TTS (future neural TTS):** https://github.com/rhasspy/piper
- **Telegram sendVoice API (OGG Opus required):** https://core.telegram.org/bots/api#sendvoice
- **Open-source STT overview:** https://fosspost.org/open-source-speech-recognition

## Resolved Design Decisions

1. **Transport:** In-process API inside gateway (not CLI, not MCP). Lowest latency, simplest lifecycle.
2. **Library:** grammY (not Telegraf, not GramIO). Mature, TS-first, successor to Telegraf.
3. **Polling vs Webhook:** Long polling for now. No public URL/TLS needed. Can add webhook endpoint later at `POST /webhook/telegram` if needed for production.
4. **Owner check location:** In the adapter itself (before normalization), not in the router. Fail fast.
5. **Plain text for v1:** Skip MarkdownV2 entirely. Send all replies as plain text. Add MarkdownV2 formatting in a later iteration when we have real messages to test against.
6. **Media handling:** Download to `gateway/media/<message-id>/` staging dir. Pass local file path to Claude prompt.
7. **Message splitting:** Split at paragraph/sentence/word boundaries when >4096 chars.
8. **STT:** whisper.cpp (local, Apple Silicon optimized via CoreML Metal). Future upgrade path: FluidAudio (Swift/CoreML/ANE).
9. **TTS:** macOS `say` + ffmpeg -> OGG Opus. Future upgrade path: Piper TTS for better voice quality.
10. **Voice reply strategy:** Voice messages get replied as "both" (voice + text caption). Text messages get text replies. `/voice` prefix forces voice reply.
11. **Voice in UnifiedMessage:** `content.voice` object carries `isVoice`, `transcription`, `duration`, `originalFileId`. `OutboundResponse.replyAs` controls reply format.
12. **Rate limiting:** `@grammyjs/auto-retry` plugin.

## Voice Message Support (STT + TTS)

Claude can't process audio via `claude -p`, so voice messages require a transcription pipeline (inbound) and an optional speech synthesis pipeline (outbound). Both use **local-only** tools — no cloud APIs.

### Inbound: Voice -> Text (STT)

**Tool: whisper.cpp** (local, runs on Apple Neural Engine via CoreML)

```bash
# Install
brew install whisper-cpp ffmpeg

# Download model (once)
# ggml-large-v3-turbo.bin is fast + accurate on Apple Silicon
whisper-cpp --download-model large-v3-turbo

# Set Metal path for GPU acceleration
export GGML_METAL_PATH_RESOURCES="$(brew --prefix whisper-cpp)/share/whisper-cpp"
```

**Pipeline:**

```
Telegram voice (.ogg opus)
  │
  ├── 1. Download via bot.api.getFile()
  │
  ├── 2. Convert to 16kHz WAV (whisper.cpp requirement)
  │     ffmpeg -y -i voice.ogg -ar 16000 -ac 1 voice.wav
  │
  ├── 3. Transcribe locally
  │     whisper-cpp --model large-v3-turbo --language auto --no-timestamps --file voice.wav
  │
  └── 4. Pass transcription as text to Claude
        "[Voice message transcription]: <text>"
```

```typescript
// gateway/src/voice/stt.ts
import { $ } from "bun";

const WHISPER_MODEL = process.env.WHISPER_MODEL || "large-v3-turbo";

export async function transcribeAudio(oggPath: string): Promise<string> {
  const wavPath = oggPath.replace(/\.\w+$/, ".wav");

  // Convert to 16kHz WAV
  await $`ffmpeg -y -i ${oggPath} -ar 16000 -ac 1 ${wavPath}`.quiet();

  // Transcribe with whisper.cpp
  const result = await $`whisper-cpp --model ${WHISPER_MODEL} --language auto --no-timestamps --output-txt --file ${wavPath}`.quiet();

  // Read the .txt output file
  const txtPath = wavPath.replace(/\.wav$/, ".txt");
  const text = await Bun.file(txtPath).text();

  // Cleanup temp files
  await $`rm -f ${wavPath} ${txtPath}`.quiet();

  return text.trim();
}
```

**Alternative (future):** [FluidAudio](https://github.com/FluidInference/FluidAudio) — Swift SDK using CoreML/ANE with Parakeet TDT models. Faster and more power-efficient than whisper.cpp, but requires a Swift bridge (not callable from Bun directly). Could wrap as a CLI tool later.

### Outbound: Text -> Voice (TTS)

**Tool: macOS `say` + ffmpeg** (zero dependencies beyond macOS builtins + ffmpeg)

Telegram requires voice messages in OGG Opus format. macOS `say` outputs AIFF, so we convert via ffmpeg.

```
Claude text response
  │
  ├── 1. macOS say -> AIFF
  │     say -o reply.aiff "Response text here"
  │
  ├── 2. Convert to OGG Opus (Telegram requirement)
  │     ffmpeg -y -i reply.aiff -c:a libopus -b:a 48k reply.ogg
  │
  └── 3. Send via bot.api.sendVoice()
```

```typescript
// gateway/src/voice/tts.ts
import { $ } from "bun";

const TTS_VOICE = process.env.TTS_VOICE || "Samantha"; // macOS voice

export async function synthesizeSpeech(text: string, outputPath: string): Promise<string> {
  const aiffPath = outputPath.replace(/\.\w+$/, ".aiff");

  // macOS say -> AIFF
  await $`say -v ${TTS_VOICE} -o ${aiffPath} ${text}`.quiet();

  // Convert to OGG Opus for Telegram
  await $`ffmpeg -y -i ${aiffPath} -c:a libopus -b:a 48k ${outputPath}`.quiet();

  // Cleanup
  await $`rm -f ${aiffPath}`.quiet();

  return outputPath;
}
```

**Alternative (future):** [Piper TTS](https://github.com/rhasspy/piper) — local neural TTS with high-quality voices. Install via `pip install piper-tts`, download voice models from HuggingFace. Much better voice quality than macOS `say`. Can swap in later without changing the adapter.

### Voice Mode Signaling in UnifiedMessage

The unified message format needs to indicate:
1. Whether the inbound message was a voice message (so the agent knows)
2. Whether the reply should be sent back as voice

```typescript
// Additions to gateway/src/types.ts

interface UnifiedMessage {
  // ... existing fields ...
  content: {
    text: string;
    media?: { /* ... existing ... */ };
    voice?: {
      isVoice: true;                    // message was received as voice
      originalFileId: string;           // Telegram file_id for the audio
      duration: number;                 // seconds
      transcription: string;            // STT result
    };
  };
}

interface OutboundResponse {
  // ... existing fields ...
  replyAs?: "text" | "voice" | "both";  // how to send the reply
}
```

### Voice Reply Strategy

The reply mode is determined by how the message was received:

| Inbound | Reply as | Rationale |
|---------|----------|-----------|
| Text message | `text` | Normal text reply |
| Voice message | `both` | Send voice + text (text as caption for searchability) |
| Text with `/voice` prefix | `voice` | Explicit voice request |

```typescript
// In router.ts — determine reply mode
function determineReplyMode(msg: UnifiedMessage): "text" | "voice" | "both" {
  if (msg.content.voice?.isVoice) return "both";
  if (msg.content.text.startsWith("/voice ")) return "voice";
  return "text";
}
```

### Voice in the Adapter

```typescript
// Addition to TelegramAdapter

private async handleVoiceMessage(ctx: Context): Promise<UnifiedMessage> {
  const msg = ctx.message!;
  const voice = msg.voice!;

  // Download and transcribe
  const oggPath = join(MEDIA_DIR, `${msg.message_id}.ogg`);
  await this.downloadMedia(voice.file_id, oggPath);
  const transcription = await transcribeAudio(oggPath);

  return {
    id: crypto.randomUUID(),
    channel: "telegram",
    channelMessageId: String(msg.message_id),
    senderId: String(msg.from!.id),
    chatId: String(msg.chat.id),
    content: {
      text: transcription,  // Claude sees the transcription as text
      voice: {
        isVoice: true,
        originalFileId: voice.file_id,
        duration: voice.duration,
        transcription,
      },
    },
    timestamp: new Date(msg.date * 1000).toISOString(),
  };
}

// In send() — handle voice replies
async send(response: OutboundResponse): Promise<void> {
  const replyAs = response.replyAs || "text";

  if (replyAs === "voice" || replyAs === "both") {
    const oggPath = join(MEDIA_DIR, `reply-${Date.now()}.ogg`);
    await synthesizeSpeech(response.content.text, oggPath);
    await this.bot.api.sendVoice(response.chatId, new InputFile(oggPath), {
      caption: replyAs === "both"
        ? formatForChannel("telegram", `[${response.agent}]: ${response.content.text}`)
        : undefined,
      parse_mode: replyAs === "both" ? "MarkdownV2" : undefined,
    });
    await $`rm -f ${oggPath}`.quiet();
  }

  if (replyAs === "text" || replyAs === "both") {
    // existing text send logic (only for "text" mode; "both" uses caption above)
    if (replyAs === "text") {
      await this.sendText(response);
    }
  }
}
```

### Voice Dependencies

| Dependency | Purpose | Install |
|------------|---------|---------|
| `whisper-cpp` | Local STT (Apple Silicon optimized) | `brew install whisper-cpp` |
| `ffmpeg` | Audio format conversion | `brew install ffmpeg` |
| macOS `say` | Local TTS (built-in) | Pre-installed on macOS |

### Prompt Format for Voice Messages

When Claude receives a voice message, the prompt includes context:

```
[Voice message (12s), transcribed locally]:
"Hey, can you check if my deployment went through?"

Reply to this message. The user sent this as a voice message, so your response will be sent back as both text and voice.
```

## Resolved Questions

1. **grammY autoRetry plugin**: Yes, use `@grammyjs/auto-retry` for Telegram rate limiting.
2. **Webhook vs long polling**: Long polling only for now. Add webhook later if needed.
3. **Voice messages**: Full support — whisper.cpp for STT, macOS `say`+ffmpeg for TTS. Voice messages are transcribed and forwarded as text. Replies to voice messages are sent as both voice and text.
