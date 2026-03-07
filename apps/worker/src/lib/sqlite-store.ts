import { TABLE_NAMES } from "@sentinel/shared";
import { getKysely } from "@sentinel/shared/db/sqlite.js";

export interface TornItemRow {
  item_id: number;
  name: string;
  image: string | null;
  type: string | null;
  category_id?: number | null;
  effect?: string | null;
  energy_gain?: number | null;
  happy_gain?: number | null;
  cooldown?: string | null;
  value?: number | null;
}

export async function upsertTornItems(items: TornItemRow[]): Promise<void> {
  if (!items.length) {
    return;
  }

  const db = getKysely();

  await db.transaction().execute(async (trx) => {
    for (const item of items) {
      await trx
        .insertInto(TABLE_NAMES.TORN_ITEMS)
        .values({
          item_id: item.item_id,
          name: item.name,
          image: item.image ?? null,
          type: item.type ?? null,
          category_id: item.category_id ?? null,
          effect: item.effect ?? null,
          energy_gain: item.energy_gain ?? null,
          happy_gain: item.happy_gain ?? null,
          cooldown: item.cooldown ?? null,
          value: item.value ?? null,
        })
        .onConflict((oc) =>
          oc.column("item_id").doUpdateSet({
            name: item.name,
            image: item.image ?? null,
            type: item.type ?? null,
            category_id: item.category_id ?? null,
            effect: item.effect ?? null,
            energy_gain: item.energy_gain ?? null,
            happy_gain: item.happy_gain ?? null,
            cooldown: item.cooldown ?? null,
            value: item.value ?? null,
          }),
        )
        .execute();
    }
  });
}

/**
 * Insert category names if they do not exist yet. Existing rows are preserved.
 */
export async function syncTornCategories(
  categoryNames: string[],
): Promise<void> {
  if (!categoryNames.length) {
    return;
  }

  const db = getKysely();
  const uniqueNames = Array.from(new Set(categoryNames));

  const existing = await db
    .selectFrom(TABLE_NAMES.TORN_CATEGORIES)
    .select(["name"])
    .execute();

  const existingNames = new Set(existing.map((row) => row.name));
  const newNames = uniqueNames.filter((name) => !existingNames.has(name));

  if (!newNames.length) {
    return;
  }

  await db.transaction().execute(async (trx) => {
    for (const name of newNames) {
      await trx
        .insertInto(TABLE_NAMES.TORN_CATEGORIES as never)
        .values({ name } as never)
        .execute();
    }
  });
}

export async function getTornCategoryNameToIdMap(): Promise<
  Map<string, number>
> {
  const db = getKysely();
  const rows = await db
    .selectFrom(TABLE_NAMES.TORN_CATEGORIES)
    .select(["id", "name"])
    .execute();

  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.name, row.id);
  }

  return map;
}
