import fs from 'fs/promises';
import path from 'path';
import { createChildLogger } from '../logger/index.js';

const log = createChildLogger('fileUtil');

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDirectory(dirPath: string): Promise<void> {
  if (!(await fileExists(dirPath))) {
    log.debug('Creating directory', { source: 'fileUtil#ensureDirectory', dirPath });
    await fs.mkdir(dirPath, { recursive: true });
  }
}

export async function readJson<T>(filePath: string): Promise<T | null> {
  if (!(await fileExists(filePath))) return null;
  log.debug('Reading JSON file', { source: 'fileUtil#readJson', filePath });
  const data = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(data) as T;
}

export async function writeJson<T>(filePath: string, data: T): Promise<void> {
  log.debug('Writing JSON file', { source: 'fileUtil#writeJson', filePath });
  await ensureDirectory(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}
