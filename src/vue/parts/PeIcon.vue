<script setup lang="ts">
// Stroke icons on a 24-unit grid, drawn for this package so it carries no
// icon-set dependency. Decorative: buttons carry their own accessible name.
const PATHS = {
  select: 'M5 3l13 7-6 1.5L9 18z',
  draw: 'M4 18l4-12 9 3-3 9zM4 18l4-12M8 6a1.5 1.5 0 1 0 0 .01M17 9a1.5 1.5 0 1 0 0 .01M14 18a1.5 1.5 0 1 0 0 .01',
  cut: 'M6 6a3 3 0 1 0 0 .01M6 18a3 3 0 1 0 0 .01M8.5 7.5L20 18M8.5 16.5L20 6',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  magnet: 'M6 4v7a6 6 0 0 0 12 0V4M6 4h4v7a2 2 0 0 0 4 0V4h4M6 8h4M14 8h4',
  trace: 'M4 20c3-8 6-1 8-8s5 0 8-8M4 20a1 1 0 1 0 0 .01M20 4a1 1 0 1 0 0 .01',
  route: 'M6 19a2 2 0 1 0 0 .01M18 5a2 2 0 1 0 0 .01M6 17V9a3 3 0 0 1 6 0v6a3 3 0 0 0 6 0V7',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  upload: 'M12 15V4M7 9l5-5 5 5M5 20h14',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  check: 'M5 12l5 5L20 7',
  close: 'M6 6l12 12M18 6L6 18',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  merge: 'M7 4v5a5 5 0 0 0 5 5 5 5 0 0 1 5 5v1M17 4v5a5 5 0 0 1-3 4.6M4 7l3-3 3 3M14 7l3-3 3 3',
  pin: 'M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12zM12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  plus: 'M12 5v14M5 12h14',
  alert: 'M12 3l10 18H2zM12 10v5M12 18v.01',
} as const

export type IconName = keyof typeof PATHS

defineProps<{ name: IconName }>()
</script>

<template>
  <svg
    class="pe-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path :d="PATHS[name]" />
  </svg>
</template>
