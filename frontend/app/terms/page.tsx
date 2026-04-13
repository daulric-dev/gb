import { PolicyPage } from "@/components/policy-page";
import data from "@/data/terms-of-service.json";

export default function TermsOfServicePage() {
  return <PolicyPage data={data} />;
}
