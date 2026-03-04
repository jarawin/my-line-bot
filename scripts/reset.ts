#!/usr/bin/env bun
/**
 * reset.ts — ล้างข้อมูลทั้งหมด (DB + ไฟล์ที่ generate ขึ้นมา)
 * รัน: bun run reset
 *
 * ลบ:
 *   betting.sqlite / .sqlite-shm / .sqlite-wal
 *   data/exports/*
 *   data/backups/*
 *   data/images/b*.jpg  data/images/b*.png  (bank upload images)
 */

import { existsSync, rmSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

// Respect env overrides (set by fly.toml in production)
const DB_PATH   = process.env.DB_PATH   || join(ROOT, 'betting.sqlite');
const EXPORT_DIR = process.env.EXPORT_DIR || join(ROOT, 'data/exports');
const BACKUP_DIR = process.env.BACKUP_DIR || join(ROOT, 'data/backups');
const IMAGE_DIR  = process.env.IMAGE_DIR  || join(ROOT, 'data/images');

function rm(path: string) {
    if (existsSync(path)) {
        rmSync(path, { force: true });
        console.log(`  ✓ removed  ${path.replace(ROOT, '')}`);
    }
}

function clearDir(dir: string, keepDotfiles = true) {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir);
    let count = 0;
    for (const entry of entries) {
        if (keepDotfiles && entry.startsWith('.')) continue;
        unlinkSync(join(dir, entry));
        count++;
    }
    if (count > 0) console.log(`  ✓ cleared  ${dir.replace(ROOT, '')}  (${count} files)`);
}

function clearGlob(dir: string, prefix: string, extensions: string[]) {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir);
    let count = 0;
    for (const entry of entries) {
        const lower = entry.toLowerCase();
        if (extensions.some(ext => lower.startsWith(prefix) && lower.endsWith(ext))) {
            unlinkSync(join(dir, entry));
            count++;
        }
    }
    if (count > 0) console.log(`  ✓ removed  ${dir.replace(ROOT, '')}/${prefix}*  (${count} files)`);
}

console.log('\n🗑️  Resetting betting bot data...\n');

// ── SQLite files ──────────────────────────────────────────────────────────────
rm(DB_PATH);
rm(DB_PATH + '-shm');
rm(DB_PATH + '-wal');

// ── Exports & backups ─────────────────────────────────────────────────────────
clearDir(EXPORT_DIR);
clearDir(BACKUP_DIR);

// ── Bank upload images (b*.jpg / b*.png / b*.jpeg / b*.webp) ─────────────────
clearGlob(IMAGE_DIR, 'b', ['.jpg', '.jpeg', '.png', '.webp']);

console.log('\n✅  Reset complete. Run `bun run start` to initialize a fresh DB.\n');
