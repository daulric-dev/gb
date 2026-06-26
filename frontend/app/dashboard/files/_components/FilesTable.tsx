"use client";

import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,  DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Eye, Share2, Pencil, Trash2, MoreHorizontal, FileText } from "lucide-react";
import type { FileItem } from "./types";

function formatBytes(bytes: number): string {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function StatusBadge({ status }: { status: FileItem["status"] }) {
  if (status === "ready") return <Badge variant="secondary">Ready</Badge>;
  if (status === "pending" || status === "scanning")
    return <Badge variant="outline">Processing…</Badge>;
  if (status === "infected")
    return <Badge variant="destructive">Quarantined</Badge>;
  return <Badge variant="destructive">Failed</Badge>;
}

export function FilesTable({
  files,
  currentUserId,
  onView,
  onShare,
  onRename,
  onDelete,
}: {
  files: FileItem[];
  currentUserId: string | undefined;
  onView: (file: FileItem) => void;
  onShare: (file: FileItem) => void;
  onRename: (file: FileItem) => void;
  onDelete: (file: FileItem) => void;
}) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="hidden sm:table-cell">Source</TableHead>
            <TableHead className="hidden md:table-cell">Size</TableHead>
            <TableHead className="hidden md:table-cell">Added</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {files.map((file) => {
            const isOwner = file.ownerId === currentUserId;
            const ready = file.status === "ready";
            return (
              <TableRow key={file.id}>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{file.name}</span>
                    {!ready && <StatusBadge status={file.status} />}
                  </div>
                </TableCell>
                <TableCell className="hidden capitalize sm:table-cell text-muted-foreground">
                  {file.source === "report" ? "Report" : "Upload"}
                </TableCell>
                <TableCell className="hidden md:table-cell text-muted-foreground">
                  {formatBytes(file.sizeBytes)}
                </TableCell>
                <TableCell className="hidden md:table-cell text-muted-foreground">
                  {formatDate(file.createdAt)}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!ready}
                      onClick={() => onView(file)}
                      aria-label="View"
                    >
                      <Eye className="size-4" />
                    </Button>
                    {isOwner && (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label="More actions"
                            />
                          }
                        >
                          <MoreHorizontal className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            disabled={!ready}
                            onClick={() => onShare(file)}
                          >
                            <Share2 className="mr-2 size-4" />
                            Share
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onRename(file)}>
                            <Pencil className="mr-2 size-4" />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => onDelete(file)}
                          >
                            <Trash2 className="mr-2 size-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
