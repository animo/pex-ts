import { z } from 'zod'
import { PexParseError } from './pex-error/e-pex.js'

export type UnknownSchema = z.ZodType

export type SafeParseResult<T extends UnknownSchema> =
  | { success: true; output: z.output<T> }
  | { success: false; error: z.ZodError<z.input<T>>; message: string }

/**
 * Wraps a zod schema with the parse helpers every model in this library exposes.
 *
 * This is the zod translation of dcql-ts's valibot `ModelDefinition`. It differs in one way:
 * `parse` *throws* a {@link PexParseError} rather than returning it, which is what the dcql
 * implementation appears to have intended.
 */
export class ModelDefinition<T extends UnknownSchema> {
  public constructor(private readonly input: { zModel: T }) {}

  /** The underlying zod schema, for composing into other models. */
  public get schema(): T {
    return this.input.zModel
  }

  public parse(input: unknown): z.output<T> {
    const result = this.safeParse(input)
    if (result.success) return result.output

    throw new PexParseError({ message: result.message, cause: result.error })
  }

  public safeParse(input: unknown): SafeParseResult<T> {
    const result = this.input.zModel.safeParse(input)
    if (result.success) return { success: true, output: result.data }

    return {
      success: false,
      error: result.error as z.ZodError<z.input<T>>,
      message: z.prettifyError(result.error),
    }
  }

  public is(input: unknown): input is z.output<T> {
    return this.input.zModel.safeParse(input).success
  }
}

// biome-ignore lint/suspicious/noExplicitAny: the model's schema is intentionally unconstrained here
export type InferModelTypes<T extends ModelDefinition<any>> =
  T extends ModelDefinition<infer Schema> ? { Input: z.input<Schema>; Output: z.output<Schema> } : never
