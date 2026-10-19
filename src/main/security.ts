import { app, shell } from 'electron';

const DEV_SERVER_URL = process.env.DROIDBRIDGE_DEV_SERVER_URL ?? null;

function isDev(): boolean {
  return DEV_SERVER_URL !== null && process.env.NODE_ENV === 'development';
}

function cspForEnvironment(): string {
  const scriptSrc = isDev() ? "'self' 'unsafe-inline'" : "'self'";
  const connectSrc = isDev() ? "'self' ws://localhost:5173 http://localhost:5173" : "'self'";
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Applies process-wide guards: navigation, popups, permissions, CSP headers. */
export function installSecurity(): void {
  app.on('web-contents-created', (_event, contents) => {
    // Deny every window.open; external http(s) links open in the OS browser.
    contents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://') || url.startsWith('http://')) {
        void shell.openExternal(url);
      }
      return { action: 'deny' };
    });

    // Block any navigation away from the app (dev server or bundled index.html).
    contents.on('will-navigate', (event, url) => {
      const allowed =
        url.startsWith('file://') ||
        (DEV_SERVER_URL !== null && url.startsWith(DEV_SERVER_URL));
      if (!allowed) {
        event.preventDefault();
        if (url.startsWith('https://') || url.startsWith('http://')) {
          void shell.openExternal(url);
        }
      }
    });

    // The app never needs camera/mic/geolocation/notifications/clipboard-read.
    contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });

    contents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [cspForEnvironment()],
        },
      });
    });
  });
}
