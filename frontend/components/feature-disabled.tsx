import { PowerOff } from "lucide-react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

/** Shown in place of a page whose feature the school has switched off. */
export function FeatureDisabled({
  title = "This feature is turned off for your school",
  description = "Your school or organisation has switched it off. Ask an administrator if you need it.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <PowerOff />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
