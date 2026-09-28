// Test-only D1 binding backed by node:sqlite, so index.test.mjs runs the real
// schema.sql through real SQL (not a hand-rolled mock) without needing wrangler
// or miniflare. Not part of the deployed Worker bundle.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

class FakeD1Stmt {
  constructor(sqliteDb, sql) {
    this.sqliteDb = sqliteDb;
    this.sql = sql;
    this.params = [];
  }
  bind(...params) {
    this.params = params;
    return this;
  }
  run() {
    const info = this.sqliteDb.prepare(this.sql).run(...this.params);
    return { success: true, meta: { rows_written: info.changes } };
  }
  first() {
    return this.sqliteDb.prepare(this.sql).get(...this.params) ?? null;
  }
  all() {
    return { success: true, results: this.sqliteDb.prepare(this.sql).all(...this.params) };
  }
}

class FakeD1 {
  constructor(sqliteDb) {
    this.sqliteDb = sqliteDb;
  }
  prepare(sql) {
    return new FakeD1Stmt(this.sqliteDb, sql);
  }
  batch(stmts) {
    return stmts.map((s) => s.run());
  }
}

export function makeFakeD1() {
  const sqliteDb = new DatabaseSync(':memory:');
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  sqliteDb.exec(schema);
  return new FakeD1(sqliteDb);
}
