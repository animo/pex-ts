import { z } from 'zod'

export type NonEmptyArray<T> = [T, ...T[]]

export function isNonEmptyArray<T>(value: T[]): value is NonEmptyArray<T> {
  return value.length > 0
}

export function asNonEmptyArrayOrUndefined<T>(value: T[]): NonEmptyArray<T> | undefined {
  return isNonEmptyArray(value) ? value : undefined
}

export function zNonEmptyArray<T extends z.ZodType>(schema: T) {
  return z.array(schema).nonempty()
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

export const zJsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(zJsonValue), z.record(z.string(), zJsonValue)])
)

export const zJsonObject: z.ZodType<JsonObject> = z.record(z.string(), zJsonValue)

/**
 * A scalar as it can appear in a filter's `const` / `enum`.
 *
 * JSON Schema permits any value here; Presentation Exchange only ever uses scalars, and
 * restricting it keeps the comparison in `runFilter` a strict equality check rather than a
 * structural one.
 */
export const zFilterScalar = z.union([z.string(), z.number(), z.boolean(), z.null()])
export type FilterScalar = z.output<typeof zFilterScalar>

/**
 * `number | string`, as used by the numeric bounds in a filter. Presentation Exchange allows
 * strings here so that dates can be bounded with `minimum` / `maximum`.
 */
export const zNumberOrString = z.union([z.number(), z.string()])

/**
 * Text as quoted in a message, shortened so that a huge input can't make a huge message. What a message
 * echoes — a path, an id, a pattern — was chosen by the other party.
 */
export function shorten(text: string, max = 100): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}
