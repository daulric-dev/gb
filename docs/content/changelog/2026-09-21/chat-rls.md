---
sidebar_label: 2026-09-21 · Chat RLS fixed
sidebar_position: 5
---

# 2026-09-21 - Chat row-level security never ran, and what it was hiding

Found while auditing the one item left open from the [May security review](../2026-05-24/security-fixes.md) - "UPDATE RLS policies lack `WITH CHECK`, a full audit is still pending". That item turned out not to be a vulnerability. Chat was.

**Nothing was exposed.** The policies failed closed, and `chat.service.ts` uses the service client throughout, which bypasses RLS entirely - so the breakage was invisible rather than harmful. What matters is the state it left the next person in.

## The recursion

`member_reads_membership` guarded `chat.conversation_member` with a policy whose `USING` clause selected **from `chat.conversation_member`**. Evaluating it requires evaluating it:

```
ERROR:  infinite recursion detected in policy for relation "conversation_member"
```

The `conversation` and `message` policies both test membership through that same table, so all three failed the same way. Every chat query from a user-scoped client errored out - not "returned nothing", *errored*.

## What it was hiding

The trap is what happens when someone fixes only the recursion. Restoring the read policies also restores `member_updates_own_membership`, which pins `user_id` and nothing else:

```sql
UPDATE chat.conversation_member
   SET conversation_id = '<someone else''s DM>', role = 'owner'
 WHERE user_id = auth.uid();
```

The new row still satisfies `user_id = auth.uid()`, so the policy allows it - and the membership row is exactly what every read policy trusts. The caller is now in the conversation and can read its messages.

The recursion was the only thing preventing this. A fix that addressed the error and stopped there would have **opened** the hole it appeared to close, which is why both are fixed together.

### There is a route to PostgREST

Worth stating, because it is what makes chat RLS load-bearing rather than decorative. `mintUploadToken` issues a genuine Supabase `authenticated` JWT (`sub`, `role`, `aud`) so the client can upload to Storage over TUS. That token is not confined to Storage - it is a user JWT, valid against PostgREST too. With `NEXT_PUBLIC_SUPABASE_ANON_KEY` being a browser variable, a user can reach the database directly as themselves. Wherever RLS is the only gate, RLS is the gate.

## The fix

`20260921140000_fix_chat_rls_recursion.sql`:

1. **`chat.is_conversation_member(uuid)`** - `SECURITY DEFINER`, `STABLE`, with `search_path` pinned to `chat, pg_temp`. The body runs as the table's owner, and RLS is not applied to a table's owner, so reading `conversation_member` inside it does not evaluate that table's policy and the recursion cannot arise. The pinned `search_path` is not optional: a `SECURITY DEFINER` function that resolves names through the caller's path is how these turn into privilege escalations.
2. **The three read policies** now go through the helper.
3. **Column privileges on `conversation_member`.** `WITH CHECK` sees only the new row, never the old one, so "`conversation_id` must not change" is not something a policy can say. A grant can: `UPDATE` is revoked from `authenticated` and re-granted on `last_read_at` alone - the only column a member legitimately writes. `conversation_id` and `role` are now unwritable by an authenticated caller regardless of policy, so the escalation is refused before a policy is consulted.
4. **`WITH CHECK` written out explicitly** on the update policy. Postgres would apply `USING` to the new row anyway; stating it means a later edit to one clause cannot silently change the other.
5. **`anon` revoked** from all three chat tables. They had been granted `ALL` alongside `authenticated` and `service_role`. No policy admits `anon` - every one tests `auth.uid()`, which is null for an anonymous caller - so this removes surface, not behaviour.

## Verified

Applied to a throwaway Postgres 17 with all 49 migrations, then exercised as real roles with three users and a private DM:

| Check | Result |
| --- | --- |
| Recursion | Gone; membership rows read normally |
| A member reading their own conversation and messages | Works |
| The same member reading a DM they are not in | 0 rows |
| Moving their membership into that DM | `permission denied for table conversation_member` |
| Changing their own `role` to `owner` | `permission denied` |
| Marking their own membership read (`last_read_at`) | Succeeds |
| Marking **someone else's** membership read | `UPDATE 0` - policy refuses |
| `anon` selecting messages | `permission denied` |
| `service_role` read, insert, update, delete | All intact - the backend is unaffected |

Also confirmed from scratch rather than only on an incrementally patched database, and a catalog sweep shows **no remaining policy that queries its own table**, so this was the only instance.

## On the May audit item

The finding it came from is closed as **not a vulnerability**. 8 of 12 `UPDATE` policies omit `WITH CHECK`, but Postgres reuses the `USING` expression as the check when `WITH CHECK` is absent - so omitting it makes a policy *stricter*, not weaker. Tested directly: an update trying to move a row out of its own policy's reach was rejected. Seven of the eight pin every scope column they need to; the eighth was `conversation_member`, fixed above.
