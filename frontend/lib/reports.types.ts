type TermBased = {
    CW: number;
    EX: number;
    Final: number;
}

type YearBased = {
    Term: "trinity" | "michaelmas" | "hilary";

    TrinityExam: number; // this should be the exams for trinity term
    Year: number;
    Final: number;
}

type ReportType = TermBased | YearBased;