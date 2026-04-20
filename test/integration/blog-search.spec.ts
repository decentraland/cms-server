import nock from 'nock'
import { test } from '../components'
import {
  TEST_ENVIRONMENT,
  TEST_SPACE,
  TEST_TOKEN,
  cleanTestDb,
  createBlogAuthorEntry,
  createBlogCategoryEntry,
  createBlogPostEntry
} from '../helpers'

test('when searching blog posts with a q query parameter', ({ components }) => {
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

    const techCategory = createBlogCategoryEntry()
    const eventsCategory = createBlogCategoryEntry({
      id: 'cat-events',
      slug: 'events',
      title: 'Events and Meetups'
    })
    const johnAuthor = createBlogAuthorEntry()
    const janeAuthor = createBlogAuthorEntry({ id: 'author-jane', slug: 'jane-doe', title: 'Jane Doe' })

    const postParty = createBlogPostEntry({
      id: 'post-party',
      slug: 'epic-party-night',
      title: 'Epic Party Night',
      description: 'Dance the night away at the ultimate celebration',
      bodyText: 'Dance floor, DJ set, and lights until dawn',
      publishedDate: '2024-03-01T00:00:00.000Z'
    })
    const postParticipate = createBlogPostEntry({
      id: 'post-participate',
      slug: 'participate-in-the-contest',
      title: 'Participate in the Contest',
      description: 'Join our latest wearable design competition',
      bodyText: 'Submit entries and win prizes',
      publishedDate: '2024-02-15T00:00:00.000Z'
    })
    const postRust = createBlogPostEntry({
      id: 'post-rust',
      slug: 'rust-deep-dive',
      title: 'Rust Deep Dive',
      description: 'Memory safety without a garbage collector',
      bodyText: 'Ownership, borrowing, and lifetimes explained',
      publishedDate: '2024-01-20T00:00:00.000Z'
    })
    const postJane = createBlogPostEntry({
      id: 'post-jane',
      slug: 'article-by-jane',
      title: 'An Ordinary Article',
      description: 'Nothing special here',
      bodyText: 'Just regular content',
      authorId: 'author-jane',
      publishedDate: '2024-02-01T00:00:00.000Z'
    })
    const postEvents = createBlogPostEntry({
      id: 'post-events',
      slug: 'weekly-meetup-recap',
      title: 'Weekly Meetup Recap',
      description: 'Highlights from the gathering',
      bodyText: 'A full house and great discussions',
      categoryId: 'cat-events',
      publishedDate: '2024-02-10T00:00:00.000Z'
    })
    const postEsOnly = createBlogPostEntry({
      id: 'post-es-only',
      slug: 'post-es-only',
      title: 'Nothing Interesting',
      description: 'Blank English description',
      titleEs: 'Fiesta Nocturna Inolvidable',
      descriptionEs: 'Una celebración única',
      bodyTextEs: 'Baile y música hasta el amanecer',
      publishedDate: '2024-01-10T00:00:00.000Z'
    })

    for (const entry of [
      techCategory,
      eventsCategory,
      johnAuthor,
      janeAuthor,
      postParty,
      postParticipate,
      postRust,
      postJane,
      postEvents,
      postEsOnly
    ]) {
      await postWebhook(entry)
    }
  })

  afterEach(() => {
    nock.cleanAll()
  })

  describe('and the query matches a single post by a unique title word', () => {
    it('should return only that post with a highlight and a rank', async () => {
      const response = await components.localFetch.fetch(
        `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/blog/posts?q=epic`
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.total).toBe(1)
      expect(body.items[0].fields.id).toBe('epic-party-night')
      expect(body.items[0]._rank).toBeGreaterThan(0)
      expect(body.items[0]._highlight.title).toContain('<em>')
      expect(body.items[0]._highlight.title).toContain('</em>')
    })
  })

  describe('and the query is a prefix shorter than the matched words', () => {
    it('should match every post whose indexed text starts with the prefix', async () => {
      const response = await components.localFetch.fetch(
        `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/blog/posts?q=par`
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      const ids = body.items.map((item: { fields: { id: string } }) => item.fields.id).sort()
      expect(ids).toEqual(['epic-party-night', 'participate-in-the-contest'])
    })
  })

  describe('and the query is multiple words', () => {
    it('should require every word to match (AND semantics)', async () => {
      const response = await components.localFetch.fetch(
        `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/blog/posts?q=dance+party`
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.total).toBe(1)
      expect(body.items[0].fields.id).toBe('epic-party-night')
    })
  })

  describe('and the query matches the body of a post', () => {
    it('should return the post and highlight the body snippet', async () => {
      const response = await components.localFetch.fetch(
        `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/blog/posts?q=lifetimes`
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.total).toBe(1)
      expect(body.items[0].fields.id).toBe('rust-deep-dive')
      expect(body.items[0]._highlight.body).toContain('<em>')
    })
  })

  describe('and the query matches an author name', () => {
    it('should return posts authored by that author', async () => {
      const response = await components.localFetch.fetch(
        `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/blog/posts?q=jane`
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.items.map((item: { fields: { id: string } }) => item.fields.id)).toContain('article-by-jane')
    })
  })

  describe('and the query matches a category name', () => {
    it('should return posts in that category', async () => {
      const response = await components.localFetch.fetch(
        `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/blog/posts?q=meetups`
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.items.map((item: { fields: { id: string } }) => item.fields.id)).toContain('weekly-meetup-recap')
    })
  })

  describe('and the query targets Spanish-only content with locale=es', () => {
    it('should match the Spanish text', async () => {
      const response = await components.localFetch.fetch(
        `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/blog/posts?q=fiesta&locale=es`
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.items.map((item: { sys: { id: string } }) => item.sys.id)).toContain('post-es-only')
    })
  })

  describe('and the same Spanish-only query is run with locale=en-US', () => {
    it('should not match because the English fields do not contain the word', async () => {
      const response = await components.localFetch.fetch(
        `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/blog/posts?q=fiesta&locale=en-US`
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.total).toBe(0)
    })
  })

  describe('and q is combined with a category filter', () => {
    it('should narrow to the intersection', async () => {
      const response = await components.localFetch.fetch(
        `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/blog/posts?q=meetup&category=events`
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.total).toBe(1)
      expect(body.items[0].fields.id).toBe('weekly-meetup-recap')
    })
  })

  describe('and q contains only whitespace', () => {
    it('should behave like no q and return all posts sorted by date', async () => {
      const response = await components.localFetch.fetch(
        `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/blog/posts?q=%20%20`
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.total).toBe(6)
      expect(body.items[0]._rank).toBeUndefined()
    })
  })

  describe('and q is longer than the 200-character cap', () => {
    it('should return 400', async () => {
      const longQ = 'x'.repeat(201)
      const response = await components.localFetch.fetch(
        `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/blog/posts?q=${longQ}`
      )
      expect(response.status).toBe(400)
    })
  })

  describe('and q matches no posts', () => {
    it('should return an empty result', async () => {
      const response = await components.localFetch.fetch(
        `/spaces/${TEST_SPACE}/environments/${TEST_ENVIRONMENT}/blog/posts?q=zzzzznonexistent`
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.total).toBe(0)
      expect(body.items).toHaveLength(0)
    })
  })
})
