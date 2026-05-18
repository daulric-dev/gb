import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FileText } from "lucide-react";
import { type ReportType } from "@/lib/reports";
import { type Term } from "./types";

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

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
          <select
            className={selectClass}
            value={reportType}
            onChange={(e) => {
              onReportTypeChange(e.target.value as ReportType);
            }}
          >
            <option value="term">Term</option>
            <option value="year_end">Year-End</option>
          </select>
        </div>
        {reportType !== "year_end" && (
          <div className="space-y-1.5 min-w-[180px]">
            <label className="text-sm font-medium">Term</label>
            <select
              className={selectClass}
              value={selectedTermId}
              onChange={(e) => {
                onTermChange(e.target.value);
              }}
            >
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
