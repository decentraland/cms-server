import { randomUUID } from 'crypto'
import type { IHttpServerComponent } from '@well-known-components/interfaces'
import { listBlog } from '../../logic/blog'
import { parseLocale } from '../../logic/localization'
import { BadRequestError, NotFoundError } from '../../types/errors'
import { mapErrorToResponse } from '../error-mapper'
import type { HandlerContextWithPath } from '../../types'

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
