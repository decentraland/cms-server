import type { Entry } from 'contentful'

/** Pre-validated params for single entry sync. */
export interface SyncEntryParams {
  space: string
  environment: string
  entryId: string
}

export interface SyncEntryResult {
  entryId: string
  key: string
  entry: Entry
  timestamp: string
}

/** Pre-validated params for bulk sync. */
export interface BulkSyncParams {
  space: string
  environment: string
}

export interface BulkSyncResult {
  synced: { posts: number; categories: number; authors: number }
  timestamp: string
}
