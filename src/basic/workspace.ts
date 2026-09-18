/**
 * "My programs": the reader's own programs, kept in the browser.
 *
 * The layout is programs/'s own — <id>.bas, <id>.json, and a diagram as
 * <id>.png|jpg|webp — so what a reader downloads or submits is exactly what the
 * archive would hold, and the sidecar is a real sidecar rather than an app
 * format that has to be translated on the way out.
 *
 * The archive itself is never copied in. It is fetched fresh on every load and
 * is read-only; a reader who wants to change an archive program makes a copy
 * here, which forgets the original's fidelity (an edited verbatim listing is
 * not verbatim) and says where it came from.
 *
 * Pure: storage is whatever FileStore it is given. The app gives it OPFS
 * (src/workspace/opfs-store.ts); the tests give it a Map.
 */

import { sniffImage } from './image-format.ts';
import type { ProgramMeta } from './program-catalog.ts';
import {
  SubmissionError,
  buildSubmission,
  fieldsToSidecar,
  sidecarToFields,
  type FormFields,
} from './submission.ts';

/** A flat directory of files. OPFS in the browser, a Map in the tests. */
export interface FileStore {
  list(): Promise<string[]>;
  read(name: string): Promise<Uint8Array | null>;
  write(name: string, data: Uint8Array | string): Promise<void>;
  remove(name: string): Promise<void>;
}

export interface WorkspaceEntry {
  id: string;
  title: string;
  files: string[];
}

export interface WorkspaceProgram {
  id: string;
  listing: string;
  fields: FormFields;
  image: Uint8Array | null;
  imageFile: string | null;
}

/** An archive program, as copyFromArchive needs it. */
export type ArchiveProgram = ProgramMeta & { listing: string };

const PROGRAM_FILE = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.(bas|json|png|jpg|jpeg|webp)$/;
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const NEW_LISTING = `10 REM Untitled
20 REM Replace these lines with the listing, exactly as printed.
30 END
`;

const decoder = new TextDecoder();

export class Workspace {
  private readonly store: FileStore;
  private readonly archiveIds: ReadonlySet<string>;

  constructor(store: FileStore, archiveIds: Iterable<string>) {
    this.store = store;
    this.archiveIds = new Set(archiveIds);
  }

  async list(): Promise<WorkspaceEntry[]> {
    const byId = new Map<string, string[]>();
    for (const name of await this.store.list()) {
      const match = PROGRAM_FILE.exec(name);
      if (!match) continue;
      byId.set(match[1], [...(byId.get(match[1]) ?? []), name]);
    }

    const entries: WorkspaceEntry[] = [];
    for (const [id, files] of byId) {
      if (!files.includes(`${id}.bas`) && !files.includes(`${id}.json`)) continue;
      const fields = sidecarToFields(id, await this.readJson(`${id}.json`));
      entries.push({ id, title: fields.title || id, files: files.sort() });
    }
    return entries.sort((a, b) => a.id.localeCompare(b.id));
  }

  async open(id: string): Promise<WorkspaceProgram> {
    const bas = await this.store.read(`${id}.bas`);
    const imageFile = await this.imageFileOf(id);
    return {
      id,
      listing: bas ? decoder.decode(bas) : '',
      fields: sidecarToFields(id, await this.readJson(`${id}.json`)),
      image: imageFile ? await this.store.read(imageFile) : null,
      imageFile,
    };
  }

  /** One of a program's files, for download. Only program files: the store may
   *  hold anything, but the workspace hands out only what it manages. */
  async readFile(name: string): Promise<Uint8Array | null> {
    return PROGRAM_FILE.test(name) ? this.store.read(name) : null;
  }

  async create(): Promise<string> {
    const id = await this.unusedId('untitled');
    await this.store.write(`${id}.bas`, NEW_LISTING);
    await this.writeJson(id, { title: 'Untitled' });
    return id;
  }

  async copyFromArchive(program: ArchiveProgram, image?: Uint8Array): Promise<string> {
    const id = await this.unusedId(`${program.id}-copy`);
    const fields = sidecarToFields(id, program);

    fields.fidelity = '';
    const origin = `Copied from the archive's ${program.id}, which is ${program.fidelity}.`;
    fields.notes = fields.notes ? `${origin}\n\n${fields.notes}` : origin;

    await this.store.write(`${id}.bas`, program.listing);
    if (image) {
      await this.writeImage(id, image);
    } else {
      fields.diagramCaption = fields.diagramFigure = fields.rightsBasis = fields.rightsStatement = '';
    }
    await this.saveFields(id, fields);
    return id;
  }

  async saveListing(id: string, listing: string): Promise<void> {
    await this.store.write(`${id}.bas`, listing);
  }

  /** Saved as a sidecar, valid or not: a draft is saved as it is typed. */
  async saveFields(id: string, fields: FormFields): Promise<void> {
    const imageFile = await this.imageFileOf(id);
    await this.writeJson(id, fieldsToSidecar(fields, imageFile ?? undefined));
  }

  async saveImage(id: string, bytes: Uint8Array): Promise<void> {
    await this.writeImage(id, bytes);
    // The sidecar names the file, and the extension may just have changed.
    await this.saveFields(id, (await this.open(id)).fields);
  }

  async removeImage(id: string): Promise<void> {
    const file = await this.imageFileOf(id);
    if (file) await this.store.remove(file);
    await this.saveFields(id, (await this.open(id)).fields);
  }

  async rename(from: string, to: string): Promise<void> {
    if (from === to) return;
    if (!ID.test(to)) {
      throw new Error(`"${to}" must be lowercase words joined by hyphens, like "two-tank".`);
    }
    if (this.archiveIds.has(to)) throw new Error(`"${to}" is already in the archive.`);
    if ((await this.list()).some((p) => p.id === to)) {
      throw new Error(`"${to}" is already one of your programs.`);
    }

    for (const name of await this.filesOf(from)) {
      const data = await this.store.read(name);
      if (data) await this.store.write(`${to}${name.slice(from.length)}`, data);
      await this.store.remove(name);
    }
    await this.saveFields(to, (await this.open(to)).fields);
  }

  async remove(id: string): Promise<void> {
    for (const name of await this.filesOf(id)) await this.store.remove(name);
  }

  /** What would stop this program being submitted — the bot's own check, run here first. */
  async check(id: string): Promise<string[]> {
    const program = await this.open(id);
    const problems: string[] = [];
    if (this.archiveIds.has(id)) {
      problems.push(`Program id: "${id}" is already in the archive. Rename this program.`);
    }
    try {
      buildSubmission({ ...program.fields, listing: program.listing }, program.image ?? undefined);
    } catch (e) {
      if (!(e instanceof SubmissionError)) throw e;
      problems.push(...e.problems);
    }
    return problems;
  }

  // ------------------------------------------------------------------ helpers

  private async filesOf(id: string): Promise<string[]> {
    return (await this.store.list()).filter((name) => PROGRAM_FILE.exec(name)?.[1] === id);
  }

  private async imageFileOf(id: string): Promise<string | null> {
    const files = await this.filesOf(id);
    return IMAGE_EXTENSIONS.map((ext) => `${id}.${ext}`).find((f) => files.includes(f)) ?? null;
  }

  private async writeImage(id: string, bytes: Uint8Array): Promise<void> {
    const format = sniffImage(bytes);
    if (!format) throw new Error('A diagram must be a PNG, JPEG or WebP image.');
    const previous = await this.imageFileOf(id);
    if (previous) await this.store.remove(previous);
    await this.store.write(`${id}.${format}`, bytes);
  }

  private async unusedId(base: string): Promise<string> {
    const taken = new Set([...this.archiveIds, ...(await this.list()).map((p) => p.id)]);
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }

  private async readJson(name: string): Promise<unknown> {
    const bytes = await this.store.read(name);
    if (!bytes) return null;
    try {
      return JSON.parse(decoder.decode(bytes));
    } catch {
      // A hand-mangled file reads as an empty form rather than breaking the list.
      return null;
    }
  }

  private async writeJson(id: string, sidecar: Record<string, unknown>): Promise<void> {
    await this.store.write(`${id}.json`, `${JSON.stringify(sidecar, null, 2)}\n`);
  }
}
