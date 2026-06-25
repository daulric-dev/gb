import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KeyRound, Loader2, X } from "lucide-react";
import type { SchoolMember } from "./types";

function getInitials(user: SchoolMember["user"]) {
  if (!user?.first_name) return "?";
  return `${user.first_name[0] ?? ""}${user.last_name?.[0] ?? ""}`.toUpperCase();
}

function getName(user: SchoolMember["user"]) {
  if (!user) return "Unknown user";
  return [user.first_name, user.last_name].filter(Boolean).join(" ") || "Unnamed";
}

export function MemberCard({
  member,
  removing,
  onRemove,
  onManageRoles,
}: {
  member: SchoolMember;
  removing?: boolean;
  onRemove?: (member: SchoolMember) => void;
  onManageRoles?: (member: SchoolMember) => void;
}) {
  const joined = new Date(member.created_at).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="flex items-center gap-3 rounded-lg border px-4 py-3">
      <Avatar className="size-9 shrink-0">
        {member.user?.avatar_url && (
          <AvatarImage src={member.user.avatar_url} alt="" />
        )}
        <AvatarFallback className="text-xs">{getInitials(member.user)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="font-medium leading-tight truncate">{getName(member.user)}</p>
        <p className="text-xs text-muted-foreground">Joined {joined}</p>
        {member.roles.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {member.roles.map((role) => (
              <Badge
                key={role.id}
                variant="secondary"
                className="capitalize font-normal"
              >
                {role.name}
              </Badge>
            ))}
          </div>
        )}
      </div>
      {onManageRoles && (
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Manage roles"
          onClick={() => onManageRoles(member)}
        >
          <KeyRound className="size-3.5" />
        </Button>
      )}
      {onRemove && (
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
          disabled={removing}
          onClick={() => onRemove(member)}
        >
          {removing ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <X className="size-3.5" />
          )}
        </Button>
      )}
    </div>
  );
}
