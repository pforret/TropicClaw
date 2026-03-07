import path from "path";
import { existsSync, readFileSync } from "fs";
import type { AgentConfig, UnifiedMessage } from "./types.js";
import { pickModel } from "./model-picker.js";

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

  private async invokeAgent(agent: AgentConfig, prompt: string): Promise<string> {
    const pick = pickModel(prompt, agent.model || "sonnet");
    if (pick.reason) {
      console.log(`[agent-pool] Model pick: ${pick.model} (reason: ${pick.reason})`);
    }

    const args = [
      "-p", prompt,
      "--output-format", "json",
      "--model", pick.model,
      "--max-turns", String(agent.max_turns || 20),
      "--dangerously-skip-permissions",
    ];

    const personality = loadPersonality(agent.directory);
    if (personality) {
      args.push("--append-system-prompt", personality);
    }

    if (agent.allowed_tools?.length) {
      args.push("--allowedTools", agent.allowed_tools.join(","));
    }

    const env = { ...process.env };
    delete env.CLAUDECODE;

    console.log(`[agent-pool] Spawning: claude ${args.slice(0, 2).join(" ")}... (cwd: ${agent.directory})`);
    const startTime = Date.now();

    const proc = Bun.spawn(["claude", ...args], {
      cwd: agent.directory,
      env: {
        ...env,
        TRUST_TIER: String(agent.trust_tier || 1),
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    // Set up timeout
    const timeoutMs = (agent.timeout || 120) * 1000;
    const timer = setTimeout(() => {
      console.error(`[agent-pool] Killing claude after ${agent.timeout}s timeout`);
      proc.kill();
    }, timeoutMs);

    try {
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      clearTimeout(timer);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[agent-pool] claude exited: code=${exitCode} elapsed=${elapsed}s stdout=${stdout.length}chars`);
      if (stderr) console.log(`[agent-pool] stderr: ${stderr.slice(0, 500)}`);

      if (exitCode !== 0) {
        throw new Error(`claude exited with code ${exitCode}: ${stderr}`);
      }

      return parseClaudeOutput(stdout);
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  runningCount(): number {
    return this.running.size;
  }

  queuedCount(): number {
    return this.queue.length;
  }
}

const PERSONALITY_FILES = ["SOUL.md", "USER.md", "TOOLS.md", "AGENTS.md", "MEMORY.md", "CONTEXT.md", "RULES.md"];

function loadPersonality(agentDir: string): string | null {
  const sections: string[] = [];
  for (const filename of PERSONALITY_FILES) {
    const filePath = path.join(agentDir, filename);
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, "utf-8").trim();
      if (content) {
        sections.push(`# ${filename}\n\n${content}`);
      }
    }
  }
  return sections.length ? sections.join("\n\n---\n\n") : null;
}

function parseClaudeOutput(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (parsed.result) return parsed.result;
    if (parsed.content) {
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
