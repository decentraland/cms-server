import { randomUUID } from 'crypto'
import type { IHttpServerComponent } from '@dcl/core-commons'
import { listBlog } from '../../logic/blog'
import { parseLocale } from '../../logic/localization'
import { BadRequestError, NotFoundError } from '../../types/errors'
import { mapErrorToResponse } from '../error-mapper'
import type { HandlerContextWithPath } from '../../types'

const MAX_SEARCH_QUERY_LENGTH = 200

/**
 * A projected page is a few KB rather than the 2.5 MB a listing page costs once every row carries
 * its rich-text body, so the whole archive fits in one request per type and a consumer that only
 * builds links never pages.
 */
const MAX_URL_VIEW_LIMIT = 1000
const MAX_ENTRY_LIMIT = 100

/** Parses the `view` query param. Only `urls` is defined; anything else is rejected. */
function parseView(raw: string | null): 'urls' | null {
  if (raw === null || raw === '') return null
  if (raw === 'urls') return 'urls'
  throw new BadRequestError(`Invalid view: ${raw}`)
}

/** Parses the `q` query param: trimmed non-empty string, or null. Throws for over-length. */
function parseSearchQuery(raw: string | null): string | null {
  if (raw === null) return null
  const trimmed = raw.trim()
  if (trimmed.length > MAX_SEARCH_QUERY_LENGTH) {
    throw new BadRequestError('Search query is too long')
  }
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Handles blog listing requests (posts, categories, authors).
 * Validates space/environment, parses query parameters, and returns paginated results.
 */
export async function blogHandler(
  context: Pick<
    HandlerContextWithPath<'cmsDb' | 'cmsConfig' | 'logs', '/spaces/:space/environments/:environment/blog/:type'>,
    'url' | 'params' | 'request' | 'components'
  >
): Promise<IHttpServerComponent.IResponse> {
  const { url, params, components } = context
  const { cmsConfig, logs } = components
  const logger = logs.getLogger('blog-controller')
  const requestId = randomUUID()

  try {
    const { space, environment, type } = params

    if (space !== cmsConfig.contentfulSpaceId || environment !== cmsConfig.contentfulEnvironmentId) {
      throw new NotFoundError()
    }

    if (!['posts', 'categories', 'authors'].includes(type)) {
      throw new BadRequestError(`Invalid blog type: ${type}`)
    }

    const locale = parseLocale(url.searchParams.get('locale'))
    if (!locale) {
      throw new BadRequestError(`Unknown locale: ${url.searchParams.get('locale')}`)
    }

    const slug = url.searchParams.get('slug')
    const category = url.searchParams.get('category')
    const author = url.searchParams.get('author')
    const q = parseSearchQuery(url.searchParams.get('q'))
    const view = parseView(url.searchParams.get('view'))
    const maxLimit = view === 'urls' ? MAX_URL_VIEW_LIMIT : MAX_ENTRY_LIMIT
    const defaultLimit = view === 'urls' ? MAX_URL_VIEW_LIMIT : 20
    const limitRaw = parseInt(url.searchParams.get('limit') || String(defaultLimit))
    const skipRaw = parseInt(url.searchParams.get('skip') || '0')
    const limit = Number.isNaN(limitRaw) ? defaultLimit : Math.min(limitRaw, maxLimit)
    const skip = Number.isNaN(skipRaw) ? 0 : skipRaw

    if (!slug && (limit < 1 || skip < 0)) {
      throw new BadRequestError('Invalid pagination parameters')
    }

    const result = await listBlog(components, {
      space,
      environment,
      type: type as 'posts' | 'categories' | 'authors',
      view,
      locale,
      slug,
      category,
      author,
      q,
      limit,
      skip
    })

    return {
      status: 200,
      body: result,
      headers: { 'Cache-Control': 'public, max-age=300' }
    }
  } catch (err) {
    return mapErrorToResponse(requestId, err, logger)
  }
}
