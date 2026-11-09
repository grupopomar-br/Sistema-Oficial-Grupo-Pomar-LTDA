type WorkspaceRpcResult<T> = {
  data: T | null;
  error: { code?: string; message?: string } | null;
};

// Only the specific missing-function response permits compatibility fallback.
// Authentication, network and database failures remain visible to the caller.
export async function fetchWorkspaceSnapshot<T>(
  rpc: (
    name:
      | "pomar_workspace_expense_purposes"
      | "pomar_workspace_collection_queue"
      | "pomar_workspace_client_terms"
      | "pomar_workspace_cards"
      | "pomar_workspace_results"
      | "pomar_workspace_scheduled"
      | "pomar_workspace_personalized"
      | "pomar_workspace_enriched"
      | "pomar_workspace",
  ) => PromiseLike<WorkspaceRpcResult<T>>,
): Promise<WorkspaceRpcResult<T>> {
  const finance = await rpc("pomar_workspace_expense_purposes");
  if (finance.error?.code !== "PGRST202") return finance;
  const collectionQueue = await rpc("pomar_workspace_collection_queue");
  if (collectionQueue.error?.code !== "PGRST202") return collectionQueue;
  const clientTerms = await rpc("pomar_workspace_client_terms");
  if (clientTerms.error?.code !== "PGRST202") return clientTerms;
  const cards = await rpc("pomar_workspace_cards");
  if (cards.error?.code !== "PGRST202") return cards;
  const results = await rpc("pomar_workspace_results");
  if (results.error?.code !== "PGRST202") return results;
  const scheduled = await rpc("pomar_workspace_scheduled");
  if (scheduled.error?.code !== "PGRST202") return scheduled;
  const personalized = await rpc("pomar_workspace_personalized");
  if (personalized.error?.code !== "PGRST202") return personalized;
  const result = await rpc("pomar_workspace_enriched");
  return result.error?.code === "PGRST202"
    ? await rpc("pomar_workspace")
    : result;
}
