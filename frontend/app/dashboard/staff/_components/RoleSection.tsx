import { Crown, GraduationCap, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { SchoolMember } from "./types";
import { MemberCard } from "./MemberCard";

const ROLE_META: Record<
  SchoolMember["role"],
  { label: string; icon: typeof Crown; variant: "default" | "secondary" | "outline" }
> = {
  admin: { label: "Admins", icon: Crown, variant: "default" },
  teacher: { label: "Teachers", icon: GraduationCap, variant: "secondary" },
  member: { label: "Members", icon: User, variant: "outline" },
};

export function RoleSection({
  role,
  members,
  removingId,
  currentUserId,
  onRemove,
}: {
  role: SchoolMember["role"];
  members: SchoolMember[];
  removingId?: string | null;
  currentUserId?: string;
  onRemove?: (member: SchoolMember) => void;
}) {
  const meta = ROLE_META[role];
  const Icon = meta.icon;

  if (members.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{meta.label}</h2>
        <Badge variant={meta.variant} className="ml-1 text-xs">
          {members.length}
        </Badge>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {members.map((m) => {
          const isSelf = m.user?.id === currentUserId;
          return (
            <MemberCard
              key={m.id}
              member={m}
              removing={removingId === m.id}
              onRemove={!isSelf ? onRemove : undefined}
            />
          );
        })}
      </div>
    </section>
  );
}
