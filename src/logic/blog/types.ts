import type { ListedEntry } from '../../adapters/cms-db'
import type { Locale } from '../localization/types'

/** Pre-validated params for the blog listing logic. */
export interface BlogListParams {
  space: string
  environment: string
  type: 'posts' | 'categories' | 'authors'
  locale: Locale
  slug: string | null
  category: string | null
  author: string | null
  q: string | null
  limit: number
  skip: number
}

/**
 * The logic layer exposes the adapter-level entry shape under its domain name. Aliasing
 * (rather than redeclaring) keeps a single source of truth for `_rank` / `_highlight`
 * so the two layers can't drift.
 */
export type BlogListItem = ListedEntry

export interface BlogListResult {
  items: BlogListItem[]
  total: number
  skip: number
  limit: number
}

/** One blog URL, stripped to what a sitemap or a link index needs. */
export interface BlogUrl {
  slug: string
  /** Only posts carry one: it is the first path segment of the post URL. */
  categorySlug?: string
  /** Contentful's `sys.updatedAt` for the entry, so `lastmod` is a real value. */
  updatedAt: string | null
}

export interface BlogUrlsResult {
  posts: BlogUrl[]
  categories: BlogUrl[]
  authors: BlogUrl[]
}
