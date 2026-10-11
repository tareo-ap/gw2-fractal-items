import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrations } from './schema.js';

// Opens the database and applies missing migrations.
export function openDatabase(dbPath: string): DatabaseSync {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    migrate(db);
    return db;
}

function migrate(db: DatabaseSync): void {
    const { user_version: current } = db.prepare('PRAGMA user_version').get() as { user_version: number };
    for (let version = current; version < migrations.length; version++) {
        db.exec('BEGIN');
        try {
            db.exec(migrations[version]!);
            db.exec(`PRAGMA user_version = ${version + 1}`);
            db.exec('COMMIT');
            console.log(`DB migration ${version + 1} applied`);
        } catch (err) {
            db.exec('ROLLBACK');
            throw err;
        }
    }
}

/** Runs fn in a transaction: COMMIT on success, ROLLBACK on error. */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
    db.exec('BEGIN');
    try {
        const result = fn();
        db.exec('COMMIT');
        return result;
    } catch (err) {
        db.exec('ROLLBACK');
        throw err;
    }
}
