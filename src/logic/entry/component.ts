import { createHash } from 'crypto'
import { EntryNotFoundError } from './errors'
import { localizeFields } from '../localization'
import { toDecentralandCDNUrl } from '../urls'
import type { EntryParams, EntryResult, LocalesResult } from './types'
import type { AppComponents } from '../../types'
import type { Asset, AssetFile, Entry } from 'contentful'

/**
 * Retrieves a single Contentful entry or asset.
 * Tries the database first, falls back to Contentful CDN API.
 * @param components - Database, Contentful, and logs components.
 * @param params - Already-validated entry parameters.
 */
export async function getEntry(
  components: Pick<AppComponents, 'contentful' | 'cmsDb' | 'logs'>,
  params: EntryParams
): Promise<EntryResult> {
  const { contentful, cmsDb, logs } = components
  const logger = logs.getLogger('entry')
  const { space, environment, type, id, locale, ifNoneMatch } = params

  let content: Entry | Asset | undefined
  let etag: string | undefined

  // Try to get from DB first (searches cms_entries + all blog tables in one query)
  try {
    const row = await cmsDb.findEntryContent(space, environment, type, id)
    if (row) {
      content = row.content as Entry | Asset

      // Use the same ETag inputs as the Contentful path (revision + updatedAt from the entry itself)
      // so ETags are consistent regardless of whether the entry came from DB or Contentful.
      const hasher = createHash('sha1')
      hasher.update(locale + (content.sys.revision ?? '') + (content.sys.updatedAt ?? ''))
      etag = hasher.digest('hex')

      // If client has a matching ETag, return early with notModified
      if (ifNoneMatch && (ifNoneMatch === `W/"${etag}"` || ifNoneMatch === `"${etag}"`)) {
        return { content, etag, notModified: true }
      }

      logger.log('Entry loaded from DB', { type, entryId: id })
    }
  } catch (dbError: unknown) {
    logger.warn('DB read failed, falling back to Contentful', { type, entryId: id, error: (dbError as Error).message })
  }

  // If not found in DB, try to fetch from Contentful
  if (!content) {
    const fetched = await contentful.fetchEntryOrAsset(space, environment, type, id)

    if (!fetched) {
      throw new EntryNotFoundError({ type, id, environment, space })
    }

    content = fetched

    // Transform asset URLs to Decentraland CDN
    if (type === 'Asset' && content.sys.type === 'Asset') {
      const asset = content as Asset
      const files = asset.fields.file as Record<string, AssetFile>
      for (const file of Object.values(files)) {
        if (file.url) {
          file.url = toDecentralandCDNUrl(file.url, logger)
        }
      }
    }

    // Cache in DB for future requests
    await cmsDb.upsertEntry(space, environment, type, id, content)

    const hasher = createHash('sha1')
    hasher.update(locale + content.sys.revision + content.sys.updatedAt)
    etag = hasher.digest('hex')

    logger.log('Entry fetched from Contentful and cached', { type, entryId: id })
  }

  // Transform content for locale
  content.sys.locale = locale
  content.fields = localizeFields(content.fields, locale)

  return { content, etag: etag as string, notModified: false }
}

/**
 * Fetches available Contentful locales.
 * @param components - Contentful component for API access.
 * @param space - The Contentful space ID.
 * @param environment - The Contentful environment ID.
 */
export async function getLocales(
  components: Pick<AppComponents, 'contentful'>,
  space: string,
  environment: string
): Promise<LocalesResult> {
  return components.contentful.fetchLocales(space, environment)
}
