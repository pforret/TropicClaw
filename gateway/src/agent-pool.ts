import { spawn } from "child_process";
import path from "path";
import type { AgentConfig, UnifiedMessage } from "./types.js";
import { SessionStore } from "./session-store.js";

interface QueueItem {
  agent: AgentConfig;
  prompt: string;
  resolve: (value: string) => void;
  reject: (reason: Error) => void;
}

export class AgentPool {
  private running: Map<string, Promise<string>> = new Map();
  private queue: QueueItem[] = [];
  private maxConcurrent: number;
  private onTyping?: (channel: string, chatId: string) => void;

  constructor(maxConcurrent: number = 3) {
    this.maxConcurrent = maxConcurrent;
  }

  setTypingCallback(cb: (channel: string, chatId: string) => void) {
    this.onTyping = cb;
  }

  async dispatch(
    agent: AgentConfig,
    prompt: string,
    message?: UnifiedMessage
  ): Promise<string> {
    if (this.running.size >= this.maxConcurrent) {
      return new Promise((resolve, reject) => {
        this.queue.push({ agent, prompt, resolve, reject });
      });
    }

    if (message && this.onTyping) {
      this.onTyping(message.channel, message.chatId);
    }

    const key = `${agent.name}-${Date.now()}`;
    const promise = this.invokeAgent(agent, prompt);
    this.running.set(key, promise);

    try {
      return await promise;
    } finally {
      this.running.delete(key);
      this.drainQueue();
    }
  }

  private drainQueue() {
    if (this.queue.length === 0 || this.running.size >= this.maxConcurrent) return;
    const item = this.queue.shift()!;
    this.dispatch(item.agent, item.prompt).then(item.resolve, item.reject);
  }

  private invokeAgent(agent: AgentConfig, prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        "-p", prompt,
        "--output-format", "json",
        "--model", agent.model || "sonnet",
        "--max-turns", String(agent.max_turns || 20),
        "--dangerously-skip-permissions",
      ];

      if (agent.allowed_tools?.length) {
        args.push("--allowedTools", agent.allowed_tools.join(","));
      }

      const proc = spawn("claude", args, {
        cwd: agent.directory,
        timeout: (agent.timeout || 120) * 1000,
        env: {
          ...process.env,
          TRUST_TIER: String(agent.trust_tier || 1),
        },
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`claude exited with code ${code}: ${stderr}`));
          return;
        }
        try {
          const result = parseClaudeOutput(stdout);
          resolve(result);
        } catch (e) {
          // If JSON parsing fails, return raw stdout
          resolve(stdout.trim());
        }
      });

      proc.on("error", (err) => {
        reject(new Error(`Failed to spawn claude: ${err.message}`));
      });
    });
  }

  runningCount(): number {
    return this.running.size;
  }

  queuedCount(): number {
    return this.queue.length;
  }
}

function parseClaudeOutput(raw: string): string {
  // claude --output-format json returns JSON with a "result" field
  try {
    const parsed = JSON.parse(raw);
    if (parsed.result) return parsed.result;
    if (parsed.content) {
      // Handle array of content blocks
      if (Array.isArray(parsed.content)) {
        return parsed.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("\n");
      }
      return String(parsed.content);
    }
    return raw.trim();
  } catch {
    return raw.trim();
  }
}
