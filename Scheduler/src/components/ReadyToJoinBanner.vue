<template>
  <transition name="banner">
    <div
      v-if="showBanner"
      class="fixed top-4 inset-x-4 z-50 mx-auto max-w-sm flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-xl"
      role="status"
      aria-live="polite"
    >
      <p class="flex-1 text-sm font-semibold text-gray-900">
        Your call is ready to join
      </p>
      <Debouncing v-slot="{ locked, run }">
        <button
          type="button"
          :disabled="locked"
          class="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          @click="run(() => join(callId))"
        >
          {{ locked ? "Joining..." : "Join now" }}
        </button>
      </Debouncing>
    </div>
  </transition>
</template>

<script setup>
import Debouncing from "../../Debouncing.vue";

// `join` does the join and resolves false when nothing started, which frees the button to try again.
defineProps({
  callId: { type: [String, Number], required: true },
  showBanner: { type: Boolean, default: false },
  join: { type: Function, required: true },
});
</script>

<style scoped>
.banner-enter-from,
.banner-leave-to {
  opacity: 0;
  transform: translateY(-16px);
}
.banner-enter-active,
.banner-leave-active {
  transition: all 0.25s ease;
}
</style>
