import type { Prisma } from '@/generated/prisma/client';
import { PRIVATE_AUDIT_ENTITIES } from '@/audit-log/audit-log.service';
import type { Collector } from '../data-export.types';
import { schoolNames, stringId } from './helpers';

/** Audit entries per export, newest first. */
export const AUDIT_LIMIT = 10_000;

export const auditCollector: Collector = {
  id: 'audit-log',
  title: 'Audit log',
  description:
    'Entries in the audit log about the person (their account or student record: what changed, when and by whom) and the changes the account made (what and when; the values only when the record is the person\'s own). Self exports leave out entries about pastoral notes and the email addresses of staff.',
  covers: ['public.audit_log.actor_id'],
  scopes: ['self', 'staff'],
  async collect(ctx) {
    const { subject } = ctx;
    const ids = [subject.userId, ...subject.studentIds].filter((x): x is string => !!x);
    if (ids.length === 0) return { data: [], count: 0 };
    const or: Prisma.audit_logWhereInput[] = [{ entity_id: { in: ids } }];
    if (subject.userId) or.push({ actor_id: subject.userId });
    const rows = await ctx.prisma.audit_log.findMany({
      where: {
        OR: or,
        ...(subject.schoolId ? { school_id: subject.schoolId } : {}),
        ...(subject.scope === 'self' ? { entity: { notIn: [...PRIVATE_AUDIT_ENTITIES] } } : {}),
      },
      select: {
        school_id: true,
        actor_id: true,
        actor_name: true,
        actor_email: true,
        entity: true,
        entity_id: true,
        action: true,
        changes: true,
        created_at: true,
      },
      orderBy: { created_at: 'desc' },
      take: AUDIT_LIMIT,
    });
    const schools = await schoolNames(ctx, rows.map((r) => r.school_id));
    const data = rows.map((r) => ({
      at: r.created_at,
      school: r.school_id ? (schools.get(r.school_id) ?? null) : null,
      byYou: !!subject.userId && r.actor_id === subject.userId,
      by: r.actor_name,
      ...(subject.scope === 'staff' ? { byEmail: r.actor_email } : {}),
      entity: r.entity,
      entityId: r.entity_id,
      action: r.action,
      // A change the person made to someone else's record carries that
      // person's data: only what was done and when, not the values.
      changes: r.entity_id && ids.includes(r.entity_id) ? r.changes : null,
    }));
    return { data, count: data.length };
  },
};

export const aiCollector: Collector = {
  id: 'ai-requests',
  title: 'AI requests',
  description:
    'Requests the account sent to the school\'s AI assistant: feature, provider and model, status, token counts and time; the prompt and answer only while they are still kept (30 days at most).',
  covers: ['public.ai_request.user_id'],
  scopes: ['self', 'staff'],
  async collect(ctx) {
    const userId = ctx.subject.userId;
    if (!userId) return { data: [], count: 0 };
    const rows = await ctx.prisma.ai_request.findMany({
      where: { user_id: userId, ...(ctx.subject.schoolId ? { school_id: ctx.subject.schoolId } : {}) },
      select: {
        feature: true,
        provider_name: true,
        provider_kind: true,
        model: true,
        status: true,
        error: true,
        input_tokens: true,
        output_tokens: true,
        duration_ms: true,
        prompt_text: true,
        response_text: true,
        prompt_expires_at: true,
        created_at: true,
      },
      orderBy: { created_at: 'asc' },
    });
    const data = rows.map((r) => ({
      at: r.created_at,
      feature: r.feature,
      provider: r.provider_name,
      providerKind: r.provider_kind,
      model: r.model,
      status: r.status,
      error: r.error,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      durationMs: r.duration_ms,
      prompt: r.prompt_text,
      response: r.response_text,
      promptKeptUntil: r.prompt_expires_at,
    }));
    return { data, count: data.length };
  },
};

export const integrationsCollector: Collector = {
  id: 'integrations',
  title: 'Connected tools and rostering',
  description:
    'The pseudonymous ids GradeBook gave external learning tools (LTI) for the account and when it opened them, and the school information system records (rostering) the account or student record is matched to, with the fields last received from that system.',
  covers: ['public.lti_subject.user_profile_id', 'public.lti_launch.user_profile_id', 'public.roster_link.target_id'],
  scopes: ['self', 'staff'],
  async collect(ctx) {
    const { subject, prisma } = ctx;
    const ids = [subject.userId, ...subject.studentIds].filter((x): x is string => !!x);
    const [subjects, launches, links] = await Promise.all([
      subject.userId
        ? prisma.lti_subject.findMany({
            where: { user_profile_id: subject.userId },
            select: { id: true, created_at: true, tool_id: true },
          })
        : Promise.resolve([] as never[]),
      subject.userId
        ? prisma.lti_launch.findMany({
            where: { user_profile_id: subject.userId },
            select: { tool_id: true, created_at: true, used_at: true },
            orderBy: { created_at: 'asc' },
          })
        : Promise.resolve([] as never[]),
      ids.length
        ? prisma.roster_link.findMany({
            where: {
              target_id: { in: ids },
              entity: { in: ['student', 'staff'] },
              ...(subject.schoolId ? { school_id: subject.schoolId } : {}),
            },
            select: { entity: true, sourced_id: true, email: true, data: true, disabled_at: true, created_at: true, updated_at: true, school_id: true },
          })
        : Promise.resolve([] as never[]),
    ]);
    const toolIds = [...new Set([...subjects, ...launches].map((s) => s.tool_id))];
    const tools = toolIds.length
      ? await prisma.lti_tool.findMany({ where: { id: { in: toolIds } }, select: { id: true, name: true } })
      : [];
    const toolName = new Map(tools.map((t) => [t.id, t.name]));
    const schools = await schoolNames(ctx, links.map((l) => l.school_id));
    const data = {
      ltiIds: subjects.map((s) => ({ tool: toolName.get(stringId(s.tool_id)) ?? null, id: s.id, since: s.created_at })),
      ltiLaunches: launches.map((l) => ({ tool: toolName.get(stringId(l.tool_id)) ?? null, at: l.created_at, openedAt: l.used_at })),
      rosterRecords: links.map((l) => ({
        school: l.school_id ? (schools.get(stringId(l.school_id)) ?? null) : null,
        kind: l.entity,
        sourcedId: l.sourced_id,
        email: l.email,
        lastReceived: l.data,
        disabledAt: l.disabled_at,
        firstMatchedAt: l.created_at,
        updatedAt: l.updated_at,
      })),
    };
    return { data, count: data.ltiIds.length + data.ltiLaunches.length + data.rosterRecords.length };
  },
};
