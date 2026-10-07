<script setup lang="ts">
// Every area, with its colour and size. Selecting one here selects it on the
// map; a double click also zooms to it.
import { computed } from 'vue'
import { formatArea } from '../../core/format'
import { usePolygonEditorContext } from '../usePolygonEditor'
import PeIcon from './PeIcon.vue'

const editor = usePolygonEditorContext()
const { t } = editor

const PALETTE = [
  '--pe-area-1',
  '--pe-area-2',
  '--pe-area-3',
  '--pe-area-4',
  '--pe-area-5',
  '--pe-area-6',
  '--pe-area-7',
  '--pe-area-8',
]

const rows = computed(() =>
  editor.areas.value.map((area, i) => ({
    area,
    name: editor.nameOf(area),
    size: formatArea(editor.metrics(area).area, editor.locale()),
    color:
      typeof area.properties.color === 'string'
        ? area.properties.color
        : `var(${PALETTE[i % PALETTE.length]})`,
  })),
)
</script>

<template>
  <section class="pe-list pe-part" :aria-label="t('areas')">
    <h3 class="pe-heading">
      <span>{{ t('areas') }}</span>
      <span class="pe-count">{{ rows.length }}</span>
    </h3>

    <div v-if="rows.length === 0" class="pe-empty">
      <p class="pe-empty__title">{{ t('noAreas') }}</p>
      <p v-if="!editor.state.value.readonly">{{ t('noAreasHint') }}</p>
    </div>

    <ul v-else class="pe-list__items">
      <li v-for="row in rows" :key="row.area.id">
        <button
          type="button"
          class="pe-list-item"
          :aria-current="row.area.id === editor.state.value.selectedId"
          @click="editor.select(row.area.id)"
          @dblclick="editor.fitArea(row.area.id)"
        >
          <span class="pe-swatch" :style="{ background: row.color }" />
          <span class="pe-list-item__text">
            <span class="pe-list-item__name">{{ row.name }}</span>
            <span class="pe-list-item__meta">{{ row.size }}</span>
          </span>
          <PeIcon v-if="row.area.locked" name="lock" :aria-label="t('locked')" />
        </button>
      </li>
    </ul>
  </section>
</template>
