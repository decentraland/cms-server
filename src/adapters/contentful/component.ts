import type { IContentfulComponent } from './types'
import type { AppComponents } from '../../types'
import type { Asset, Entry } from 'contentful'

const BASE_URL = 'https://cdn.contentful.com'

/** Shape of a Contentful API error response body. */
interface ContentfulErrorResponse {
  sys?: { type?: 'Error'; id?: string }
  message?: string
}

/**
 * Type guard that checks whether an API response body is a Contentful error.
 * @param body - The parsed JSON response body.
 */
export function isContentfulError(body: unknown): body is ContentfulErrorResponse {
  return typeof body === 'object' && body !== null && (body as ContentfulErrorResponse)?.sys?.type === 'Error'
}

/**
 * Creates the Contentful adapter component.
 * Uses the WKC fetcher for HTTP requests (provides tracing) and cmsConfig for credentials.
 * @param components - The fetcher, cmsConfig, and logs components.
 * @returns The Contentful component with methods to fetch entries, assets, and locales.
 */
export async function createContentfulComponent(
  components: Pick<AppComponents, 'cmsConfig' | 'fetcher' | 'logs'>
): Promise<IContentfulComponent> {
  const { cmsConfig, fetcher, logs } = components
  const logger = logs.getLogger('contentful')
  const token = cmsConfig.contentfulAccessToken

  // ─── Locales Cache (1-hour TTL) ──────────────────────────────────────────────
  let localesCache: { body: string; status: number; cachedAt: number } | null = null
  const LOCALES_CACHE_TTL = 60 * 60 * 1000 // 1 hour

  /**
   * Fetches a single Contentful entry or asset by ID.
   * Returns `null` if the resource is not found or Contentful returns an error.
   * @param space - The Contentful space ID.
   * @param environment - The Contentful environment ID.
   * @param type - `'Entry'` or `'Asset'`.
   * @param id - The resource's `sys.id`.
   * @returns The Entry or Asset, or `null` on any error.
   */
  async function fetchEntryOrAsset(
    space: string,
    environment: string,
    type: 'Entry' | 'Asset',
    id: string
  ): Promise<(Entry | Asset) | null> {
    const pathSegment = type === 'Entry' ? 'entries' : 'assets'
    const url = `${BASE_URL}/spaces/${space}/environments/${environment}/${pathSegment}/${id}?locale=*`

    const response = await fetcher.fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    })

    const text = await response.text()

    if (!response.ok) {
      logger.error('Contentful fetch failed', {
        status: String(response.status),
        type,
        entryId: id,
        errorBody: text.substring(0, 500)
      })
      return null
    }

    const data = JSON.parse(text)

    if (isContentfulError(data)) {
      logger.error('Contentful returned error', {
        entryId: id,
        errorType: data.sys?.id ?? 'unknown',
        errorMessage: data.message ?? 'unknown'
      })
      return null
    }

    return data as Entry | Asset
  }

  /**
   * Fetches a single Contentful entry by ID. Throws on failure.
   * @param space - The Contentful space ID.
   * @param environment - The Contentful environment ID.
   * @param entryId - The entry's `sys.id`.
   * @returns The full Contentful Entry object.
   * @throws {Error} If Contentful returns an error or the entry is not found.
   */
  async function fetchEntry(space: string, environment: string, entryId: string): Promise<Entry> {
    const result = await fetchEntryOrAsset(space, environment, 'Entry', entryId)
    if (!result) {
      throw new Error(`Failed to fetch entry ${entryId} from Contentful`)
    }
    return result as Entry
  }

  /**
   * Fetches all Contentful entries of a given content type, handling pagination automatically.
   * @param space - The Contentful space ID.
   * @param environment - The Contentful environment ID.
   * @param contentType - The content type ID to filter by (e.g. `'blog_post'`).
   * @returns An array of all matching Entry objects.
   * @throws {Error} If any page request returns a Contentful error.
   */
  async function fetchAllEntries(space: string, environment: string, contentType: string): Promise<Entry[]> {
    const allItems: Entry[] = []
    let skip = 0
    const limit = 100
    let total = 0

    do {
      const url = `${BASE_URL}/spaces/${space}/environments/${environment}/entries?content_type=${contentType}&locale=*&limit=${limit}&skip=${skip}`
      const response = await fetcher.fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      })

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw new Error(`Contentful API returned ${response.status} for ${contentType} (skip=${skip})`)
      }

      const data = (await response.json()) as {
        items?: Entry[]
        total?: number
        sys?: { type?: string; id?: string }
        message?: string
      }

      if (isContentfulError(data)) {
        throw new Error(`Contentful API error: ${data.message ?? data.sys?.id ?? 'Unknown error'}`)
      }

      const items = (data.items || []) as Entry[]
      total = data.total || 0

      allItems.push(...items)
      skip += limit

      logger.log('Contentful fetch progress', {
        contentType,
        fetched: String(allItems.length),
        total: String(total)
      })
    } while (skip < total)

    return allItems
  }

  /**
   * Fetches the available locales for a Contentful space/environment.
   * Results are cached for 1 hour.
   * @param space - The Contentful space ID.
   * @param environment - The Contentful environment ID.
   * @returns The raw JSON response body as a string and HTTP status.
   */
  async function fetchLocales(space: string, environment: string): Promise<{ body: string; status: number }> {
    if (localesCache && Date.now() - localesCache.cachedAt < LOCALES_CACHE_TTL) {
      return { body: localesCache.body, status: localesCache.status }
    }

    const url = `${BASE_URL}/spaces/${space}/environments/${environment}/locales`
    const response = await fetcher.fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const body = await response.text()
    const result = { body, status: response.status }

    localesCache = { ...result, cachedAt: Date.now() }

    return result
  }

  return {
    fetchEntryOrAsset,
    fetchEntry,
    fetchAllEntries,
    fetchLocales
  }
}
