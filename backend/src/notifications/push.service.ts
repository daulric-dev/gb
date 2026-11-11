import {
  BadRequestException,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { FeatureService } from '@/features/feature.service';
import type { Prisma } from '@/generated/prisma/client';
import { optedOut, type NotificationCategory } from './notification-preferences';
import {
  GENERIC_BODY,
  GENERIC_TITLE,
  genericData,
  isGeneric,
  pushContentFor,
} from './push-content';

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
export const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

/** Expo accepts at most 100 messages per request. */
const CHUNK_SIZE = 100;
/** Expo accepts at most 1000 receipt ids per request. */
const RECEIPT_CHUNK_SIZE = 1000;
/** Per request to Expo; a hung connection must not hold the sender. */
export const EXPO_TIMEOUT_MS = 10_000;
/** Retries after a 429 or 5xx, with these waits (Retry-After wins, capped). */
export const RETRY_DELAYS_MS = [500, 2_000];
const MAX_RETRY_AFTER_MS = 10_000;
/** Expo recommends fetching receipts about 15 minutes after sending. */
export const RECEIPT_DELAY_MS = 15 * 60_000;
/** Tickets waiting for a receipt check, at most (oldest dropped first). */
const MAX_PENDING_RECEIPTS = 10_000;

const EXPO_TOKEN = /^Expo(nent)?PushToken\[.+\]$/;

export type PushPlatform = 'ios' | 'android' | 'web';

/**
 * What a push is about. A notification category is checked against each
 * recipient's preferences; `parent` notices follow the parent portal's own
 * settings, which the sender has already applied.
 */
export type PushCategory = NotificationCategory | 'parent';

/** Categories whose pushes carry children's data: generic unless set to full. */
const SENSITIVE_CATEGORIES: ReadonlySet<PushCategory> = new Set(['parent', 'attendance', 'grades']);

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** Android notification channel the app created (e.g. `attendance`). */
  channelId?: string;
  /**
   * What it is about. Unset: `attendance` for the attendance channel or an
   * `attendance.*` type, else none (sent to everyone, no preference check).
   */
  category?: PushCategory;
  /**
   * Whether it carries a child's data (names, grades, attendance). Unset:
   * true for parent, attendance and grades pushes. Sensitive pushes are sent
   * generic unless the school or organisation chose `full` (push-content.ts).
   */
  sensitive?: boolean;
  /** The school whose push-content setting applies; unset = each recipient's school. */
  schoolId?: string | null;
}

/** The category a message is about, inferred for senders that do not say. */
export function pushCategoryOf(message: PushMessage): PushCategory | undefined {
  if (message.category) return message.category;
  const type = typeof message.data?.type === 'string' ? message.data.type : '';
  if (message.channelId === 'attendance' || type.startsWith('attendance.')) return 'attendance';
  return undefined;
}

/** The lock-screen form of a message: as given, or generic. */
export function presentPush(message: PushMessage, generic: boolean): PushMessage {
  if (!generic) return message;
  return {
    ...message,
    title: GENERIC_TITLE,
    body: GENERIC_BODY,
    data: genericData(message.data),
  };
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

type ExpoReceipt = Omit<ExpoTicket, 'id'>;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Whether a session can still be used (so its device may receive pushes). */
const liveSession = (now: Date): Prisma.sessionWhereInput => ({
  revoked_at: null,
  expires_at: { gt: now },
  absolute_expires_at: { gt: now },
});

/**
 * Expo push notifications to signed-in devices.
 *
 * A token belongs to the user and session that registered it. Another user
 * can only take it over when the sign-in that held it has ended (a shared
 * phone after sign-out) or it predates session binding; and a device whose
 * session was revoked or has expired gets nothing. Sending is best effort:
 * it never throws, and a token Expo says is gone (in a ticket or, about 15
 * minutes later, a receipt) is forgotten.
 */
@Injectable()
export class PushService implements OnModuleDestroy {
  private readonly logger = new Logger(PushService.name);

  /** Swappable in tests. */
  fetchImpl: (url: string, init: RequestInit) => Promise<Response> = (
    url,
    init,
  ) => fetch(url, init);
  /** Swappable in tests. */
  sleepImpl: (ms: number) => Promise<void> = sleep;

  /** Ticket id -> token and when it was sent, until its receipt is checked. */
  private readonly pendingReceipts = new Map<string, { token: string; at: number }>();
  private receiptTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureService,
  ) {}

  onModuleDestroy() {
    if (this.receiptTimer) clearTimeout(this.receiptTimer);
    this.receiptTimer = undefined;
  }

  /**
   * Bind this device's token to the caller and their session. A token held
   * by someone else moves only when that holder's session has ended (or the
   * row predates session binding); otherwise it is left alone, silently, so
   * the response does not reveal whose token it is.
   */
  async register(
    userId: string,
    token: string,
    platform: PushPlatform,
    sessionId?: string | null,
  ) {
    const value = token.trim();
    const device = {
      user_id: userId,
      platform,
      last_seen_at: new Date(),
      session_id: sessionId ?? null,
    };
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const existing = await this.prisma.push_device.findUnique({
          where: { token: value },
          select: {
            user_id: true,
            session_id: true,
            session: { select: { revoked_at: true, expires_at: true, absolute_expires_at: true } },
          },
        });
        if (!existing) {
          try {
            await this.prisma.push_device.create({ data: { token: value, ...device } });
            return;
          } catch (err) {
            // Registered concurrently: decide again against that row.
            if ((err as { code?: string }).code === 'P2002' && attempt === 0) continue;
            throw err;
          }
        }
        if (!this.mayTakeOver(existing, userId, sessionId ?? null)) {
          this.logger.warn(
            `Push token registration by user ${userId} ignored: the token belongs to another user's live session`,
          );
          return;
        }
        // Conditional on the holder still being the one checked above.
        await this.prisma.push_device.updateMany({
          where: { token: value, user_id: existing.user_id, session_id: existing.session_id },
          data: device,
        });
        return;
      }
    } catch (err) {
      this.logger.error(
        `Failed to register push device: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to register the device');
    }
  }

  private mayTakeOver(
    existing: {
      user_id: string;
      session_id: string | null;
      session: { revoked_at: Date | null; expires_at: Date; absolute_expires_at: Date } | null;
    },
    userId: string,
    sessionId: string | null,
  ): boolean {
    if (existing.user_id === userId) return true;
    if (sessionId && existing.session_id === sessionId) return true;
    // Registered before tokens were bound to sessions.
    if (!existing.session_id || !existing.session) return true;
    const now = Date.now();
    const s = existing.session;
    return (
      !!s.revoked_at ||
      s.expires_at.getTime() <= now ||
      s.absolute_expires_at.getTime() <= now
    );
  }

  /** Only ever the caller's own token; anyone else's is left alone. */
  async unregister(userId: string, token: string) {
    try {
      await this.prisma.push_device.deleteMany({
        where: { user_id: userId, token },
      });
    } catch (err) {
      this.logger.error(
        `Failed to remove push device: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to remove the device');
    }
  }

  /**
   * Push to every device of these users. Never throws. Recipients whose
   * school has push off, or who turned the message's category off, get
   * nothing; the rest get it full or generic as their school decides.
   */
  async sendToUsers(userIds: string[], message: PushMessage): Promise<void> {
    try {
      const recipients = await this.recipients(
        [...new Set(userIds.filter(Boolean))],
        message,
      );
      if (recipients.size === 0) return;

      let data: { token: string; user_id?: string }[];
      try {
        data = await this.prisma.push_device.findMany({
          where: {
            user_id: { in: [...recipients.keys()] },
            // Not a device whose sign-in was revoked or has expired.
            OR: [{ session_id: null }, { session: liveSession(new Date()) }],
          },
          select: { token: true, user_id: true },
        });
      } catch (err) {
        this.logger.error(
          `Failed to load push devices: ${(err as Error).message}`,
        );
        return;
      }

      // A device whose owner is unknown gets the more private form.
      const anyGeneric = [...recipients.values()].some(Boolean);
      const byForm = new Map<boolean, Set<string>>([
        [false, new Set()],
        [true, new Set()],
      ]);
      for (const d of data) {
        if (!EXPO_TOKEN.test(d.token)) continue;
        const known = d.user_id ? recipients.get(d.user_id) : undefined;
        const generic = known ?? anyGeneric;
        byForm.get(generic)!.add(d.token);
      }
      // A token listed under both (cannot normally happen) goes generic only.
      for (const t of byForm.get(true)!) byForm.get(false)!.delete(t);

      const gone: string[] = [];
      for (const [generic, set] of byForm) {
        const tokens = [...set];
        const shown = presentPush(message, generic);
        for (let i = 0; i < tokens.length; i += CHUNK_SIZE) {
          const chunk = tokens.slice(i, i + CHUNK_SIZE);
          gone.push(...(await this.sendChunk(chunk, shown)));
        }
      }

      if (gone.length > 0) await this.forget(gone);
    } catch (err) {
      this.logger.error(`Push send failed: ${(err as Error).message}`);
    }
  }

  /**
   * Who gets the message, and whether in its generic form (user id ->
   * generic). Drops recipients whose school has push notifications off (the
   * organisation's setting for users without a school; checked once per
   * school) and those who turned the message's category off. Registration is
   * unaffected, so devices are ready when push is switched back on.
   */
  private async recipients(
    userIds: string[],
    message: PushMessage,
  ): Promise<Map<string, boolean>> {
    const out = new Map<string, boolean>();
    if (userIds.length === 0) return out;
    const profiles = await this.prisma.user_profile.findMany({
      where: { id: { in: userIds } },
      select: { id: true, school_id: true },
    });
    const schoolOf = new Map(profiles.map((p) => [p.id, p.school_id ?? null]));
    const decided = new Map<string | null, boolean>();
    const on: string[] = [];
    for (const id of userIds) {
      const school = schoolOf.get(id) ?? null;
      if (!decided.has(school)) {
        decided.set(
          school,
          await this.features.isEnabled(school, 'push_notifications'),
        );
      }
      if (decided.get(school)) on.push(id);
    }
    if (on.length === 0) return out;

    const category = pushCategoryOf(message);
    const off =
      category && category !== 'parent'
        ? await optedOut(this.prisma, on, category, 'push')
        : new Set<string>();
    const wanted = on.filter((id) => !off.has(id));
    if (wanted.length === 0) return out;

    const sensitive = message.sensitive ?? (!!category && SENSITIVE_CATEGORIES.has(category));
    const schoolFor = (id: string) =>
      message.schoolId !== undefined ? message.schoolId : (schoolOf.get(id) ?? null);
    const settings = await pushContentFor(this.prisma, wanted.map(schoolFor));
    for (const id of wanted) {
      out.set(id, isGeneric(settings.get(schoolFor(id)) ?? null, sensitive));
    }
    return out;
  }

  private expoHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    const accessToken = process.env.EXPO_ACCESS_TOKEN;
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return headers;
  }

  /**
   * POST to Expo with a timeout, retrying a 429 or 5xx (after Retry-After
   * when given, capped). A timeout or network error is not retried: the
   * request may have gone through, and a retry would notify twice.
   */
  private async postExpo(url: string, body: unknown): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: this.expoHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(EXPO_TIMEOUT_MS),
      });
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= RETRY_DELAYS_MS.length) return res;
      await res.body?.cancel().catch(() => undefined);
      const after = Number(res.headers.get('retry-after'));
      const wait =
        Number.isFinite(after) && after > 0
          ? Math.min(after * 1000, MAX_RETRY_AFTER_MS)
          : RETRY_DELAYS_MS[attempt];
      this.logger.warn(`Expo answered ${res.status}; retrying in ${wait} ms`);
      await this.sleepImpl(wait);
    }
  }

  /** Send one batch; returns the tokens Expo says no longer exist. */
  private async sendChunk(
    tokens: string[],
    message: PushMessage,
  ): Promise<string[]> {
    try {
      const res = await this.postExpo(
        EXPO_PUSH_URL,
        tokens.map((to) => ({
          to,
          title: message.title,
          body: message.body,
          data: message.data ?? {},
          sound: 'default',
          priority: 'high',
          ...(message.channelId ? { channelId: message.channelId } : {}),
        })),
      );

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.error(`Expo push rejected (${res.status}): ${text.slice(0, 500)}`);
        return [];
      }

      const json = (await res.json()) as { data?: ExpoTicket[] };
      const tickets = Array.isArray(json?.data) ? json.data : [];
      const gone: string[] = [];
      tickets.forEach((ticket, i) => {
        const to = tokens[i];
        if (ticket?.status === 'ok') {
          if (ticket.id && to) this.awaitReceipt(ticket.id, to);
          return;
        }
        if (ticket?.status !== 'error') return;
        if (ticket.details?.error === 'DeviceNotRegistered' && to) {
          gone.push(to);
        } else {
          this.logger.warn(
            `Expo push ticket error: ${ticket.details?.error ?? ''} ${ticket.message ?? ''}`,
          );
        }
      });
      return gone;
    } catch (err) {
      this.logger.error(`Expo push request failed: ${(err as Error).message}`);
      return [];
    }
  }

  /** Remember a ticket so its receipt is checked in about 15 minutes. */
  private awaitReceipt(ticketId: string, token: string) {
    if (this.pendingReceipts.size >= MAX_PENDING_RECEIPTS) {
      const oldest = this.pendingReceipts.keys().next().value;
      if (oldest !== undefined) this.pendingReceipts.delete(oldest);
    }
    this.pendingReceipts.set(ticketId, { token, at: Date.now() });
    this.scheduleReceipts(RECEIPT_DELAY_MS);
  }

  private scheduleReceipts(delayMs: number) {
    if (this.receiptTimer) return;
    this.receiptTimer = setTimeout(() => {
      this.receiptTimer = undefined;
      void this.checkReceipts().catch((err: Error) =>
        this.logger.error(`Expo receipt check failed: ${err.message}`),
      );
    }, delayMs);
    this.receiptTimer.unref?.();
  }

  /**
   * Fetch the receipts of tickets sent at least RECEIPT_DELAY_MS ago and
   * forget the tokens Expo reports as DeviceNotRegistered. Best effort and in
   * memory: tickets pending at a restart are not checked (the next send's
   * ticket catches a dead token anyway).
   */
  async checkReceipts(now = Date.now()): Promise<void> {
    const due: [string, string][] = [];
    for (const [id, entry] of this.pendingReceipts) {
      if (now - entry.at < RECEIPT_DELAY_MS) continue;
      due.push([id, entry.token]);
      this.pendingReceipts.delete(id);
    }
    const gone: string[] = [];
    for (let i = 0; i < due.length; i += RECEIPT_CHUNK_SIZE) {
      const chunk = new Map(due.slice(i, i + RECEIPT_CHUNK_SIZE));
      try {
        const res = await this.postExpo(EXPO_RECEIPTS_URL, { ids: [...chunk.keys()] });
        if (!res.ok) {
          this.logger.error(`Expo receipts rejected (${res.status})`);
          continue;
        }
        const json = (await res.json()) as { data?: Record<string, ExpoReceipt> };
        for (const [id, receipt] of Object.entries(json?.data ?? {})) {
          if (receipt?.status !== 'error') continue;
          const to = chunk.get(id);
          if (receipt.details?.error === 'DeviceNotRegistered' && to) {
            gone.push(to);
          } else {
            this.logger.warn(
              `Expo push receipt error: ${receipt.details?.error ?? ''} ${receipt.message ?? ''}`,
            );
          }
        }
      } catch (err) {
        this.logger.error(`Expo receipts request failed: ${(err as Error).message}`);
      }
    }
    if (gone.length > 0) await this.forget([...new Set(gone)]);
    if (this.pendingReceipts.size > 0) {
      const oldest = this.pendingReceipts.values().next().value!.at;
      this.scheduleReceipts(Math.max(1_000, oldest + RECEIPT_DELAY_MS - Date.now()));
    }
  }

  private async forget(tokens: string[]) {
    try {
      await this.prisma.push_device.deleteMany({
        where: { token: { in: tokens } },
      });
    } catch (err) {
      this.logger.error(
        `Failed to forget push devices: ${(err as Error).message}`,
      );
    }
  }
}
