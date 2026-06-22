import type { ILoggerComponent } from '@well-known-components/interfaces'
import type { IHttpServerComponent } from '@dcl/core-commons'
import { EntryNotFoundError } from '../logic/entry/errors'
import { RateLimitError } from '../logic/sync/errors'
import { BadRequestError, NotFoundError, UnauthorizedError } from '../types/errors'

/**
 * Maps domain and validation errors to HTTP responses in the Contentful error format.
 * Controller-level errors (NotFoundError, BadRequestError, UnauthorizedError) come from
 * input validation in the controller. Domain errors (EntryNotFoundError, RateLimitError)
 * come from business logic in the logic layer.
 * @param requestId - A unique request identifier for tracing.
 * @param err - The caught error.
 * @param logger - Logger for unexpected errors.
 */
export function mapErrorToResponse(
  requestId: string,
  err: unknown,
  logger: ILoggerComponent.ILogger
): IHttpServerComponent.IResponse {
  // Controller-level validation errors
  if (err instanceof NotFoundError) {
    return {
      status: 404,
      body: {
        sys: { type: 'Error', id: 'NotFound' },
        message: 'The resource could not be found.',
        requestId,
        details: err.details
      }
    }
  }
  if (err instanceof BadRequestError) {
    return {
      status: 400,
      body: {
        sys: { type: 'Error', id: 'BadRequest' },
        message: err.message,
        requestId
      }
    }
  }
  if (err instanceof UnauthorizedError) {
    return {
      status: 404,
      body: {
        sys: { type: 'Error', id: 'NotFound' },
        message: 'The resource could not be found.',
        requestId
      }
    }
  }
  // Domain errors from logic layer
  if (err instanceof EntryNotFoundError) {
    return {
      status: 404,
      body: {
        sys: { type: 'Error', id: 'NotFound' },
        message: 'The resource could not be found.',
        requestId,
        details: err.details
      }
    }
  }
  if (err instanceof RateLimitError) {
    return {
      status: 400,
      body: {
        sys: { type: 'Error', id: 'BadRequest' },
        message: err.message,
        requestId
      }
    }
  }
  // Unexpected errors
  logger.error('Unhandled error', { requestId, error: String(err) })
  return {
    status: 500,
    body: {
      sys: { type: 'Error', id: 'InternalServerError' },
      message: 'An unexpected error occurred while processing the request.',
      requestId
    }
  }
}
