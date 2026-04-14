import { randomUUID } from 'crypto'
import type { IHttpServerComponent } from '@well-known-components/interfaces'
import { getEntry, getLocales } from '../../logic/entry'
import { parseLocale } from '../../logic/localization'
import { fromPlural } from '../../types/contentful'
import { BadRequestError, NotFoundError } from '../../types/errors'
import { mapErrorToResponse } from '../error-mapper'
import type { HandlerContextWithPath } from '../../types'

/**
 * Handles individual entry/asset retrieval with ETag support and DB-first lookup.
 */
export async function entryHandler(
  context: Pick<
    HandlerContextWithPath<
      'cmsDb' | 'contentful' | 'cmsConfig' | 'logs',
      '/spaces/:space/environments/:environment/:types/:id'
    >,
    'url' | 'params' | 'request' | 'components'
  >
): Promise<IHttpServerComponent.IResponse> {
  const { url, params, request, components } = context
  const { cmsConfig, logs } = components
  const logger = logs.getLogger('entry-controller')
  const requestId = randomUUID()

  try {
    const { space, environment } = params

    const type = fromPlural(params.types || '')
    if (!type) {
      throw new NotFoundError()
    }

    const locale = parseLocale(url.searchParams.get('locale'))
    if (!locale) {
      throw new BadRequestError(`Unknown locale: ${url.searchParams.get('locale')}`)
    }

    if (space !== cmsConfig.contentfulSpaceId || environment !== cmsConfig.contentfulEnvironmentId) {
      throw new NotFoundError('Space or environment mismatch', {
        type,
        id: params.id,
        environment,
        space
      })
    }

    const result = await getEntry(components, {
      space,
      environment,
      type,
      locale,
      id: params.id,
      ifNoneMatch: request.headers.get('if-none-match')
    })

    if (result.notModified) {
      return {
        status: 304,
        headers: { ETag: `W/"${result.etag}"` }
      }
    }

    const bodyStr = JSON.stringify(result.content)
    const bodyBytes = Buffer.from(bodyStr, 'utf8')

    return {
      status: 200,
      body: bodyStr,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
        ETag: `W/"${result.etag}"`,
        'Content-Length': String(bodyBytes.length)
      }
    }
  } catch (err) {
    return mapErrorToResponse(requestId, err, logger)
  }
}

/**
 * Handles locale listing requests, proxied through the Contentful CDN with caching.
 */
export async function localesHandler(
  context: Pick<
    HandlerContextWithPath<'contentful' | 'cmsConfig' | 'logs', '/spaces/:space/environments/:environment/locales'>,
    'params' | 'components'
  >
): Promise<IHttpServerComponent.IResponse> {
  const { params, components } = context
  const { cmsConfig, logs } = components
  const logger = logs.getLogger('locales-controller')
  const requestId = randomUUID()

  try {
    const { space, environment } = params

    if (space !== cmsConfig.contentfulSpaceId || environment !== cmsConfig.contentfulEnvironmentId) {
      throw new NotFoundError()
    }

    const result = await getLocales(components, space, environment)

    return {
      status: result.status,
      body: result.body,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }
    }
  } catch (err) {
    return mapErrorToResponse(requestId, err, logger)
  }
}
