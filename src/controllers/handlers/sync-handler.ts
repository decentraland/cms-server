import { randomUUID } from 'crypto'
import type { IHttpServerComponent } from '@dcl/core-commons'
import { syncAll, syncEntry } from '../../logic/sync'
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../types/errors'
import { mapErrorToResponse } from '../error-mapper'
import type { HandlerContextWithPath } from '../../types'

/**
 * Handles single entry sync from Contentful to the database.
 */
export async function singleEntrySyncHandler(
  context: Pick<
    HandlerContextWithPath<
      'pg' | 'cmsDb' | 'contentful' | 'cmsConfig' | 'logs',
      '/spaces/:space/environments/:environment/blog/sync/entry/:entry_id'
    >,
    'params' | 'request' | 'components'
  >
): Promise<IHttpServerComponent.IResponse> {
  const { params, request, components } = context
  const { cmsConfig, logs } = components
  const logger = logs.getLogger('sync-controller')
  const requestId = randomUUID()

  try {
    const { space, environment, entry_id: entryId } = params

    if (!entryId) {
      throw new BadRequestError('Missing path parameter: entry_id')
    }

    if (request.headers.get('Authorization') !== `Bearer ${cmsConfig.contentfulAccessToken}`) {
      throw new UnauthorizedError()
    }

    if (space !== cmsConfig.contentfulSpaceId || environment !== cmsConfig.contentfulEnvironmentId) {
      throw new NotFoundError()
    }

    const result = await syncEntry(components, { space, environment, entryId })

    return { body: { status: 'ok', ...result } }
  } catch (err) {
    return mapErrorToResponse(requestId, err, logger)
  }
}

/**
 * Handles bulk sync of all blog content from Contentful to the database.
 * Rate-limited to once per hour.
 */
export async function bulkSyncHandler(
  context: Pick<
    HandlerContextWithPath<
      'pg' | 'cmsDb' | 'contentful' | 'cmsConfig' | 'logs',
      '/spaces/:space/environments/:environment/blog/sync'
    >,
    'params' | 'request' | 'components'
  >
): Promise<IHttpServerComponent.IResponse> {
  const { params, request, components } = context
  const { cmsConfig, logs } = components
  const logger = logs.getLogger('sync-controller')
  const requestId = randomUUID()

  try {
    const { space, environment } = params

    if (request.headers.get('Authorization') !== `Bearer ${cmsConfig.contentfulAccessToken}`) {
      throw new UnauthorizedError()
    }

    if (space !== cmsConfig.contentfulSpaceId || environment !== cmsConfig.contentfulEnvironmentId) {
      throw new NotFoundError()
    }

    const result = await syncAll(components, { space, environment })

    return { body: { status: 'ok', ...result } }
  } catch (err) {
    return mapErrorToResponse(requestId, err, logger)
  }
}
