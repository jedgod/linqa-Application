<template>
  <Debouncing v-slot="{ locked, run }" :ms="JOIN_LOCK_MS">
    <button
      type="button"
      :disabled="locked || !joinable"
      :aria-label="joinable ? 'Join call' : 'Join opens 10 minutes before the call'"
      :class="[
        'px-4 py-2 rounded font-semibold transition-colors duration-200',
        joinable ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-gray-400 cursor-not-allowed',
        locked ? 'opacity-50 cursor-wait' : '',
      ]"
      @click="run(() => handleJoin())"
    >
      {{ locked ? "Joining..." : "Join" }}
    </button>
  </Debouncing>
</template>

<script setup>
import Debouncing from "../../Debouncing.vue";
import { JOIN_LOCK_MS, joinCall } from "../api";

const props = defineProps({
  joinable: { type: Boolean, required: true },
  callId: { type: [String, Number], required: true },
});
const emit = defineEmits(["joined", "error"]);

// Returns false when nothing started, which releases the lock so the person can try again.
async function handleJoin() {
  const result = await joinCall(String(props.callId));
  if (result.success) {
    emit("joined", props.callId, result);
    return true;
  }
  emit("error", result.error);
  return false;
}
</script>
