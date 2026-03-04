import { mkdirSync } from 'fs';

export const DB_PATH = process.env.DB_PATH || './betting.sqlite';
export const EXPORT_DIR = process.env.EXPORT_DIR || './data/exports';
export const BACKUP_DIR = process.env.BACKUP_DIR || './data/backups';
export const IMAGE_DIR = process.env.IMAGE_DIR || './data/images';

mkdirSync(EXPORT_DIR, { recursive: true });
mkdirSync(BACKUP_DIR, { recursive: true });
mkdirSync(IMAGE_DIR, { recursive: true });
