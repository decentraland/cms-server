import SQL from 'sql-template-strings'
import type { IPgComponent } from '../src/types'
import type { Entry } from 'contentful'

// ─── Test Constants ──────────────────────────────────────────────────────────

export const TEST_SPACE = 'test-space'
export const TEST_ENVIRONMENT = 'master'
export const TEST_TOKEN = 'test-contentful-token'

// ─── Test Database Utilities ─────────────────────────────────────────────────

/** Truncates all CMS tables. Call in beforeEach to reset state. */
export async function cleanTestDb(pg: IPgComponent): Promise<void> {
  await pg.query(`
    DELETE FROM cms_sync_metadata;
    DELETE FROM cms_blog_authors;
    DELETE FROM cms_blog_categories;
    DELETE FROM cms_blog_posts;
    DELETE FROM cms_entries;
  `)
}

// ─── Test Database Queries ───────────────────────────────────────────────────

/** Fetches a blog post row by ID. Returns `{ id, slug, category_id, author_id }` or `null`. */
export async function findBlogPost(
  pg: IPgComponent,
  space: string,
  environment: string,
  id: string
): Promise<Record<string, unknown> | null> {
  const result = await pg.query(
    SQL`SELECT id, slug, category_id, author_id FROM cms_blog_posts WHERE space = ${space} AND environment = ${environment} AND id = ${id}`
  )
  return result.rows[0] ?? null
}

/** Fetches a blog category row by ID. Returns `{ slug, title }` or `null`. */
export async function findBlogCategory(
  pg: IPgComponent,
  space: string,
  environment: string,
  id: string
): Promise<Record<string, unknown> | null> {
  const result = await pg.query(
    SQL`SELECT slug, title FROM cms_blog_categories WHERE space = ${space} AND environment = ${environment} AND id = ${id}`
  )
  return result.rows[0] ?? null
}

/** Fetches a cached entry/asset from cms_entries by ID. Returns `{ content }` or `null`. */
export async function findCachedEntry(
  pg: IPgComponent,
  space: string,
  environment: string,
  entryType: string,
  id: string
): Promise<Record<string, unknown> | null> {
  const result = await pg.query(
    SQL`SELECT content FROM cms_entries WHERE space = ${space} AND environment = ${environment} AND entry_type = ${entryType} AND id = ${id}`
  )
  return result.rows[0] ?? null
}

/** Counts blog posts matching the given space/environment. */
export async function countBlogPosts(pg: IPgComponent, space: string, environment: string): Promise<number> {
  const result = await pg.query(
    SQL`SELECT count(*) as total FROM cms_blog_posts WHERE space = ${space} AND environment = ${environment}`
  )
  return parseInt(result.rows[0].total, 10)
}

/** Fetches the last-sync metadata value, or `null` if not set. */
export async function findLastSync(pg: IPgComponent, space: string, environment: string): Promise<string | null> {
  const result = await pg.query(
    SQL`SELECT value FROM cms_sync_metadata WHERE space = ${space} AND environment = ${environment} AND key = 'last-sync'`
  )
  return result.rows[0]?.value ?? null
}

/** Inserts a last-sync timestamp directly (for testing rate limiting). */
export async function insertLastSync(
  pg: IPgComponent,
  space: string,
  environment: string,
  timestamp: string
): Promise<void> {
  await pg.query(
    SQL`INSERT INTO cms_sync_metadata (space, environment, key, value) VALUES (${space}, ${environment}, 'last-sync', ${timestamp})`
  )
}

// ─── Test Data Factories (full Contentful shape) ─────────────────────────────

export function createBlogPostEntry(
  overrides: {
    id?: string
    slug?: string
    title?: string
    publishedDate?: string
    categoryId?: string
    authorId?: string
  } = {}
): Record<string, unknown> {
  const id = overrides.id || 'post-1'
  return {
    sys: {
      id,
      type: 'Entry',
      space: { sys: { id: TEST_SPACE, type: 'Link', linkType: 'Space' } },
      environment: { sys: { id: TEST_ENVIRONMENT, type: 'Link', linkType: 'Environment' } },
      contentType: { sys: { id: 'blog_post', type: 'Link', linkType: 'ContentType' } },
      revision: 1,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z'
    },
    fields: {
      id: { 'en-US': overrides.slug || 'test-post', es: 'test-post-es', zh: 'test-post-zh' },
      title: { 'en-US': overrides.title || 'Test Post', es: 'Publicación de Prueba', zh: '测试帖子' },
      description: { 'en-US': 'A test post', es: 'Una publicación de prueba', zh: '测试帖子' },
      body: {
        'en-US': { nodeType: 'document', content: [] },
        es: { nodeType: 'document', content: [] },
        zh: { nodeType: 'document', content: [] }
      },
      publishedDate: {
        'en-US': overrides.publishedDate || '2024-01-15T00:00:00.000Z',
        es: '2024-01-15T00:00:00.000Z',
        zh: '2024-01-15T00:00:00.000Z'
      },
      image: { 'en-US': { sys: { id: 'img-1', type: 'Link', linkType: 'Asset' } } },
      category: overrides.categoryId
        ? { 'en-US': { sys: { id: overrides.categoryId, type: 'Link', linkType: 'Entry' } } }
        : { 'en-US': { sys: { id: 'cat-1', type: 'Link', linkType: 'Entry' } } },
      author: overrides.authorId
        ? { 'en-US': { sys: { id: overrides.authorId, type: 'Link', linkType: 'Entry' } } }
        : { 'en-US': { sys: { id: 'author-1', type: 'Link', linkType: 'Entry' } } }
    }
  }
}

export function createBlogCategoryEntry(
  overrides: { id?: string; slug?: string; title?: string } = {}
): Record<string, unknown> {
  const id = overrides.id || 'cat-1'
  return {
    sys: {
      id,
      type: 'Entry',
      space: { sys: { id: TEST_SPACE, type: 'Link', linkType: 'Space' } },
      environment: { sys: { id: TEST_ENVIRONMENT, type: 'Link', linkType: 'Environment' } },
      contentType: { sys: { id: 'blog_category', type: 'Link', linkType: 'ContentType' } },
      revision: 1,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z'
    },
    fields: {
      id: { 'en-US': overrides.slug || 'technology', es: 'tecnologia', zh: '技术' },
      title: { 'en-US': overrides.title || 'Technology', es: 'Tecnología', zh: '技术' },
      description: { 'en-US': 'Tech posts', es: 'Posts de tecnología', zh: '技术帖子' }
    }
  }
}

export function createBlogAuthorEntry(
  overrides: { id?: string; slug?: string; title?: string } = {}
): Record<string, unknown> {
  const id = overrides.id || 'author-1'
  return {
    sys: {
      id,
      type: 'Entry',
      space: { sys: { id: TEST_SPACE, type: 'Link', linkType: 'Space' } },
      environment: { sys: { id: TEST_ENVIRONMENT, type: 'Link', linkType: 'Environment' } },
      contentType: { sys: { id: 'blog_author', type: 'Link', linkType: 'ContentType' } },
      revision: 1,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z'
    },
    fields: {
      id: { 'en-US': overrides.slug || 'john-doe', es: 'john-doe', zh: 'john-doe' },
      title: { 'en-US': overrides.title || 'John Doe', es: 'John Doe', zh: 'John Doe' },
      description: { 'en-US': 'A test author' },
      image: { 'en-US': { sys: { id: 'img-author-1', type: 'Link', linkType: 'Asset' } } }
    }
  }
}

export function createAssetEntry(overrides: { id?: string } = {}): Record<string, unknown> {
  return {
    sys: {
      id: overrides.id || 'asset-1',
      type: 'Asset',
      space: { sys: { id: TEST_SPACE, type: 'Link', linkType: 'Space' } },
      environment: { sys: { id: TEST_ENVIRONMENT, type: 'Link', linkType: 'Environment' } },
      revision: 1,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z'
    },
    fields: {
      title: { 'en-US': 'Test Image' },
      file: {
        'en-US': {
          url: '//images.ctfassets.net/test-space/asset-1/image.png',
          fileName: 'image.png',
          contentType: 'image/png',
          details: { size: 1024, image: { width: 100, height: 100 } }
        }
      }
    }
  }
}

// ─── Unit Test Factories ─────────────────────────────────────────────────────

export function makeBlogListParams(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    space: TEST_SPACE,
    environment: TEST_ENVIRONMENT,
    type: 'posts' as const,
    locale: 'en-US' as const,
    slug: null,
    category: null,
    author: null,
    limit: 10,
    skip: 0,
    ...overrides
  }
}

export function makeEntryParams(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    space: TEST_SPACE,
    environment: TEST_ENVIRONMENT,
    type: 'Entry',
    id: 'entry-1',
    locale: 'en-US',
    ifNoneMatch: null,
    ...overrides
  }
}

export function makeEntry(overrides: { sys?: Record<string, unknown>; fields?: Record<string, unknown> } = {}): Entry {
  return {
    sys: {
      id: 'entry-1',
      type: 'Entry',
      space: { sys: { id: TEST_SPACE, type: 'Link', linkType: 'Space' } },
      environment: { sys: { id: TEST_ENVIRONMENT, type: 'Link', linkType: 'Environment' } },
      contentType: { sys: { id: 'page', type: 'Link', linkType: 'ContentType' } },
      revision: 1,
      updatedAt: '2025-01-01T00:00:00Z',
      ...overrides.sys
    },
    fields: overrides.fields ?? { title: { 'en-US': 'Test', es: 'Prueba' } },
    metadata: { tags: [] }
  } as Entry
}

export function makeBlogEntry(
  contentTypeId: string,
  overrides: { sys?: Record<string, unknown>; fields?: Record<string, unknown>; id?: string } = {}
): Entry {
  return makeEntry({
    sys: {
      id: overrides.id || 'entry-1',
      contentType: { sys: { id: contentTypeId, type: 'Link', linkType: 'ContentType' } },
      ...overrides.sys
    },
    fields: overrides.fields
  })
}

export function makeAsset(
  overrides: { sys?: Record<string, unknown>; fields?: Record<string, unknown> } = {}
): Record<string, unknown> {
  return {
    sys: {
      id: 'asset-1',
      type: 'Asset',
      space: { sys: { id: TEST_SPACE } },
      environment: { sys: { id: TEST_ENVIRONMENT } },
      revision: 1,
      updatedAt: '2025-01-01T00:00:00Z',
      ...overrides.sys
    },
    fields: {
      file: {
        'en-US': { url: '//images.ctfassets.net/space/image.png', contentType: 'image/png' }
      },
      ...overrides.fields
    },
    metadata: { tags: [] }
  }
}
