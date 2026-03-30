import SQL from 'sql-template-strings'
import type { AppComponents } from '../types'
import type { BlogContentTypeId } from '../types/contentful'
import type { Entry } from 'contentful'

const BULK_BATCH_SIZE = 50

/** Options for blog listing queries. */
export interface ListBlogOptions {
  locale: string
  slug?: string | null
  category?: string | null
  author?: string | null
  limit: number
  skip: number
}

/** Result of a blog listing query. */
export interface ListResult {
  items: Entry[]
  total: number
}

/** Minimal database client interface used for transactional queries. */
export interface DatabaseClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>
}

/** The CMS database component interface for all CMS-specific PostgreSQL operations. */
export interface ICmsDatabaseComponent {
  upsertEntry(space: string, environment: string, entryType: string, id: string, content: object): Promise<void>
  deleteEntry(space: string, environment: string, entryType: string, id: string): Promise<void>
  findEntryContent(
    space: string,
    environment: string,
    entryType: string,
    id: string
  ): Promise<{ content: Entry; updatedAt: string } | null>
  upsertBlogEntry(
    space: string,
    environment: string,
    contentType: BlogContentTypeId,
    entry: Entry,
    client?: DatabaseClient
  ): Promise<void>
  deleteBlogEntry(space: string, environment: string, contentType: BlogContentTypeId, id: string): Promise<void>
  listBlogPosts(space: string, environment: string, opts: ListBlogOptions): Promise<ListResult>
  listBlogCategories(space: string, environment: string, opts: ListBlogOptions): Promise<ListResult>
  listBlogAuthors(space: string, environment: string, opts: ListBlogOptions): Promise<ListResult>
  getLastSync(space: string, environment: string): Promise<Date | null>
  setLastSync(space: string, environment: string, timestamp: string, client?: DatabaseClient): Promise<void>
  bulkUpsertBlogContent(
    space: string,
    environment: string,
    contentType: BlogContentTypeId,
    entries: Entry[],
    client?: DatabaseClient
  ): Promise<void>
}

/**
 * Creates the CMS database adapter.
 * Consumes the pg component and provides CMS-specific query methods.
 * @param components - The pg and logs components.
 */
export function createCmsDatabaseComponent(components: Pick<AppComponents, 'pg' | 'logs'>): ICmsDatabaseComponent {
  const { pg } = components

  /** Access the raw pool for queries that need {text, values, name} format (prepared statements, dynamic SQL). */
  function pool() {
    return pg.getPool()
  }

  /** Per-content-type configuration for the dynamic blog table upsert. */
  interface BlogTableConfig {
    table: string
    extraColumns: string[]
    extractExtra: (fields: Record<string, unknown>) => unknown[]
  }

  function extractRefId(field: unknown): string | null {
    if (!field) return null
    const obj = field as Record<string, unknown>
    if (typeof field === 'object' && !(obj as Record<string, unknown>).sys) {
      for (const value of Object.values(obj)) {
        const id = (value as Record<string, Record<string, string>>)?.sys?.id
        if (id) return id
      }
      return null
    }
    return (obj as Record<string, Record<string, string>>)?.sys?.id ?? null
  }

  function extractPublishedDateSort(publishedDate: unknown): string | null {
    if (!publishedDate) return null
    const dateStr =
      typeof publishedDate === 'object' && (publishedDate as Record<string, string>)['en-US']
        ? (publishedDate as Record<string, string>)['en-US']
        : typeof publishedDate === 'string'
          ? publishedDate
          : null
    if (!dateStr) return null
    const d = new Date(dateStr)
    return isNaN(d.getTime()) ? null : d.toISOString()
  }

  const BLOG_TABLES: Record<BlogContentTypeId, BlogTableConfig> = {
    blog_post: {
      table: 'cms_blog_posts',
      extraColumns: ['published_date', 'published_date_sort', 'category_id', 'author_id'],
      extractExtra: (fields) => [
        JSON.stringify(fields.publishedDate ?? {}),
        extractPublishedDateSort(fields.publishedDate),
        extractRefId(fields.category),
        extractRefId(fields.author)
      ]
    },
    blog_category: {
      table: 'cms_blog_categories',
      extraColumns: [],
      extractExtra: () => []
    },
    blog_author: {
      table: 'cms_blog_authors',
      extraColumns: [],
      extractExtra: () => []
    }
  }

  async function upsertEntry(
    space: string,
    environment: string,
    entryType: string,
    id: string,
    content: object
  ): Promise<void> {
    await pg.query(
      SQL`INSERT INTO cms_entries (id, space, environment, entry_type, content, updated_at)
     VALUES (${id}, ${space}, ${environment}, ${entryType}, ${JSON.stringify(content)}, now())
     ON CONFLICT (space, environment, entry_type, id)
     DO UPDATE SET content = EXCLUDED.content, updated_at = now()`
    )
  }

  async function deleteEntry(space: string, environment: string, entryType: string, id: string): Promise<void> {
    await pg.query(
      SQL`DELETE FROM cms_entries WHERE space = ${space} AND environment = ${environment} AND entry_type = ${entryType} AND id = ${id}`
    )
  }

  async function findEntryContent(
    space: string,
    environment: string,
    entryType: string,
    id: string
  ): Promise<{ content: Entry; updatedAt: string } | null> {
    // UNION ALL across cms_entries and all blog tables — cannot use SQL template for this
    // because prepared statements with UNION ALL and shared params need raw SQL
    const result = await pool().query({
      text: `SELECT content, updated_at FROM cms_entries WHERE space = $1 AND environment = $2 AND entry_type = $3 AND id = $4
     UNION ALL
     SELECT content, updated_at FROM cms_blog_posts WHERE space = $1 AND environment = $2 AND id = $4
     UNION ALL
     SELECT content, updated_at FROM cms_blog_categories WHERE space = $1 AND environment = $2 AND id = $4
     UNION ALL
     SELECT content, updated_at FROM cms_blog_authors WHERE space = $1 AND environment = $2 AND id = $4
     LIMIT 1`,
      values: [space, environment, entryType, id],
      name: 'find_entry_content'
    })
    if (result.rows.length === 0) return null
    return { content: result.rows[0].content, updatedAt: result.rows[0].updated_at }
  }

  async function upsertBlogEntry(
    space: string,
    environment: string,
    contentType: BlogContentTypeId,
    entry: Entry,
    client?: DatabaseClient
  ): Promise<void> {
    const tableConfig = BLOG_TABLES[contentType]
    const fields = entry.fields as Record<string, unknown>

    const baseColumns = ['id', 'space', 'environment', 'slug', 'title']
    const allColumns = [...baseColumns, ...tableConfig.extraColumns, 'content', 'updated_at']

    const baseValues = [
      entry.sys.id,
      space,
      environment,
      JSON.stringify(fields.id ?? {}),
      JSON.stringify(fields.title ?? {})
    ]
    const extraValues = tableConfig.extractExtra(fields)
    const allValues = [...baseValues, ...extraValues, JSON.stringify(entry)]

    const placeholders = allColumns.map((_, i) => (i < allValues.length ? `$${i + 1}` : 'now()')).join(', ')
    const updateCols = allColumns
      .filter((col) => col !== 'id' && col !== 'space' && col !== 'environment')
      .map((col) => (col === 'updated_at' ? `${col} = now()` : `${col} = EXCLUDED.${col}`))
      .join(', ')

    const sql = `INSERT INTO ${tableConfig.table} (${allColumns.join(', ')})
     VALUES (${placeholders})
     ON CONFLICT (space, environment, id)
     DO UPDATE SET ${updateCols}`

    if (client) {
      await client.query(sql, allValues)
    } else {
      await pool().query({ text: sql, values: allValues })
    }
  }

  async function deleteBlogEntry(
    space: string,
    environment: string,
    contentType: BlogContentTypeId,
    id: string
  ): Promise<void> {
    const tableConfig = BLOG_TABLES[contentType]
    await pool().query({
      text: `DELETE FROM ${tableConfig.table} WHERE space = $1 AND environment = $2 AND id = $3`,
      values: [space, environment, id]
    })
  }

  async function listBlogPosts(space: string, environment: string, opts: ListBlogOptions): Promise<ListResult> {
    const { locale, slug, category, author, limit, skip } = opts

    const fromClause = `
    cms_blog_posts bp
    LEFT JOIN cms_blog_categories cat
      ON $3::text IS NOT NULL
      AND cat.space = $1 AND cat.environment = $2
      AND cat.slug @> jsonb_build_object($4::text, $3::text)
    LEFT JOIN cms_blog_authors auth
      ON $5::text IS NOT NULL
      AND auth.space = $1 AND auth.environment = $2
      AND auth.slug @> jsonb_build_object($4::text, $5::text)`

    const whereClause = `
    bp.space = $1 AND bp.environment = $2
    AND ($3::text IS NULL OR bp.category_id = cat.id)
    AND ($5::text IS NULL OR bp.author_id = auth.id)
    AND ($6::text IS NULL OR bp.slug @> jsonb_build_object($4::text, $6::text))`

    const params = [space, environment, category || null, locale, author || null, slug || null]

    const [countResult, itemsResult] = await Promise.all([
      pool().query({
        text: `SELECT count(*) AS total FROM ${fromClause} WHERE ${whereClause}`,
        values: params,
        name: 'list_posts_count'
      }),
      pool().query({
        text: `SELECT bp.content FROM ${fromClause}
       WHERE ${whereClause}
       ORDER BY bp.published_date_sort DESC NULLS LAST
       OFFSET $7 LIMIT $8`,
        values: [...params, skip, limit],
        name: 'list_posts_items'
      })
    ])

    return {
      items: itemsResult.rows.map((r: { content: Entry }) => r.content),
      total: parseInt(countResult.rows[0].total, 10)
    }
  }

  async function listBlogCategories(space: string, environment: string, opts: ListBlogOptions): Promise<ListResult> {
    const { locale, slug, limit, skip } = opts

    const whereClause = `space = $1 AND environment = $2
    AND ($3::text IS NULL OR slug @> jsonb_build_object($4::text, $3::text))`
    const params = [space, environment, slug || null, locale]

    const [countResult, itemsResult] = await Promise.all([
      pool().query({
        text: `SELECT count(*) AS total FROM cms_blog_categories WHERE ${whereClause}`,
        values: params,
        name: 'list_categories_count'
      }),
      pool().query({
        text: `SELECT content FROM cms_blog_categories
       WHERE ${whereClause}
       ORDER BY title->>'en-US' ASC
       OFFSET $5 LIMIT $6`,
        values: [...params, skip, limit],
        name: 'list_categories_items'
      })
    ])

    return {
      items: itemsResult.rows.map((r: { content: Entry }) => r.content),
      total: parseInt(countResult.rows[0].total, 10)
    }
  }

  async function listBlogAuthors(space: string, environment: string, opts: ListBlogOptions): Promise<ListResult> {
    const { locale, slug, limit, skip } = opts

    const whereClause = `space = $1 AND environment = $2
    AND ($3::text IS NULL OR slug @> jsonb_build_object($4::text, $3::text))`
    const params = [space, environment, slug || null, locale]

    const [countResult, itemsResult] = await Promise.all([
      pool().query({
        text: `SELECT count(*) AS total FROM cms_blog_authors WHERE ${whereClause}`,
        values: params,
        name: 'list_authors_count'
      }),
      pool().query({
        text: `SELECT content FROM cms_blog_authors
       WHERE ${whereClause}
       ORDER BY title->>'en-US' ASC
       OFFSET $5 LIMIT $6`,
        values: [...params, skip, limit],
        name: 'list_authors_items'
      })
    ])

    return {
      items: itemsResult.rows.map((r: { content: Entry }) => r.content),
      total: parseInt(countResult.rows[0].total, 10)
    }
  }

  async function getLastSync(space: string, environment: string): Promise<Date | null> {
    const result = await pg.query(
      SQL`SELECT value FROM cms_sync_metadata WHERE space = ${space} AND environment = ${environment} AND key = 'last-sync'`
    )
    if (result.rows.length === 0) return null
    return new Date(result.rows[0].value)
  }

  async function setLastSync(
    space: string,
    environment: string,
    timestamp: string,
    client?: DatabaseClient
  ): Promise<void> {
    const sql = `INSERT INTO cms_sync_metadata (space, environment, key, value, updated_at)
     VALUES ($1, $2, 'last-sync', $3, now())
     ON CONFLICT (space, environment, key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = now()`
    if (client) {
      await client.query(sql, [space, environment, timestamp])
    } else {
      await pg.query(SQL`INSERT INTO cms_sync_metadata (space, environment, key, value, updated_at)
       VALUES (${space}, ${environment}, 'last-sync', ${timestamp}, now())
       ON CONFLICT (space, environment, key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = now()`)
    }
  }

  async function bulkUpsertBlogContent(
    space: string,
    environment: string,
    contentType: BlogContentTypeId,
    entries: Entry[],
    txClient?: DatabaseClient
  ): Promise<void> {
    async function doBulkUpsert(client: DatabaseClient) {
      for (let i = 0; i < entries.length; i += BULK_BATCH_SIZE) {
        const batch = entries.slice(i, i + BULK_BATCH_SIZE)
        const values: unknown[] = []
        const placeholders: string[] = []

        for (let j = 0; j < batch.length; j++) {
          const offset = j * 4
          placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, 'Entry', $${offset + 4}, now())`)
          values.push(batch[j].sys.id, space, environment, JSON.stringify(batch[j]))
        }

        await client.query(
          `INSERT INTO cms_entries (id, space, environment, entry_type, content, updated_at)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (space, environment, entry_type, id)
         DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
          values
        )

        for (const entry of batch) {
          await upsertBlogEntry(space, environment, contentType, entry, client)
        }
      }
    }

    // If an external transaction client is provided, use it directly (caller manages the transaction).
    // Otherwise, create our own transaction.
    if (txClient) {
      await doBulkUpsert(txClient)
    } else {
      await pg.withTransaction(async (client) => doBulkUpsert(client))
    }
  }

  return {
    upsertEntry,
    deleteEntry,
    findEntryContent,
    upsertBlogEntry,
    deleteBlogEntry,
    listBlogPosts,
    listBlogCategories,
    listBlogAuthors,
    getLastSync,
    setLastSync,
    bulkUpsertBlogContent
  }
}
