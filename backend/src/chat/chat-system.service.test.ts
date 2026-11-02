import { describe, expect, mock, test } from 'bun:test';
import { ChatSystemService } from './chat-system.service';

const file = { id: 'f1', name: 'Notes.pdf', school_id: 'school-1' };
const share = (id: string, type: string, principal: string, canDownload = true) => ({
  id,
  principal_type: type,
  principal_id: principal,
  can_download: canDownload,
});

function fakeChat() {
  return {
    ensureDirectConversationRow: mock(async (_s: string, _a: string, b: string) => ({
      id: `dm-${b}`,
    })),
    postMessage: mock(async () => ({})),
    studentAccountsAmong: mock(async (_ids: string[]) => new Set<string>()),
  };
}

/** Effective features for the file's school (messaging on by default). */
function fakeFeatures(over: Record<string, boolean> = {}) {
  return {
    effective: mock(async (_school: string) => ({
      messaging: true,
      student_messaging: false,
      ...over,
    })),
  };
}

describe('ChatSystemService.notifyFileShares', () => {
  test('posts a pending file_share message into each direct share DM', async () => {
    const chat = fakeChat();
    await new ChatSystemService(chat as any, fakeFeatures() as any).notifyFileShares('owner', file, [
      share('s1', 'user', 'u1', false),
    ]);
    expect(chat.ensureDirectConversationRow).toHaveBeenCalledWith(
      'school-1',
      'owner',
      'u1',
    );
    expect(chat.postMessage.mock.calls[0]).toEqual([
      {
        conversation: { id: 'dm-u1' },
        senderId: 'owner',
        type: 'file_share',
        body: 'shared a file with you: "Notes.pdf"',
        metadata: {
          fileId: 'f1',
          shareId: 's1',
          fileName: 'Notes.pdf',
          canDownload: false,
        },
        actionState: 'pending',
      },
    ] as any);
  });

  test('skips role/course shares and shares with the owner', async () => {
    const chat = fakeChat();
    await new ChatSystemService(chat as any, fakeFeatures() as any).notifyFileShares('owner', file, [
      share('s1', 'role', 'teacher'),
      share('s2', 'course', 'c1'),
      share('s3', 'user', 'owner'),
    ]);
    expect(chat.ensureDirectConversationRow).not.toHaveBeenCalled();
    expect(chat.postMessage).not.toHaveBeenCalled();
  });

  test('a failure for one recipient is swallowed and the rest still go out', async () => {
    const chat = fakeChat();
    chat.ensureDirectConversationRow.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    await new ChatSystemService(chat as any, fakeFeatures() as any).notifyFileShares('owner', file, [
      share('s1', 'user', 'u1'),
      share('s2', 'user', 'u2'),
    ]);
    expect(chat.postMessage).toHaveBeenCalledTimes(1);
    expect((chat.postMessage.mock.calls[0] as any)[0].conversation).toEqual({
      id: 'dm-u2',
    });
  });

  test('posts nothing while the school has messaging off', async () => {
    const chat = fakeChat();
    const features = fakeFeatures({ messaging: false });
    await new ChatSystemService(chat as any, features as any).notifyFileShares(
      'owner',
      file,
      [share('s1', 'user', 'u1')],
    );
    expect(features.effective).toHaveBeenCalledWith('school-1');
    expect(chat.ensureDirectConversationRow).not.toHaveBeenCalled();
    expect(chat.postMessage).not.toHaveBeenCalled();
  });

  test('skips student recipients unless student messaging is on', async () => {
    const chat = fakeChat();
    chat.studentAccountsAmong.mockImplementation(async () => new Set(['stu']));
    await new ChatSystemService(chat as any, fakeFeatures() as any).notifyFileShares(
      'owner',
      file,
      [share('s1', 'user', 'stu'), share('s2', 'user', 'u2')],
    );
    expect(chat.postMessage).toHaveBeenCalledTimes(1);
    expect((chat.postMessage.mock.calls[0] as any)[0].conversation).toEqual({ id: 'dm-u2' });

    const chat2 = fakeChat();
    await new ChatSystemService(
      chat2 as any,
      fakeFeatures({ student_messaging: true }) as any,
    ).notifyFileShares('owner', file, [share('s1', 'user', 'stu')]);
    expect(chat2.studentAccountsAmong).not.toHaveBeenCalled();
    expect(chat2.postMessage).toHaveBeenCalledTimes(1);
  });
});
