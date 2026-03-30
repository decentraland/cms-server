export const Locales = ['en-US', 'es', 'zh'] as const
export type Locale = (typeof Locales)[number]
