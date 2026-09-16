import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import type { IProviderSessions } from '@/shared/interfaces.js';
import type {
  FetchHistoryOptions,
  FetchHistoryResult,
  NormalizedMessage,
} from '@/shared/types.js';
import { createNormalizedMessage } from '@/shared/utils.js';

/**
 * zcode persists every conversation in its own SQLite store
 * (`~/.zcode/cli/db/db.sqlite`): one `message` row per turn role, with typed
 * `part` rows (text / tool / reasoning / step markers) below it. This is the
 * same shape opencode uses, so replay is a read-only indexed query — resume
 * still works through `--resume sess_...` in the CLI itself.
 */
export function getZcodeDatabasePath(): string {
  return path.join(os.homedir(), '.zcode', 'cli', 'db', 'db.sqlite');
}

type ZcodePartRow = {
  id: string;
  time_created: number;
  data: string;
};

type ZcodeMessageRow = {
  id: string;
  time_created: number;
  data: string;
};

type ZcodeMessageData = {
  role?: unknown;
  time?: { created?: unknown };
};

type ZcodePartData = {
  type?: unknown;
  text?: unknown;
  tool?: unknown;
  callID?: unknown;
  state?: { input?: unknown };
};

const toIsoTimestamp = (ms: unknown): string => {
  const n = typeof ms === 'number' ? ms : Number(ms);
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : new Date().toISOString();
};

const readSessionsQuery = `
  SELECT m.id AS message_id,
         m.time_created AS message_time,
         m.data AS message_data,
         p.id AS part_id,
         p.time_created AS part_time,
         p.data AS part_data
    FROM message m
    LEFT JOIN part p ON p.message_id = m.id
   WHERE m.session_id = ?
   ORDER BY m.sequence, m.time_created, m.id,
            p.sequence, p.time_created, p.id
`;

export class ZcodeSessionsProvider implements IProviderSessions {
  normalizeMessage(raw: unknown, sessionId: string | null): NormalizedMessage[] {
    const payload = raw as { sessionId?: unknown; response?: unknown } | null;
    if (!payload || typeof payload !== 'object') {
      return [];
    }
    if (typeof payload.response !== 'string' || payload.response.length === 0) {
      return [];
    }
    return [createNormalizedMessage({
      kind: 'text',
      content: payload.response,
      sessionId: (typeof payload.sessionId === 'string' ? payload.sessionId : sessionId) || '',
      provider: 'zcode',
    })];
  }

  async fetchHistory(
    sessionId: string,
    options?: FetchHistoryOptions,
  ): Promise<FetchHistoryResult> {
    const empty: FetchHistoryResult = {
      messages: [],
      total: 0,
      hasMore: false,
      offset: options?.offset ?? 0,
      limit: options?.limit ?? null,
    };

    // CloudCLI passes the provider-native id in options for app-created
    // sessions; sessions discovered from the provider store carry it directly.
    const providerSessionId = typeof options?.providerSessionId === 'string'
      && options.providerSessionId
      ? options.providerSessionId
      : (sessionId.startsWith('sess_') ? sessionId : null);
    if (!providerSessionId) {
      return empty;
    }

    const dbPath = getZcodeDatabasePath();
    if (!fsSync.existsSync(dbPath)) {
      return empty;
    }

    let db: Database.Database | null = null;
    try {
      db = new Database(dbPath, { readonly: true, fileMustExist: true });
      const rows = db.prepare(readSessionsQuery).all(providerSessionId) as Array<{
        message_id: string;
        message_time: number;
        message_data: string;
        part_id: string | null;
        part_time: number | null;
        part_data: string | null;
      }>;

      const messages: NormalizedMessage[] = [];
      for (const row of rows) {
        let messageData: ZcodeMessageData = {};
        try {
          messageData = JSON.parse(row.message_data) as ZcodeMessageData;
        } catch {
          continue;
        }
        const role = messageData.role === 'user' ? 'user' : 'assistant';

        if (row.part_id === null || row.part_data === null) {
          continue;
        }
        let partData: ZcodePartData;
        try {
          partData = JSON.parse(row.part_data) as ZcodePartData;
        } catch {
          continue;
        }

        const baseId = row.part_id;
        const sessionIdForMessage = providerSessionId;
        const timestamp = toIsoTimestamp(row.part_time ?? row.message_time);

        if (partData.type === 'text' && typeof partData.text === 'string' && partData.text.trim()) {
          messages.push(createNormalizedMessage({
            id: baseId,
            kind: 'text',
            role,
            content: partData.text,
            sessionId: sessionIdForMessage,
            provider: 'zcode',
            timestamp,
          }));
          continue;
        }

        if (partData.type === 'reasoning' && typeof partData.text === 'string' && partData.text.trim()) {
          messages.push(createNormalizedMessage({
            id: baseId,
            kind: 'thinking',
            content: partData.text,
            sessionId: sessionIdForMessage,
            provider: 'zcode',
            timestamp,
          }));
          continue;
        }

        if (partData.type === 'tool' && typeof partData.tool === 'string') {
          messages.push(createNormalizedMessage({
            id: baseId,
            kind: 'tool_use',
            toolName: partData.tool,
            toolInput: partData.state?.input ?? {},
            toolId: typeof partData.callID === 'string' ? partData.callID : baseId,
            sessionId: sessionIdForMessage,
            provider: 'zcode',
            timestamp,
          }));
        }
        // step-start / step-finish and unknown part types carry no user-visible
        // content and are skipped.
      }

      return {
        messages,
        total: messages.length,
        hasMore: false,
        offset: options?.offset ?? 0,
        limit: options?.limit ?? null,
      };
    } catch {
      // A locked or mid-migration store replays as empty rather than failing
      // the session view; zcode's own CLI remains the source of truth.
      return empty;
    } finally {
      db?.close();
    }
  }
}
