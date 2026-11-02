type WorkspaceRpcResult<T> = {
  data: T | null;
  error: { code?: string; message?: string } | null;
};

// Only the specific missing-function response permits compatibility fallback.
// Authentication, network and database failures remain visible to the caller.
export async function fetchWorkspaceSnapshot<T>(
  rpc: (
    name: "pomar_workspace_enriched" | "pomar_workspace",
  ) => PromiseLike<WorkspaceRpcResult<T>>,
): Promise<WorkspaceRpcResult<T>> {
  const result = await rpc("pomar_workspace_enriched");
  return result.error?.code === "PGRST202"
    ? await rpc("pomar_workspace")
    : result;
}
