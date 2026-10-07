<script setup lang="ts">
// The default layout: toolbar on top, the map, and a side panel with search,
// the list of areas and the inspector. It measures its own width, not the
// window's — below `narrowWidth` the panel moves under the map.
import { onBeforeUnmount, onMounted, ref, toRef } from 'vue'
import type { Map as MapLibreMap, MapOptions, StyleSpecification } from 'maplibre-gl'
import type { LockedOverlapPolicy, OverlapPolicy } from '../core/editor'
import type { Router } from '../core/trace'
import type { Area, Position } from '../core/types'
import type { Geocoder } from '../adapters/geocoding'
import type { MapBindingOptions } from '../map/binding'
import type { Messages } from './i18n'
import { usePolygonEditor } from './usePolygonEditor'
import PolygonEditorAreaList from './parts/PolygonEditorAreaList.vue'
import PolygonEditorInspector from './parts/PolygonEditorInspector.vue'
import PolygonEditorMap from './parts/PolygonEditorMap.vue'
import PolygonEditorSearch from './parts/PolygonEditorSearch.vue'
import PolygonEditorToolbar from './parts/PolygonEditorToolbar.vue'

const props = withDefaults(
  defineProps<{
    mapStyle: string | StyleSpecification
    center?: Position
    zoom?: number
    mapOptions?: Partial<MapOptions>
    readonly?: boolean
    overlap?: OverlapPolicy
    lockedOverlap?: LockedOverlapPolicy
    decimals?: number
    geocoder?: Geocoder | null
    router?: Router | null
    snapLayers?: MapBindingOptions['snapLayers']
    locale?: string
    messages?: Messages
    /** Show import/export buttons. */
    files?: boolean
    /** Container width (px) below which the panel moves under the map. */
    narrowWidth?: number
  }>(),
  {
    center: undefined,
    zoom: undefined,
    mapOptions: undefined,
    readonly: false,
    overlap: 'clip',
    lockedOverlap: 'clip',
    decimals: undefined,
    geocoder: null,
    router: null,
    snapLayers: undefined,
    locale: undefined,
    messages: undefined,
    files: true,
    narrowWidth: 720,
  },
)

const areas = defineModel<Area[]>({ default: () => [] })
const emit = defineEmits<{ ready: [map: MapLibreMap] }>()

const editor = usePolygonEditor({
  modelValue: areas,
  onUpdate: (next) => (areas.value = next),
  readonly: toRef(props, 'readonly'),
  overlap: toRef(props, 'overlap'),
  lockedOverlap: toRef(props, 'lockedOverlap'),
  decimals: props.decimals,
  geocoder: toRef(props, 'geocoder'),
  router: toRef(props, 'router'),
  snapLayers: props.snapLayers,
  locale: toRef(props, 'locale'),
  messages: toRef(props, 'messages'),
})

const root = ref<HTMLElement>()
const narrow = ref(false)
let observer: ResizeObserver | undefined
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    narrow.value = (entry?.contentRect.width ?? Infinity) < props.narrowWidth
  })
  observer.observe(root.value!)
})
onBeforeUnmount(() => observer?.disconnect())

defineExpose({ editor })
</script>

<template>
  <div ref="root" class="pe-root" :class="{ 'pe-narrow': narrow }">
    <PolygonEditorToolbar :files="files" />
    <PolygonEditorMap
      :map-style="mapStyle"
      :center="center"
      :zoom="zoom"
      :map-options="mapOptions"
      @ready="(m) => emit('ready', m)"
    />
    <aside class="pe-side">
      <PolygonEditorSearch />
      <PolygonEditorAreaList />
      <PolygonEditorInspector />
    </aside>
  </div>
</template>
