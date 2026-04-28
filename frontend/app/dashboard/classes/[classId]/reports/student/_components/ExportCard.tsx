import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, FileText } from "lucide-react";
import { type StudentTermResult } from "@/lib/reports";

interface ExportCardProps {
  tr: StudentTermResult | null;
  onDownloadPdf: () => void;
  onDownloadReportCard: () => void;
}

export function ExportCard({
  tr,
  onDownloadPdf,
  onDownloadReportCard,
}: ExportCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="size-5" />
          Export
        </CardTitle>
        <CardDescription>
          Download this student&apos;s report as a PDF.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onDownloadPdf}>
          <Download className="mr-2 size-4" />
          Download PDF
        </Button>
        {tr && (
          <Button size="sm" onClick={onDownloadReportCard}>
            <FileText className="mr-2 size-4" />
            Report Card
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
