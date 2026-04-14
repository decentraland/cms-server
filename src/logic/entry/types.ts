import type { Locale } from '../localization/types'
import type { Asset, Entry } from 'contentful'

/** Pre-validated params for the entry retrieval logic. */
export interface EntryParams {
  space: string
  environment: string
  type: 'Entry' | 'Asset'
  id: string
  locale: Locale
  ifNoneMatch: string | null
}

export interface EntryResult {
  content: Entry | Asset
  etag: string
  notModified: boolean
}

export interface LocalesResult {
  body: string
  status: number
}
