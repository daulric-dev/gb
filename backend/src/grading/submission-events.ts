import { Global, Injectable, Logger, Module } from '@nestjs/common';

/** A student handed work in (an assignment, or a quiz attempt was scored). */
export interface HandedInEvent {
  submissionId: string;
  activityId: string;
  studentId: string;
  kind: 'assignment' | 'quiz';
}

type Listener = (event: HandedInEvent) => Promise<void> | void;

/**
 * Lets other modules react to a hand-in without SubmissionService importing
 * them (peer review tops up allocations for a late submitter; the similarity
 * check fingerprints the text). Listeners run after the hand-in has been
 * saved, are not awaited by the request, and a failing one is only logged.
 */
@Injectable()
export class SubmissionEvents {
  private readonly logger = new Logger(SubmissionEvents.name);
  private readonly listeners: Listener[] = [];

  onHandedIn(listener: Listener): void {
    this.listeners.push(listener);
  }

  /** Never throws; resolves once every listener has finished. */
  async handedIn(event: HandedInEvent): Promise<void> {
    await Promise.all(
      this.listeners.map(async (listener) => {
        try {
          await listener(event);
        } catch (err) {
          this.logger.error(
            `A hand-in listener failed for ${event.submissionId}: ${(err as Error).message}`,
          );
        }
      }),
    );
  }
}

@Global()
@Module({ providers: [SubmissionEvents], exports: [SubmissionEvents] })
export class SubmissionEventsModule {}
