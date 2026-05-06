import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function StatCard({
  icon: Icon,
  value,
  label,
  loading,
}: {
  icon: LucideIcon;
  value: string | number;
  label: string;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <Icon className="size-5 text-primary" />
          <div>
            {loading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              <p className="text-2xl font-bold">{value}</p>
            )}
            <p className="text-sm text-muted-foreground">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
