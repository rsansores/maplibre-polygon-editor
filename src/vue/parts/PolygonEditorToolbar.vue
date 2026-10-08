<script setup lang="ts">
// Modes, history, helper toggles and file actions. Every action here is also
// on the context, so a host can put any of them in its own toolbar instead.
import { computed, ref } from 'vue'
import type { Mode } from '../../core/editor'
import { usePolygonEditorContext } from '../usePolygonEditor'
import PeIcon, { type IconName } from './PeIcon.vue'

withDefaults(defineProps<{ files?: boolean }>(), { files: true })

const editor = usePolygonEditorContext()
const { t } = editor
const state = editor.state
const fileInput = ref<HTMLInputElement>()

const allModes: { mode: Mode; icon: IconName; label: string; tip: string }[] = [
  { mode: 'select', icon: 'select', label: 'modeSelect', tip: 'modeSelectTip' },
  { mode: 'draw', icon: 'draw', label: 'modeDraw', tip: 'modeDrawTip' },
  { mode: 'cut', icon: 'cut', label: 'modeCut', tip: 'modeCutTip' },
]

// Drawing and cutting both make a new area.
const modes = computed(() => allModes.filter((m) => m.mode === 'select' || state.value.canCreate))

const drafting = computed(() => state.value.draft.length > 0)

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) await editor.importFile(file)
}
</script>

<template>
  <div class="pe-toolbar pe-part" role="toolbar">
    <div v-if="!state.readonly" class="pe-segmented" role="group">
      <button
        v-for="m in modes"
        :key="m.mode"
        type="button"
        class="pe-btn"
        :aria-pressed="state.mode === m.mode"
        :title="t(m.tip)"
        :data-mode="m.mode"
        @click="editor.setMode(m.mode)"
      >
        <PeIcon :name="m.icon" />
        <span>{{ t(m.label) }}</span>
      </button>
    </div>

    <template v-if="drafting">
      <button type="button" class="pe-btn pe-btn--primary" :disabled="state.pending" @click="editor.finish()">
        <PeIcon name="check" />
        {{ t('finish') }}
      </button>
      <button type="button" class="pe-btn pe-btn--outline" @click="editor.cancel()">
        {{ t('cancel') }}
      </button>
    </template>

    <div v-if="!state.readonly" class="pe-toolbar__group">
      <button
        type="button"
        class="pe-btn pe-btn--icon"
        :title="t('undo')"
        :aria-label="t('undo')"
        :disabled="!state.canUndo && !drafting"
        @click="editor.undo()"
      >
        <PeIcon name="undo" />
      </button>
      <button
        type="button"
        class="pe-btn pe-btn--icon"
        :title="t('redo')"
        :aria-label="t('redo')"
        :disabled="!state.canRedo"
        @click="editor.redo()"
      >
        <PeIcon name="redo" />
      </button>
    </div>

    <template v-if="!state.readonly">
      <span class="pe-toolbar__sep" aria-hidden="true" />
      <div class="pe-toolbar__group">
        <button
          type="button"
          class="pe-btn"
          :aria-pressed="state.snapping"
          :title="t('snappingTip')"
          @click="editor.setSnapping(!state.snapping)"
        >
          <PeIcon name="magnet" />
          <span>{{ t('snapping') }}</span>
        </button>
        <button
          type="button"
          class="pe-btn"
          :aria-pressed="state.tracing"
          :title="t('tracingTip')"
          @click="editor.setTracing(!state.tracing)"
        >
          <PeIcon name="trace" />
          <span>{{ t('tracing') }}</span>
        </button>
        <button
          v-if="state.canFollowRoads"
          type="button"
          class="pe-btn"
          :aria-pressed="state.followRoads"
          :title="t('followRoadsTip')"
          @click="editor.setFollowRoads(!state.followRoads)"
        >
          <PeIcon name="route" />
          <span>{{ t('followRoads') }}</span>
        </button>
      </div>
    </template>

    <span class="pe-toolbar__spacer" />

    <div class="pe-toolbar__group">
      <button
        type="button"
        class="pe-btn pe-btn--icon"
        :title="t('fitAll')"
        :aria-label="t('fitAll')"
        :disabled="state.areas.length === 0"
        @click="editor.fitAll()"
      >
        <PeIcon name="fit" />
      </button>
      <template v-if="files">
        <button
          v-if="!state.readonly && state.canCreate"
          type="button"
          class="pe-btn pe-btn--icon"
          :title="t('importTip')"
          :aria-label="t('import')"
          @click="fileInput?.click()"
        >
          <PeIcon name="upload" />
        </button>
        <button
          type="button"
          class="pe-btn pe-btn--icon"
          :title="t('exportTip')"
          :aria-label="t('export')"
          :disabled="state.areas.length === 0"
          @click="editor.exportGeoJSON()"
        >
          <PeIcon name="download" />
        </button>
        <input
          ref="fileInput"
          class="pe-visually-hidden"
          type="file"
          accept=".geojson,.json,.kml,application/geo+json,application/vnd.google-earth.kml+xml"
          tabindex="-1"
          aria-hidden="true"
          @change="onFile"
        />
      </template>
    </div>
  </div>
</template>
