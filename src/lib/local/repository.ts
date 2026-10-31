import { emptyWorkspace, type Workspace } from "../domain/model.ts";
import { parseWorkspace, BusinessError } from "../domain/workspace.ts";

const databaseName = "pomar-central-local-v1";
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("workspace");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new Error("O navegador não permitiu abrir o armazenamento local."),
      );
  });
}
export async function loadLocalWorkspace(): Promise<Workspace> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("workspace", "readonly");
    const request = transaction.objectStore("workspace").get("current");
    request.onsuccess = () => {
      try {
        resolve(
          request.result ? parseWorkspace(request.result) : emptyWorkspace(),
        );
      } catch {
        reject(
          new Error(
            "Os dados locais não passaram na validação. Preserve seu backup antes de continuar.",
          ),
        );
      }
    };
    request.onerror = () =>
      reject(new Error("Não foi possível ler os dados locais."));
    transaction.oncomplete = () => database.close();
    transaction.onabort = () => database.close();
  });
}
export async function persistLocalWorkspace(
  state: Workspace,
  expectedRevision: number,
): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("workspace", "readwrite");
    const store = transaction.objectStore("workspace");
    const request = store.get("current");
    let failure: Error | null = null;
    request.onsuccess = () => {
      const current = request.result as Workspace | undefined;
      if ((current?.revision ?? 0) !== expectedRevision) {
        failure = new BusinessError(
          "Outra aba alterou os dados. Atualize e tente novamente.",
          "CONFLICT",
        );
        transaction.abort();
        return;
      }
      store.put(state, "current");
    };
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(
        failure ??
          new Error(
            "Falha ao salvar. Verifique o espaço disponível e exporte um backup.",
          ),
      );
    };
    transaction.onabort = () => {
      database.close();
      reject(failure ?? new Error("A gravação local foi interrompida."));
    };
  });
}
