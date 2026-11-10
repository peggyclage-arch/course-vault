// Minimal typings for the parts of megajs we use.
// We import the browser ESM build directly by path because it is the build
// that runs on fetch + WebCrypto (provided in the app by
// react-native-quick-crypto), instead of Node's crypto/https modules.
declare module 'megajs/dist/main.browser-es.mjs' {
  export interface MegaDownloadStream {
    on(event: 'data', cb: (chunk: Uint8Array) => void): void;
    on(event: 'end', cb: () => void): void;
    on(event: 'error', cb: (err: Error) => void): void;
    pause(): void;
    resume(): void;
  }

  export interface MegaFileLike {
    name: string;
    directory: boolean;
    size: number;
    /** [rootHandle, ..., ownHandle] for nodes inside a public folder link. */
    downloadId?: string[];
    children?: MegaFileLike[];
    loadAttributes(): Promise<void>;
    navigate(name: string): Promise<MegaFileLike>;
    download(): MegaDownloadStream;
  }

  export const File: {
    fromURL(url: string): MegaFileLike;
  };
}
