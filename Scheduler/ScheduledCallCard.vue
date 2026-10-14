<template>
  <div
    class="flex items-center justify-between p-4 bg-white border border-gray-100 rounded-xl shadow-sm"
  >
    <!-- Call Info Panel -->
    <div class="flex items-center gap-3">
      <div class="p-2.5 bg-blue-50 text-blue-600 rounded-lg">
        <svg
          xmlns="http://w3.org"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="2"
          stroke="currentColor"
          class="w-5 h-5"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"
          />
        </svg>
      </div>
      <div>
        <h4 class="text-sm font-semibold text-gray-900">
          Sync with {{ hostName }}
        </h4>
        <p class="text-xs text-gray-500 mt-0.5">
          Scheduled for:
          <span class="font-medium text-gray-700">{{
            formatDisplayTime(callTime)
          }}</span>
        </p>
      </div>
    </div>

    <!-- Active Actions Interface -->
    <div class="flex items-center gap-2">
      <!-- The "Join" interactive target action -->
      <button
        type="button"
        @click="$emit('join-call')"
        class="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg shadow-sm border text-white transition-all duration-150"
        :class="[
          isJoinable
            ? 'bg-emerald-600 hover:bg-emerald-700 border-emerald-600 animate-pulse'
            : 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed',
        ]"
        :disabled="!isJoinable"
      >
        <span v-if="isJoinable" class="relative flex h-2 w-2">
          <span
            class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"
          ></span>
          <span
            class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"
          ></span>
        </span>
        Join Call
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  hostName: { type: String, default: "Linqa Contact" },
  callTime: { type: String, required: true }, // Expects ISO String
});

defineEmits(["join-call"]);

// Helper to format string times safely
const formatDisplayTime = (isoString) => {
  if (!isoString) return "";
  return new Date(isoString).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
};

// Check if call time window is open (e.g. true if it is 5 mins before or anytime after scheduled time)
const isJoinable = computed(() => {
  if (!props.callTime) return false;
  const now = new Date();
  const scheduled = new Date(props.callTime);
  const timeDifferenceInMinutes = (scheduled - now) / 60000;

  // Allows joining if within 5 minutes of scheduled time window or if call is actively active/late
  return timeDifferenceInMinutes <= 5;
});
</script>
