<script setup lang="ts">
// What floats over the map: the hint for the current step, the length of the
// segment being drawn, and the last message. Positioned absolutely, so it can
// be dropped over any map container.
import { computed } from 'vue'
import { formatLength } from '../../core/format'
import { usePolygonEditorContext } from '../usePolygonEditor'
import PeIcon from './PeIcon.vue'

const editor = usePolygonEditorContext()
const { t } = editor

const snapLabel = computed(() => {
  switch (editor.cursor.value?.snap) {
    case 'vertex':
      return t('snapVertex')
    case 'edge':
      return t('snapEdge')
    case 'line':
    case 'line-vertex':
      return t('snapLine')
    default:
      return t('snapFree')
  }
})

const segment = computed(() => {
  const metres = editor.cursor.value?.segment
  return metres == null ? null : formatLength(metres, editor.locale())
})
</script>

<template>
  <div class="pe-overlays pe-part">
    <p v-if="editor.hint.value" class="pe-chip" role="status">{{ editor.hint.value }}</p>

    <div v-if="editor.cursor.value" class="pe-hud" aria-hidden="true">
      <span v-if="segment"
        ><span class="pe-hud__label">{{ t('segment') }}</span> {{ segment }}</span
      >
      <span>{{ snapLabel }}</span>
    </div>

    <div v-if="editor.issueMessage.value" class="pe-toast" role="alert">
      <PeIcon name="alert" />
      <span>{{ editor.issueMessage.value }}</span>
      <button
        type="button"
        class="pe-btn pe-btn--icon"
        :aria-label="t('dismiss')"
        @click="editor.dismissIssue()"
      >
        <PeIcon name="close" />
      </button>
    </div>
  </div>
</template>
