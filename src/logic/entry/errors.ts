import { CmsError } from '../../types/errors'

/** The requested entry or asset was not found in the database or Contentful. */
export class EntryNotFoundError extends CmsError {
  constructor(public readonly details: Record<string, string> = {}) {
    super('Entry not found')
  }
}
