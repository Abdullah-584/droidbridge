import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'node:path';
import { LogcatManager } from './adb/logcat';
import { createToolInstaller, type ToolInstaller } from './services/installer';
import { EmulatorManager } from './services/emulator';
import { ScrcpyManager } from './services/scrcpy';
import { createUpdater, type UpdaterHandle } from './services/updater';
import { createHandlerSpecs } from './ipc/handlers';
import { registerInvokeHandlers } from './ipc/registry';
import { processRegistry } from './process/registry';
import { installSecurity } from './security';
import type { LogcatLine } from '../shared/types';

const DEV_SERVER_URL = process.env.DROIDBRIDGE_DEV_SERVER_URL ?? null;

// Single instance: a second launch focuses the existing window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

installSecurity();

let mainWindow: BrowserWindow | null = null;
let updaterHandle: UpdaterHandle | null = null;
let toolInstaller: ToolInstaller | null = null;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    backgroundColor: '#0b1120',
    title: 'DroidBridge',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
      devTools: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  if (DEV_SERVER_URL) {
    void win.loadURL(DEV_SERVER_URL);
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  win.on('closed', () => {
    mainWindow = null;
  });
  return win;
}

function registerIpc(): UpdaterHandle {
  const logcat = new LogcatManager(
    processRegistry,
    {
      onLines(sessionId, lines: LogcatLine[]) {
        mainWindow?.webContents.send('logcat:lines', { sessionId, lines });
      },
      onExit(sessionId, code, error) {
        mainWindow?.webContents.send('logcat:exit', { sessionId, code, error });
      },
    },
    async () => {
      const { resolveAdbPath } = await import('./adb/adb');
      return resolveAdbPath();
    },
  );

  const scrcpy = new ScrcpyManager(processRegistry, {
    onExit(sessionId, code, error) {
      mainWindow?.webContents.send('scrcpy:exit', { sessionId, code, error });
    },
  });

  const emulator = new EmulatorManager(processRegistry, {
    onExit({ sessionId, avd, code, error }) {
      mainWindow?.webContents.send('emulator:exit', { sessionId, avd, code, error });
    },
  });

  // Automatic tool installation: missing adb/scrcpy are fetched into
  // %LOCALAPPDATA%\DroidBridge\tools (installer service); progress streams to
  // the renderer on `tools:install-progress`.
  toolInstaller = createToolInstaller((progress) =>
    mainWindow?.webContents.send('tools:install-progress', progress),
  );

  // Auto-update: packaged builds only (see services/updater), statuses stream
  // to the renderer on the `update:status` event channel.
  const updater = createUpdater(autoUpdater, {
    isPackaged: app.isPackaged,
    emit: (status) => mainWindow?.webContents.send('update:status', status),
  });

  const specs = createHandlerSpecs({
    logcat,
    scrcpy,
    emulator,
    installer: toolInstaller,
    installUpdate: () => updater.install(),
    appVersion: app.getVersion(),
    platform: process.platform,
    getWindow: () => mainWindow ?? undefined,
    openExternal: (url) => {
      void shell.openExternal(url);
    },
    pickFolder: async (title) => {
      const result = await dialog.showOpenDialog(mainWindow ?? undefined!, {
        title,
        properties: ['openDirectory'],
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0];
    },
  });

  registerInvokeHandlers(ipcMain, specs);
  return updater;
}

app.whenReady().then(() => {
  updaterHandle = registerIpc();
  mainWindow = createWindow();
  updaterHandle.start();
  // First-launch dependency pass: silently install adb/scrcpy when missing.
  void toolInstaller?.autoInstallMissing();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  updaterHandle?.stop();
  processRegistry.stopAll();
});
