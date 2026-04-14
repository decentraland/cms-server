import { CmsError } from '../../types/errors'

/** Sync rate limit exceeded. Controllers map this to 400. */
export class RateLimitError extends CmsError {}
