/**
 * The workspace's files, in the browser's Origin Private File System.
 *
 * OPFS is per origin, and energese-project.github.io is one origin shared by
 * every Pages site in the organisation. So everything lives under a directory
 * named for this repository, and nothing here touches the root.
 *
 * Writing has two routes. FileSystemFileHandle.createWritable() is the simple
 * one, but it reached Safari late; where it is missing, the write goes to a
 * Web Worker that uses createSyncAccessHandle(), which is only allowed off the
 * main thread and has been in every OPFS browser from the start.
 */

import type { FileStore } from '../basic/workspace.ts';

const APP_DIRECTORY = 'odum-basic-simulations';
const WORKSPACE_DIRECTORY = 'workspace';

/** The workspace store, or null where the browser has no OPFS at all. */
export async function openWorkspaceStore(): Promise<FileStore | null> {
  if (typeof navigator.storage?.getDirectory !== 'function') return null;
  try {
    const root = await navigator.storage.getDirectory();
    const app = await root.getDirectoryHandle(APP_DIRECTORY, { create: true });
    const dir = await app.getDirectoryHandle(WORKSPACE_DIRECTORY, { create: true });
    return new OpfsStore(dir);
  } catch {
    // Firefox private windows expose the API and then refuse to use it.
    return null;
  }
}

class OpfsStore implements FileStore {
  private readonly dir: FileSystemDirectoryHandle;
  private persisted = false;

  constructor(dir: FileSystemDirectoryHandle) {
    this.dir = dir;
  }

  async list(): Promise<string[]> {
    const names: string[] = [];
    for await (const [name, handle] of this.dir.entries()) {
      if (handle.kind === 'file') names.push(name);
    }
    return names;
  }

  async read(name: string): Promise<Uint8Array | null> {
    try {
      const file = await (await this.dir.getFileHandle(name)).getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotFoundError') return null;
      throw e;
    }
  }

  async write(name: string, data: Uint8Array | string): Promise<void> {
    void this.persist();
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const handle = await this.dir.getFileHandle(name, { create: true });
    if (typeof handle.createWritable === 'function') {
      const writable = await handle.createWritable();
      await writable.write(bytes as Uint8Array<ArrayBuffer>);
      await writable.close();
    } else {
      await writeInWorker(name, bytes);
    }
  }

  async remove(name: string): Promise<void> {
    try {
      await this.dir.removeEntry(name);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'NotFoundError')) throw e;
    }
  }

  /** Ask once for the files not to be evicted under storage pressure. The
   *  browser may say no; the workspace still works, it is just less durable. */
  private async persist(): Promise<void> {
    if (this.persisted) return;
    this.persisted = true;
    try {
      await navigator.storage.persist?.();
    } catch {
      // Not offered here. Downloading a program is the backup.
    }
  }
}

// ------------------------------------------------------ the worker route

let worker: Worker | null = null;
let nextRequest = 0;
const pending = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();

function writeInWorker(name: string, bytes: Uint8Array): Promise<void> {
  if (!worker) {
    worker = new Worker(new URL('./opfs-writer.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ id: number; error?: string }>) => {
      const request = pending.get(event.data.id);
      pending.delete(event.data.id);
      if (event.data.error) request?.reject(new Error(event.data.error));
      else request?.resolve();
    };
  }
  const id = nextRequest++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ id, path: [APP_DIRECTORY, WORKSPACE_DIRECTORY], name, bytes });
  });
}
