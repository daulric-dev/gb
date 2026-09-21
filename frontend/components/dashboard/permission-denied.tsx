import { Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";


export function PermissionDenied({
  title,
  description,
  message,
}: {
  title: string;
  description: string;
  message: string;
}) {
  return (
    <div className="space-y-6">
      <DashboardPageHeader title={title} description={description} />
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <Lock className="mb-3 size-10 text-muted-foreground/40" />
          <p className="font-medium">No access</p>
          <p className="mt-1 text-sm text-muted-foreground">{message}</p>
        </CardContent>
      </Card>
    </div>
  );
}
