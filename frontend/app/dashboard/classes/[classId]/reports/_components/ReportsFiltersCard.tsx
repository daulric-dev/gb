import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileText } from "lucide-react";
import { type ReportType } from "@/lib/reports";
import { type Term } from "./types";

interface ReportsFiltersCardProps {
  reportType: ReportType;
  onReportTypeChange: (value: ReportType) => void;
  terms: Term[];
  selectedTermId: string;
  onTermChange: (value: string) => void;
}

export function ReportsFiltersCard({
  reportType,
  onReportTypeChange,
  terms,
  selectedTermId,
  onTermChange,
}: ReportsFiltersCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="size-5" />
          Filters
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="space-y-1.5 min-w-[160px]">
          <label className="text-sm font-medium">Report Type</label>
          <Select
            value={reportType}
            onValueChange={(v) => {
              onReportTypeChange(v as ReportType);
            }}
            items={[
              { value: "term", label: "Term" },
              { value: "year_end", label: "Year-End" },
            ]}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="term">Term</SelectItem>
              <SelectItem value="year_end">Year-End</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {reportType !== "year_end" && (
          <div className="space-y-1.5 min-w-[180px]">
            <label className="text-sm font-medium">Term</label>
            <Select
              value={selectedTermId}
              onValueChange={(v) => {
                onTermChange(v as string);
              }}
              items={terms.map((t) => ({ value: t.id, label: t.name }))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {terms.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
