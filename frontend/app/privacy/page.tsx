import { PolicyPage } from "@/components/policy-page";
import data from "@/data/privacy-policy.json";

export default function PrivacyPolicyPage() {
  return <PolicyPage data={data} />;
}
