import { test } from '../components'

test('when requesting an unknown route', ({ components }) => {
  it('should respond with 404', async () => {
    const response = await components.localFetch.fetch('/unknown/path')
    expect(response.status).toBe(404)
  })
})
