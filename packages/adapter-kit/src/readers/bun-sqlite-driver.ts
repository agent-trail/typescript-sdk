import { Database } from "bun:sqlite";
import type { SqliteConnection, SqliteDriver } from "./sqlite-reader.js";

// `bun:sqlite`-backed SqliteDriver. Lives behind the
// `@agent-trail/adapter-kit/bun-sqlite` subpath so importing the main kit entry
// under Node never pulls in the Bun-only `bun:sqlite` module.
export const bunSqliteDriver: SqliteDriver = {
  open(path: string): SqliteConnection {
    const db = new Database(path, { readonly: true });
    return {
      prepare(sql: string) {
        const statement = db.query(sql);
        return {
          all: (params?: Record<string, string | number | boolean | null>) =>
            (params === undefined ? statement.all() : statement.all(params)) as Record<
              string,
              unknown
            >[],
          get: (params?: Record<string, string | number | boolean | null>) =>
            (params === undefined ? statement.get() : statement.get(params)) as
              | Record<string, unknown>
              | undefined,
        };
      },
      close() {
        db.close();
      },
    };
  },
};
