// Mega client for CourseVault mobile.
//
// Mega folders are encrypted: listing a public folder link and downloading
// its files both need client-side decryption. We use megajs' browser build
// (fetch + WebCrypto — the crypto globals come from react-native-quick-crypto,
// imported first in index.ts). Files are downloaded through megajs'
// decrypted stream and written chunk-by-chunk to the device cache, so even
// a 400+ MB video never has to sit in memory in full.
//
// Verified against the real link on 2026-11-10 (Node test): folder listing
// and a 10 MB video download both work, and the downloaded file is a valid
// MP4 (ftyp box present).

import * as mega from 'megajs/dist/main.browser-es.mjs';
import { Directory, File, Paths } from 'expo-file-system';

export interface MegaTreeNode {
  name: string;
  isDir: boolean;
  size: number;
  /** Slash-joined path relative to the catalogue root. */
  path: string;
  /** Mega node handle, when known (last element of downloadId). */
  handle?: string;
  children?: MegaTreeNode[];
}

export interface ParsedMegaLink {
  rootHandle: string;
  key: string;
  /** Optional subfolder handle from the "/folder/<handle>" suffix. */
  subfolderHandle?: string;
  cleanUrl: string;
}

const LINK_RE = /mega\.nz\/folder\/([A-Za-z0-9_-]+)#([A-Za-z0-9_-]+)(?:\/folder\/([A-Za-z0-9_-]+))?/;

/** Split a Mega folder URL into the parts megajs needs. */
export function parseMegaLink(url: string): ParsedMegaLink {
  const m = url.trim().match(LINK_RE);
  if (!m) throw new Error('That does not look like a Mega folder link (expected mega.nz/folder/…).');
  const [, rootHandle, key, subfolderHandle] = m;
  return {
    rootHandle,
    key,
    subfolderHandle,
    cleanUrl: `https://mega.nz/folder/${rootHandle}#${key}`,
  };
}

/** Handle of a node inside a public folder link (last element of downloadId). */
function nodeHandle(f: mega.MegaFileLike): string | undefined {
  const d = f.downloadId;
  return d && d.length > 0 ? d[d.length - 1] : undefined;
}

async function walk(
  dir: mega.MegaFileLike,
  path: string,
  fileByPath: Map<string, mega.MegaFileLike>,
): Promise<MegaTreeNode> {
  const node: MegaTreeNode = {
    name: dir.name,
    isDir: true,
    size: 0,
    path,
    handle: nodeHandle(dir),
    children: [],
  };
  const kids = dir.children || [];
  for (const kid of kids) {
    const childPath = path ? `${path}/${kid.name}` : kid.name;
    if (kid.directory) {
      // Descend with navigate() — loadAttributes() on children of a public
      // folder link fails with EARGS in this megajs version; navigate() works.
      const sub = await dir.navigate(kid.name);
      node.children!.push(await walk(sub, childPath, fileByPath));
    } else {
      fileByPath.set(childPath, kid);
      node.children!.push({
        name: kid.name,
        isDir: false,
        size: kid.size || 0,
        path: childPath,
        handle: nodeHandle(kid),
      });
    }
  }
  return node;
}

function findByHandle(node: MegaTreeNode, handle: string): MegaTreeNode | null {
  if (node.handle === handle) return node;
  for (const child of node.children || []) {
    if (!child.isDir) continue;
    const found = findByHandle(child, handle);
    if (found) return found;
  }
  return null;
}

/** Re-root a tree at the target folder: strip the target's own name from paths. */
function reRoot(node: MegaTreeNode, prefix: string): MegaTreeNode {
  const strip = (p: string) =>
    p === prefix ? '' : p.startsWith(prefix + '/') ? p.slice(prefix.length + 1) : p;
  const clone: MegaTreeNode = {
    name: node.name,
    isDir: true,
    size: 0,
    path: '',
    handle: node.handle,
    children: (node.children || []).map((c) =>
      c.isDir ? reRoot(c, prefix) : { ...c, path: strip(c.path) },
    ),
  };
  return clone;
}

export interface LoadedLibrary {
  /** Tree rooted at the linked folder (or its target subfolder). */
  tree: MegaTreeNode;
  /** Live megajs File objects, keyed by the tree paths above. */
  fileByPath: Map<string, mega.MegaFileLike>;
  rootName: string;
}

/**
 * Load a Mega folder link and return its full file tree.
 * The link may point at a course folder, a library folder, or a single
 * module — the catalogue builder (catalogue.ts) sorts that out.
 */
export async function loadMegaLibrary(linkUrl: string): Promise<LoadedLibrary> {
  const parsed = parseMegaLink(linkUrl);
  const root = mega.File.fromURL(parsed.cleanUrl);
  await root.loadAttributes();
  const fileByPath = new Map<string, mega.MegaFileLike>();
  const fullTree = await walk(root, '', fileByPath);

  let tree = fullTree;
  if (parsed.subfolderHandle) {
    const target = findByHandle(fullTree, parsed.subfolderHandle);
    if (target) {
      tree = reRoot(target, target.path);
      // Re-key the file map to the re-rooted paths.
      const remapped = new Map<string, mega.MegaFileLike>();
      for (const [p, f] of fileByPath) {
        const stripped = target.path && p.startsWith(target.path + '/') ? p.slice(target.path.length + 1) : p;
        if (p === target.path || p.startsWith(target.path + '/')) remapped.set(stripped, f);
      }
      fileByPath.clear();
      for (const [p, f] of remapped) fileByPath.set(p, f);
    }
    // If the handle is not found, fall back to the whole folder — the
    // catalogue builder still produces a sensible library from it.
  }

  return { tree, fileByPath, rootName: tree.name };
}

/** Where downloaded lessons live on the phone. */
export function cacheDir(): string {
  return `${Paths.cache.uri}coursevault/`;
}

export interface DownloadProgress {
  received: number;
  total: number;
}

/**
 * Download one Mega file (decrypted by megajs) to a local path, streaming
 * chunk-by-chunk so large videos never sit in memory. Calls onProgress
 * as bytes arrive. Resolves with the local file URI.
 */
export async function downloadMegaFile(
  file: mega.MegaFileLike,
  destPath: string,
  onProgress?: (p: DownloadProgress) => void,
): Promise<string> {
  const dest = new File(destPath);
  const parentPath = destPath.slice(0, destPath.lastIndexOf('/'));
  if (parentPath) {
    const parent = new Directory(parentPath);
    if (!parent.exists) parent.create();
  }
  if (dest.exists) dest.delete();
  dest.create();
  const writer = dest.writableStream().getWriter();
  const total = file.size || 0;
  let received = 0;

  const stream = file.download();
  try {
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk: Uint8Array) => {
        // Pause the Mega stream while we write, so memory stays bounded
        // to a single chunk.
        stream.pause();
        writer
          .write(chunk)
          .then(() => {
            received += chunk.length;
            onProgress?.({ received, total });
            stream.resume();
          })
          .catch((err) => reject(err instanceof Error ? err : new Error(String(err))));
      });
      stream.on('end', () => resolve());
      stream.on('error', (err: Error) => reject(err));
    });
    await writer.close();
  } catch (err) {
    try {
      await writer.abort();
    } catch {
      // ignore abort errors
    }
    try {
      if (dest.exists) dest.delete();
    } catch {
      // ignore cleanup errors
    }
    throw err;
  }
  return dest.uri;
}
