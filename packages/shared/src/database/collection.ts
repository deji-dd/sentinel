import { EventEmitter } from "events";
import { SentinelDatabase } from "./engine";

export type BaseDocument = { id: string; [key: string]: any };

/**
 * Generic NoSQL document collection wrapper for SQLite.
 * Provides a schema-less interface over a rigid two-column SQLite table,
 * equipped with an EventEmitter for real-time memory subscriptions.
 *
 * @template T Document structure strictly extending BaseDocument.
 */
export class Collection<T extends BaseDocument> extends EventEmitter {
  private db: SentinelDatabase["db"];
  public readonly tableName: string;

  private stmtInsert: any;
  private stmtFindOne: any;

  /**
   * @param engine The optimized SentinelDatabase connection pool.
   * @param tableName Base name of the collection (auto-prefixed with 'nosql_').
   * @param indexedFields Optional array of fields to automatically index via virtual columns.
   */
  constructor(
    engine: SentinelDatabase, 
    tableName: string,
    private indexedFields: Array<{ key: string, type: "TEXT" | "INTEGER" | "REAL" }> = []
  ) {
    super();
    this.setMaxListeners(0);
    this.db = engine.db;
    this.tableName = `nosql_${tableName}`;

    this.initializeTable();
    this.initializeIndexes();
    this.prepareStatements();
  }

  private initializeTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      )
    `);
  }

  private initializeIndexes() {
    if (!this.indexedFields || this.indexedFields.length === 0) return;

    const columns = this.db.pragma(`table_info(${this.tableName})`) as any[];
    const existingColumns = new Set(columns.map(c => c.name));

    for (const field of this.indexedFields) {
      if (!existingColumns.has(field.key)) {
        try {
          this.db.exec(`
            ALTER TABLE ${this.tableName} 
            ADD COLUMN ${field.key} ${field.type} GENERATED ALWAYS AS (data ->> '$.${field.key}') VIRTUAL
          `);
        } catch (err: any) {
          // Ignore duplicate column errors caused by multiprocess startup race conditions
          if (!err.message.includes("duplicate column name")) {
            throw err;
          }
        }
      }

      const safeSuffix = field.key.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+/, "");
      const indexName = `idx_${this.tableName}_${safeSuffix}`;

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS ${indexName} 
        ON ${this.tableName} (${field.key})
      `);
    }
  }

  private prepareStatements() {
    this.stmtInsert = this.db.prepare(
      `INSERT OR REPLACE INTO ${this.tableName} (id, data) VALUES (@id, @data)`,
    );
    this.stmtFindOne = this.db.prepare(
      `SELECT data FROM ${this.tableName} WHERE id = @id`,
    );
  }

  /**
   * Inserts or completely replaces a single document based on its `id`.
   * * @param doc The document to insert.
   * @returns The inserted document.
   * @emits change Fired immediately after the disk write.
   */
  public insertOne(doc: T): T {
    this.stmtInsert.run({
      id: doc.id,
      data: JSON.stringify(doc),
    });

    this.emit("change", doc);
    return doc;
  }
  /**
   * Updates an existing document. Functionally identical to insertOne (which upserts),
   * but provided for semantic clarity.
   * * @param doc The document to update.
   * @returns The updated document.
   * @emits change Fired immediately after the disk write.
   */
  public update(doc: T): T {
    return this.insertOne(doc);
  }


  /**
   * Executes a high-speed, transactional bulk insert.
   * * @param docs Array of documents to insert.
   * @returns The inserted array of documents.
   * @emits batch_change Fired after the entire transaction commits.
   */
  public insertMany(docs: T[]): T[] {
    const insertTx = this.db.transaction((items: T[]) => {
      for (const item of items) {
        this.stmtInsert.run({
          id: item.id,
          data: JSON.stringify(item),
        });
      }
    });

    insertTx(docs);
    this.emit("batch_change", docs);
    return docs;
  }

  /**
   * Retrieves a single document by its primary key.
   * * @param id The unique document identifier.
   * @returns The parsed document or null if not found.
   */
  public findOne(id: string): T | null {
    const row = this.stmtFindOne.get({ id }) as { data: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.data) as T;
  }

  /**
   * Searches the collection using exact-match property constraints.
   * * @param filter An object containing key-value pairs to match against the JSON document.
   * @returns Array of matching documents.
   */
  public find(filter: Partial<T>): T[] {
    const keys = Object.keys(filter);

    if (keys.length === 0) {
      const rows = this.db
        .prepare(`SELECT data FROM ${this.tableName}`)
        .all() as { data: string }[];
      return rows.map((r) => JSON.parse(r.data));
    }

    const whereClauses = keys
      .map((key) => `json_extract(data, '$.${key}') = ?`)
      .join(" AND ");
    const values = keys.map((key) => filter[key as keyof T]);

    const query = `SELECT data FROM ${this.tableName} WHERE ${whereClauses}`;
    const rows = this.db.prepare(query).all(...values) as { data: string }[];

    return rows.map((r) => JSON.parse(r.data));
  }

  /**
   * Creates a functional B-Tree index over a nested JSON property to optimize lookups.
   * * @param jsonPath The SQLite json_extract path (e.g., '$.metadata.lastSeen').
   * @param type The storage class to cast the value to for index sorting.
   */
  public createFieldIndex(
    jsonPath: string,
    type: "TEXT" | "INTEGER" | "REAL" = "TEXT",
  ) {
    const safeSuffix = jsonPath
      .replace(/[^a-zA-Z0-9]/g, "_")
      .replace(/^_+/, "");
    const indexName = `idx_${this.tableName}_${safeSuffix}`;

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS ${indexName} 
      ON ${this.tableName} (CAST(json_extract(data, '${jsonPath}') AS ${type}))
    `);
  }

  /**
   * Prunes old documents based on a numeric timestamp nested in the JSON structure.
   * * @param days The age threshold in days.
   * @param timestampPath The SQLite json_extract path to the timestamp (e.g., '$.timestamp').
   * @returns The number of rows deleted.
   * @emits pruned Fired with the count of deleted rows.
   */
  public deleteOlderThan(days: number, timestampPath: string): number {
    const threshold = Date.now() - days * 24 * 60 * 60 * 1000;

    const stmt = this.db.prepare(`
      DELETE FROM ${this.tableName} 
      WHERE CAST(json_extract(data, '${timestampPath}') AS INTEGER) < ?
    `);

    const result = stmt.run(threshold);

    this.emit("pruned", result.changes);
    return result.changes;
  }

  /**
   * Retrieves all documents, optionally filtering them in-memory using a predicate function.
   * Highly optimized for complex time/math comparisons that are difficult to write in SQLite.
   * * @param predicate Optional callback to filter documents.
   * @returns Array of matching documents.
   */
  public findAll(predicate?: (doc: T) => boolean): T[] {
    const rows = this.db
      .prepare(`SELECT data FROM ${this.tableName}`)
      .all() as { data: string }[];
    const docs = rows.map((r) => JSON.parse(r.data) as T);
    return predicate ? docs.filter(predicate) : docs;
  }

  /**
   * Deletes a single document by its primary key.
   * * @param id The unique document identifier.
   * @returns True if a document was deleted, false otherwise.
   * @emits delete Fired immediately after the disk write.
   */
  public delete(id: string): boolean {
    const result = this.db
      .prepare(`DELETE FROM ${this.tableName} WHERE id = ?`)
      .run(id);

    if (result.changes > 0) {
      this.emit("delete", id);
      return true;
    }
    return false;
  }

  /**
   * Deletes multiple documents based on exact-match property constraints.
   * * @param filter An object containing key-value pairs to match against the JSON document.
   * @returns The number of documents deleted.
   * @emits batch_delete Fired with the count of deleted rows.
   */
  public deleteManyBy(filter: Partial<T>): number {
    const keys = Object.keys(filter);

    if (keys.length === 0) {
      const result = this.db.prepare(`DELETE FROM ${this.tableName}`).run();
      if (result.changes > 0) {
        this.emit("batch_delete", result.changes);
      }
      return result.changes;
    }

    const whereClauses = keys
      .map((key) => `json_extract(data, '$.${key}') = ?`)
      .join(" AND ");
    const values = keys.map((key) => filter[key as keyof T]);

    const query = `DELETE FROM ${this.tableName} WHERE ${whereClauses}`;
    const result = this.db.prepare(query).run(...values);

    if (result.changes > 0) {
      this.emit("batch_delete", result.changes);
    }
    return result.changes;
  }

  /**
   * Retrieves the first document that matches a given predicate function.
   * * @param predicate Callback to evaluate each document.
   * @returns The matching document, or null if not found.
   */
  public findFirst(predicate: (doc: T) => boolean): T | null {
    // Reuse the highly optimized JSON extraction from findAll
    const docs = this.findAll();
    return docs.find(predicate) || null;
  }
}
