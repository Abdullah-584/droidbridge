import { dialog } from 'electron';
import type { BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import { DroidBridgeError } from '../errors';

/**
 * Writes exported logcat lines to a user-chosen file. The path always comes
 * from the native save dialog — the renderer never supplies a filesystem path.
 */
export async function exportLogLines(
  suggestedName: string,
  lines: string[],
  window?: BrowserWindow,
): Promise<string> {
  const dialogOptions = {
    title: 'Export logcat',
    defaultPath: suggestedName,
    filters: [
      { name: 'Log files', extensions: ['log', 'txt'] },
      { name: 'All files', extensions: ['*'] },
    ],
  };
  const result = window
    ? await dialog.showSaveDialog(window, dialogOptions)
    : await dialog.showSaveDialog(dialogOptions);
  if (result.canceled || !result.filePath) {
    throw new DroidBridgeError('EXPORT_CANCELLED', 'Export cancelled.');
  }
  await fs.writeFile(result.filePath, `${lines.join('\n')}\n`, 'utf8');
  return result.filePath;
}
