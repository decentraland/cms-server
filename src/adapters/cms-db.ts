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
  q?: string | null
  limit: number
  skip: number
}

/** `<em>`-wrapped snippets produced by ts_headline when a search query is supplied. */
export interface SearchHighlight {
  title?: string
  description?: string
  body?: string
}

/** An Entry optionally annotated with FTS rank/highlight metadata when `q` is present. */
export type ListedEntry = Entry & { _rank?: number; _highlight?: SearchHighlight }

/**
 * ts_headline always returns a string — if the query doesn't match the field it returns
 * the first fragment of the raw text with no markup. A "highlight" without `<em>` would
 * mislead consumers, so we only treat a snippet as a highlight when the tag is present.
 */
function asHighlight(snippet: string | null): string | undefined {
  if (snippet && snippet.includes('<em>')) return snippet
  return undefined
}

/** Result of a blog listing query. */
export interface ListResult {
  items: ListedEntry[]
  total: number
}

/** Per-locale lookup for the text search config and column names used for FTS + fuzzy match. */
const LOCALE_FTS: Record<string, { config: string; tsvector: string; text: string } | undefined> = {
  'en-US': { config: 'english', tsvector: 'search_vector_en_us', text: 'search_text_en_us' },
  es: { config: 'spanish', tsvector: 'search_vector_es', text: 'search_text_es' },
  zh: { config: 'simple', tsvector: 'search_vector_zh', text: 'search_text_zh' }
}

/**
 * Minimum word_similarity (pg_trgm) required for a row to be considered a fuzzy match.
 * 0.4 catches typical single-character typos on short words (e.g. "partyy" → "party",
 * "rusti" → "rust") while keeping multi-word AND semantics intact — at lower thresholds
 * a query like "dance party" would fuzzy-match rows that contain only "participate".
 */
const FUZZY_SIMILARITY_THRESHOLD = 0.4

/**
 * Minimum raw query length to apply fuzzy matching. Short queries (≤3 chars) include
 * most English/Spanish stopwords ("the", "and", "or", "is", "un", "el") — those have
 * trigram similarity ≈ 1.0 against almost any text that contains them, which floods
 * results with irrelevant hits. FTS correctly drops stopwords and prefix-matches real
 * tokens, so short queries rely on FTS alone; fuzzy only kicks in once there's enough
 * query length for typos to be a real concern.
 */
const FUZZY_MIN_QUERY_LENGTH = 4

/**
 * Sanitizes a user-supplied search string and converts it into a `to_tsquery`-compatible
 * prefix query. Returns `null` if the input contains no usable tokens.
 * Each whitespace-separated token becomes a prefix term joined by `&`, e.g. `"party time"`
 * → `"party:* & time:*"`, matching Algolia's prefix-search UX.
 */
export function buildPrefixTsQuery(raw: string): string | null {
  const sanitized = raw.normalize('NFC').replace(/[^\p{L}\p{N}\s]/gu, ' ')
  const tokens = sanitized.split(/\s+/).filter((t) => t.length > 0)
  if (tokens.length === 0) return null
  return tokens.map((t) => `${t}:*`).join(' & ')
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
    const { locale, slug, category, author, q, limit, skip } = opts
    const tsqueryString = q ? buildPrefixTsQuery(q) : null

    if (tsqueryString && q) {
      return listBlogPostsWithSearch(space, environment, opts, tsqueryString, q)
    }

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

  async function listBlogPostsWithSearch(
    space: string,
    environment: string,
    opts: ListBlogOptions,
    tsqueryString: string,
    rawQuery: string
  ): Promise<ListResult> {
    const { locale, slug, category, author, limit, skip } = opts
    const fts = LOCALE_FTS[locale]
    if (!fts) {
      // Unknown locale: return an empty result set rather than crashing.
      return { items: [], total: 0 }
    }
    const { config, tsvector, text: textCol } = fts

    // Disable fuzzy matching on short queries by passing an empty string as the fuzzy
    // probe: word_similarity('', anything) returns 0, which is below the threshold, so
    // every fuzzy OR-clause short-circuits to FALSE and the row is selected by FTS alone.
    // This keeps the SQL shape (and prepared-statement cache entry) stable regardless of
    // query length.
    const fuzzyProbe = rawQuery.length >= FUZZY_MIN_QUERY_LENGTH ? rawQuery : ''

    // Always join the post's referenced author/category (by id) so their search vectors
    // and headline text are available. A second pair of joins (`cat_slug`, `auth_slug`)
    // supports the existing category= / author= slug filters without breaking them.
    const fromClause = `
    cms_blog_posts bp
    LEFT JOIN cms_blog_authors bp_auth
      ON bp_auth.space = bp.space AND bp_auth.environment = bp.environment AND bp_auth.id = bp.author_id
    LEFT JOIN cms_blog_categories bp_cat
      ON bp_cat.space = bp.space AND bp_cat.environment = bp.environment AND bp_cat.id = bp.category_id
    LEFT JOIN cms_blog_categories cat_slug
      ON $3::text IS NOT NULL
      AND cat_slug.space = $1 AND cat_slug.environment = $2
      AND cat_slug.slug @> jsonb_build_object($4::text, $3::text)
    LEFT JOIN cms_blog_authors auth_slug
      ON $5::text IS NOT NULL
      AND auth_slug.space = $1 AND auth_slug.environment = $2
      AND auth_slug.slug @> jsonb_build_object($4::text, $5::text)`

    // A row qualifies if the tsquery hits any of the three vectors OR the raw query is
    // trigram-similar to any of the three searchable text fields (typo tolerance).
    const whereClause = `
    bp.space = $1 AND bp.environment = $2
    AND ($3::text IS NULL OR bp.category_id = cat_slug.id)
    AND ($5::text IS NULL OR bp.author_id = auth_slug.id)
    AND ($6::text IS NULL OR bp.slug @> jsonb_build_object($4::text, $6::text))
    AND (
      bp.${tsvector} @@ tq
      OR bp_auth.${tsvector} @@ tq
      OR bp_cat.${tsvector} @@ tq
      OR word_similarity($8::text, coalesce(bp.${textCol}, '')) >= ${FUZZY_SIMILARITY_THRESHOLD}
      OR word_similarity($8::text, coalesce(bp_auth.${textCol}, '')) >= ${FUZZY_SIMILARITY_THRESHOLD}
      OR word_similarity($8::text, coalesce(bp_cat.${textCol}, '')) >= ${FUZZY_SIMILARITY_THRESHOLD}
    )`

    const params = [
      space,
      environment,
      category || null,
      locale,
      author || null,
      slug || null,
      tsqueryString,
      fuzzyProbe
    ]

    // ts_rank dominates when the FTS predicate matches; the trigram term is scaled down
    // so exact/prefix hits always outrank typo-only hits, but typo hits still get a signal.
    const rankExpr = `
      CASE WHEN bp.${tsvector} @@ tq THEN ts_rank(bp.${tsvector}, tq) ELSE 0 END
      + CASE WHEN bp_auth.${tsvector} @@ tq THEN 0.5 * ts_rank(bp_auth.${tsvector}, tq) ELSE 0 END
      + CASE WHEN bp_cat.${tsvector} @@ tq THEN 0.5 * ts_rank(bp_cat.${tsvector}, tq) ELSE 0 END
      + 0.3 * GREATEST(
          word_similarity($8::text, coalesce(bp.${textCol}, '')),
          word_similarity($8::text, coalesce(bp_auth.${textCol}, '')),
          word_similarity($8::text, coalesce(bp_cat.${textCol}, ''))
        )`

    const headlineOpts = 'StartSel=<em>, StopSel=</em>, MaxFragments=2, MaxWords=20, MinWords=5'
    const headlineTitleOpts = 'StartSel=<em>, StopSel=</em>, MaxFragments=1, MaxWords=30, MinWords=1, HighlightAll=TRUE'

    // One round-trip. count(*) OVER () returns the pre-LIMIT total on every row, so we
    // avoid issuing a second identical query just to get the count — the WHERE clause,
    // joins, tsquery materialization and per-row rank are computed once.
    const itemsResult = await pool().query({
      text: `WITH q AS (SELECT to_tsquery('${config}', $7) AS tq)
             SELECT
               bp.content,
               (${rankExpr}) AS rank,
               count(*) OVER () AS total,
               ts_headline('${config}',
                 coalesce(bp.content->'fields'->'title'->>$4::text, ''),
                 tq,
                 '${headlineTitleOpts}'
               ) AS highlight_title,
               ts_headline('${config}',
                 coalesce(bp.content->'fields'->'description'->>$4::text, ''),
                 tq,
                 '${headlineOpts}'
               ) AS highlight_description,
               ts_headline('${config}',
                 cms_rich_text_to_plain(bp.content->'fields'->'body'->$4::text),
                 tq,
                 '${headlineOpts}'
               ) AS highlight_body
             FROM ${fromClause} CROSS JOIN q
             WHERE ${whereClause}
             ORDER BY rank DESC, bp.published_date_sort DESC NULLS LAST
             OFFSET $9 LIMIT $10`,
      values: [...params, skip, limit],
      name: `list_posts_search_${locale}`
    })

    const items: ListedEntry[] = itemsResult.rows.map(
      (r: {
        content: Entry
        rank: string | number
        highlight_title: string | null
        highlight_description: string | null
        highlight_body: string | null
      }) => {
        const title = asHighlight(r.highlight_title)
        const description = asHighlight(r.highlight_description)
        const body = asHighlight(r.highlight_body)
        const listed: ListedEntry = {
          ...r.content,
          _rank: typeof r.rank === 'string' ? parseFloat(r.rank) : r.rank
        }
        if (title || description || body) {
          listed._highlight = {}
          if (title) listed._highlight.title = title
          if (description) listed._highlight.description = description
          if (body) listed._highlight.body = body
        }
        return listed
      }
    )

    // When LIMIT truncates to 0 rows we still need the pre-limit total — that's what the
    // second query (below) is for. We only hit it in the offset-past-the-end case, so in
    // the common path this branch is free.
    let total: number
    if (itemsResult.rows.length > 0) {
      total = parseInt(itemsResult.rows[0].total as string, 10)
    } else {
      const countResult = await pool().query({
        text: `WITH q AS (SELECT to_tsquery('${config}', $7) AS tq)
               SELECT count(*) AS total FROM ${fromClause} CROSS JOIN q WHERE ${whereClause}`,
        values: params,
        name: `list_posts_search_count_${locale}`
      })
      total = parseInt(countResult.rows[0].total, 10)
    }

    return { items, total }
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
