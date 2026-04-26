import { IsString, IsNotEmpty, IsInt, Min } from 'class-validator';

export class SavePdfDto {
  @IsString()
  @IsNotEmpty()
  filePath!: string; // path in Supabase Storage, e.g. "report-books/2025-2026/michaelmas/james-STU-001.pdf"

  @IsInt()
  @Min(1)
  fileSize!: number; // size in bytes
}
