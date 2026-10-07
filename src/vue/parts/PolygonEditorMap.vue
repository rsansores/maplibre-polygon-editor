<script setup lang="ts">
// The map, with the editor attached and its overlays (hint, measurements,
// messages) drawn on top. A host that already owns a MapLibre map does not
// need this part: call `attach(map)` from the context and place
// `PolygonEditorOverlays` over that map instead.
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import {
  Map as MapLibreMap,
  NavigationControl,
  ScaleControl,
  type MapOptions,
  type StyleSpecification,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Position } from '../../core/types'
import { usePolygonEditorContext } from '../usePolygonEditor'
import PolygonEditorOverlays from './PolygonEditorOverlays.vue'

const props = withDefaults(
  defineProps<{
    /** A MapLibre style URL or object. */
    mapStyle: string | StyleSpecification
    center?: Position
    zoom?: number
    /** Fit the map to the areas once they are first available, instead of `center`/`zoom`. */
    fitAreas?: boolean
    /** Anything else MapLibre accepts. */
    mapOptions?: Partial<MapOptions>
    /** Zoom buttons and a scale bar. */
    controls?: boolean
  }>(),
  { center: () => [0, 20], zoom: 2, fitAreas: true, controls: true, mapOptions: undefined },
)

const emit = defineEmits<{ ready: [map: MapLibreMap] }>()

const editor = usePolygonEditorContext()
const container = ref<HTMLDivElement>()
const map = shallowRef<MapLibreMap | null>(null)

onMounted(() => {
  const instance = new MapLibreMap({
    container: container.value!,
    style: props.mapStyle,
    center: props.center,
    zoom: props.zoom,
    maxZoom: 22,
    ...props.mapOptions,
  })
  if (props.controls) {
    instance.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    instance.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-right')
  }
  map.value = instance
  editor.attach(instance)
  instance.once('load', () => {
    if (props.fitAreas && editor.areas.value.length > 0) editor.fitAll()
    emit('ready', instance)
  })
})

watch(
  () => props.mapStyle,
  (style) => map.value?.setStyle(style),
)

onBeforeUnmount(() => {
  editor.detach()
  map.value?.remove()
  map.value = null
})

defineExpose({ map })
</script>

<template>
  <div class="pe-map pe-part">
    <div ref="container" class="pe-map__canvas" />
    <PolygonEditorOverlays />
  </div>
</template>
