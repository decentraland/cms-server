import { Locales } from './types'
import type { Locale } from './types'

/**
 * Parses and validates a locale string from a request query parameter.
 * Returns the default locale (`en-US`) when `raw` is `null`.
 * @param raw - The raw `locale` query parameter value, or `null`.
 * @returns A valid locale, or `null` if the value is not a supported locale.
 */
export function parseLocale(raw: string | null): Locale | null {
  const locale = raw ?? Locales[0]
  return Locales.includes(locale as Locale) ? (locale as Locale) : null
}

/**
 * Type guard that checks whether a field value is in Contentful's localized format
 * (i.e. an object with locale keys like `{ "en-US": "value", "es": "valor" }`).
 * @param value - The field value to check.
 */
export function isLocalizedFieldValue(value: unknown): value is Record<Locale, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Locales.some((locale) => Object.prototype.hasOwnProperty.call(value, locale))
  )
}

/**
 * Extracts the value for a specific locale from a field value.
 * If the field is in localized format, returns the requested locale with `en-US` fallback.
 * If the field is not localized (legacy/plain value), returns it as-is.
 * @param value - The field value (localized or plain).
 * @param locale - The target locale to extract.
 */
export function localizeFieldValue(value: unknown, locale: Locale): unknown {
  if (isLocalizedFieldValue(value)) {
    return value[locale] || value[Locales[0]]
  }
  return value
}

/**
 * Transforms all fields of a Contentful entry to their localized values.
 * Each field is passed through {@link localizeFieldValue}.
 * @param fields - The entry's fields object (keys are field names, values may be localized).
 * @param locale - The target locale.
 * @returns A new object with the same keys but single-locale values.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function localizeFields(fields: Record<string, any>, locale: Locale): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields || {}).map(([key, value]) => [key, localizeFieldValue(value, locale)])
  )
}
