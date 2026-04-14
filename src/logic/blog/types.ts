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
  limit: number
  skip: number
}

export interface BlogListResult {
  items: Entry[]
  total: number
  skip: number
  limit: number
}
