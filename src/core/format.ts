/**
 * Human-readable measurements. The unit follows the magnitude: square metres
 * for a block, hectares for a neighbourhood, square kilometres for a town.
 */

function number(value: number, locale: string | undefined, digits: number): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)
}

export function formatArea(squareMetres: number, locale?: string): string {
  if (squareMetres < 10_000) return `${number(squareMetres, locale, 0)} m²`
  if (squareMetres < 1_000_000) return `${number(squareMetres / 10_000, locale, 2)} ha`
  return `${number(squareMetres / 1_000_000, locale, 2)} km²`
}

export function formatLength(metres: number, locale?: string): string {
  if (metres < 1000) return `${number(metres, locale, metres < 10 ? 2 : 1)} m`
  return `${number(metres / 1000, locale, 2)} km`
}
