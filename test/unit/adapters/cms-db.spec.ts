import { buildPrefixTsQuery } from '../../../src/adapters/cms-db'

describe('when building a prefix tsquery from a user-supplied search string', () => {
  describe('and the string is a single word', () => {
    it('should produce a single prefix term', () => {
      expect(buildPrefixTsQuery('party')).toBe('party:*')
    })
  })

  describe('and the string contains multiple whitespace-separated words', () => {
    it('should AND each word as a prefix term', () => {
      expect(buildPrefixTsQuery('online party')).toBe('online:* & party:*')
    })
  })

  describe('and the string contains tsquery metacharacters', () => {
    it('should strip them so they cannot break the query', () => {
      expect(buildPrefixTsQuery('party & time | !foo')).toBe('party:* & time:* & foo:*')
    })
  })

  describe('and the string contains punctuation and quotes', () => {
    it('should treat punctuation as whitespace', () => {
      expect(buildPrefixTsQuery('"decentraland\'s" party, prom.')).toBe('decentraland:* & s:* & party:* & prom:*')
    })
  })

  describe('and the string contains unicode letters and digits', () => {
    it('should preserve them as usable tokens', () => {
      expect(buildPrefixTsQuery('café 2024')).toBe('café:* & 2024:*')
    })
  })

  describe('and the string collapses to whitespace after sanitization', () => {
    it('should return null', () => {
      expect(buildPrefixTsQuery('   ')).toBeNull()
      expect(buildPrefixTsQuery('&&&&')).toBeNull()
      expect(buildPrefixTsQuery('')).toBeNull()
    })
  })
})
