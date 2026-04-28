import { Skeleton } from "@/components/ui/skeleton";

export function StudentReportLoadingSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-72" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}
