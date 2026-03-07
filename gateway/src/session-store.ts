import { Database } from "bun:sqlite";
import path from "path";

const DB_PATH = path.resolve(import.meta.dir, "..", "data", "sessions.db");

export class SessionStore {
  private db: Database;

  constructor(dbPath: string = DB_PATH) {
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode=WAL");
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        agent TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        last_active TEXT NOT NULL,
        message_count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active'
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent TEXT NOT NULL REFERENCES sessions(agent),
        ts TEXT NOT NULL,
        role TEXT NOT NULL,
        channel TEXT,
        text TEXT,
        tools_used TEXT,
        latency_ms INTEGER,
        source TEXT DEFAULT 'gateway',
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS channel_agents (
        channel TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        current_agent TEXT NOT NULL DEFAULT 'main',
        previous_agent TEXT,
        updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (channel, chat_id)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_agent ON messages(agent, ts);
      CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel, ts);
    `);
  }

  ensureSession(agent: string) {
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO sessions (agent, created_at, last_active)
       VALUES (?, ?, ?)
       ON CONFLICT(agent) DO UPDATE SET last_active = ?`,
      [agent, now, now, now]
    );
  }

  logMessage(
    agent: string,
    role: "user" | "assistant" | "system",
    text: string,
    channel?: string,
    source: string = "gateway",
    latencyMs?: number
  ) {
    this.ensureSession(agent);
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO messages (agent, ts, role, channel, text, source, latency_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [agent, now, role, channel ?? null, text, source, latencyMs ?? null]
    );
    this.db.run(
      `UPDATE sessions SET last_active = ?, message_count = message_count + 1 WHERE agent = ?`,
      [now, agent]
    );
  }

  getCurrentAgent(channel: string, chatId: string): string {
    const row = this.db
      .query("SELECT current_agent FROM channel_agents WHERE channel = ? AND chat_id = ?")
      .get(channel, chatId) as { current_agent: string } | null;
    return row?.current_agent ?? "main";
  }

  getPreviousAgent(channel: string, chatId: string): string | null {
    const row = this.db
      .query("SELECT previous_agent FROM channel_agents WHERE channel = ? AND chat_id = ?")
      .get(channel, chatId) as { previous_agent: string } | null;
    return row?.previous_agent ?? null;
  }

  switchAgent(channel: string, chatId: string, newAgent: string) {
    const current = this.getCurrentAgent(channel, chatId);
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO channel_agents (channel, chat_id, current_agent, previous_agent, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(channel, chat_id)
       DO UPDATE SET current_agent = ?, previous_agent = ?, updated_at = ?`,
      [channel, chatId, newAgent, current, now, newAgent, current, now]
    );
  }

  getHistory(agent: string, limit: number = 50): Array<{
    ts: string;
    role: string;
    channel: string | null;
    text: string;
    source: string;
  }> {
    return this.db
      .query(
        `SELECT ts, role, channel, text, source FROM messages
         WHERE agent = ? ORDER BY ts DESC LIMIT ?`
      )
      .all(agent, limit) as any[];
  }

  listSessions(): Array<{
    agent: string;
    created_at: string;
    last_active: string;
    message_count: number;
    status: string;
  }> {
    return this.db.query("SELECT * FROM sessions WHERE status = 'active'").all() as any[];
  }

  activeCount(): number {
    const row = this.db
      .query("SELECT COUNT(*) as count FROM sessions WHERE status = 'active'")
      .get() as { count: number };
    return row.count;
  }

  getChannelAgents(): Array<{
    channel: string;
    chat_id: string;
    current_agent: string;
    updated_at: string;
  }> {
    return this.db.query("SELECT * FROM channel_agents").all() as any[];
  }

  getRecentActivity(limit: number = 100): Array<{
    agent: string;
    ts: string;
    role: string;
    channel: string | null;
    text: string;
    source: string;
    latency_ms: number | null;
  }> {
    return this.db
      .query("SELECT agent, ts, role, channel, text, source, latency_ms FROM messages ORDER BY ts DESC LIMIT ?")
      .all(limit) as any[];
  }

  close() {
    this.db.close();
  }
}
