import type { Asset, Entry } from 'contentful'

export interface IContentfulComponent {
  fetchEntryOrAsset(
    space: string,
    environment: string,
    type: 'Entry' | 'Asset',
    id: string
  ): Promise<(Entry | Asset) | null>
  fetchEntry(space: string, environment: string, entryId: string): Promise<Entry>
  fetchAllEntries(space: string, environment: string, contentType: string): Promise<Entry[]>
  fetchLocales(space: string, environment: string): Promise<{ body: string; status: number }>
}
