"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, FileSpreadsheet, FileText, Upload } from "lucide-react";
import type { ClassReportFile } from "@/lib/reports";

interface ExportCardProps {
  isClassTeacher: boolean;
  generating: boolean;
  storedFiles: ClassReportFile[];
  storedFileTypes: Set<string>;
  onDownloadPdf: () => void;
  onDownloadExamReportPdf: () => void;
  onDownloadCsv: () => void;
  onDownloadXlsx: () => void;
  onGenerateAndUploadAll: () => void;
  onDownloadStoredFile: (fileType: string) => void;
}

export function ExportCard({
  isClassTeacher,
  generating,
  storedFiles,
  storedFileTypes,
  onDownloadPdf,
  onDownloadExamReportPdf,
  onDownloadCsv,
  onDownloadXlsx,
  onGenerateAndUploadAll,
  onDownloadStoredFile,
}: ExportCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="size-5" />
          Export
        </CardTitle>
        <CardDescription>
          Download locally or generate and upload to storage.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onDownloadPdf}>
            <FileText className="mr-2 size-4" />
            Download PDF
          </Button>
          <Button size="sm" variant="outline" onClick={onDownloadExamReportPdf}>
            <FileText className="mr-2 size-4" />
            Exam Report Card
          </Button>
          <Button size="sm" variant="outline" onClick={onDownloadCsv}>
            <FileSpreadsheet className="mr-2 size-4" />
            Download CSV
          </Button>
          <Button size="sm" variant="outline" onClick={onDownloadXlsx}>
            <FileSpreadsheet className="mr-2 size-4" />
            Download Excel
          </Button>
        </div>

        {isClassTeacher && (
          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button
              size="sm"
              onClick={onGenerateAndUploadAll}
              disabled={generating}
            >
              <Upload className="mr-2 size-4" />
              {generating
                ? "Working…"
                : "Generate & save all to storage"}
            </Button>
          </div>
        )}

        {storedFiles.length > 0 && (
          <div className="space-y-2 border-t pt-4">
            <p className="text-sm font-medium">Stored files</p>
            <ul className="space-y-2 text-sm">
              {storedFiles.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-2"
                >
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs uppercase">
                        {f.file_type}
                      </Badge>
                      <code className="text-xs break-all">
                        {f.file_path}
                      </code>
                    </div>
                    <span className="text-muted-foreground">
                      {(f.file_size / 1024).toFixed(1)} KB &middot;{" "}
                      {new Date(f.generated_at).toLocaleString()}
                    </span>
                  </div>
                  {storedFileTypes.has(f.file_type) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="shrink-0"
                      onClick={() => onDownloadStoredFile(f.file_type)}
                    >
                      <Download className="size-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
