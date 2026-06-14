import type { Database } from "bun:sqlite";
import type { CatalogDb, CatalogParams } from "../src/index.ts";

export class BunCatalogDb implements CatalogDb {
  constructor(private readonly db: Database) {}

  exec(sql: string, params: CatalogParams = []): void {
    if (params.length === 0) {
      this.db.exec(sql);
      return;
    }
    this.db.query(sql).run(...params);
  }

  get<T>(sql: string, params: CatalogParams = []): T | null | undefined {
    return this.db.query(sql).get(...params) as T | null | undefined;
  }

  all<T>(sql: string, params: CatalogParams = []): T[] {
    return this.db.query(sql).all(...params) as T[];
  }
}
