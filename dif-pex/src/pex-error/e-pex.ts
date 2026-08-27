import { PexError } from './e-base.js'

/**
 * A value did not match its model. Thrown by `*.parse`.
 */
export class PexParseError extends PexError {
  public constructor(options: { message: string; cause?: unknown }) {
    super({ code: 'PARSE_ERROR', ...options })
  }
}

/**
 * A presentation definition is structurally valid but semantically invalid, e.g. duplicate
 * input descriptor ids, or a submission requirement pointing at a group that does not exist.
 */
export class PexInvalidDefinitionError extends PexError {
  public constructor(options: { message: string; cause?: unknown }) {
    super({ code: 'BAD_REQUEST', ...options })
  }
}

/**
 * A presentation definition could not be assigned a version, or the version conflicts with
 * the properties present on the definition.
 */
export class PexUnknownVersionError extends PexError {
  public constructor(options: { message: string; cause?: unknown }) {
    super({ code: 'BAD_REQUEST', ...options })
  }
}

/**
 * A path is not expressible in the JSONPath subset supported by this library.
 *
 * Thrown when parsing a presentation definition, rather than when running a query, so that a
 * definition using unsupported syntax fails loudly and up front instead of silently matching
 * nothing.
 */
export class PexJsonPathError extends PexError {
  public readonly path: string

  public constructor(options: { message: string; path: string; cause?: unknown }) {
    super({ code: 'BAD_REQUEST', message: options.message, cause: options.cause })
    this.path = options.path
  }
}

/**
 * A presentation submission does not line up with the definition it claims to satisfy.
 */
export class PexInvalidSubmissionError extends PexError {
  public constructor(options: { message: string; cause?: unknown }) {
    super({ code: 'BAD_REQUEST', ...options })
  }
}
