<template>
  <div class="p-4 max-w-md mx-auto">
    <h2 class="text-xl font-bold mb-4">Upcoming Calls</h2>
    <p v-if="!calls.length" class="text-sm text-gray-500">No calls scheduled.</p>
    <ul>
      <li
        v-for="call in calls"
        :key="call.id"
        class="flex justify-between items-center p-3 mb-3 border rounded shadow-sm"
      >
        <div>
          <p class="font-semibold">{{ call.title }}</p>
          <p class="text-sm text-gray-600">{{ formatDate(call.time) }}</p>
        </div>
        <JoinButton
          :callId="call.id"
          :joinable="call.joinable"
          @joined="(id, result) => emit('joined', id, result)"
          @error="(message) => emit('error', message)"
        />
      </li>
    </ul>
  </div>
</template>

<script setup>
import JoinButton from "./JoinButton.vue";

defineProps({ calls: { type: Array, default: () => [] } });
const emit = defineEmits(["joined", "error"]);

function formatDate(isoString) {
  return new Date(isoString).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
</script>
