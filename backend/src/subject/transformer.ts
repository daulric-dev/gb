import type { Tables } from '@/types/database.types';

type Subject = Tables<'subject'>;

export interface MessageResponse {
  message: string;
}

export function v1SubjectList(data: Subject[]): Subject[] {
  return data;
}

export function v1SubjectDetail(raw: Subject): Subject {
  return raw;
}

export function v1SubjectCreated(raw: Subject): Subject {
  return raw;
}

export function v1SubjectUpdated(raw: Subject): Subject {
  return raw;
}

export function v1SubjectDeleted(raw: MessageResponse): MessageResponse {
  return raw;
}

export function v1SubjectReordered(raw: MessageResponse): MessageResponse {
  return raw;
}
