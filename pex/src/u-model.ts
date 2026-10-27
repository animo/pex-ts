import { z } from 'zod'
import { PexParseError } from './pex-error/e-pex.js'

export type UnknownSchema = z.ZodType

/**
 * How deeply objects and arrays may nest in parsed input. Filters, submission requirements and nested
 * descriptor paths are recursive, and parsing them recurses too, so input nested deeply enough would
 * exhaust the stack. Real definitions nest about ten levels.
 */
export const MAX_INPUT_DEPTH = 64

/**
 * Whether `input` nests objects and arrays deeper than `maxDepth`. Iterative, so it can't overflow the
 * stack itself.
 */
export function exceedsMaxDepth(input: unknown, maxDepth = MAX_INPUT_DEPTH): boolean {
  const stack: Array<{ value: unknown; depth: number }> = [{ value: input, depth: 0 }]

  while (stack.length > 0) {
    const { value, depth } = stack.pop() as { value: unknown; depth: number }
    if (typeof value !== 'object' || value === null) continue
    if (depth >= maxDepth) return true

    for (const child of Object.values(value)) stack.push({ value: child, depth: depth + 1 })
  }

  return false
}

/**
 * The zod error for input nested deeper than {@link MAX_INPUT_DEPTH}. The input is left out of the issue:
 * zod serializes issues into the error message, which for such input would itself overflow the stack.
 */
export function maxDepthError(): z.ZodError {
  return new z.ZodError([
    { code: 'custom', input: undefined, path: [], message: `Input is nested more than ${MAX_INPUT_DEPTH} levels deep` },
  ])
}

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
    if (exceedsMaxDepth(input)) {
      const error = maxDepthError()
      return { success: false, error: error as z.ZodError<z.input<T>>, message: z.prettifyError(error) }
    }

    const result = this.input.zModel.safeParse(input)
    if (result.success) return { success: true, output: result.data }

    return {
      success: false,
      error: result.error as z.ZodError<z.input<T>>,
      message: z.prettifyError(result.error),
    }
  }

  public is(input: unknown): input is z.output<T> {
    return this.safeParse(input).success
  }
}

// biome-ignore lint/suspicious/noExplicitAny: the model's schema is intentionally unconstrained here
export type InferModelTypes<T extends ModelDefinition<any>> =
  T extends ModelDefinition<infer Schema> ? { Input: z.input<Schema>; Output: z.output<Schema> } : never
