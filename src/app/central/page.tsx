import AppShell from "@/components/app-shell";
import { SetupPage } from "@/components/auth-layout";
import { parseEnvironment } from "@/lib/config/environment";
import { ownerPage, AccessError } from "@/lib/server/access";
import type { View } from "@/components/types";
import { LEGACY_SESSION_POLICY, sessionPolicy } from "@/lib/domain/security";
export default async function CentralPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  try {
    parseEnvironment(process.env);
  } catch {
    return <SetupPage />;
  }
  let policy = LEGACY_SESSION_POLICY;
  try {
    const owner = await ownerPage();
    if ("sessionPolicy" in owner)
      policy = sessionPolicy(owner.sessionPolicy) ?? policy;
  } catch (error) {
    if (error instanceof AccessError)
      return <SetupPage message={error.message} />;
    throw error;
  }
  const params = await searchParams;
  return (
    <AppShell
      mode="cloud"
      initialView={params.view as View | undefined}
      sessionPolicy={policy}
    />
  );
}
