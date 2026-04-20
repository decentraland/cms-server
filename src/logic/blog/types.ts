import type { Locale } from '../localization/types'
import type { Entry } from 'contentful'

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

/** `<em>`-wrapped snippets produced by ts_headline when a search query is supplied. */
export interface BlogPostHighlight {
  title?: string
  description?: string
  body?: string
}

/** An Entry plus optional full-text-search metadata populated when `q` is present. */
export type BlogListItem = Entry & {
  _rank?: number
  _highlight?: BlogPostHighlight
}

export interface BlogListResult {
  items: BlogListItem[]
  total: number
  skip: number
  limit: number
}
