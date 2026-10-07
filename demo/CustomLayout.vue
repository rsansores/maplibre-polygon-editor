<script setup lang="ts">
// A host layout built from the headless core: its own buttons, the map part
// and the list part, no default toolbar or side panel. This is how an app with
// its own design system embeds the editor.
import type { StyleSpecification } from 'maplibre-gl'
import {
  PolygonEditorAreaList,
  PolygonEditorInspector,
  PolygonEditorMap,
  usePolygonEditor,
  type Area,
  type MapBindingOptions,
} from '../src'
import { DEMO_CENTER } from './basemap'

const props = defineProps<{
  mapStyle: string | StyleSpecification
  snapLayers: MapBindingOptions['snapLayers']
}>()
const areas = defineModel<Area[]>({ required: true })

const editor = usePolygonEditor({
  modelValue: areas,
  onUpdate: (next) => (areas.value = next),
  snapLayers: props.snapLayers,
})
const state = editor.state
</script>

<template>
  <div class="custom">
    <div class="custom__bar">
      <button
        type="button"
        class="custom__btn"
        :class="{ on: state.mode === 'select' }"
        @click="editor.setMode('select')"
      >
        Select
      </button>
      <button
        type="button"
        class="custom__btn"
        :class="{ on: state.mode === 'draw' }"
        @click="editor.setMode('draw')"
      >
        Draw
      </button>
      <button
        type="button"
        class="custom__btn"
        :class="{ on: state.mode === 'cut' }"
        @click="editor.setMode('cut')"
      >
        Cut
      </button>
      <button type="button" class="custom__btn" :disabled="!state.canUndo" @click="editor.undo()">
        Undo
      </button>
      <span class="custom__hint">{{ editor.hint.value }}</span>
    </div>
    <div class="custom__body">
      <PolygonEditorMap :map-style="mapStyle" :center="DEMO_CENTER" :zoom="14" />
      <div class="custom__side">
        <PolygonEditorAreaList />
        <PolygonEditorInspector />
      </div>
    </div>
  </div>
</template>

<style>
.custom {
  display: flex;
  flex-direction: column;
  height: 100%;
  border: 2px dashed var(--color-primary);
  border-radius: 12px;
  overflow: hidden;
}
.custom__bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
}
.custom__btn {
  padding: 0.375rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.custom__btn.on {
  background: var(--color-primary);
  color: var(--color-primary-foreground);
}
.custom__hint {
  color: var(--color-muted-foreground);
  font-size: 0.8125rem;
}
.custom__body {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 18rem;
  min-height: 0;
}
.custom__side {
  overflow: auto;
  border-left: 1px solid var(--color-border);
}
</style>
