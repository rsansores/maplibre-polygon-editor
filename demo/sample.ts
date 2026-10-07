import type { Area } from '../src'

/**
 * Three areas that tile part of the city centre and share their borders
 * vertex for vertex, plus a locked neighbour to show what "locked" means.
 * `Sur` holds the corner where `Centro` and `Oriente` meet — a T-junction —
 * so dragging that corner moves all three.
 */
export function sampleAreas(names: {
  centre: string
  east: string
  south: string
  neighbour: string
}): Area[] {
  return [
    {
      id: 'centro',
      properties: { name: names.centre },
      rings: [
        [
          [-100.4, 20.588],
          [-100.388, 20.588],
          [-100.388, 20.598],
          [-100.4, 20.598],
        ],
      ],
    },
    {
      id: 'oriente',
      properties: { name: names.east },
      rings: [
        [
          [-100.388, 20.588],
          [-100.376, 20.588],
          [-100.376, 20.598],
          [-100.388, 20.598],
        ],
      ],
    },
    {
      id: 'sur',
      properties: { name: names.south },
      rings: [
        [
          [-100.4, 20.58],
          [-100.376, 20.58],
          [-100.376, 20.588],
          [-100.388, 20.588],
          [-100.4, 20.588],
        ],
      ],
    },
    {
      id: 'vecino',
      locked: true,
      properties: { name: names.neighbour },
      rings: [
        [
          [-100.412, 20.58],
          [-100.4, 20.58],
          [-100.4, 20.588],
          [-100.4, 20.598],
          [-100.412, 20.598],
        ],
      ],
    },
  ]
}
