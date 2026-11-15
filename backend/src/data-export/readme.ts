import type { ExportScope } from './data-export.types';
import type { SkippedObject } from './archive';

export interface ReadmeCategory {
  id: string;
  title: string;
  description: string;
  count: number;
}

export interface ReadmeInput {
  scope: ExportScope;
  preparedAt: Date;
  /** Who the export is about. */
  subjectName: string | null;
  /** The school, for staff and parent exports. */
  schoolName: string | null;
  categories: ReadmeCategory[];
  /** Categories this scope leaves out because the school hides them from parents. */
  hiddenFromParents: string[];
  objectsIncluded: number;
  skipped: SkippedObject[];
  /** Days the download stays available. */
  keptHours: number;
}

const SKIP_REASON: Record<SkippedObject['reason'], string> = {
  too_large: 'larger than the per-file limit',
  size_limit: 'the export reached its total size limit',
  missing: 'no longer in storage',
  error: 'could not be read',
};

function wrap(text: string, width = 78, indent = ''): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if (line && (indent + line + ' ' + w).length > width) {
      lines.push(indent + line);
      line = w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) lines.push(indent + line);
  return lines.join('\n');
}

/** README.txt: what the export is, what each file holds, and what is not in it. */
export function buildReadme(input: ReadmeInput): string {
  const who = input.subjectName ?? 'the person';
  const school = input.schoolName ?? 'the school';
  const intro: Record<ExportScope, string> = {
    self: `A copy of the personal data GradeBook holds about ${who}, made at their own request from their account (a subject access and data portability copy, GDPR Articles 15 and 20).`,
    staff: `A copy of the personal data ${school} holds in GradeBook about ${who}, prepared by the school to answer a subject access request (GDPR Article 15). It covers the student record and the student's own GradeBook account, if they have one.`,
    parent: `A copy of information ${school} shows parents in GradeBook about ${who}, downloaded by a parent or carer linked to them. It contains only what the school's parent portal shows.`,
  };

  const out: string[] = [];
  out.push('GradeBook data export', '=====================', '');
  out.push(wrap(intro[input.scope]), '');
  out.push(`Prepared: ${input.preparedAt.toISOString().replace('T', ' ').slice(0, 16)} UTC`, '');

  out.push('What is in this file', '--------------------', '');
  for (const c of input.categories) {
    out.push(`${c.id}.json - ${c.title} (${c.count} ${c.count === 1 ? 'record' : 'records'})`);
    out.push(wrap(c.description, 78, '    '), '');
  }
  out.push(`files/ - copies of stored files: uploads, coursework and report cards (${input.objectsIncluded} ${input.objectsIncluded === 1 ? 'file' : 'files'}).`);
  if (input.skipped.length > 0) {
    out.push(
      wrap(
        `files-not-included.json - ${input.skipped.length} stored ${input.skipped.length === 1 ? 'file was' : 'files were'} not copied in (${[...new Set(input.skipped.map((s) => SKIP_REASON[s.reason]))].join('; ')}). They are still listed in the JSON files; ask ${input.scope === 'self' ? 'your school' : school} for a copy.`,
        78,
        '    ',
      ),
    );
  }
  out.push('');

  out.push('Format', '------', '');
  out.push(
    wrap(
      'The .json files are UTF-8 JSON, readable by any text editor or spreadsheet tool that imports JSON, and by other services (data portability). Dates and times are ISO 8601 in UTC. Empty lists mean GradeBook holds nothing of that kind. Ids are GradeBook\'s internal identifiers, included so records can be matched to each other.',
    ),
    '',
  );

  out.push('What is not included', '--------------------', '');
  const notes: string[] = [];
  if (input.scope === 'self') {
    notes.push(
      'Records staff keep about students - behaviour and pastoral notes, at-risk analytics, attendance alerts, similarity (copying) checks and draft report comments - are not part of a self-service copy. You can ask your school for them with a subject access request; the school prepares that copy and can withhold information only where the law allows it.',
    );
  }
  if (input.scope === 'parent') {
    notes.push(
      `Personal data about a child belongs to the child. This copy contains only what ${school} shows parents in the parent portal; it does not include the child's messages, files, sign-in history or records staff keep (such as pastoral notes). The child, or a parent acting for a young child, can make a subject access request to the school for a full copy.`,
    );
    if (input.hiddenFromParents.length > 0) {
      notes.push(`${school} does not show parents: ${input.hiddenFromParents.join(', ')}. Those categories are left out.`);
    }
  }
  notes.push(
    'Messages other people sent and files other people shared are their personal data and are not copied in; the files you received are listed by name.',
    'Sign-in secrets (session tokens, one-time codes, push tokens, signing keys) are never exported.',
    'Database backups keep earlier copies of this data until they are replaced on the backup schedule; they are not searched for an export.',
  );
  for (const n of notes) out.push(wrap(`- ${n}`), '');

  out.push('Keeping this file safe', '----------------------', '');
  out.push(
    wrap(
      `This file contains personal data. Store it somewhere private and delete it when you no longer need it. The download link stops working ${input.keptHours} hours after the export was ready, and GradeBook then deletes its copy.`,
    ),
    '',
  );
  out.push('Questions', '---------', '');
  out.push(
    wrap(
      `Questions about this data, or requests to correct or erase it, go to ${input.scope === 'self' ? 'your school (or the organisation that runs GradeBook for it)' : school}. The privacy notice in GradeBook says how to reach them.`,
    ),
    '',
  );
  return out.join('\n');
}
