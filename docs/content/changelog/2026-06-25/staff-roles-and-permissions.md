---
sidebar_label: 2026-06-25 · Staff roles & permissions
sidebar_position: 2
---

# 2026-06-25 - Staff roles and permissions

Three related changes to the staff/RBAC area: teachers can now create classes, the staff list shows each member's custom roles, and the role-assignment dialog shows which roles are already assigned. No migrations.

## Teachers can create classes

The `teacher` system role previously had only `class:read`, so the "create class" path (`POST /api/classes`, gated by `@RequirePermission('class', 'create')`) was admin-only. Teachers now get `class:create` by default ([permission.catalog.ts](../../../../backend/src/permission/permission.catalog.ts)).

`defaultsForRole` resolves effective permissions at runtime, so this is live immediately - **no migration**, and the additive per-school custom-role layer is untouched. The frontend reads effective permissions from `/permissions/me`, so the create-class UI now appears for teachers automatically.

On creation, the teacher is recorded as the class teacher (`is_class_teacher: true`). Editing and deleting an existing class stay gated by `class:update` / `class:delete` plus the `ClassTeacherGuard`, which teachers still don't have by default - so a teacher can create a class but not yet edit or delete it.

## Custom roles shown on staff cards

The staff page showed only a member's base enum role (the Admins / Teachers section they sit under), not the custom roles assigned on top. `GET /api/schools/members` ([school.service.ts](../../../../backend/src/school/school.service.ts) `getMembers`) now embeds each member's custom roles via the `school_management_role → school_role` join and returns a `roles: { id, name }[]` array. System roles are filtered out, since the base role is already conveyed by the section.

The frontend `MemberCard` ([app/dashboard/staff/_components/MemberCard.tsx](../../../../frontend/app/dashboard/staff/_components/MemberCard.tsx)) renders these as secondary badges under the "Joined" line, and `SchoolMember` ([types.ts](../../../../frontend/app/dashboard/staff/_components/types.ts)) gained the `roles` field.

## Role-assignment dialog feedback

The "Manage roles" dialog ([MemberRolesDialog.tsx](../../../../frontend/app/dashboard/staff/_components/MemberRolesDialog.tsx)) now shows a check icon next to roles that are already assigned (the spinner takes the icon slot while a toggle is in flight, then settles to the tick). Assigning or unassigning a role also fires an `onRolesChanged` callback wired to `fetchMembers`, so the badges on the staff cards refresh immediately instead of waiting for a manual Refresh.

## Behavior note

Role badges render on every member card, including admins. Admins resolve to all permissions regardless of custom roles, so a custom-role badge there is cosmetic but harmless.
