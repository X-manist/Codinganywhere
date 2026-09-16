import type { IProviderSessions } from '@/shared/interfaces.js';
import type {
  FetchHistoryOptions,
  FetchHistoryResult,
  NormalizedMessage,
} from '@/shared/types.js';
import { createNormalizedMessage } from '@/shared/utils.js';

/**
 * zcode session surface.
 *
 * With `--json`, a headless run reports one terminal payload
 * (`{sessionId, response, usage, projection}`); resume works through
 * `--resume sess_...` inside zcode's own session store, so CloudCLI only
 * needs to normalize that payload — history replay is a no-op until the
 * app-server transcript reader lands.
 */
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
    _sessionId: string,
    options?: FetchHistoryOptions,
  ): Promise<FetchHistoryResult> {
    return {
      messages: [],
      total: 0,
      hasMore: false,
      offset: options?.offset ?? 0,
      limit: options?.limit ?? null,
    };
  }
}
