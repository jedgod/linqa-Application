<template>
  <div>
    <p v-if="message" class="mx-auto max-w-md px-4 pt-3 text-sm text-red-600" role="alert">{{ message }}</p>
    <SchedulerUpcoming :calls="calls" @joined="onJoined" @error="onError" />
    <ReadyToJoinBanner
      v-if="nextCall"
      :callId="nextCall.id"
      :showBanner="showBanner"
      :join="joinFromBanner"
    />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import SchedulerUpcoming from "./SchedulerUpcoming.vue";
import ReadyToJoinBanner from "./ReadyToJoinBanner.vue";
import { fetchScheduledCalls, joinCall } from "../api";

const BANNER_LEAD_MS = 5 * 60 * 1000;

const calls = ref([]);
const now = ref(Date.now());
const message = ref("");
const joined = ref(new Set()); // calls already joined get no banner
let refreshTimer = null;
let clockTimer = null;

// The banner is for the first call that is about to start and can be joined.
const nextCall = computed(
  () => calls.value.find((c) => !joined.value.has(String(c.id)) && c.joinable && Date.parse(c.time) > now.value) ?? null,
);
const showBanner = computed(() => {
  if (!nextCall.value) return false;
  const diff = Date.parse(nextCall.value.time) - now.value;
  return diff <= BANNER_LEAD_MS && diff > 0;
});

async function refresh() {
  try {
    calls.value = await fetchScheduledCalls();
    message.value = "";
  } catch {
    message.value = "Could not load your scheduled calls.";
  }
}

function onJoined(id) {
  joined.value = new Set([...joined.value, String(id)]);
  message.value = "";
  // Open the call UI here.
}
function onError(text) {
  message.value = text;
}
async function joinFromBanner(callId) {
  const result = await joinCall(String(callId));
  if (result.success) onJoined(callId);
  else if (!result.skipped) onError(result.error);
  return result.success;
}

onMounted(() => {
  void refresh();
  // The server owns the join window; asking again every 30 s opens Join on time.
  refreshTimer = setInterval(refresh, 30000);
  clockTimer = setInterval(() => (now.value = Date.now()), 10000);
});
onBeforeUnmount(() => {
  clearInterval(refreshTimer);
  clearInterval(clockTimer);
});
</script>
