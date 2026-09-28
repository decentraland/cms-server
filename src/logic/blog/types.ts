import type { ListedEntry } from '../../adapters/cms-db'
import type { Locale } from '../localization/types'

/** Pre-validated params for the blog listing logic. */
export interface BlogListParams {
  space: string
  environment: string
  type: 'posts' | 'categories' | 'authors'
  /** `urls` swaps the entry payload for slug + lastmod. Unset returns the full entries. */
  view: 'urls' | null
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

/** One item of the `view=urls` projection, stripped to what a link builder needs. */
export interface BlogUrl {
  slug: string
  /** Posts only: the first path segment of `/blog/:categorySlug/:postSlug`. */
  categorySlug?: string
  /** The entry's `sys.updatedAt`, so a consumer gets a real `lastmod` rather than an invented one. */
  updatedAt: string | null
}
