import Database from "better-sqlite3";
import { getDB } from "@sentinel/shared/db/sqlite.js";

class QueryBuilder implements PromiseLike<{ data: any; error: any }> {
  private sqliteDb: Database.Database;
  private tableName: string;
  private selectFields: string[] = [];
  private whereConditions: Array<{
    column: string;
    operator: string;
    value: any;
  }> = [];
  private inConditions: Array<{ column: string; values: any[] }> = [];
  private updates: Record<string, any> = {};
  private isUpdate = false;
  private isDelete = false;
  private isSingle = false;
  private isMaybeSingle = false;

  constructor(sqliteDb: Database.Database, tableName: string) {
    this.sqliteDb = sqliteDb;
    this.tableName = tableName;
  }

  select(fields: string | string[]): this {
    if (typeof fields === "string") {
      this.selectFields = fields.split(",").map((f) => f.trim());
    } else {
      this.selectFields = fields;
    }
    return this;
  }

  eq(column: string, value: any): this {
    this.whereConditions.push({ column, operator: "=", value });
    return this;
  }

  neq(column: string, value: any): this {
    this.whereConditions.push({ column, operator: "!=", value });
    return this;
  }

  gt(column: string, value: any): this {
    this.whereConditions.push({ column, operator: ">", value });
    return this;
  }

  gte(column: string, value: any): this {
    this.whereConditions.push({ column, operator: ">=", value });
    return this;
  }

  lt(column: string, value: any): this {
    this.whereConditions.push({ column, operator: "<", value });
    return this;
  }

  lte(column: string, value: any): this {
    this.whereConditions.push({ column, operator: "<=", value });
    return this;
  }

  is(column: string, value: null): this {
    if (value === null) {
      this.whereConditions.push({ column, operator: "IS NULL", value: null });
    } else {
      this.whereConditions.push({
        column,
        operator: "IS NOT NULL",
        value: null,
      });
    }
    return this;
  }

  in(column: string, values: any[]): this {
    this.inConditions.push({ column, values });
    return this;
  }

  update(values: Record<string, any>): this {
    this.updates = values;
    this.isUpdate = true;
    return this;
  }

  delete(): this {
    this.isDelete = true;
    return this;
  }

  single(): this {
    this.isSingle = true;
    return this;
  }

  maybeSingle(): this {
    this.isMaybeSingle = true;
    return this;
  }

  private execute(): Promise<{ data: any; error: any }> {
    return Promise.resolve().then(() => {
      try {
        if (this.isUpdate) {
          return this.executeUpdate();
        }
        if (this.isDelete) {
          return this.executeDelete();
        }
        return this.executeSelect();
      } catch (error) {
        return { data: null, error };
      }
    });
  }

  private executeSelect(): { data: any; error: any } {
    const fields =
      this.selectFields.length > 0 ? this.selectFields.join(", ") : "*";
    let query = `SELECT ${fields} FROM ${this.tableName}`;
    const params: any[] = [];

    if (this.whereConditions.length > 0 || this.inConditions.length > 0) {
      const conditions: string[] = [];

      for (const cond of this.whereConditions) {
        if (cond.operator.includes("NULL")) {
          conditions.push(`${cond.column} ${cond.operator}`);
        } else {
          conditions.push(`${cond.column} ${cond.operator} ?`);
          params.push(cond.value);
        }
      }

      for (const inCond of this.inConditions) {
        const placeholders = inCond.values.map(() => "?").join(",");
        conditions.push(`${inCond.column} IN (${placeholders})`);
        params.push(...inCond.values);
      }

      query += ` WHERE ${conditions.join(" AND ")}`;
    }

    const stmt = this.sqliteDb.prepare(query);
    const results = stmt.all(...params) as any[];

    if (this.isSingle) {
      if (results.length === 0) {
        throw new Error("No rows found and .single() was called");
      }
      return { data: results[0], error: null };
    }

    if (this.isMaybeSingle) {
      return { data: results.length > 0 ? results[0] : null, error: null };
    }

    return { data: results, error: null };
  }

  private executeUpdate(): { data: any; error: any } {
    const updateKeys = Object.keys(this.updates);
    const setClause = updateKeys.map((key) => `${key} = ?`).join(", ");
    const params: any[] = updateKeys.map((key) => this.updates[key]);

    let query = `UPDATE ${this.tableName} SET ${setClause}`;

    if (this.whereConditions.length > 0 || this.inConditions.length > 0) {
      const conditions: string[] = [];

      for (const cond of this.whereConditions) {
        if (cond.operator.includes("NULL")) {
          conditions.push(`${cond.column} ${cond.operator}`);
        } else {
          conditions.push(`${cond.column} ${cond.operator} ?`);
          params.push(cond.value);
        }
      }

      for (const inCond of this.inConditions) {
        const placeholders = inCond.values.map(() => "?").join(",");
        conditions.push(`${inCond.column} IN (${placeholders})`);
        params.push(...inCond.values);
      }

      query += ` WHERE ${conditions.join(" AND ")}`;
    }

    const stmt = this.sqliteDb.prepare(query);
    stmt.run(...params);

    if (this.selectFields.length > 0) {
      return this.executeSelect();
    }

    return { data: null, error: null };
  }

  private executeDelete(): { data: any; error: any } {
    let query = `DELETE FROM ${this.tableName}`;
    const params: any[] = [];

    if (this.whereConditions.length > 0 || this.inConditions.length > 0) {
      const conditions: string[] = [];

      for (const cond of this.whereConditions) {
        if (cond.operator.includes("NULL")) {
          conditions.push(`${cond.column} ${cond.operator}`);
        } else {
          conditions.push(`${cond.column} ${cond.operator} ?`);
          params.push(cond.value);
        }
      }

      for (const inCond of this.inConditions) {
        const placeholders = inCond.values.map(() => "?").join(",");
        conditions.push(`${inCond.column} IN (${placeholders})`);
        params.push(...inCond.values);
      }

      query += ` WHERE ${conditions.join(" AND ")}`;
    }

    const stmt = this.sqliteDb.prepare(query);
    stmt.run(...params);

    return { data: null, error: null };
  }

  then<TResult1, TResult2 = any>(
    onFulfilled?:
      | ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onRejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onFulfilled, onRejected);
  }
}

class SQLiteSupabaseCompat {
  private sqliteDb: Database.Database;

  constructor() {
    this.sqliteDb = getDB();
  }

  from(tableName: string) {
    const builder = new QueryBuilder(this.sqliteDb, tableName);

    const wrapBuilder = (): any => ({
      insert: async (records: Record<string, any> | Record<string, any>[]) => {
        const recordsArray = Array.isArray(records) ? records : [records];
        try {
          for (const record of recordsArray) {
            const columns = Object.keys(record);
            const placeholders = columns.map(() => "?").join(", ");
            const values = columns.map((col) => record[col]);
            const sql = `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${placeholders})`;
            this.sqliteDb.prepare(sql).run(...values);
          }
          return wrapBuilder();
        } catch (error) {
          return { data: null, error } as any;
        }
      },

      upsert: async (records: Record<string, any> | Record<string, any>[]) => {
        const recordsArray = Array.isArray(records) ? records : [records];
        try {
          for (const record of recordsArray) {
            const columns = Object.keys(record);
            const placeholders = columns.map(() => "?").join(", ");
            const setClause = columns
              .map((col) => `${col} = excluded.${col}`)
              .join(", ");
            const values = columns.map((col) => record[col]);
            const sql = `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${placeholders}) ON CONFLICT DO UPDATE SET ${setClause}`;
            this.sqliteDb.prepare(sql).run(...values);
          }
          return { data: recordsArray, error: null };
        } catch (error) {
          return { data: null, error };
        }
      },

      select: (fields?: string | string[]) => {
        builder.select(fields || "*");
        return wrapBuilder();
      },

      update: (values: Record<string, any>) => {
        builder.update(values);
        return wrapBuilder();
      },

      delete: () => {
        builder.delete();
        return wrapBuilder();
      },

      eq: (column: string, value: any) => {
        builder.eq(column, value);
        return wrapBuilder();
      },

      is: (column: string, value: null) => {
        builder.is(column, value);
        return wrapBuilder();
      },

      in: (column: string, values: any[]) => {
        builder.in(column, values);
        return wrapBuilder();
      },

      single: () => {
        builder.single();
        return wrapBuilder();
      },

      maybeSingle: () => {
        builder.maybeSingle();
        return wrapBuilder();
      },

      then: builder.then.bind(builder),
    });

    return wrapBuilder();
  }

  async rpc(
    functionName: string,
    params: Record<string, any> = {},
  ): Promise<{ data: any; error: any }> {
    try {
      if (functionName === "sentinel_finalize_reaction_role_message") {
        return this.finalizeReactionRoleMessage(
          params.p_record_id,
          params.p_new_message_id,
        );
      }
      throw new Error(`Unknown RPC function: ${functionName}`);
    } catch (error) {
      return { data: null, error };
    }
  }

  private finalizeReactionRoleMessage(recordId: number, newMessageId: string) {
    const transaction = this.sqliteDb.transaction(() => {
      const messageRecord = this.sqliteDb
        .prepare(
          "SELECT message_id FROM sentinel_reaction_role_messages WHERE id = ?",
        )
        .get(recordId) as { message_id: string } | undefined;

      if (!messageRecord) {
        throw new Error(
          `Reaction role message record not found for id=${recordId}`,
        );
      }

      const oldMessageId = messageRecord.message_id;

      const updateMappingsStmt = this.sqliteDb
        .prepare(
          "UPDATE sentinel_reaction_role_mappings SET message_id = ? WHERE message_id = ?",
        )
        .run(newMessageId, oldMessageId);

      const updateMessageStmt = this.sqliteDb
        .prepare(
          "UPDATE sentinel_reaction_role_messages SET message_id = ?, updated_at = ? WHERE id = ?",
        )
        .run(newMessageId, new Date().toISOString(), recordId);

      return {
        updated_message_rows: updateMessageStmt.changes,
        updated_mapping_rows: updateMappingsStmt.changes,
      };
    });

    const result = transaction();
    return { data: [result], error: null };
  }
}

const isDev = process.env.NODE_ENV === "development";
console.log(
  `[DB] Connected to ${isDev ? "local" : "production"} SQLite database`,
);

export const db = new SQLiteSupabaseCompat();
