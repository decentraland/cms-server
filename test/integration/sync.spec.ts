import nock from 'nock'
import { test } from '../components'
import {
  TEST_ENVIRONMENT,
  TEST_SPACE,
  TEST_TOKEN,
  cleanTestDb,
  countBlogPosts,
  createBlogAuthorEntry,
  createBlogCategoryEntry,
  createBlogPostEntry,
  findBlogPost,
  findLastSync,
  insertLastSync
} from '../helpers'

test('when syncing blog content', ({ components }) => {
  beforeEach(async () => {
    await cleanTestDb(components.pg)
    nock.cleanAll()
  })

  afterEach(() => {
    nock.cleanAll()
  })

  describe('and syncing all content', () => {
    it('should respond with 200 and the sync counts', async () => {
      const posts = [
        createBlogPostEntry({ id: 'sync-post-1', slug: 'synced-1', publishedDate: '2024-01-01T00:00:00.000Z' }),
        createBlogPostEntry({ id: 'sync-post-2', slug: 'synced-2', publishedDate: '2024-02-01T00:00:00.000Z' })
      ]
      const categories = [createBlogCategoryEntry({ id: 'sync-cat-1', slug: 'sync-tech' })]
      const authors = [createBlogAuthorEntry({ id: 'sync-author-1', slug: 'sync-jane' })]

      nock('https://cdn.contentful.com')
        .get(/\/entries\?content_type=blog_post/)
        .reply(200, { items: posts, total: 2 })
        .get(/\/entries\?content_type=blog_category/)
        .reply(200, { items: categories, total: 1 })
        .get(/\/entries\?content_type=blog_author/)
        .reply(200, { items: authors, total: 1 })

      const response = await components.localFetch.fetch(
        `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/blog/sync`,
        { method: 'POST', headers: { Authorization: `Bearer ${TEST_TOKEN}` } }
      )

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.status).toBe('ok')
      expect(body.synced).toEqual({ posts: 2, categories: 1, authors: 1 })
    })

    it('should populate the database with the synced posts', async () => {
      const posts = [
        createBlogPostEntry({ id: 'sync-post-1', slug: 'synced-1', publishedDate: '2024-01-01T00:00:00.000Z' }),
        createBlogPostEntry({ id: 'sync-post-2', slug: 'synced-2', publishedDate: '2024-02-01T00:00:00.000Z' })
      ]

      nock('https://cdn.contentful.com')
        .get(/\/entries\?content_type=blog_post/)
        .reply(200, { items: posts, total: 2 })
        .get(/\/entries\?content_type=blog_category/)
        .reply(200, { items: [], total: 0 })
        .get(/\/entries\?content_type=blog_author/)
        .reply(200, { items: [], total: 0 })

      await components.localFetch.fetch(`/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/blog/sync`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TEST_TOKEN}` }
      })

      expect(await countBlogPosts(components.pg, TEST_SPACE, TEST_ENVIRONMENT)).toBe(2)
    })

    it('should record the last sync timestamp', async () => {
      nock('https://cdn.contentful.com')
        .get(/\/entries\?content_type=blog_post/)
        .reply(200, { items: [], total: 0 })
        .get(/\/entries\?content_type=blog_category/)
        .reply(200, { items: [], total: 0 })
        .get(/\/entries\?content_type=blog_author/)
        .reply(200, { items: [], total: 0 })

      await components.localFetch.fetch(`/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/blog/sync`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TEST_TOKEN}` }
      })

      expect(await findLastSync(components.pg, TEST_SPACE, TEST_ENVIRONMENT)).not.toBeNull()
    })
  })

  describe('and a sync was run recently', () => {
    it('should return 400 with a rate limit message', async () => {
      await insertLastSync(components.pg, TEST_SPACE, TEST_ENVIRONMENT, new Date().toISOString())

      const response = await components.localFetch.fetch(
        `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/blog/sync`,
        { method: 'POST', headers: { Authorization: `Bearer ${TEST_TOKEN}` } }
      )

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.message).toContain('Sync can only be run once every')
    })
  })

  describe('and the authorization is invalid', () => {
    it('should return 404 to hide endpoint existence', async () => {
      const response = await components.localFetch.fetch(
        `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/blog/sync`,
        { method: 'POST', headers: { Authorization: 'Bearer wrong-token' } }
      )
      expect(response.status).toBe(404)
    })
  })

  describe('and syncing a single entry', () => {
    it('should respond with 200 and the entry ID', async () => {
      const post = createBlogPostEntry({ id: 'single-sync', slug: 'single-synced' })

      nock('https://cdn.contentful.com')
        .get(`/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/entries/single-sync?locale=*`)
        .reply(200, post)

      const response = await components.localFetch.fetch(
        `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/blog/sync/entry/single-sync`,
        { method: 'POST', headers: { Authorization: `Bearer ${TEST_TOKEN}` } }
      )

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.status).toBe('ok')
      expect(body.entryId).toBe('single-sync')
    })

    it('should save the entry to the database', async () => {
      const post = createBlogPostEntry({ id: 'single-sync-2', slug: 'single-synced-2' })

      nock('https://cdn.contentful.com')
        .get(`/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/entries/single-sync-2?locale=*`)
        .reply(200, post)

      await components.localFetch.fetch(
        `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/blog/sync/entry/single-sync-2`,
        { method: 'POST', headers: { Authorization: `Bearer ${TEST_TOKEN}` } }
      )

      const row = await findBlogPost(components.pg, TEST_SPACE, TEST_ENVIRONMENT, 'single-sync-2')
      expect(row).not.toBeNull()
    })
  })
})
