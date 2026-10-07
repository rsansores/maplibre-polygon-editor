import type { Position } from './types'

/**
 * Turn what people paste into a position. Accepted, in order:
 *
 * - `geo:20.5888,-100.3899` URIs;
 * - degrees–minutes–seconds with hemispheres:
 *   `20°35'19.7"N 100°23'23.6"W`, `N 20° 35.328' W 100° 23.393'`;
 * - two decimal numbers, `20.5888, -100.3899` — latitude first, the order
 *   Google Maps copies and most people say out loud. When the first number
 *   cannot be a latitude (|value| > 90) the pair is read as longitude,
 *   latitude instead.
 *
 * Returns `null` for anything else, so a search box can fall through to a
 * geocoder.
 */
export function parseCoordinates(text: string): Position | null {
  const input = text.trim().replace(/^geo:/i, '').split(/[;?]/)[0]!.trim()
  return parseDms(input) ?? parseDecimal(input)
}

const NUMBER = String.raw`[-+]?\d+(?:[.,]\d+)?`

function parseDecimal(input: string): Position | null {
  const match = new RegExp(String.raw`^\(?\s*(${NUMBER})\s*[,\s]\s*(${NUMBER})\s*\)?$`).exec(input)
  if (!match) {
    // "20,5888 -100,3899" (decimal commas) never reaches here as two numbers
    // with a comma separator, so try a whitespace split with comma decimals.
    const parts = input.split(/\s+/)
    if (parts.length !== 2 || !parts.every((p) => /^[-+]?\d+,\d+$/.test(p))) return null
    return order(Number(parts[0]!.replace(',', '.')), Number(parts[1]!.replace(',', '.')))
  }
  return order(Number(match[1]!.replace(',', '.')), Number(match[2]!.replace(',', '.')))
}

function order(first: number, second: number): Position | null {
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null
  if (Math.abs(first) <= 90 && Math.abs(second) <= 180) return [second, first]
  if (Math.abs(second) <= 90 && Math.abs(first) <= 180) return [first, second]
  return null
}

// Degrees, then optional minutes, then optional seconds.
const DMS = String.raw`(\d+(?:\.\d+)?)\s*[°ºd]\s*(?:(\d+(?:\.\d+)?)\s*['′m]\s*)?(?:(\d+(?:\.\d+)?)\s*(?:"|″|''|s)\s*)?`
// The hemisphere either leads every value ("N 20° W 100°") or trails it
// ("20°N 100°W"); reading the whole string one way avoids a trailing "N"
// being mistaken for the leading letter of the next value.
const LEADING = new RegExp(String.raw`([NSEWO])\s*${DMS}`, 'gi')
const TRAILING = new RegExp(String.raw`${DMS}([NSEWO])?`, 'gi')

function parseDms(input: string): Position | null {
  if (!/[°º′″']/.test(input)) return null
  const leading = /^[NSEWO]/i.test(input)
  let lat: number | null = null
  let lng: number | null = null
  for (const m of input.matchAll(leading ? LEADING : TRAILING)) {
    const [hemisphereText, deg, min, sec] = leading ? [m[1], m[2], m[3], m[4]] : [m[4], m[1], m[2], m[3]]
    if (!deg) continue
    const hemisphere = (hemisphereText ?? '').toUpperCase()
    const value = Number(deg) + Number(min ?? 0) / 60 + Number(sec ?? 0) / 3600
    // "O" is oeste — west — in Spanish-language coordinates.
    const signed = hemisphere === 'S' || hemisphere === 'W' || hemisphere === 'O' ? -value : value
    if (hemisphere === 'N' || hemisphere === 'S') lat = signed
    else if (hemisphere === 'E' || hemisphere === 'W' || hemisphere === 'O') lng = signed
    else if (lat === null) lat = signed
    else lng = signed
  }
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return [lng, lat]
}
