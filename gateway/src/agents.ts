import { existsSync, readdirSync } from "fs";
import { readFileSync } from "fs";
import path from "path";
import { parse as parseYaml } from "yaml";
import type { AgentConfig } from "./types.js";

const AGENTS_DIR = path.resolve(import.meta.dir, "..", "agents");

const DEFAULTS: Omit<AgentConfig, "name" | "directory"> = {
  description: "",
  model: "sonnet",
  max_turns: 20,
  trust_tier: 1,
  timeout: 120,
};

export function discoverAgents(agentsDir: string = AGENTS_DIR): AgentConfig[] {
  if (!existsSync(agentsDir)) return [];

  const agents: AgentConfig[] = [];
  const entries = readdirSync(agentsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const agentDir = path.join(agentsDir, entry.name);
    const claudeMd = path.join(agentDir, "CLAUDE.md");

    if (!existsSync(claudeMd)) continue;

    const config = loadAgentConfig(entry.name, agentDir);
    agents.push(config);
  }

  return agents;
}

function loadAgentConfig(name: string, directory: string): AgentConfig {
  const yamlPath = path.join(directory, "agent.yaml");
  let parsed: Record<string, any> = {};

  if (existsSync(yamlPath)) {
    const raw = readFileSync(yamlPath, "utf-8");
    parsed = parseYaml(raw) ?? {};
  }

  return {
    name,
    directory,
    description: parsed.description ?? DEFAULTS.description,
    model: parsed.model ?? DEFAULTS.model,
    max_turns: parsed.max_turns ?? DEFAULTS.max_turns,
    trust_tier: parsed.trust_tier ?? DEFAULTS.trust_tier,
    timeout: parsed.timeout ?? DEFAULTS.timeout,
    allowed_tools: parsed.allowed_tools,
  };
}

export function getAgent(name: string, agentsDir: string = AGENTS_DIR): AgentConfig | undefined {
  const agentDir = path.join(agentsDir, name);
  const claudeMd = path.join(agentDir, "CLAUDE.md");
  if (!existsSync(claudeMd)) return undefined;
  return loadAgentConfig(name, agentDir);
}
