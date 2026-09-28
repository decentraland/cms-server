import { randomUUID } from 'crypto'
import type { IHttpServerComponent } from '@dcl/core-commons'
import { listBlog, listBlogUrls } from '../../logic/blog'
import { parseLocale } from '../../logic/localization'
import { BadRequestError, NotFoundError } from '../../types/errors'
import { mapErrorToResponse } from '../error-mapper'
import type { HandlerContextWithPath } from '../../types'

const MAX_SEARCH_QUERY_LENGTH = 200

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
    const limitRaw = parseInt(url.searchParams.get('limit') || '20')
    const skipRaw = parseInt(url.searchParams.get('skip') || '0')
    const limit = Number.isNaN(limitRaw) ? 20 : Math.min(limitRaw, 100)
    const skip = Number.isNaN(skipRaw) ? 0 : skipRaw

    if (!slug && (limit < 1 || skip < 0)) {
      throw new BadRequestError('Invalid pagination parameters')
    }

    const result = await listBlog(components, {
      space,
      environment,
      type: type as 'posts' | 'categories' | 'authors',
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

/**
 * Returns every blog URL with its last-modified and nothing else.
 *
 * Separate from `blogHandler` because the listing endpoints return whole entries: a consumer that
 * builds links (a sitemap generator, a link index) would otherwise page through 12 MB of rich text
 * to collect a few hundred slugs. Cached longer than the listings for the same reason: the set of
 * URLs moves when a post is published, not when its body is edited.
 */
export async function blogUrlsHandler(
  context: Pick<
    HandlerContextWithPath<'cmsDb' | 'cmsConfig' | 'logs', '/spaces/:space/environments/:environment/blog/urls'>,
    'url' | 'params' | 'components'
  >
): Promise<IHttpServerComponent.IResponse> {
  const { url, params, components } = context
  const { cmsConfig, logs } = components
  const logger = logs.getLogger('blog-controller')
  const requestId = randomUUID()

  try {
    const { space, environment } = params

    if (space !== cmsConfig.contentfulSpaceId || environment !== cmsConfig.contentfulEnvironmentId) {
      throw new NotFoundError()
    }

    const locale = parseLocale(url.searchParams.get('locale'))
    if (!locale) {
      throw new BadRequestError(`Unknown locale: ${url.searchParams.get('locale')}`)
    }

    const result = await listBlogUrls(components, { space, environment, locale })

    return {
      status: 200,
      body: result,
      headers: { 'Cache-Control': 'public, max-age=900' }
    }
  } catch (err) {
    return mapErrorToResponse(requestId, err, logger)
  }
}
