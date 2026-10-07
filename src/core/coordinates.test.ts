import { describe, expect, it } from 'vitest'
import { parseCoordinates } from './coordinates'
import { formatArea, formatLength } from './format'

describe('parseCoordinates', () => {
  it.each([
    ['20.5888, -100.3899', [-100.3899, 20.5888]],
    ['20.5888 -100.3899', [-100.3899, 20.5888]],
    ['(20.5888, -100.3899)', [-100.3899, 20.5888]],
    ['geo:20.5888,-100.3899', [-100.3899, 20.5888]],
    ['geo:20.5888,-100.3899;u=35', [-100.3899, 20.5888]],
    ['20,5888 -100,3899', [-100.3899, 20.5888]],
  ])('reads latitude-first decimals: %s', (text, expected) => {
    expect(parseCoordinates(text)).toEqual(expected)
  })

  it('reads longitude first when the first number cannot be a latitude', () => {
    expect(parseCoordinates('-100.3899, 20.5888')).toEqual([-100.3899, 20.5888])
  })

  it('reads degrees, minutes and seconds with hemispheres', () => {
    const p = parseCoordinates(`20°35'19.7"N 100°23'23.6"W`)!
    expect(p[1]).toBeCloseTo(20.588806, 5)
    expect(p[0]).toBeCloseTo(-100.389889, 5)
  })

  it('reads leading hemispheres and decimal minutes', () => {
    const p = parseCoordinates(`N 20° 35.328' W 100° 23.393'`)!
    expect(p[1]).toBeCloseTo(20.5888, 4)
    expect(p[0]).toBeCloseTo(-100.38988, 4)
  })

  it('reads "O" (oeste) as west', () => {
    expect(parseCoordinates(`20°35'N 100°23'O`)![0]).toBeLessThan(0)
  })

  it.each(['Avenida Universidad 12', '', '200, 300', '20.5'])('returns null for %j', (text) => {
    expect(parseCoordinates(text)).toBeNull()
  })
})

describe('formatting measurements', () => {
  it('picks the unit by magnitude', () => {
    expect(formatArea(850, 'en')).toBe('850 m²')
    expect(formatArea(124_000, 'en')).toBe('12.4 ha')
    expect(formatArea(3_250_000, 'en')).toBe('3.25 km²')
    expect(formatLength(350.26, 'en')).toBe('350.3 m')
    expect(formatLength(1250, 'en')).toBe('1.25 km')
  })

  it('follows the locale', () => {
    expect(formatArea(124_000, 'es')).toBe('12,4 ha')
  })
})
