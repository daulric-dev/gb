import type { Tables } from '@/types/database.types';

type Term = Tables<'term'>;

export interface MessageResponse {
  message: string;
}

export function v1TermList(data: Term[]): Term[] {
  return data;
}

export function v1TermDetail(raw: Term): Term {
  return raw;
}

export function v1TermCreated(raw: Term): Term {
  return raw;
}

export function v1TermUpdated(raw: Term): Term {
  return raw;
}

export function v1TermDeleted(raw: MessageResponse): MessageResponse {
  return raw;
}
