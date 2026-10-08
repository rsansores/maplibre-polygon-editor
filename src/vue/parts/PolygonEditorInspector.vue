<script setup lang="ts">
// The selected area: its name, measurements and actions; and, when a corner
// is selected, that corner's exact coordinates. Typed coordinates are how a
// border is placed where the map has nothing to snap to.
import { computed, ref, watch } from 'vue'
import { formatArea, formatLength } from '../../core/format'
import { usePolygonEditorContext } from '../usePolygonEditor'
import PeIcon from './PeIcon.vue'

const editor = usePolygonEditorContext()
const { t } = editor

const area = editor.selectedArea
const vertex = editor.selectedVertex
const readonly = computed(() => editor.state.value.readonly || area.value?.locked === true)
const metrics = computed(() => (area.value ? editor.metrics(area.value) : null))
// A merge keeps this area and deletes the other one.
const neighbours = computed(() =>
  area.value && !readonly.value ? editor.neighbours(area.value.id).filter((n) => editor.canDelete(n)) : [],
)

const name = ref('')
watch(
  () => area.value && editor.nameOf(area.value),
  (n) => (name.value = n ?? ''),
  { immediate: true },
)
function commitName() {
  const a = area.value
  const next = name.value.trim()
  if (a && next && next !== editor.nameOf(a)) editor.rename(a.id, next)
}

const lat = ref('')
const lng = ref('')
watch(
  () => vertex.value?.position,
  (p) => {
    lat.value = p ? String(p[1]) : ''
    lng.value = p ? String(p[0]) : ''
  },
  { immediate: true },
)
function applyCoordinates() {
  const y = Number(lat.value.replace(',', '.'))
  const x = Number(lng.value.replace(',', '.'))
  editor.setVertexPosition([x, y])
}

const mergeTarget = ref('')
function merge() {
  if (area.value && mergeTarget.value) editor.merge(area.value.id, mergeTarget.value)
  mergeTarget.value = ''
}

const shared = computed(() => {
  const n = vertex.value?.sharedWith ?? 0
  return n === 0 ? '' : n === 1 ? t('sharedVertexOne') : t('sharedVertex', { n })
})
</script>

<template>
  <section class="pe-inspector pe-part" :aria-label="t('area')">
    <div v-if="!area" class="pe-empty">
      <p>{{ t('nothingSelected') }}</p>
    </div>

    <template v-else>
      <h3 class="pe-heading">{{ t('area') }}</h3>
      <div class="pe-inspector__body">
        <label class="pe-field">
          <span class="pe-field__label">{{ t('name') }}</span>
          <input
            v-model="name"
            class="pe-input"
            :readonly="readonly"
            @blur="commitName"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
          />
        </label>

        <dl v-if="metrics" class="pe-metrics">
          <div>
            <dt>{{ t('size') }}</dt>
            <dd>{{ formatArea(metrics.area, editor.locale()) }}</dd>
          </div>
          <div>
            <dt>{{ t('perimeter') }}</dt>
            <dd>{{ formatLength(metrics.perimeter, editor.locale()) }}</dd>
          </div>
          <div>
            <dt>{{ t('vertices') }}</dt>
            <dd>{{ metrics.vertices }}</dd>
          </div>
        </dl>

        <p v-if="area.locked" class="pe-note"><PeIcon name="lock" /> {{ t('lockedHint') }}</p>

        <fieldset v-if="vertex && !readonly" class="pe-field pe-fieldset">
          <legend class="pe-field__label">{{ t('selectedVertex') }}</legend>
          <form class="pe-row" @submit.prevent="applyCoordinates">
            <label class="pe-field">
              <span class="pe-field__label">{{ t('latitude') }}</span>
              <input v-model="lat" class="pe-input pe-input--mono" inputmode="decimal" name="lat" />
            </label>
            <label class="pe-field">
              <span class="pe-field__label">{{ t('longitude') }}</span>
              <input v-model="lng" class="pe-input pe-input--mono" inputmode="decimal" name="lng" />
            </label>
            <button type="submit" class="pe-btn pe-btn--outline">{{ t('applyCoordinates') }}</button>
          </form>
          <p v-if="shared" class="pe-note">{{ shared }}</p>
          <div class="pe-actions">
            <button type="button" class="pe-btn pe-btn--danger" @click="editor.deleteVertex()">
              <PeIcon name="trash" />
              {{ t('deleteVertex') }}
            </button>
          </div>
        </fieldset>

        <div v-if="!readonly" class="pe-actions">
          <select
            v-if="neighbours.length > 0"
            v-model="mergeTarget"
            class="pe-select"
            :title="t('mergeHint')"
            :aria-label="t('mergeWith')"
            @change="merge"
          >
            <option value="" disabled>{{ t('mergeWith') }}</option>
            <option v-for="n in neighbours" :key="n.id" :value="n.id">{{ editor.nameOf(n) }}</option>
          </select>
          <button
            v-if="editor.canDelete(area)"
            type="button"
            class="pe-btn pe-btn--danger"
            @click="editor.deleteArea(area.id)"
          >
            <PeIcon name="trash" />
            {{ t('deleteArea') }}
          </button>
        </div>
      </div>
    </template>
  </section>
</template>
