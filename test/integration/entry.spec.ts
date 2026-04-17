import nock from 'nock'
import { test } from '../components'
import {
  TEST_ENVIRONMENT,
  TEST_SPACE,
  TEST_TOKEN,
  cleanTestDb,
  createAssetEntry,
  createBlogPostEntry,
  findCachedEntry
} from '../helpers'

test('when retrieving an individual entry', ({ components }) => {
  function postWebhook(entry: Record<string, unknown>) {
    const sys = entry.sys as Record<string, unknown>
    const type = sys.type === 'Asset' ? 'Asset' : 'Entry'
    return components.localFetch.fetch('/webhook', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        'X-Contentful-Topic': `ContentManagement.${type}.publish`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(entry)
    })
  }

  beforeEach(async () => {
    await cleanTestDb(components.pg)
    nock.cleanAll()
  })

  afterEach(() => {
    nock.cleanAll()
  })

  describe('and the entry exists in the database', () => {
    beforeEach(async () => {
      const post = createBlogPostEntry()
      await postWebhook(post)
    })

    it('should respond with 200 and the localized entry', async () => {
      const response = await components.localFetch.fetch(
        `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/entries/post-1`
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.sys.id).toBe('post-1')
      expect(body.sys.locale).toBe('en-US')
      expect(body.fields.title).toBe('Test Post')
    })

    it('should include etag and content-length headers', async () => {
      const response = await components.localFetch.fetch(
        `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/entries/post-1`
      )
      expect(response.headers.get('etag')).toBeDefined()
      expect(response.headers.get('content-length')).toBeDefined()
    })
  })

  describe('and the entry is not in the database', () => {
    it('should fall back to Contentful and return the entry', async () => {
      const contentfulEntry = createBlogPostEntry({ id: 'remote-post', slug: 'remote' })

      nock('https://cdn.contentful.com')
        .get(`/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/entries/remote-post?locale=*`)
        .reply(200, contentfulEntry)

      const response = await components.localFetch.fetch(
        `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/entries/remote-post`
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.sys.id).toBe('remote-post')
    })

    it('should cache the result in the database', async () => {
      const contentfulEntry = createBlogPostEntry({ id: 'remote-post-2', slug: 'remote-2' })

      nock('https://cdn.contentful.com')
        .get(`/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/entries/remote-post-2?locale=*`)
        .reply(200, contentfulEntry)

      await components.localFetch.fetch(`/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/entries/remote-post-2`)

      const cached = await findCachedEntry(components.pg, TEST_SPACE, TEST_ENVIRONMENT, 'Entry', 'remote-post-2')
      expect(cached).not.toBeNull()
    })
  })

  describe('and the entry does not exist anywhere', () => {
    it('should return 404', async () => {
      nock('https://cdn.contentful.com')
        .get(`/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/entries/nonexistent?locale=*`)
        .reply(404, { sys: { type: 'Error', id: 'NotFound' }, message: 'not found' })

      const response = await components.localFetch.fetch(
        `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/entries/nonexistent`
      )
      expect(response.status).toBe(404)
    })
  })

  describe('and requesting an asset', () => {
    it('should return the asset from the database', async () => {
      const asset = createAssetEntry()
      await postWebhook(asset)

      const response = await components.localFetch.fetch(
        `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/assets/asset-1`
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.sys.id).toBe('asset-1')
    })
  })

  describe('and sending If-None-Match matching the ETag', () => {
    it('should return 304 Not Modified', async () => {
      const post = createBlogPostEntry()
      await postWebhook(post)

      const firstResponse = await components.localFetch.fetch(
        `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/entries/post-1`
      )
      const etag = firstResponse.headers.get('etag')

      const response = await components.localFetch.fetch(
        `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/entries/post-1`,
        { headers: { 'If-None-Match': String(etag) } }
      )
      expect(response.status).toBe(304)
    })
  })
})
