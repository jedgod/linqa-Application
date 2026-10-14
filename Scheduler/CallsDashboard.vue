<template>
  <div class="max-w-4xl mx-auto p-6 space-y-8">
    <header class="border-b border-gray-200 pb-4">
      <h1 class="text-2xl font-bold text-gray-900">Linqa Call Center</h1>
      <p class="text-sm text-gray-500">
        Schedule custom appointments or connect instantly.
      </p>
    </header>

    <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
      <!-- Input Panel: Schedular with presets -->
      <div class="md:col-span-1">
        <CallScheduler @schedule-created="handleCreateSchedule" />
      </div>

      <!-- Feed Panel: Active / Upcoming Card feed list -->
      <div class="md:col-span-2 space-y-4">
        <h2
          class="text-sm font-semibold uppercase tracking-wider text-gray-400"
        >
          Upcoming Schedule Queue ({{ store.scheduledCalls.length }})
        </h2>

        <!-- Loading State wrapper feedback -->
        <div
          v-if="store.loading && !store.scheduledCalls.length"
          class="text-center py-6 text-gray-400 text-sm"
        >
          Synchronizing queue...
        </div>

        <!-- Empty state block feedback -->
        <div
          v-else-if="!store.scheduledCalls.length"
          class="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center text-gray-400"
        >
          No calls scheduled yet. Use presets to create one.
        </div>

        <!-- Dynamic Card Component Render list inside queue -->
        <div v-else class="space-y-3">
          <ScheduledCallCard
            v-for="call in store.scheduledCalls"
            :key="call.id"
            :host-name="call.host_name"
            :call-time="call.scheduled_at"
            @join-call="handleJoinTrigger(call.id)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted } from "vue";
import { useRouter } from "vue-router";
import { useCallStore } from "./useCallStore";
import CallScheduler from "./CallScheduler.vue";
import ScheduledCallCard from "./ScheduledCallCard.vue";

const store = useCallStore();
const router = useRouter();

// Sync current data lists when dashboard mounts
onMounted(() => {
  store.fetchScheduledCalls();
});

// Callback handler connected to Scheduler UI Component output
const handleCreateSchedule = async (timeData) => {
  try {
    await store.scheduleNewCall({
      scheduledAt: timeData.scheduledAt,
      hostName: "Engineering Lead Sync", // Dynamic example mock data
    });
  } catch (error) {
    alert("Could not schedule event: " + store.error);
  }
};

// Callback handler triggered when Join button eligibility requirement passes
const handleJoinTrigger = async (callId) => {
  try {
    const sessionData = await store.joinCallSession(callId);

    // Core Navigation flow redirection: route to live room UI passing token or room ID state params
    router.push({
      name: "VideoRoom",
      params: { roomId: sessionData.roomId },
      query: { token: sessionData.roomToken, appId: sessionData.appId },
    });
  } catch (error) {
    alert("Connection target error: " + store.error);
  }
};
</script>
