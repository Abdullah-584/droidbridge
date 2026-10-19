/**
 * Minimal Electron stub for unit tests. The main-process modules only touch
 * Electron at call time, so the stub needs to exist — not behave.
 */
export const dialog = {
  showSaveDialog: async () => ({ canceled: true, filePath: undefined }),
  showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
};

export const shell = {
  openExternal: async () => undefined,
};

export const app = {
  getVersion: () => '0.0.0-test',
  on: () => undefined,
  whenReady: async () => undefined,
  quit: () => undefined,
  requestSingleInstanceLock: () => true,
};

export const ipcMain = {
  handle: () => undefined,
};

export const ipcRenderer = {
  invoke: async () => ({ ok: false, error: { code: 'STUB', message: 'not available in tests' } }),
  on: () => undefined,
  removeListener: () => undefined,
};

export const contextBridge = {
  exposeInMainWorld: () => undefined,
};

export class BrowserWindow {
  static getAllWindows(): BrowserWindow[] {
    return [];
  }
}

export default { dialog, shell, app, ipcMain, ipcRenderer, contextBridge, BrowserWindow };
