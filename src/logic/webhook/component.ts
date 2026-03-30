import { BLOG_CONTENT_TYPES } from '../../types/contentful'
import { toDecentralandCDNUrl } from '../urls'
import type { WebhookParams, WebhookResult } from './types'
import type { AppComponents } from '../../types'
import type { BlogContentTypeId } from '../../types/contentful'
import type { Asset, AssetFile, Entry } from 'contentful'

/**
 * Processes a Contentful webhook publish/unpublish event.
 * Routes blog content to dedicated tables and non-blog content to the generic cache.
 * @param components - Database and logs components.
 * @param params - Already-validated webhook parameters.
 */
export async function processWebhook(
  components: Pick<AppComponents, 'cmsDb' | 'logs'>,
  params: WebhookParams
): Promise<WebhookResult> {
  const { cmsDb, logs } = components
  const logger = logs.getLogger('webhook')
  const { action, body, entryType } = params

  const id = body.sys.id
  const space = body.sys.space.sys.id
  const environment = body.sys.environment.sys.id

  // Transform asset URLs to Decentraland CDN
  if (body.sys.type === 'Asset') {
    const asset = body as Asset
    const files = asset.fields.file as Record<string, AssetFile>
    for (const file of Object.values(files)) {
      if (file.url) file.url = toDecentralandCDNUrl(file.url, logger)
    }
  }

  const isBlogContent = isBlogEntry(body)

  if (action === 'publish') {
    if (!isBlogContent) await cmsDb.upsertEntry(space, environment, entryType, id, body)
    logger.log('Entry saved', { entryType, entryId: id, isBlogContent: String(isBlogContent) })
  } else {
    if (!isBlogContent) await cmsDb.deleteEntry(space, environment, entryType, id)
    logger.log('Entry removed', { entryType, entryId: id, isBlogContent: String(isBlogContent) })
  }

  if (isBlogContent) {
    const sysType = body.sys.type as string
    if (sysType === 'Entry' || sysType === 'DeletedEntry') {
      const entry = body as Entry
      const contentTypeId = entry.sys.contentType?.sys.id as BlogContentTypeId
      if (action === 'publish') {
        await cmsDb.upsertBlogEntry(space, environment, contentTypeId, entry)
        logger.log('Blog entry updated', { contentType: contentTypeId, entryId: id })
      } else {
        await cmsDb.deleteBlogEntry(space, environment, contentTypeId, id)
        logger.log('Blog entry removed', { contentType: contentTypeId, entryId: id })
      }
    }
  }

  return { status: 'ok' }
}

function isBlogEntry(body: Entry | Asset): boolean {
  const sysType = body.sys.type as string
  if (sysType !== 'Entry' && sysType !== 'DeletedEntry') return false
  const contentTypeId = (body as Entry).sys.contentType?.sys.id
  return !!contentTypeId && contentTypeId in BLOG_CONTENT_TYPES
}
