import fs from 'node:fs';
import path from 'node:path';

/** Layout of DATA_DIR (NF-18). All mutable data lives here; backup = copy this folder. */
export interface DataPaths {
  dataDir: string;
  db: string;
  images: string;
  imagesTrash: string;
  backups: string;
  logs: string;
  tmp: string;
}

export function dataPaths(dataDir: string): DataPaths {
  const images = path.join(dataDir, 'images');
  return {
    dataDir,
    db: path.join(dataDir, 'rezepte.sqlite'),
    images,
    imagesTrash: path.join(images, '.trash'),
    backups: path.join(dataDir, 'backups'),
    logs: path.join(dataDir, 'logs'),
    tmp: path.join(dataDir, 'tmp'),
  };
}

/** Creates all folders. Throws if DATA_DIR is not writable (NF-24). */
export function ensureDataDirs(paths: DataPaths): void {
  for (const dir of [paths.dataDir, paths.images, paths.imagesTrash, paths.backups, paths.logs, paths.tmp]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const probe = path.join(paths.dataDir, `.write-test-${process.pid}`);
  fs.writeFileSync(probe, 'ok');
  fs.rmSync(probe, { force: true });
}
