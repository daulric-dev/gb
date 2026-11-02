import { Injectable, Logger } from '@nestjs/common';
import { FeatureService } from '@/features/feature.service';
import { ChatService } from './chat.service';

interface CreatedShare {
  id: string;
  principal_type: string;
  principal_id: string;
  can_download: boolean;
}

/**
 * Bridges other features into chat as system messages. Every method is
 * best-effort: a chat failure is logged and swallowed so it never breaks the
 * originating action (sharing a file). The chat message is an additional
 * notification surface, not the source of truth for access — access is still
 * granted by the file_share row.
 *
 * Classes are gone, so nothing sends `class_invite` messages any more; ones
 * already in conversations still load and render as before.
 */
@Injectable()
export class ChatSystemService {
  private readonly logger = new Logger(ChatSystemService.name);

  constructor(
    private readonly chat: ChatService,
    private readonly features: FeatureService,
  ) {}

  /**
   * For each direct (user) share of a file, drop a "file shared with you"
   * message with an inline "Accept & view" action into the owner↔recipient DM.
   * Role/course shares are skipped — they have no single DM target (the file
   * manager's own notification still covers them). Nothing is posted while
   * the school has `messaging` off, and students only get one with
   * `student_messaging` on (they could not read it otherwise).
   */
  async notifyFileShares(
    ownerId: string,
    file: { id: string; name: string; school_id: string },
    shares: CreatedShare[],
  ): Promise<void> {
    const direct = shares.filter(
      (s) => s.principal_type === 'user' && s.principal_id !== ownerId,
    );
    if (direct.length === 0) return;

    let skip: Set<string>;
    try {
      const features = await this.features.effective(file.school_id);
      if (!features.messaging) return;
      skip = features.student_messaging
        ? new Set()
        : await this.chat.studentAccountsAmong(direct.map((s) => s.principal_id));
    } catch (err) {
      this.logger.error(
        `file_share chat messages skipped (file ${file.id}): ${(err as Error).message}`,
      );
      return;
    }

    for (const share of direct) {
      if (skip.has(share.principal_id)) continue;
      try {
        const conversation = await this.chat.ensureDirectConversationRow(
          file.school_id,
          ownerId,
          share.principal_id,
        );
        await this.chat.postMessage({
          conversation,
          senderId: ownerId,
          type: 'file_share',
          body: `shared a file with you: "${file.name}"`,
          metadata: {
            fileId: file.id,
            shareId: share.id,
            fileName: file.name,
            canDownload: share.can_download,
          },
          actionState: 'pending',
        });
      } catch (err) {
        this.logger.error(
          `file_share chat message failed (file ${file.id} → ${share.principal_id}): ${(err as Error).message}`,
        );
      }
    }
  }
}
