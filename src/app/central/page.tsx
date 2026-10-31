import AppShell from "@/components/app-shell";
import { SetupPage } from "@/components/auth-layout";
import { parseEnvironment } from "@/lib/config/environment";
import { ownerPage, AccessError } from "@/lib/server/access";
import type { View } from "@/components/types";
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
  try {
    await ownerPage();
  } catch (error) {
    if (error instanceof AccessError)
      return <SetupPage message={error.message} />;
    throw error;
  }
  const params = await searchParams;
  return (
    <AppShell mode="cloud" initialView={params.view as View | undefined} />
  );
}
