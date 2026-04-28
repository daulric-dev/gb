import { Card, CardContent } from "@/components/ui/card";

export function NoGradesCard() {
  return (
    <Card>
      <CardContent className="py-12 text-center text-muted-foreground">
        No calculated grades found for this student. Make sure assessments
        have been entered.
      </CardContent>
    </Card>
  );
}
