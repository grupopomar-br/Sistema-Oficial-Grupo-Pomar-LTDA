import { notFound } from "next/navigation";
import AppShell from "@/components/app-shell";
import { localModeAllowed } from "@/lib/config/environment";
import type { View } from "@/components/types";
export default async function LocalPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  if (!localModeAllowed(process.env)) notFound();
  const params = await searchParams;
  return (
    <AppShell mode="local" initialView={params.view as View | undefined} />
  );
}
