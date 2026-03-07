/**
 * ModelPicker — choose sonnet (cheap) by default, upgrade to opus when
 * the message suggests a complex task that benefits from the stronger model.
 */

export type ModelTier = "sonnet" | "opus";

interface PickResult {
  model: ModelTier;
  reason?: string; // which keyword triggered the upgrade (undefined = default)
}

// Patterns that suggest the user needs deep reasoning, complex code, or nuanced analysis.
// Each entry: [regex, short label for logging].
const OPUS_TRIGGERS: [RegExp, string][] = [
  // Explicit model requests
  [/\buse opus\b/i, "explicit-opus"],
  [/\bopus mode\b/i, "explicit-opus"],

  // Architecture & design
  [/\barchitect(ure)?\b/i, "architecture"],
  [/\bsystem design\b/i, "system-design"],
  [/\bdesign pattern\b/i, "design-pattern"],
  [/\btrade.?offs?\b/i, "tradeoffs"],

  // Deep analysis
  [/\brefactor\b/i, "refactor"],
  [/\bcode review\b/i, "code-review"],
  [/\broot cause\b/i, "root-cause"],
  [/\bdebug(ging)?\b/i, "debug"],
  [/\bdiagnos(e|tic|tics)\b/i, "diagnose"],
  [/\bexplain (why|how)\b/i, "explain-deep"],
  [/\bwhat went wrong\b/i, "post-mortem"],

  // Complex generation
  [/\bmigrat(e|ion)\b/i, "migration"],
  [/\bimplement .{20,}/i, "long-implement"], // "implement" + long description
  [/\brewrite\b/i, "rewrite"],
  [/\bfrom scratch\b/i, "from-scratch"],
  [/\boptimi[sz](e|ation)\b/i, "optimize"],

  // Multi-step reasoning
  [/\bstep.by.step\b/i, "step-by-step"],
  [/\bcompare .+ (and|vs|with|or) /i, "compare"],
  [/\bpros? (and|&) cons?\b/i, "pros-cons"],
  [/\banalys[ei]s\b/i, "analysis"],
  [/\bstrateg(y|ic)\b/i, "strategy"],
  [/\bplan (for|to|how)\b/i, "planning"],

  // Security & sensitive
  [/\bsecurity (audit|review|vulnerabilit)/i, "security"],
  [/\bpenetration test/i, "security"],
  [/\bthreat model/i, "security"],
];

export function pickModel(text: string, agentDefault: string = "sonnet"): PickResult {
  // If the agent is already configured for opus, keep it
  if (agentDefault === "opus") {
    return { model: "opus", reason: "agent-config" };
  }

  // Scan for opus triggers
  for (const [pattern, label] of OPUS_TRIGGERS) {
    if (pattern.test(text)) {
      return { model: "opus", reason: label };
    }
  }

  return { model: "sonnet" };
}
