import { randomUUID } from 'crypto'
import type { IHttpServerComponent } from '@well-known-components/interfaces'
import { processWebhook } from '../../logic/webhook'
import { toEntryType } from '../../types/contentful'
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../types/errors'
import { mapErrorToResponse } from '../error-mapper'
import type { HandlerContextWithPath } from '../../types'

/**
 * Handles Contentful webhook publish/unpublish events.
 * Validates authorization, parses the webhook topic, and delegates to the webhook logic.
 */
export async function webhookHandler(
  context: Pick<HandlerContextWithPath<'cmsDb' | 'cmsConfig' | 'logs', '/webhook'>, 'request' | 'components'>
): Promise<IHttpServerComponent.IResponse> {
  const { request, components } = context
  const { cmsConfig, logs } = components
  const logger = logs.getLogger('webhook-controller')
  const requestId = randomUUID()

  try {
    if (request.headers.get('Authorization') !== `Bearer ${cmsConfig.contentfulAccessToken}`) {
      throw new UnauthorizedError()
    }

    const [, type, action] = (request.headers.get('X-Contentful-Topic') || '').split('.')
    if (!['Asset', 'Entry'].includes(type) || !['publish', 'unpublish'].includes(action)) {
      throw new NotFoundError('Invalid webhook topic')
    }

    const body = await request.json()
    const entryType = toEntryType(body.sys.type)
    if (!entryType) {
      throw new NotFoundError('Invalid entry type')
    }

    if (action !== 'publish' && action !== 'unpublish') {
      throw new BadRequestError(`Invalid action: ${action}`)
    }

    const result = await processWebhook(components, {
      action: action as 'publish' | 'unpublish',
      body,
      entryType
    })

    return { body: result }
  } catch (err) {
    return mapErrorToResponse(requestId, err, logger)
  }
}
