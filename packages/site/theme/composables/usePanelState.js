import { ref, computed } from 'vue'

const activePanel = ref(null)

export function usePanelState(name) {
  const isOwner = computed(() => activePanel.value === name)

  function tryOpen() {
    if (activePanel.value && activePanel.value !== name) return false
    activePanel.value = name
    return true
  }

  function close() {
    if (activePanel.value === name) {
      activePanel.value = null
    }
  }

  const isBlocked = computed(() => activePanel.value !== null && activePanel.value !== name)

  return { isOwner, isBlocked, tryOpen, close }
}
