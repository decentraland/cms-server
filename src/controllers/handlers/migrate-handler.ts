import { randomUUID } from 'crypto'
import type { IHttpServerComponent } from '@well-known-components/interfaces'
import type { HandlerContextWithPath } from '../../types'

/**
 * Manual migration trigger endpoint.
 * Note: The pg-component runs migrations automatically on startup.
 * This endpoint exists for compatibility — it reports that migrations are managed by the pg-component.
 */
export async function migrateHandler(
  context: Pick<HandlerContextWithPath<'cmsConfig' | 'logs', '/migrate'>, 'request' | 'components'>
): Promise<IHttpServerComponent.IResponse> {
  const { request, components } = context
  const { cmsConfig, logs } = components
  const logger = logs.getLogger('migrate-controller')
  const requestId = randomUUID()

  if (request.headers.get('Authorization') !== `Bearer ${cmsConfig.contentfulAccessToken}`) {
    logger.error('Invalid authorization header', { requestId })
    return {
      status: 400,
      body: {
        sys: { type: 'Error', id: 'BadRequest' },
        message: 'Invalid authorization header',
        requestId
      }
    }
  }

  return {
    body: {
      status: 'ok',
      message: 'Migrations are managed by pg-component and run automatically on startup.'
    }
  }
}
