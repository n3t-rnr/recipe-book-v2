import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/** App version from package.json; sent as X-App-Version and shown on the status page (F-36, F-42). */
export const APP_VERSION: string = pkg.version;
