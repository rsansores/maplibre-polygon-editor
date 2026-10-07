import { describe, expect, it, vi } from 'vitest'
import { photonGeocoder } from './geocoding'
import { osrmRouter } from './routing'

function fakeFetch(body: unknown, ok = true) {
  return vi.fn(
    async (_url: string | URL | Request) =>
      ({ ok, status: ok ? 200 : 500, json: async () => body }) as Response,
  )
}

describe('photonGeocoder', () => {
  it('asks near the map centre and labels results like an address', async () => {
    const fetch = fakeFetch({
      features: [
        {
          geometry: { coordinates: [-100.39, 20.59] },
          properties: {
            name: 'Jardín Zenea',
            street: 'Avenida Madero',
            city: 'Santiago de Querétaro',
            state: 'Querétaro',
            extent: [-100.391, 20.592, -100.389, 20.588],
          },
        },
      ],
    })
    const geocode = photonGeocoder({ url: 'https://photon.example/', fetch })
    const [result] = await geocode('zenea', { near: [-100.4, 20.6], language: 'en' })
    const url = new URL(String(fetch.mock.calls[0]![0]))
    expect(url.pathname).toBe('/api')
    expect(url.searchParams.get('q')).toBe('zenea')
    expect(url.searchParams.get('lat')).toBe('20.6')
    expect(url.searchParams.get('lang')).toBe('en')
    expect(result).toEqual({
      label: 'Jardín Zenea, Avenida Madero, Santiago de Querétaro, Querétaro',
      position: [-100.39, 20.59],
      bbox: [-100.391, 20.588, -100.389, 20.592],
    })
  })

  it('leaves out a language the instance does not have', async () => {
    const fetch = fakeFetch({ features: [] })
    await photonGeocoder({ url: 'https://photon.example', fetch })('x', { language: 'es' })
    expect(new URL(String(fetch.mock.calls[0]![0])).searchParams.has('lang')).toBe(false)
  })

  it('throws on an error answer, so the UI can say the search failed', async () => {
    await expect(photonGeocoder({ url: 'https://p', fetch: fakeFetch({}, false) })('x', {})).rejects.toThrow()
  })
})

describe('osrmRouter', () => {
  it('returns the route geometry', async () => {
    const fetch = fakeFetch({
      code: 'Ok',
      routes: [
        {
          geometry: {
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
        },
      ],
    })
    const route = await osrmRouter({ url: 'https://osrm.example', fetch })([0, 0], [1, 1])
    expect(String(fetch.mock.calls[0]![0])).toContain('/route/v1/driving/0,0;1,1?')
    expect(route).toEqual([
      [0, 0],
      [1, 1],
    ])
  })

  it('returns null when there is no route', async () => {
    expect(
      await osrmRouter({ url: 'https://o', fetch: fakeFetch({ code: 'NoRoute' }) })([0, 0], [1, 1]),
    ).toBeNull()
    expect(await osrmRouter({ url: 'https://o', fetch: fakeFetch({}, false) })([0, 0], [1, 1])).toBeNull()
  })
})
