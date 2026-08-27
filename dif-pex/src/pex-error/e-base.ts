export type PexErrorCode = 'PARSE_ERROR' | 'BAD_REQUEST' | 'NOT_IMPLEMENTED'

export class PexError extends Error {
  public readonly code: PexErrorCode

  public constructor(options: { code: PexErrorCode; message: string; cause?: unknown }) {
    super(options.message, { cause: options.cause })
    this.code = options.code
    this.name = new.target.name
  }
}
