import { Injectable, Logger } from '@nestjs/common';
import { ChatService } from './chat.service';

interface CreatedShare {
  id: string;
  principal_type: 'user' | 'role' | 'group';
  principal_id: string;
  can_download: boolean;
}

/**
 * Bridges other features into chat as system messages. Every method is
 * best-effort: a chat failure is logged and swallowed so it never breaks the
 * originating action (sharing a file, assigning a teacher). The chat message is
 * an additional notification surface, not the source of truth for access —
 * access is still granted by the file_share row / teacher assignment.
 */
@Injectable()
export class ChatSystemService {
  private readonly logger = new Logger(ChatSystemService.name);

  constructor(private readonly chat: ChatService) {}

  /**
   * For each direct (user) share of a file, drop a "file shared with you"
   * message with an inline "Accept & view" action into the owner↔recipient DM.
   * Role/group shares are skipped — they have no single DM target (the file
   * manager's own notification still covers them).
   */
  async notifyFileShares(
    ownerId: string,
    file: { id: string; name: string; school_id: string },
    shares: CreatedShare[],
  ): Promise<void> {
    for (const share of shares) {
      if (share.principal_type !== 'user') continue;
      if (share.principal_id === ownerId) continue;
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

  /**
   * Tell a user they were added to a class, with an inline "View class" action.
   * Fired when a teacher is assigned to a class.
   */
  async notifyClassInvite(
    inviterId: string,
    invitedUserId: string,
    ctx: { classId: string; className: string; schoolId: string },
  ): Promise<void> {
    if (invitedUserId === inviterId) return;
    try {
      const conversation = await this.chat.ensureDirectConversationRow(
        ctx.schoolId,
        inviterId,
        invitedUserId,
      );
      await this.chat.postMessage({
        conversation,
        senderId: inviterId,
        type: 'class_invite',
        body: `added you to the class "${ctx.className}"`,
        metadata: { classId: ctx.classId, className: ctx.className },
        actionState: 'pending',
      });
    } catch (err) {
      this.logger.error(
        `class_invite chat message failed (class ${ctx.classId} → ${invitedUserId}): ${(err as Error).message}`,
      );
    }
  }
}
