import type { SQLiteDatabase } from 'expo-sqlite';

import type { Category, CategoryType, NeedWant } from '@/types/models';
import { createId, nowIso } from '@/utils/ids';

import { DuplicateNameError, isUniqueConstraintViolation } from '../errors';

/**
 * Reads and writes categories.
 *
 * Categories are never deleted once they might have been used: they are
 * deactivated instead, so historical transactions keep a real category.
 * `ON DELETE RESTRICT` in the schema makes the database refuse the delete too,
 * not just the screens.
 */

/**
 * The row shape as SQLite returns it. Kept separate from the domain type so
 * the mapping (snake_case, 0/1 flags, text enums) is explicit and lives in
 * exactly one function per table.
 */
type CategoryRow = {
  id: string;
  name: string;
  type: string;
  icon: string | null;
  default_need_want: string | null;
  is_default: number;
  is_active: number;
  sort_order: number;
  created_at: string;
};

const CATEGORY_COLUMNS = `
  id, name, type, icon, default_need_want, is_default, is_active, sort_order, created_at
`;

function rowToCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    // Casts are safe: the column CHECK constraints allow only these values.
    type: row.type as CategoryType,
    icon: row.icon,
    defaultNeedWant: row.default_need_want as NeedWant | null,
    isDefault: row.is_default === 1,
    isActive: row.is_active === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

export type ListCategoriesOptions = {
  /** Restrict to categories usable by this transaction type. */
  type?: CategoryType;
  /** Include deactivated categories (needed by the category management screen). */
  includeInactive?: boolean;
};

/**
 * Lists categories, oldest first within each type.
 *
 * Active-only by default: a deactivated category is one the user retired, so
 * it must not appear in the "add transaction" picker.
 */
export async function listCategories(
  db: SQLiteDatabase,
  options: ListCategoriesOptions = {}
): Promise<Category[]> {
  const conditions: string[] = [];
  const parameters: (string | number)[] = [];

  if (options.type) {
    conditions.push('type = ?');
    parameters.push(options.type);
  }

  if (!options.includeInactive) {
    conditions.push('is_active = 1');
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await db.getAllAsync<CategoryRow>(
    `SELECT ${CATEGORY_COLUMNS}
     FROM categories
     ${whereClause}
     ORDER BY type, sort_order, name COLLATE NOCASE;`,
    parameters
  );

  return rows.map(rowToCategory);
}

/** Returns one category, or `null` when the id is unknown. */
export async function getCategoryById(db: SQLiteDatabase, id: string): Promise<Category | null> {
  const row = await db.getFirstAsync<CategoryRow>(
    `SELECT ${CATEGORY_COLUMNS} FROM categories WHERE id = ?;`,
    [id]
  );
  return row ? rowToCategory(row) : null;
}

export type CreateCategoryInput = {
  name: string;
  type: CategoryType;
  icon?: string | null;
  /** Suggestion only, and meaningful for expenses alone. */
  defaultNeedWant?: NeedWant | null;
};

/**
 * Creates a category.
 *
 * Throws `DuplicateNameError` when the name is already used within the same
 * type. The check is case- and space-insensitive because the schema's unique
 * index compares `lower(trim(name))` — so "Food" and " food " would collide in
 * the database anyway, and it is better to say so plainly.
 */
export async function createCategory(
  db: SQLiteDatabase,
  input: CreateCategoryInput
): Promise<Category> {
  const id = createId();
  const timestamp = nowIso();

  // Only expenses carry a Need/Want suggestion; anything else is dropped here
  // rather than failing on a CHECK constraint with a cryptic message.
  const defaultNeedWant = input.type === 'expense' ? (input.defaultNeedWant ?? null) : null;

  try {
    await db.runAsync(
      `INSERT INTO categories
         (id, name, type, icon, default_need_want, is_default, is_active, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?);`,
      [
        id,
        input.name.trim(),
        input.type,
        input.icon ?? null,
        defaultNeedWant,
        await getNextSortOrder(db, input.type),
        timestamp,
      ]
    );
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new DuplicateNameError(`A ${input.type} category named "${input.name.trim()}"`);
    }
    throw error;
  }

  const created = await getCategoryById(db, id);
  if (!created) {
    throw new Error('The category could not be created.');
  }
  return created;
}

export type UpdateCategoryInput = {
  name?: string;
  icon?: string | null;
  defaultNeedWant?: NeedWant | null;
};

/**
 * Renames a category or changes its icon / Need-Want suggestion.
 *
 * The **type is intentionally not editable**: every transaction written against
 * this category was validated against that type. Changing it would silently
 * invalidate past records (an "expense" category suddenly holding income).
 * Retire the category and create a new one instead.
 */
export async function updateCategory(
  db: SQLiteDatabase,
  id: string,
  patch: UpdateCategoryInput
): Promise<Category> {
  const existing = await getCategoryById(db, id);
  if (!existing) {
    throw new Error('That category no longer exists.');
  }

  const nextName = patch.name === undefined ? existing.name : patch.name.trim();
  const nextIcon = patch.icon === undefined ? existing.icon : patch.icon;
  const nextDefaultNeedWant =
    patch.defaultNeedWant === undefined
      ? existing.defaultNeedWant
      : existing.type === 'expense'
        ? patch.defaultNeedWant
        : null;

  try {
    await db.runAsync(
      `UPDATE categories
         SET name = ?, icon = ?, default_need_want = ?
       WHERE id = ?;`,
      [nextName, nextIcon, nextDefaultNeedWant, id]
    );
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new DuplicateNameError(`A ${existing.type} category named "${nextName}"`);
    }
    throw error;
  }

  const updated = await getCategoryById(db, id);
  if (!updated) {
    throw new Error('The category could not be updated.');
  }
  return updated;
}

/**
 * Activates or retires a category.
 *
 * Retiring the last active category of a type is refused: it would leave the
 * "add transaction" form with nothing to select, which reads as a bug to the
 * user. Deleting is not offered at all — historical transactions reference it.
 */
export async function setCategoryActive(
  db: SQLiteDatabase,
  id: string,
  isActive: boolean
): Promise<Category> {
  const existing = await getCategoryById(db, id);
  if (!existing) {
    throw new Error('That category no longer exists.');
  }

  if (!isActive) {
    const activeCount = await db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM categories WHERE type = ? AND is_active = 1;',
      [existing.type]
    );

    if ((activeCount?.count ?? 0) <= 1) {
      throw new Error(
        `"${existing.name}" is the only active ${existing.type} category. ` +
          'Create another one before retiring this.'
      );
    }
  }

  await db.runAsync('UPDATE categories SET is_active = ? WHERE id = ?;', [isActive ? 1 : 0, id]);

  const updated = await getCategoryById(db, id);
  if (!updated) {
    throw new Error('The category could not be updated.');
  }
  return updated;
}

/** Appends new categories after the existing ones of the same type. */
async function getNextSortOrder(db: SQLiteDatabase, type: CategoryType): Promise<number> {
  const row = await db.getFirstAsync<{ next: number | null }>(
    'SELECT MAX(sort_order) + 1 AS next FROM categories WHERE type = ?;',
    [type]
  );
  return row?.next ?? 0;
}
