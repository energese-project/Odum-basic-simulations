/**
 * Writes one OPFS file with a sync access handle — the route for browsers that
 * have OPFS but not createWritable(). Sync handles are only allowed in a
 * worker, which is the whole reason this file exists. See opfs-store.ts.
 */

interface WriteRequest {
  id: number;
  path: string[];
  name: string;
  bytes: Uint8Array;
}

/** In the webworker lib, not the dom one this project compiles against. */
interface SyncAccessHandle {
  truncate(size: number): void;
  write(buffer: Uint8Array, options: { at: number }): number;
  flush(): void;
  close(): void;
}

self.onmessage = async (event: MessageEvent<WriteRequest>) => {
  const { id, path, name, bytes } = event.data;
  let access: SyncAccessHandle | null = null;
  try {
    let dir = await navigator.storage.getDirectory();
    for (const part of path) dir = await dir.getDirectoryHandle(part, { create: true });
    const handle = await dir.getFileHandle(name, { create: true });
    access = await (
      handle as unknown as { createSyncAccessHandle(): Promise<SyncAccessHandle> }
    ).createSyncAccessHandle();
    access.truncate(0);
    access.write(bytes, { at: 0 });
    access.flush();
    self.postMessage({ id });
  } catch (e) {
    self.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  } finally {
    access?.close();
  }
};
