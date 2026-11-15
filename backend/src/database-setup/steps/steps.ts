import type { SetupStep } from './runner';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The analytics feature's default changed from on to off (privacy by
 * default; src/features/feature.catalog.ts). An organisation that existed
 * before this step ran was using the old default, so it keeps analytics on
 * by getting an explicit `analytics: true` - unless it had already chosen
 * either way (a boolean `analytics` key). Organisations created later start
 * with the new default, off. On a fresh database (no organisation yet) this
 * changes nothing.
 */
export const analyticsDefaultOffKeepExisting: SetupStep = {
  key: 'analytics-default-off-keep-existing',
  description: 'Keep analytics on for organisations that existed before its default became off',
  async run(tx) {
    const orgs = await tx.organisation.findMany({ select: { id: true, features: true } });
    let kept = 0;
    for (const org of orgs) {
      const features = isRecord(org.features) ? org.features : {};
      if (typeof features.analytics === 'boolean') continue;
      await tx.organisation.update({
        where: { id: org.id },
        data: { features: { ...features, analytics: true }, updated_at: new Date() },
      });
      kept++;
    }
    return `${kept} of ${orgs.length} organisation(s) given an explicit analytics: true`;
  },
};

/**
 * Inactive students without `left_at`: their retention clock starts now,
 * never in the past, so turning leaver retention on cannot erase anyone
 * without the notice period. The old migration did this once with the
 * trigger; a database built by `prisma db push` before the application set
 * `left_at` itself may have such rows. No-op on a fresh database.
 */
export const studentLeftAtBackfill: SetupStep = {
  key: 'student-left-at-backfill',
  description: 'Start the leaver retention clock for inactive students without left_at',
  async run(tx, now) {
    const { count } = await tx.student.updateMany({
      where: { is_active: false, left_at: null },
      data: { left_at: now },
    });
    return `${count} inactive student(s) given left_at`;
  },
};

/** Every step, in the order they run. Append only; never reuse a key. */
export const SETUP_STEPS: readonly SetupStep[] = [
  studentLeftAtBackfill,
  analyticsDefaultOffKeepExisting,
];
