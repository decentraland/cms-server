/** Base class for all CMS domain errors. */
export class CmsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = this.constructor.name
  }
}

/** Resource not found. Controllers map this to 404. */
export class NotFoundError extends CmsError {
  constructor(
    message = 'The resource could not be found.',
    public readonly details: Record<string, string> = {}
  ) {
    super(message)
  }
}

/** Invalid client input. Controllers map this to 400. */
export class BadRequestError extends CmsError {
  constructor(message = 'Bad request') {
    super(message)
  }
}

/** Auth failure. Controllers map this to 404 (hides endpoint existence). */
export class UnauthorizedError extends CmsError {
  constructor(message = 'Unauthorized') {
    super(message)
  }
}
