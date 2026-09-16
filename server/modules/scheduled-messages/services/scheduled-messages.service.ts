import { scheduledMessagesDb, sessionsDb } from '@/modules/database/index.js';
import type { ScheduledMessageRow, ScheduledRecurrence } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

/** How far ahead a message may be scheduled. Beyond this it is almost certainly a mistake. */
const MAX_SCHEDULE_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_CONTENT_LENGTH = 100_000;
const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export type ScheduledMessage = {
  id: string;
  sessionId: string;
  content: string;
  options: Record<string, unknown>;
  scheduledFor: string;
  status: ScheduledMessageRow['status'];
  failureReason: string | null;
  recurrence: ScheduledRecurrence | null;
  seriesId: string | null;
  createdAt: string;
};

function readOptions(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    // A corrupt options blob must not stop the message from being sent.
    return {};
  }
}

function readRecurrence(raw: unknown): ScheduledRecurrence | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AppError('recurrence must be an object.', {
      code: 'INVALID_RECURRENCE',
      statusCode: 400,
    });
  }
  const { type, time, dayOfWeek } = raw as Record<string, unknown>;
  if (type !== 'daily' && type !== 'weekly') {
    throw new AppError('recurrence.type must be "daily" or "weekly".', {
      code: 'INVALID_RECURRENCE',
      statusCode: 400,
    });
  }
  if (typeof time !== 'string' || !TIME_OF_DAY_PATTERN.test(time)) {
    throw new AppError('recurrence.time must be "HH:MM" (24-hour).', {
      code: 'INVALID_RECURRENCE',
      statusCode: 400,
    });
  }
  if (type === 'weekly') {
    if (typeof dayOfWeek !== 'number' || !Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      throw new AppError('recurrence.dayOfWeek must be 0 (Sunday) through 6 (Saturday) for weekly.', {
        code: 'INVALID_RECURRENCE',
        statusCode: 400,
      });
    }
    return { type, time, dayOfWeek };
  }
  return { type, time };
}

export function toScheduledMessage(row: ScheduledMessageRow): ScheduledMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    content: row.content,
    options: readOptions(row.options),
    scheduledFor: row.scheduled_for,
    status: row.status,
    failureReason: row.failure_reason,
    recurrence: row.recurrence === 'daily' || row.recurrence === 'weekly'
      ? {
          type: row.recurrence,
          time: row.recurrence_time ?? '',
          dayOfWeek: row.recurrence_dow,
        }
      : null,
    seriesId: row.series_id,
    createdAt: row.created_at,
  };
}

export const scheduledMessagesService = {
  /**
   * Records a message to send to a session later.
   *
   * The time is taken as an absolute instant, so the schedule does not move if
   * the user changes time zone — or schedules from a phone and is on a laptop
   * when it fires.
   */
  schedule(input: {
    userId: number;
    sessionId: string;
    content: string;
    options?: unknown;
    scheduledFor: string;
    recurrence?: unknown;
  }): ScheduledMessage {
    const content = input.content.trim();
    if (!content) {
      throw new AppError('A scheduled message needs some text.', {
        code: 'CONTENT_REQUIRED',
        statusCode: 400,
      });
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      throw new AppError('That message is too long to schedule.', {
        code: 'CONTENT_TOO_LONG',
        statusCode: 400,
      });
    }

    const scheduledFor = new Date(input.scheduledFor);
    if (Number.isNaN(scheduledFor.getTime())) {
      throw new AppError('scheduledFor must be an ISO timestamp.', {
        code: 'INVALID_SCHEDULE_TIME',
        statusCode: 400,
      });
    }
    if (scheduledFor.getTime() - Date.now() > MAX_SCHEDULE_AHEAD_MS) {
      throw new AppError('That is too far in the future to schedule.', {
        code: 'SCHEDULE_TOO_FAR_AHEAD',
        statusCode: 400,
      });
    }

    if (!sessionsDb.getSessionById(input.sessionId)) {
      throw new AppError(`Session "${input.sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    const recurrence = readRecurrence(input.recurrence);

    return toScheduledMessage(scheduledMessagesDb.create({
      userId: input.userId,
      sessionId: input.sessionId,
      content,
      options: input.options ?? {},
      scheduledFor,
      recurrence,
    }));
  },

  listForSession(userId: number, sessionId: string): ScheduledMessage[] {
    return scheduledMessagesDb.listForSession(userId, sessionId).map(toScheduledMessage);
  },

  listPending(userId: number): ScheduledMessage[] {
    return scheduledMessagesDb.listPendingForUser(userId).map(toScheduledMessage);
  },

  /** Cancels a pending message, or dismisses a failed one. */
  cancel(userId: number, id: string): void {
    if (!scheduledMessagesDb.cancel(userId, id)) {
      throw new AppError('That message has already been sent or cancelled.', {
        code: 'SCHEDULED_MESSAGE_NOT_PENDING',
        statusCode: 409,
      });
    }
  },
};
