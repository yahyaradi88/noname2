import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Room } from "../../packages/shared/types.js";
export class Store {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:")
      mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(readFileSync(resolve("migrations/001_initial.sql"), "utf8"));
  }
  load(): Room[] {
    return this.db
      .prepare("SELECT state FROM rooms")
      .all()
      .map((r) => JSON.parse(String(r.state)) as Room);
  }
  save(room: Room) {
    room.updatedAt = Date.now();
    this.db
      .prepare(
        "INSERT INTO rooms(code,state,updated_at) VALUES(?,?,?) ON CONFLICT(code) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at",
      )
      .run(room.code, JSON.stringify(room), room.updatedAt);
  }
  delete(code: string) {
    this.db.prepare("DELETE FROM rooms WHERE code=?").run(code);
  }
  session(hash: string): boolean {
    return !!this.db
      .prepare("SELECT hash FROM sessions WHERE hash=? AND expires_at>?")
      .get(hash, Date.now());
  }
  addSession(hash: string) {
    this.db
      .prepare("INSERT INTO sessions(hash,expires_at) VALUES(?,?)")
      .run(hash, Date.now() + 7 * 86400000);
  }
  clean() {
    this.db.prepare("DELETE FROM sessions WHERE expires_at<?").run(Date.now());
  }
  close() {
    this.db.close();
  }
}
