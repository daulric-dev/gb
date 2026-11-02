"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  LayoutDashboard,
  LogOut,
  MoreHorizontal,
  Pencil,
  Plus,
  Power,
  Search,
  Settings2,
  UserCog,
} from "lucide-react";
import {
  organisationSchoolPath,
  personLabel,
  listOrganisationSchools,
  schoolTypeLabel,
  type OrganisationSchool,
  type SchoolStatusFilter,
} from "@/lib/organisation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OrgHeader } from "../_components/org-header";
import { AppointAdminDialog, SchoolFormDialog } from "./_components/school-dialogs";
import { PendingAdminInvite } from "./_components/pending-invite";
import {
  signOutSchoolAdmin,
  toggleSchoolActive,
  useOpenSchoolDashboard,
} from "./_components/school-actions";
import { userMessage } from "@/lib/errors";

const STATUSES: { value: SchoolStatusFilter; label: string }[] = [
  { value: "all", label: "All schools" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

/** `?status=` from the URL (the overview tiles link with it). */
function initialStatus(): SchoolStatusFilter {
  if (typeof window === "undefined") return "all";
  const raw = new URLSearchParams(window.location.search).get("status");
  return raw === "active" || raw === "inactive" ? raw : "all";
}

/** `?welcome=1`: straight from first-run setup. */
function arrivedFromSetup(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("welcome") === "1";
}

export default function OrganisationSchoolsPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<SchoolStatusFilter>(initialStatus);
  const [rows, setRows] = useState<OrganisationSchool[] | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const router = useRouter();
  // Add / edit share one dialog; `editing` is the school being edited.
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<OrganisationSchool | null>(null);
  const [appointing, setAppointing] = useState<OrganisationSchool | null>(null);
  // Configuring a school happens on its page (the name links there); its
  // dashboard is a row action that switches the active school.
  const { open: openDashboard, switching } = useOpenSchoolDashboard();
  // Fresh from setup with no schools: the add form opens once, by itself.
  const welcomePending = useRef(arrivedFromSetup());
  const unfiltered = search === "" && status === "all";
  const noSchoolsYet = rows !== null && rows.length === 0 && unfiltered;

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      listOrganisationSchools(search, status)
        .then((data) => {
          if (cancelled) return;
          const list = Array.isArray(data) ? data : [];
          setRows(list);
          if (welcomePending.current && list.length === 0) {
            welcomePending.current = false;
            setEditing(null);
            setFormOpen(true);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setRows([]);
            toast.error(userMessage(err, "Failed to load schools"));
          }
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, status, reloadKey]);

  function openAdd() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(school: OrganisationSchool) {
    setEditing(school);
    setFormOpen(true);
  }

  return (
    <div className="space-y-6">
      <OrgHeader
        title="Schools"
        description="Every school in your organisation"
        action={
          <Button onClick={openAdd}>
            <Plus className="mr-1.5 size-4" />
            Add school
          </Button>
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search schools"
            className="pl-8"
            aria-label="Search schools"
          />
        </div>
        <NativeSelect
          value={status}
          onChange={(e) => setStatus(e.target.value as SchoolStatusFilter)}
          aria-label="Filter by status"
          className="w-full sm:w-48"
        >
          {STATUSES.map((s) => (
            <NativeSelectOption key={s.value} value={s.value}>
              {s.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      <Card>
        <CardContent className="p-0 sm:p-2">
          {rows === null ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8" />
              ))}
            </div>
          ) : noSchoolsYet ? (
            <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
              <p className="font-medium">Add your first school</p>
              <p className="max-w-md text-sm text-muted-foreground">
                Your organisation is ready. Add the schools it runs, and appoint
                an admin for each - or yourself, if you run it.
              </p>
              <Button onClick={openAdd}>
                <Plus className="mr-1.5 size-4" />
                Add school
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No schools match.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>School</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Admin</TableHead>
                  <TableHead className="text-right">Staff</TableHead>
                  <TableHead className="text-right">Students</TableHead>
                  <TableHead className="w-10">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="max-w-56">
                      <Link
                        href={organisationSchoolPath(r.id)}
                        title={`${r.name}: settings`}
                        className="block truncate font-medium underline-offset-4 hover:underline"
                      >
                        {r.name}
                      </Link>
                      {r.code && (
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {r.code}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.isActive ? "default" : "outline"}>
                        {r.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>{schoolTypeLabel(r.schoolType)}</TableCell>
                    <TableCell className="max-w-72 truncate">
                      {r.admin ? (
                        personLabel(r.admin)
                      ) : r.pendingAdminInvite ? (
                        <PendingAdminInvite invite={r.pendingAdminInvite} onChanged={reload} />
                      ) : (
                        <span className="text-muted-foreground">None</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.staffCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.studentCount}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button variant="ghost" size="icon" aria-label={`Actions for ${r.name}`} />
                          }
                        >
                          <MoreHorizontal className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          <DropdownMenuItem
                            onClick={() => router.push(organisationSchoolPath(r.id))}
                          >
                            <Settings2 className="mr-2 size-4" />
                            School settings
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => openDashboard(r)}
                            disabled={!r.isActive || !!switching}
                          >
                            <LayoutDashboard className="mr-2 size-4" />
                            {switching === r.id ? "Opening…" : "Open school dashboard"}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => openEdit(r)}>
                            <Pencil className="mr-2 size-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setAppointing(r)}
                          >
                            <UserCog className="mr-2 size-4" />
                            Appoint admin
                          </DropdownMenuItem>
                          {r.admin && (
                            <DropdownMenuItem onClick={() => void signOutSchoolAdmin(r)}>
                              <LogOut className="mr-2 size-4" />
                              Sign out admin&apos;s sessions
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => void toggleSchoolActive(r).then((ok) => ok && reload())}>
                            <Power className="mr-2 size-4" />
                            {r.isActive ? "Deactivate" : "Activate"}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <SchoolFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        onSaved={reload}
      />
      <AppointAdminDialog
        school={appointing}
        onClose={() => setAppointing(null)}
        onAppointed={reload}
      />
    </div>
  );
}
