"use client";

import { Building2, Check, ChevronsUpDown, GraduationCap, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSignals } from "@preact/signals-react/runtime";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMySchools, useSwitchSchool } from "@/hooks/use-my-schools";
import { canSwitchSchools, schoolLabel } from "@/lib/active-school";
import { ORGANISATION_PATH } from "@/lib/routing";

/**
 * The active school in the sidebar header. With more than one school to work
 * in (several memberships, or an organisation admin) it opens a list to
 * switch between them; otherwise it is just the school's name.
 */
export function SchoolSwitcher({
  schoolName,
  isOrgAdmin,
}: {
  schoolName: string;
  isOrgAdmin: boolean;
}) {
  useSignals();
  const router = useRouter();
  const schools = useMySchools();
  const { switchTo, switching } = useSwitchSchool();

  if (!canSwitchSchools(schools)) {
    return (
      <div className="flex items-center gap-1.5 mt-0.5">
        <GraduationCap className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs text-muted-foreground truncate flex-1" translate="no">
          {schoolName}
        </span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`Switch school (current: ${schoolName})`}
            translate="no"
            className="mt-0.5 flex w-full items-center gap-1.5 rounded-md px-1 -mx-1 py-0.5 text-left hover:bg-accent transition-colors"
          />
        }
      >
        <GraduationCap className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs text-muted-foreground truncate flex-1" translate="no">
          {schoolName}
        </span>
        {switching ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Switch school</DropdownMenuLabel>
          {schools!.map((s) => (
            <DropdownMenuItem
              key={s.id}
              disabled={!!switching}
              onClick={() => {
                if (!s.isActive) void switchTo(s.id);
              }}
            >
              <span className="min-w-0 flex-1 truncate" translate="no">{schoolLabel(s)}</span>
              {s.viaOrganisation && (
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  via organisation
                </Badge>
              )}
              {s.isActive && <Check className="size-4 shrink-0" aria-label="Current school" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        {isOrgAdmin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push(ORGANISATION_PATH)}>
              <Building2 className="mr-2 size-4" />
              Organisation
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
