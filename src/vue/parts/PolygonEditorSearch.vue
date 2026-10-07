<script setup lang="ts">
// Find a place, or paste coordinates. A helper and never a gate: a failed or
// empty search says so and leaves the map fully usable, and pasted
// coordinates work with no geocoder at all — the way to place a corner exactly
// in an unmapped field.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { parseCoordinates } from '../../core/coordinates'
import type { GeocodeResult } from '../../adapters/geocoding'
import { usePolygonEditorContext } from '../usePolygonEditor'
import PeIcon from './PeIcon.vue'

const props = withDefaults(defineProps<{ debounceMs?: number; minLength?: number }>(), {
  debounceMs: 300,
  minLength: 3,
})

const editor = usePolygonEditorContext()
const { t } = editor

const query = ref('')
const results = ref<GeocodeResult[]>([])
const status = ref<'idle' | 'searching' | 'empty' | 'failed'>('idle')
let timer: ReturnType<typeof setTimeout> | undefined
let controller: AbortController | undefined

const coordinates = computed(() => parseCoordinates(query.value))
const drafting = computed(() => editor.state.value.mode !== 'select')

watch(query, (text) => {
  clearTimeout(timer)
  controller?.abort()
  results.value = []
  status.value = 'idle'
  const geocoder = editor.geocoder.value
  if (!geocoder || coordinates.value || text.trim().length < props.minLength) return
  timer = setTimeout(async () => {
    controller = new AbortController()
    status.value = 'searching'
    try {
      const found = await geocoder(text.trim(), {
        near: editor.binding.value?.center(),
        language: editor.locale().split('-')[0],
        signal: controller.signal,
      })
      results.value = found
      status.value = found.length === 0 ? 'empty' : 'idle'
    } catch (error) {
      if ((error as Error).name !== 'AbortError') status.value = 'failed'
    }
  }, props.debounceMs)
})

onBeforeUnmount(() => {
  clearTimeout(timer)
  controller?.abort()
})

function clear() {
  query.value = ''
  editor.clearPin()
}

function format(n: number) {
  return n.toFixed(6)
}
</script>

<template>
  <div class="pe-search pe-part">
    <div class="pe-search__box">
      <PeIcon name="search" />
      <input
        v-model="query"
        class="pe-input"
        type="search"
        :placeholder="t('searchPlaceholder')"
        :aria-label="t('searchPlaceholder')"
        @keydown.esc="clear"
      />
    </div>

    <ul v-if="coordinates || results.length > 0" class="pe-results">
      <li v-if="coordinates" class="pe-result">
        <button type="button" class="pe-list-item" @click="editor.goTo(coordinates)">
          <PeIcon name="pin" />
          {{ t('searchCoordinates', { lat: format(coordinates[1]), lng: format(coordinates[0]) }) }}
        </button>
        <button
          v-if="drafting"
          type="button"
          class="pe-btn pe-btn--icon"
          :title="t('searchAddPoint')"
          :aria-label="t('searchAddPoint')"
          @click="editor.addPoint(coordinates)"
        >
          <PeIcon name="plus" />
        </button>
      </li>
      <li v-for="(result, i) in results" :key="i" class="pe-result">
        <button type="button" class="pe-list-item" @click="editor.goTo(result.position, result.bbox)">
          <PeIcon name="pin" />
          {{ result.label }}
        </button>
        <button
          v-if="drafting"
          type="button"
          class="pe-btn pe-btn--icon"
          :title="t('searchAddPoint')"
          :aria-label="t('searchAddPoint')"
          @click="editor.addPoint(result.position)"
        >
          <PeIcon name="plus" />
        </button>
      </li>
    </ul>

    <p v-if="status === 'searching'" class="pe-search__status" role="status">{{ t('searching') }}</p>
    <p v-else-if="status === 'empty'" class="pe-search__status" role="status">{{ t('searchNoResults') }}</p>
    <p v-else-if="status === 'failed'" class="pe-search__status" role="status">{{ t('searchFailed') }}</p>
  </div>
</template>
