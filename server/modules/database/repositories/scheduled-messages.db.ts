import { randomUUID } from 'node:crypto';

import { getConnection } from '@/modules/database/connection.js';

export type ScheduledMessageStatus = 'pending' | 'sent' | 'failed' | 'cancelled';

export type ScheduledRecurrence = {
  type: 'daily' | 'weekly';
  time: string;
  dayOfWeek?: number | null;
};

export type ScheduledMessageRow = {
  id: string;
  user_id: number;
  session_id: string;
  content: string;
  options: string;
  scheduled_for: string;
  status: ScheduledMessageStatus;
  failure_reason: string | null;
  recurrence: ScheduledRecurrence['type'] | null;
  recurrence_time: string | null;
  recurrence_dow: number | null;
  series_id: string | null;
  created_at: string;
  updated_at: string;
};

const COLUMNS =
  'id, user_id, session_id, content, options, scheduled_for, status, failure_reason, recurrence, recurrence_time, recurrence_dow, series_id, created_at, updated_at';

function readOptionsObject(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export const scheduledMessagesDb = {
  create(input: {
    userId: number;
    sessionId: string;
    content: string;
    options: unknown;
    scheduledFor: Date;
    recurrence?: ScheduledRecurrence | null;
    seriesId?: string | null;
  }): ScheduledMessageRow {
    const db = getConnection();
    const id = randomUUID();
    const recurrence = input.recurrence ?? null;
    const seriesId = recurrence ? (input.seriesId ?? randomUUID()) : null;

    db.prepare(
      `INSERT INTO scheduled_messages (id, user_id, session_id, content, options, scheduled_for, status, recurrence, recurrence_time, recurrence_dow, series_id)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
    ).run(
      id,
      input.userId,
      input.sessionId,
      input.content,
      JSON.stringify(input.options ?? {}),
      input.scheduledFor.toISOString(),
      recurrence?.type ?? null,
      recurrence?.time ?? null,
      recurrence?.type === 'weekly' ? (recurrence.dayOfWeek ?? null) : null,
      seriesId,
    );

    return db.prepare(`SELECT ${COLUMNS} FROM scheduled_messages WHERE id = ?`).get(id) as ScheduledMessageRow;
  },

  /**
   * Inserts the next pending instance of a recurring series. The just-fired
   * row stays behind as history; cancelling this new row is what stops the
   * series.
   */
  createFollowingInstance(row: ScheduledMessageRow, nextRunAt: Date): ScheduledMessageRow | null {
    if (row.recurrence !== 'daily' && row.recurrence !== 'weekly') {
      return null;
    }
    return this.create({
      userId: row.user_id,
      sessionId: row.session_id,
      content: row.content,
      options: readOptionsObject(row.options),
      scheduledFor: nextRunAt,
      recurrence: {
        type: row.recurrence,
        time: row.recurrence_time ?? '09:00',
        dayOfWeek: row.recurrence_dow,
      },
      seriesId: row.series_id,
    });
  },

  /** Everything still to come or recently resolved, newest schedule first. */
  listForSession(userId: number, sessionId: string): ScheduledMessageRow[] {
    return getConnection()
      .prepare(
        `SELECT ${COLUMNS} FROM scheduled_messages
         WHERE user_id = ? AND session_id = ?
         ORDER BY scheduled_for ASC`
      )
      .all(userId, sessionId) as ScheduledMessageRow[];
  },

  listPendingForUser(userId: number): ScheduledMessageRow[] {
    return getConnection()
      .prepare(
        `SELECT ${COLUMNS} FROM scheduled_messages
         WHERE user_id = ? AND status = 'pending'
         ORDER BY scheduled_for ASC`
      )
      .all(userId) as ScheduledMessageRow[];
  },

  /**
   * Claims every message whose time has passed, marking them in the same
   * statement that selects them.
   *
   * Claiming is what makes a missed schedule work: the server can be down at
   * the moment a message was due, and the next poll after it starts picks the
   * message up instead of skipping it. Doing it in one transaction is what
   * stops two overlapping polls from sending the same message twice.
   *
   * Recurring series collapse when several instances pile up while the server
   * was offline: only the newest due instance per series is claimed, the older
   * ones are cancelled — firing a daily task three times back to back after a
   * weekend is never what the schedule meant.
   */
  claimDue(now: Date): ScheduledMessageRow[] {
    const db = getConnection();
    const nowIso = now.toISOString();

    return db.transaction(() => {
      const due = db
        .prepare(
          `SELECT ${COLUMNS} FROM scheduled_messages
           WHERE status = 'pending' AND scheduled_for <= ?
           ORDER BY scheduled_for ASC`
        )
        .all(nowIso) as ScheduledMessageRow[];

      const seriesKey = (row: ScheduledMessageRow): string | null => {
        if (row.recurrence !== 'daily' && row.recurrence !== 'weekly') {
          return null;
        }
        return [
          row.user_id,
          row.session_id,
          row.recurrence,
          row.recurrence_time ?? '',
          row.recurrence_dow ?? '',
        ].join('|');
      };

      const newestDuePerSeries = new Map<string, ScheduledMessageRow>();
      const claimed: ScheduledMessageRow[] = [];
      for (const row of due) {
        const key = seriesKey(row);
        if (!key) {
          claimed.push(row);
          continue;
        }
        const existing = newestDuePerSeries.get(key);
        // Rows arrive ordered by scheduled_for ASC, so the last one seen is
        // the newest of the series.
        if (!existing || existing.scheduled_for <= row.scheduled_for) {
          if (existing) {
            claimed.splice(claimed.indexOf(existing), 1);
          }
          newestDuePerSeries.set(key, row);
          claimed.push(row);
        }
      }

      for (const row of due) {
        const key = seriesKey(row);
        const isClaimed = claimed.includes(row);
        const isSuperseded = key !== null
          && newestDuePerSeries.get(key) !== undefined
          && newestDuePerSeries.get(key) !== row
          && !isClaimed;
        const nextStatus = isSuperseded ? 'cancelled' : 'sent';
        const reason = isSuperseded ? 'Missed while the server was offline.' : null;
        db.prepare(
          `UPDATE scheduled_messages SET status = ?, failure_reason = COALESCE(?, failure_reason), updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        ).run(nextStatus, reason, row.id);
      }

      return claimed;
    })();
  },

  markFailed(id: string, reason: string): void {
    getConnection()
      .prepare(
        `UPDATE scheduled_messages
         SET status = 'failed', failure_reason = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(reason.slice(0, 500), id);
  },

  /**
   * Cancels a pending message, or dismisses a failed one so its banner goes
   * away. Returns false when it had already fired successfully.
   */
  cancel(userId: number, id: string): boolean {
    const result = getConnection()
      .prepare(
        `UPDATE scheduled_messages
         SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ? AND status IN ('pending', 'failed')`
      )
      .run(id, userId);

    return result.changes > 0;
  },
};
