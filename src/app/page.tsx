import { redirect } from "next/navigation";
import {
  hasCloudConfiguration,
  localModeAllowed,
} from "@/lib/config/environment";
import { SetupPage } from "@/components/auth-layout";
export default function Page() {
  if (hasCloudConfiguration(process.env)) redirect("/central");
  if (localModeAllowed(process.env)) redirect("/local");
  return <SetupPage />;
}
