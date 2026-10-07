// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { area, square } from '../../test-support/fixtures'
import type { Area } from '../../core/types'
import { usePolygonEditor, type PolygonEditorOptions } from '../usePolygonEditor'
import PolygonEditorAreaList from './PolygonEditorAreaList.vue'

function mountList(options: PolygonEditorOptions) {
  const Host = defineComponent({
    setup() {
      usePolygonEditor({ locale: 'en', ...options })
      return () => h(PolygonEditorAreaList)
    },
  })
  const el = document.createElement('div')
  createApp(Host).mount(el)
  const names = () => [...el.querySelectorAll('.pe-list-item__name')].map((n) => n.textContent)
  const count = () => el.querySelector('.pe-count')?.textContent
  const swatches = () =>
    [...el.querySelectorAll<HTMLElement>('.pe-swatch')].map((s) => s.style.getPropertyValue('background'))
  return { names, count, swatches }
}

const areas = (): Area[] => [
  area('a', square(0, 0, 0.01)),
  { ...area('theirs', square(0.01, 0, 0.01)), locked: true },
  area('b', square(0.02, 0, 0.01)),
]

describe('PolygonEditorAreaList', () => {
  it('lists every area by default', () => {
    const { names, count } = mountList({ modelValue: areas() })
    expect(names()).toEqual(['a', 'theirs', 'b'])
    expect(count()).toBe('3')
  })

  it('leaves out the areas `listed` rejects, keeping each swatch the colour the map gives it', () => {
    const { names, count, swatches } = mountList({ modelValue: areas(), listed: (a) => !a.locked })
    expect(names()).toEqual(['a', 'b'])
    expect(count()).toBe('2')
    expect(swatches()).toEqual(['var(--pe-area-1)', 'var(--pe-area-3)'])
  })

  it('follows reactive data the predicate reads', async () => {
    const showLocked = ref(false)
    const { names } = mountList({ modelValue: areas(), listed: (a) => showLocked.value || !a.locked })
    expect(names()).toEqual(['a', 'b'])
    showLocked.value = true
    await nextTick()
    expect(names()).toEqual(['a', 'theirs', 'b'])
  })
})
