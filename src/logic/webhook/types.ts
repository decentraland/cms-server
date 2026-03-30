import type { Asset, Entry } from 'contentful'

/** Pre-validated params for the webhook logic. */
export interface WebhookParams {
  action: 'publish' | 'unpublish'
  body: Entry | Asset
  entryType: 'Entry' | 'Asset'
}

export interface WebhookResult {
  status: 'ok'
}
