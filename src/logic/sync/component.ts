import { RateLimitError } from './errors'
import { BLOG_CONTENT_TYPES } from '../../types/contentful'
import type { BulkSyncParams, BulkSyncResult, SyncEntryParams, SyncEntryResult } from './types'
import type { AppComponents } from '../../types'
import type { BlogContentTypeId } from '../../types/contentful'

const RATE_LIMIT_SYNC_HOURS = 1

/**
 * Syncs a single entry from Contentful to the database.
 * @param components - Contentful, database, and logs components.
 * @param params - Already-validated sync parameters.
 */
export async function syncEntry(
  components: Pick<AppComponents, 'contentful' | 'cmsDb' | 'logs'>,
  params: SyncEntryParams
): Promise<SyncEntryResult> {
  const { contentful, cmsDb, logs } = components
  const logger = logs.getLogger('sync')

  logger.log('Single entry sync started', {
    space: params.space,
    environment: params.environment,
    entryId: params.entryId
  })

  const entry = await contentful.fetchEntry(params.space, params.environment, params.entryId)

  const contentTypeId = entry.sys.contentType?.sys.id as BlogContentTypeId | undefined
  if (contentTypeId && contentTypeId in BLOG_CONTENT_TYPES) {
    await cmsDb.upsertBlogEntry(params.space, params.environment, contentTypeId, entry)
  } else {
    await cmsDb.upsertEntry(params.space, params.environment, 'Entry', params.entryId, entry)
  }

  logger.log('Single entry sync completed', { entryId: params.entryId })

  return {
    entryId: params.entryId,
    key: `entries/${params.entryId}`,
    entry,
    timestamp: new Date().toISOString()
  }
}

/**
 * Syncs all blog content (posts, categories, authors) from Contentful to the database.
 * Rate-limited to once per hour.
 * @param components - Contentful, database, and logs components.
 * @param params - Already-validated sync parameters.
 * @throws {RateLimitError} If a sync was run within the last hour.
 */
export async function syncAll(
  components: Pick<AppComponents, 'contentful' | 'cmsDb' | 'logs' | 'pg'>,
  params: BulkSyncParams
): Promise<BulkSyncResult> {
  const { contentful, cmsDb, pg, logs } = components
  const logger = logs.getLogger('sync')

  // Check last sync timestamp
  const lastSyncDate = await cmsDb.getLastSync(params.space, params.environment)
  if (lastSyncDate) {
    const now = new Date()
    const hoursSinceLastSync = (now.getTime() - lastSyncDate.getTime()) / (1000 * 60 * 60)

    if (hoursSinceLastSync < RATE_LIMIT_SYNC_HOURS) {
      throw new RateLimitError(
        `Sync can only be run once every ${RATE_LIMIT_SYNC_HOURS} hours. Last sync was ${hoursSinceLastSync.toFixed(2)} hours ago.`
      )
    }
  }

  // Fetch all content from Contentful (network I/O, done outside the transaction)
  const [posts, categories, authors] = await Promise.all([
    contentful.fetchAllEntries(params.space, params.environment, 'blog_post'),
    contentful.fetchAllEntries(params.space, params.environment, 'blog_category'),
    contentful.fetchAllEntries(params.space, params.environment, 'blog_author')
  ])

  // Write everything in a single transaction — all upserts + timestamp are atomic
  await pg.withTransaction(async (client) => {
    await cmsDb.bulkUpsertBlogContent(params.space, params.environment, 'blog_post', posts, client)
    await cmsDb.bulkUpsertBlogContent(params.space, params.environment, 'blog_category', categories, client)
    await cmsDb.bulkUpsertBlogContent(params.space, params.environment, 'blog_author', authors, client)
    await cmsDb.setLastSync(params.space, params.environment, new Date().toISOString(), client)
  })

  const results = { posts: posts.length, categories: categories.length, authors: authors.length }
  logger.log('Blog sync completed', {
    posts: String(results.posts),
    categories: String(results.categories),
    authors: String(results.authors)
  })

  return {
    synced: results,
    timestamp: new Date().toISOString()
  }
}
