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
rm(join(ROOT, 'betting.sqlite'));
rm(join(ROOT, 'betting.sqlite-shm'));
rm(join(ROOT, 'betting.sqlite-wal'));

// ── Exports & backups ─────────────────────────────────────────────────────────
clearDir(join(ROOT, 'data/exports'));
clearDir(join(ROOT, 'data/backups'));

// ── Bank upload images (b*.jpg / b*.png / b*.jpeg / b*.webp) ─────────────────
clearGlob(join(ROOT, 'data/images'), 'b', ['.jpg', '.jpeg', '.png', '.webp']);

console.log('\n✅  Reset complete. Run `bun run start` to initialize a fresh DB.\n');
