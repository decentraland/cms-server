import type { Document } from '@contentful/rich-text-types'
import type { Asset, Entry } from 'contentful'

export interface IBlogAuthorFields {
  /** Id */
  id: string
  /** Title */
  title: string
  /** Description */
  description?: string | undefined
  /** Image */
  image: Asset
}

export interface IBlogAuthor {
  sys: Entry['sys']
  fields: IBlogAuthorFields
}

export interface IBlogCategoryFields {
  /** Id */
  id: string
  /** Title */
  title: string
  /** Description */
  description: string
  /** Image */
  image?: Asset | undefined
  /** Show in menu */
  isShownInMenu?: boolean | undefined
}

export interface IBlogCategory {
  sys: Entry['sys']
  fields: IBlogCategoryFields
}

export interface IBlogPostFields {
  /** id */
  id?: string | undefined
  /** Title */
  title: string
  /** Description */
  description: string
  /** Image */
  image: Asset
  /** Body */
  body: Document
  /** Published Date */
  publishedDate: string
  /** Category */
  category: IBlogCategory
  /** Author */
  author: IBlogAuthor
}

export interface IBlogPost {
  sys: Entry['sys']
  fields: IBlogPostFields
}

/** Union type for blog content entries. */
export type BlogEntry = IBlogPost | IBlogCategory | IBlogAuthor

/** Maps Contentful content type IDs to their plural catalog names used in API paths. */
export const BLOG_CONTENT_TYPES = {
  blog_post: 'posts',
  blog_category: 'categories',
  blog_author: 'authors'
} as const

/** A Contentful content type ID that corresponds to a blog content type. */
export type BlogContentTypeId = keyof typeof BLOG_CONTENT_TYPES

/**
 * Maps a Contentful `sys.type` string (including `DeletedEntry`/`DeletedAsset`) to the
 * canonical entry type used in database storage.
 * @param sysType - The `sys.type` value from a Contentful webhook payload.
 * @returns `'Entry'`, `'Asset'`, or `null` if the type is unrecognized.
 */
export function toEntryType(sysType: string): 'Entry' | 'Asset' | null {
  switch (sysType) {
    case 'Entry':
    case 'DeletedEntry':
      return 'Entry'
    case 'Asset':
    case 'DeletedAsset':
      return 'Asset'
    default:
      return null
  }
}

/**
 * Converts a plural URL path segment (`'entries'`, `'assets'`) to the corresponding
 * Contentful `sys.type` value.
 * @param plural - The plural type string from the URL path.
 * @returns `'Entry'`, `'Asset'`, or `null` if unrecognized.
 */
export function fromPlural(plural: string): Entry['sys']['type'] | Asset['sys']['type'] | null {
  switch (plural) {
    case 'entires': // intentional: some clients send this misspelling
    case 'entries':
      return 'Entry'
    case 'assets':
      return 'Asset'
    default:
      return null
  }
}
