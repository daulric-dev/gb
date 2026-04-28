"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import { Pencil, Trash2, GripVertical } from "lucide-react";
import { type Subject } from "./types";

interface SortableSubjectRowProps {
  subject: Subject;
  onEdit: () => void;
  onDelete: () => void;
}

export function SortableSubjectRow({ subject, onEdit, onDelete }: SortableSubjectRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: subject.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <TableRow ref={setNodeRef} style={style}>
      <TableCell className="w-10 px-2">
        <button
          type="button"
          className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
      </TableCell>
      <TableCell className="font-medium">{subject.name}</TableCell>
      <TableCell>
        {subject.code ? (
          <Badge variant="outline">{subject.code}</Badge>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </TableCell>
      <TableCell>
        {subject.is_graded ? (
          <Badge>Graded</Badge>
        ) : (
          <Badge variant="secondary">Not Graded</Badge>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {subject.sort_order}
      </TableCell>
      <TableCell className="text-right space-x-1">
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Pencil className="size-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={onDelete}>
          <Trash2 className="size-4 text-destructive" />
        </Button>
      </TableCell>
    </TableRow>
  );
}
