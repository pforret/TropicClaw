import { existsSync, readFileSync, readdirSync } from "fs";
import path from "path";
import type { FastifyInstance } from "fastify";
import type { SessionStore } from "./session-store.js";
import { discoverAgents, getAgent } from "./agents.js";
import type { AgentConfig } from "./types.js";
import { parse as parseYaml } from "yaml";

const JOBS_DIR = path.resolve(import.meta.dir, "..", "..", ".claude", "tropicron", "jobs");

export interface ChannelInfo {
  name: string;
  label: string;
  hasToken: boolean;
  tokenEnvVar: string;
  running: boolean;
  botName?: string;
  ownerId?: string;
  extra?: Record<string, string>;
}

export function buildChannelInfo(): ChannelInfo[] {
  return [
    {
      name: "telegram",
      label: "Telegram",
      hasToken: !!process.env.TELEGRAM_BOT_TOKEN,
      tokenEnvVar: "TELEGRAM_BOT_TOKEN",
      running: false, // updated after start
      botName: undefined,
      ownerId: process.env.OWNER_TELEGRAM_ID,
    },
    {
      name: "slack",
      label: "Slack",
      hasToken: !!process.env.SLACK_BOT_TOKEN,
      tokenEnvVar: "SLACK_BOT_TOKEN",
      running: false,
      ownerId: process.env.OWNER_SLACK_ID,
      extra: {
        "Signing secret": process.env.SLACK_SIGNING_SECRET ? "configured" : "missing",
        "App token": process.env.SLACK_APP_TOKEN ? "configured" : "missing",
      },
    },
    {
      name: "discord",
      label: "Discord",
      hasToken: !!process.env.DISCORD_BOT_TOKEN,
      tokenEnvVar: "DISCORD_BOT_TOKEN",
      running: false,
      ownerId: process.env.OWNER_DISCORD_ID,
    },
    {
      name: "http",
      label: "HTTP API",
      hasToken: true, // always available
      tokenEnvVar: "(none)",
      running: true, // always running
    },
  ];
}

export function registerWebRoutes(app: FastifyInstance, sessionStore: SessionStore, channels: ChannelInfo[]) {
  app.get("/", async (_req, reply) => {
    const endpoints = [
      { method: "GET", path: "/web/agents", desc: "Agents dashboard", web: true },
      { method: "GET", path: "/web/activity", desc: "Recent activity", web: true },
      { method: "GET", path: "/web/channels", desc: "Channels overview", web: true },
      { method: "GET", path: "/web/schedule", desc: "Scheduled jobs (tropicron)", web: true },
      { method: "GET", path: "/health", desc: "Health check", web: true },
      { method: "GET", path: "/api/agents", desc: "List agents (JSON)", web: true },
      { method: "GET", path: "/api/sessions", desc: "List sessions (JSON)", web: true },
      { method: "GET", path: "/api/activity", desc: "Recent activity (JSON, ?limit=N&since=ISO)", web: true },
      { method: "POST", path: "/api/message", desc: "Send message (HTTP adapter)", web: false },
      { method: "POST", path: "/api/deliver", desc: "Deliver output to channel (tropicron)", web: false },
    ];

    const rows = endpoints
      .map((e) => {
        const linked = e.web
          ? `<a href="${esc(e.path)}">${esc(e.path)}</a>`
          : `<code>${esc(e.path)}</code>`;
        const methodClass = e.method === "GET" ? "badge badge-ok" : "badge badge-alt";
        return `
        <tr>
          <td><span class="${methodClass}">${e.method}</span></td>
          <td>${linked}</td>
          <td class="muted">${esc(e.desc)}</td>
        </tr>`;
      })
      .join("");

    reply.type("text/html").send(
      layout(
        "Home",
        `<h1>TropicClaw Gateway</h1>
        <p class="muted">Central orchestration layer — routes messages to Claude Code agents.</p>
        <h2>Endpoints</h2>
        <table>
          <thead><tr><th>Method</th><th>Path</th><th>Description</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
      )
    );
  });

  app.get("/web/agents", async (_req, reply) => {
    const agents = discoverAgents();
    const sessions = sessionStore.listSessions();
    const channelAgents = sessionStore.getChannelAgents();

    const sessionMap = new Map(sessions.map((s) => [s.agent, s]));
    const channelMap = new Map<string, string[]>();
    for (const ca of channelAgents) {
      const list = channelMap.get(ca.current_agent) || [];
      list.push(`${ca.channel}:${ca.chat_id}`);
      channelMap.set(ca.current_agent, list);
    }

    const rows = agents
      .map((a) => {
        const s = sessionMap.get(a.name);
        const channels = channelMap.get(a.name) || [];
        return `
        <tr>
          <td><a href="/web/agents/${a.name}">${a.name}</a></td>
          <td>${esc(a.description)}</td>
          <td><code>${a.model}</code></td>
          <td>${a.trust_tier}</td>
          <td>${s?.message_count ?? 0}</td>
          <td>${channels.length ? channels.map((c) => `<span class="badge">${esc(c)}</span>`).join(" ") : "<span class='muted'>none</span>"}</td>
          <td class="muted">${s ? timeAgo(s.last_active) : "never"}</td>
        </tr>`;
      })
      .join("");

    reply.type("text/html").send(
      layout(
        "Agents",
        `<h1>Agents</h1>
        <table>
          <thead><tr>
            <th>Name</th><th>Description</th><th>Model</th><th>Trust</th><th>Messages</th><th>Channels</th><th>Last Active</th>
          </tr></thead>
          <tbody>${rows || "<tr><td colspan=7 class='muted'>No agents discovered</td></tr>"}</tbody>
        </table>`
      )
    );
  });

  app.get<{ Params: { name: string } }>("/web/agents/:name", async (req, reply) => {
    const agent = getAgent(req.params.name);
    if (!agent) {
      reply.status(404).type("text/html").send(layout("Not Found", "<h1>Agent not found</h1>"));
      return;
    }

    const personalityFiles = getPersonalityFiles(agent);

    const sessions = sessionStore.listSessions();
    const session = sessions.find((s) => s.agent === agent.name);

    const channelAgents = sessionStore.getChannelAgents().filter((ca) => ca.current_agent === agent.name);

    const history = sessionStore.getHistory(agent.name, 30);

    const dreamsDir = path.join(agent.directory, "dreams");
    let dreams: string[] = [];
    if (existsSync(dreamsDir)) {
      dreams = readdirSync(dreamsDir)
        .filter((f) => f.endsWith(".md"))
        .sort()
        .reverse()
        .slice(0, 10);
    }

    const historyRows = history
      .reverse()
      .map((m) => {
        const roleClass = m.role === "user" ? "role-user" : m.role === "assistant" ? "role-assistant" : "role-system";
        return `
        <tr class="${roleClass}">
          <td class="muted">${formatTime(m.ts)}</td>
          <td>${m.role}</td>
          <td>${m.channel ? `<span class="badge">${esc(m.channel)}</span>` : ""}</td>
          <td class="msg-text">${esc(truncate(m.text, 200))}</td>
        </tr>`;
      })
      .join("");

    const dreamsList = dreams.length
      ? dreams.map((d) => `<li><code>${esc(d)}</code></li>`).join("")
      : "<li class='muted'>No dream logs yet</li>";

    const channelList = channelAgents.length
      ? channelAgents
          .map(
            (ca) =>
              `<span class="badge">${esc(ca.channel)}:${esc(ca.chat_id)}</span>`
          )
          .join(" ")
      : '<span class="muted">No active channels</span>';

    const personalityItems = personalityFiles
      .map((pf) => {
        const firstLine = pf.content.split("\n").find((l) => l.trim().length > 0) || "";
        const preview = truncate(firstLine.replace(/^#+\s*/, ""), 60);
        return `<li>
          <code>${esc(pf.filename)}</code>
          <span class="muted"> &mdash; ${esc(preview)}</span>
        </li>`;
      })
      .join("");

    reply.type("text/html").send(
      layout(
        `Agent: ${agent.name}`,
        `<h1>${esc(agent.name)}</h1>
        <p class="muted">${esc(agent.description)}</p>

        <div class="grid">
          <div class="card">
            <h3>Config</h3>
            <dl>
              <dt>Model</dt><dd><code>${esc(agent.model)}</code></dd>
              <dt>Max turns</dt><dd>${agent.max_turns}</dd>
              <dt>Trust tier</dt><dd>${agent.trust_tier}</dd>
              <dt>Timeout</dt><dd>${agent.timeout}s</dd>
            </dl>
          </div>
          <div class="card">
            <h3>Session</h3>
            <dl>
              <dt>Messages</dt><dd>${session?.message_count ?? 0}</dd>
              <dt>Status</dt><dd>${session?.status ?? "inactive"}</dd>
              <dt>Last active</dt><dd>${session ? timeAgo(session.last_active) : "never"}</dd>
            </dl>
          </div>
          <div class="card">
            <h3>Channels</h3>
            <p>${channelList}</p>
          </div>
          <div class="card">
            <h3>Personality</h3>
            <ul class="personality-list">${personalityItems || '<li class="muted">No personality files</li>'}</ul>
            ${personalityFiles.length ? `<p style="margin-top:0.5rem"><a href="/web/agents/${esc(agent.name)}/personality">View all &rarr;</a></p>` : ""}
          </div>
        </div>

        <h2>Recent Activity (last 30)</h2>
        <table class="activity">
          <thead><tr><th>Time</th><th>Role</th><th>Channel</th><th>Message</th></tr></thead>
          <tbody>${historyRows || "<tr><td colspan=4 class='muted'>No messages yet</td></tr>"}</tbody>
        </table>

        <h2>Dream Logs</h2>
        <ul>${dreamsList}</ul>

        <p><a href="/web/agents">&larr; All agents</a></p>`
      )
    );
  });

  app.get<{ Params: { name: string } }>("/web/agents/:name/personality", async (req, reply) => {
    const agent = getAgent(req.params.name);
    if (!agent) {
      reply.status(404).type("text/html").send(layout("Not Found", "<h1>Agent not found</h1>"));
      return;
    }

    const personalityFiles = getPersonalityFiles(agent);

    const sections = personalityFiles
      .map((pf) => {
        const lines = pf.content.split("\n").length;
        return `
        <div class="personality-section">
          <h2>${esc(pf.filename)} <span class="muted" style="font-size:0.75rem; font-weight:400">${lines} lines</span></h2>
          <pre>${esc(pf.content)}</pre>
        </div>`;
      })
      .join("");

    reply.type("text/html").send(
      layout(
        `Personality: ${agent.name}`,
        `<h1>Personality: ${esc(agent.name)}</h1>
        <p class="muted">${esc(agent.description)}</p>

        ${sections || '<p class="muted">No personality files found.</p>'}

        <p style="margin-top:2rem"><a href="/web/agents/${esc(agent.name)}">&larr; Back to ${esc(agent.name)}</a></p>`
      )
    );
  });

  app.get("/web/channels", async (_req, reply) => {
    const channelAgents = sessionStore.getChannelAgents();
    const activity = sessionStore.getRecentActivity(500);

    const rows = channels
      .map((ch) => {
        const activeAgents = channelAgents
          .filter((ca) => ca.channel === ch.name)
          .map((ca) => ca.current_agent);
        const msgCount = activity.filter((m) => m.channel === ch.name).length;
        const statusBadge = ch.running
          ? '<span class="badge badge-ok">running</span>'
          : ch.hasToken
            ? '<span class="badge badge-alt">ready (not started)</span>'
            : '<span class="badge badge-off">no token</span>';
        return `
        <tr>
          <td><a href="/web/channels/${esc(ch.name)}">${esc(ch.label)}</a></td>
          <td>${statusBadge}</td>
          <td>${ch.hasToken ? '<span class="badge badge-ok">yes</span>' : '<span class="badge badge-off">no</span>'}</td>
          <td>${ch.botName ? esc(ch.botName) : '<span class="muted">-</span>'}</td>
          <td>${activeAgents.length ? activeAgents.map((a) => `<a href="/web/agents/${esc(a)}">${esc(a)}</a>`).join(", ") : '<span class="muted">none</span>'}</td>
          <td>${msgCount || '<span class="muted">0</span>'}</td>
        </tr>`;
      })
      .join("");

    reply.type("text/html").send(
      layout(
        "Channels",
        `<h1>Channels</h1>
        <table>
          <thead><tr><th>Channel</th><th>Status</th><th>Token</th><th>Bot</th><th>Active Agents</th><th>Messages</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
      )
    );
  });

  app.get<{ Params: { channel: string } }>("/web/channels/:channel", async (req, reply) => {
    const ch = channels.find((c) => c.name === req.params.channel);
    if (!ch) {
      reply.status(404).type("text/html").send(layout("Not Found", "<h1>Channel not found</h1>"));
      return;
    }

    const channelAgents = sessionStore.getChannelAgents().filter((ca) => ca.channel === ch.name);
    const recentMessages = sessionStore.getRecentActivity(200).filter((m) => m.channel === ch.name);

    const statusBadge = ch.running
      ? '<span class="badge badge-ok">running</span>'
      : ch.hasToken
        ? '<span class="badge badge-alt">ready (not started)</span>'
        : '<span class="badge badge-off">not configured</span>';

    const tokenStatus = ch.hasToken
      ? `<span class="badge badge-ok">available</span> <span class="muted">(${esc(ch.tokenEnvVar)})</span>`
      : `<span class="badge badge-off">missing</span> <span class="muted">Set <code>${esc(ch.tokenEnvVar)}</code> in .env</span>`;

    const agentRows = channelAgents.length
      ? channelAgents.map((ca) => `
        <tr>
          <td><code>${esc(ca.chat_id)}</code></td>
          <td><a href="/web/agents/${esc(ca.current_agent)}">${esc(ca.current_agent)}</a></td>
          <td class="muted">${timeAgo(ca.updated_at)}</td>
        </tr>`).join("")
      : '<tr><td colspan=3 class="muted">No active agent assignments</td></tr>';

    const extraRows = ch.extra
      ? Object.entries(ch.extra).map(([k, v]) => {
          const badge = v === "configured"
            ? '<span class="badge badge-ok">configured</span>'
            : '<span class="badge badge-off">missing</span>';
          return `<dt>${esc(k)}</dt><dd>${badge}</dd>`;
        }).join("")
      : "";

    const msgRows = recentMessages.slice(0, 30).map((m) => {
      const roleClass = m.role === "user" ? "role-user" : m.role === "assistant" ? "role-assistant" : "role-system";
      return `
      <tr class="${roleClass}">
        <td class="muted">${formatTime(m.ts)}</td>
        <td><a href="/web/agents/${esc(m.agent)}">${esc(m.agent)}</a></td>
        <td>${m.role}</td>
        <td class="msg-text">${esc(truncate(m.text, 150))}</td>
      </tr>`;
    }).join("");

    reply.type("text/html").send(
      layout(
        `Channel: ${ch.label}`,
        `<h1>${esc(ch.label)}</h1>

        <div class="grid">
          <div class="card">
            <h3>Status</h3>
            <dl>
              <dt>Status</dt><dd>${statusBadge}</dd>
              <dt>API token</dt><dd>${tokenStatus}</dd>
              ${ch.botName ? `<dt>Bot name</dt><dd>${esc(ch.botName)}</dd>` : ""}
              ${ch.ownerId ? `<dt>Owner ID</dt><dd><code>${esc(ch.ownerId)}</code></dd>` : ""}
              ${extraRows}
            </dl>
          </div>
          <div class="card">
            <h3>Stats</h3>
            <dl>
              <dt>Messages (recent)</dt><dd>${recentMessages.length}</dd>
              <dt>Active chats</dt><dd>${channelAgents.length}</dd>
            </dl>
          </div>
        </div>

        <h2>Agent Assignments</h2>
        <table>
          <thead><tr><th>Chat ID</th><th>Current Agent</th><th>Last Switch</th></tr></thead>
          <tbody>${agentRows}</tbody>
        </table>

        <h2>Recent Messages</h2>
        <table class="activity">
          <thead><tr><th>Time</th><th>Agent</th><th>Role</th><th>Message</th></tr></thead>
          <tbody>${msgRows || '<tr><td colspan=4 class="muted">No messages yet</td></tr>'}</tbody>
        </table>

        <p><a href="/web/channels">&larr; All channels</a></p>`
      )
    );
  });

  app.get("/api/activity", async (req, reply) => {
    const limit = Math.min(Number((req.query as any).limit) || 100, 500);
    const since = (req.query as any).since as string | undefined;
    let activity = sessionStore.getRecentActivity(limit);
    if (since) {
      activity = activity.filter((m) => m.ts > since);
    }
    reply.send(activity);
  });

  app.get("/web/activity", async (_req, reply) => {
    const activity = sessionStore.getRecentActivity(100);

    const rows = activity
      .map((m) => {
        const roleClass = m.role === "user" ? "role-user" : m.role === "assistant" ? "role-assistant" : "role-system";
        const latency = m.latency_ms ? `${m.latency_ms}ms` : "";
        return `
        <tr class="${roleClass}" data-ts="${esc(m.ts)}">
          <td class="muted">${formatTime(m.ts)}</td>
          <td><a href="/web/agents/${esc(m.agent)}">${esc(m.agent)}</a></td>
          <td>${m.role}</td>
          <td>${m.channel ? `<span class="badge">${esc(m.channel)}</span>` : ""}</td>
          <td>${m.source !== "gateway" ? `<span class="badge badge-alt">${esc(m.source)}</span>` : ""}</td>
          <td class="msg-text">${esc(truncate(m.text, 150))}</td>
          <td class="muted">${latency}</td>
        </tr>`;
      })
      .join("");

    const autoRefreshScript = `
<script>
(function() {
  let lastTs = '';
  const rows = document.querySelectorAll('#activity-body tr[data-ts]');
  if (rows.length) lastTs = rows[0].dataset.ts;

  const statusEl = document.getElementById('auto-status');

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function truncate(s, max) {
    return s && s.length > max ? s.slice(0, max) + '...' : (s || '');
  }

  function formatTime(iso) {
    const d = new Date(iso);
    return d.toLocaleString('en-GB', {
      month: 'short', day: '2-digit', hour: '2-digit',
      minute: '2-digit', second: '2-digit', hour12: false
    });
  }

  function roleClass(role) {
    return role === 'user' ? 'role-user' : role === 'assistant' ? 'role-assistant' : 'role-system';
  }

  async function poll() {
    try {
      const url = '/api/activity?limit=100' + (lastTs ? '&since=' + encodeURIComponent(lastTs) : '');
      const res = await fetch(url);
      if (!res.ok) return;
      const items = await res.json();
      if (!items.length) return;

      const tbody = document.getElementById('activity-body');
      const empty = tbody.querySelector('.empty-row');
      if (empty) empty.remove();

      for (const m of items) {
        const tr = document.createElement('tr');
        tr.className = roleClass(m.role);
        tr.dataset.ts = m.ts;
        tr.innerHTML =
          '<td class="muted">' + esc(formatTime(m.ts)) + '</td>' +
          '<td><a href="/web/agents/' + esc(m.agent) + '">' + esc(m.agent) + '</a></td>' +
          '<td>' + m.role + '</td>' +
          '<td>' + (m.channel ? '<span class="badge">' + esc(m.channel) + '</span>' : '') + '</td>' +
          '<td>' + (m.source !== 'gateway' ? '<span class="badge badge-alt">' + esc(m.source) + '</span>' : '') + '</td>' +
          '<td class="msg-text">' + esc(truncate(m.text, 150)) + '</td>' +
          '<td class="muted">' + (m.latency_ms ? m.latency_ms + 'ms' : '') + '</td>';
        tr.style.animation = 'fadeIn 0.3s ease-in';
        tbody.prepend(tr);
      }

      // keep max 200 rows
      while (tbody.children.length > 200) tbody.lastChild.remove();

      lastTs = items[items.length - 1].ts;
      statusEl.textContent = 'Last update: ' + new Date().toLocaleTimeString();
    } catch(e) {
      statusEl.textContent = 'Update failed';
    }
  }

  setInterval(poll, 3000);
  statusEl.textContent = 'Auto-updating every 3s';
})();
</script>
<style>
@keyframes fadeIn { from { opacity: 0; background: rgba(88,166,255,0.1); } to { opacity: 1; background: transparent; } }
</style>`;

    reply.type("text/html").send(
      layout(
        "Activity",
        `<h1>Recent Activity <span id="auto-status" class="muted" style="font-size:0.7rem; font-weight:400; margin-left:1rem;"></span></h1>
        <table class="activity">
          <thead><tr><th>Time</th><th>Agent</th><th>Role</th><th>Channel</th><th>Source</th><th>Message</th><th>Latency</th></tr></thead>
          <tbody id="activity-body">${rows || "<tr class='empty-row'><td colspan=7 class='muted'>No activity yet</td></tr>"}</tbody>
        </table>
        ${autoRefreshScript}`
      )
    );
  });

  app.get("/web/schedule", async (_req, reply) => {
    const jobs = loadTropicronJobs();

    const rows = jobs
      .map((j) => {
        const statusClass = j.enabled ? "" : "muted";
        return `
        <tr class="${statusClass}">
          <td><code>${esc(j.name)}</code></td>
          <td><code>${esc(j.cron)}</code></td>
          <td>${j.enabled ? '<span class="badge badge-ok">enabled</span>' : '<span class="badge badge-off">disabled</span>'}</td>
          <td>${esc(j.agent)}</td>
          <td>${esc(j.description)}</td>
          <td><code>${esc(j.model)}</code></td>
          <td>${j.timeout}s</td>
        </tr>`;
      })
      .join("");

    reply.type("text/html").send(
      layout(
        "Schedule",
        `<h1>Scheduled Jobs (Tropicron)</h1>
        <table>
          <thead><tr><th>Job</th><th>Cron</th><th>Status</th><th>Agent</th><th>Description</th><th>Model</th><th>Timeout</th></tr></thead>
          <tbody>${rows || "<tr><td colspan=7 class='muted'>No jobs found</td></tr>"}</tbody>
        </table>
        <p class="muted">Jobs directory: <code>${esc(JOBS_DIR)}</code></p>`
      )
    );
  });
}

interface TropicronJob {
  name: string;
  cron: string;
  enabled: boolean;
  agent: string;
  description: string;
  model: string;
  timeout: number;
}

function loadTropicronJobs(): TropicronJob[] {
  if (!existsSync(JOBS_DIR)) return [];

  const files = readdirSync(JOBS_DIR).filter(
    (f) => f.endsWith(".md") && !f.includes(".memory.")
  );

  return files.map((f) => {
    const raw = readFileSync(path.join(JOBS_DIR, f), "utf-8");
    const frontmatter = extractFrontmatter(raw);
    return {
      name: f.replace(/\.md$/, ""),
      cron: frontmatter.cron || "???",
      enabled: frontmatter.enabled !== false,
      agent: frontmatter.agent || "main",
      description: frontmatter.description || "",
      model: frontmatter.model || "sonnet",
      timeout: frontmatter.timeout || 300,
    };
  });
}

function extractFrontmatter(content: string): Record<string, any> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  try {
    return parseYaml(match[1]) ?? {};
  } catch {
    return {};
  }
}

const PERSONALITY_FILES = [
  "CLAUDE.md", "SOUL.md", "USER.md", "TOOLS.md", "AGENTS.md",
  "MEMORY.md", "CONTEXT.md", "RULES.md",
];

interface PersonalityFile {
  filename: string;
  content: string;
}

function getPersonalityFiles(agent: AgentConfig): PersonalityFile[] {
  const files: PersonalityFile[] = [];

  for (const filename of PERSONALITY_FILES) {
    const filePath = path.join(agent.directory, filename);
    if (existsSync(filePath)) {
      files.push({
        filename,
        content: readFileSync(filePath, "utf-8"),
      });
    }
  }

  // Also pick up any other .md files in the agent root (excluding dreams/)
  if (existsSync(agent.directory)) {
    const allFiles = readdirSync(agent.directory);
    for (const f of allFiles) {
      if (
        f.endsWith(".md") &&
        !PERSONALITY_FILES.includes(f) &&
        f !== "agent.yaml"
      ) {
        const filePath = path.join(agent.directory, f);
        files.push({
          filename: f,
          content: readFileSync(filePath, "utf-8"),
        });
      }
    }
  }

  return files;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(s: string, max: number): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max) + "..." : s;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} - TropicClaw</title>
  <style>
    :root {
      --bg: #0d1117; --surface: #161b22; --border: #30363d;
      --text: #c9d1d9; --muted: #8b949e; --accent: #58a6ff;
      --green: #3fb950; --red: #f85149; --yellow: #d29922;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      background: var(--bg); color: var(--text); line-height: 1.5;
    }
    nav {
      background: var(--surface); border-bottom: 1px solid var(--border);
      padding: 0.75rem 1.5rem; display: flex; gap: 1.5rem; align-items: center;
    }
    nav .brand { font-weight: 700; color: var(--accent); text-decoration: none; font-size: 1.1rem; }
    nav a { color: var(--text); text-decoration: none; font-size: 0.9rem; }
    nav a:hover { color: var(--accent); }
    main { max-width: 1100px; margin: 2rem auto; padding: 0 1.5rem; }
    h1 { margin-bottom: 0.5rem; font-size: 1.6rem; }
    h2 { margin: 2rem 0 0.75rem; font-size: 1.2rem; border-bottom: 1px solid var(--border); padding-bottom: 0.4rem; }
    h3 { margin-bottom: 0.5rem; font-size: 1rem; color: var(--accent); }
    table { width: 100%; border-collapse: collapse; margin: 0.5rem 0 1.5rem; font-size: 0.85rem; }
    th { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 2px solid var(--border); color: var(--muted); font-weight: 600; }
    td { padding: 0.4rem 0.75rem; border-bottom: 1px solid var(--border); vertical-align: top; }
    tr:hover td { background: rgba(88,166,255,0.04); }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    code { background: var(--surface); padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.85em; }
    pre {
      background: var(--surface); border: 1px solid var(--border); border-radius: 6px;
      padding: 1rem; overflow-x: auto; font-size: 0.82rem; line-height: 1.6;
      white-space: pre-wrap; word-break: break-word; max-height: 400px;
    }
    .muted { color: var(--muted); }
    .badge {
      display: inline-block; background: var(--surface); border: 1px solid var(--border);
      border-radius: 12px; padding: 0.1em 0.6em; font-size: 0.78rem; white-space: nowrap;
    }
    .badge-ok { background: rgba(63,185,80,0.15); border-color: var(--green); color: var(--green); }
    .badge-off { background: rgba(248,81,73,0.1); border-color: var(--red); color: var(--red); }
    .badge-alt { background: rgba(210,153,34,0.12); border-color: var(--yellow); color: var(--yellow); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin: 1rem 0; }
    .card {
      background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1rem;
    }
    dl { display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 0.75rem; font-size: 0.85rem; }
    dt { color: var(--muted); }
    dd { font-weight: 500; }
    ul { padding-left: 1.5rem; font-size: 0.85rem; }
    li { margin: 0.25rem 0; }
    .msg-text { max-width: 500px; word-break: break-word; }
    .role-user td:nth-child(2) { color: var(--accent); }
    .role-assistant td:nth-child(2) { color: var(--green); }
    .role-system td:nth-child(2) { color: var(--yellow); }
    .activity .role-user td:nth-child(3) { color: var(--accent); }
    .activity .role-assistant td:nth-child(3) { color: var(--green); }
    .activity .role-system td:nth-child(3) { color: var(--yellow); }
    .personality-list { padding-left: 1.2rem; font-size: 0.82rem; }
    .personality-list li { margin: 0.3rem 0; }
    .personality-section { margin-bottom: 2rem; }
    .personality-section pre { max-height: 600px; }
  </style>
</head>
<body>
  <nav>
    <a href="/web/agents" class="brand">TropicClaw</a>
    <a href="/web/agents">Agents</a>
    <a href="/web/channels">Channels</a>
    <a href="/web/activity">Activity</a>
    <a href="/web/schedule">Schedule</a>
    <a href="/health">Health</a>
  </nav>
  <main>${body}</main>
</body>
</html>`;
}
