<template>
  <div class="fixed inset-0 bg-gray-950 text-white flex flex-col">
    <!-- Remote participants -->
    <div class="flex-1 grid gap-2 p-3" :class="gridClass">
      <div
        v-for="user in store.remoteUsers"
        :key="user.uid"
        :ref="(el) => playRemote(user, el)"
        class="relative bg-gray-900 rounded-xl overflow-hidden min-h-40"
      >
        <span class="absolute bottom-2 left-2 text-xs bg-black/50 rounded px-2 py-0.5">
          Participant {{ user.uid }}
        </span>
      </div>

      <div
        v-if="!store.remoteUsers.length"
        class="flex items-center justify-center text-gray-400 text-sm"
      >
        {{ status }}
      </div>
    </div>

    <!-- Local preview -->
    <div
      ref="localEl"
      class="absolute bottom-24 right-4 w-32 h-44 sm:w-40 sm:h-56 rounded-xl overflow-hidden bg-gray-800 border border-white/20 shadow-xl"
    ></div>

    <p v-if="error" class="absolute top-4 inset-x-4 text-center text-sm bg-red-600/90 rounded-lg py-2" role="alert">
      {{ error }}
    </p>

    <!-- Controls -->
    <div class="flex items-center justify-center gap-4 p-5 bg-black/40">
      <button
        type="button"
        class="px-4 py-2.5 text-sm font-semibold rounded-full border border-white/20"
        :class="micOn ? 'bg-white/10' : 'bg-red-600 border-red-600'"
        :aria-pressed="!micOn"
        @click="toggle('audio')"
      >
        {{ micOn ? "Mute" : "Unmute" }}
      </button>
      <button
        type="button"
        class="px-4 py-2.5 text-sm font-semibold rounded-full border border-white/20"
        :class="camOn ? 'bg-white/10' : 'bg-red-600 border-red-600'"
        :aria-pressed="!camOn"
        @click="toggle('video')"
      >
        {{ camOn ? "Camera off" : "Camera on" }}
      </button>
      <button
        type="button"
        class="px-5 py-2.5 text-sm font-bold rounded-full bg-red-600 hover:bg-red-700"
        @click="leave"
      >
        Leave
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useCallStore } from "./useCallStore";

const store = useCallStore();
const route = useRoute();
const router = useRouter();

const localEl = ref(null);
const micOn = ref(true);
const camOn = ref(true);
const error = ref("");
const status = ref("Connecting...");

const gridClass = computed(() =>
  store.remoteUsers.length > 1 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1",
);

// Plays a remote video into its tile once the element exists.
const playRemote = (user, el) => {
  if (el && user.videoTrack) user.videoTrack.play(el);
};

const playLocal = async () => {
  await nextTick();
  if (localEl.value && store.localTracks.videoTrack) {
    store.localTracks.videoTrack.play(localEl.value);
  }
};

onMounted(async () => {
  const { token, appId } = route.query;
  if (!appId || !token) {
    error.value = "This room link is missing its details. Rejoin from your schedule.";
    return;
  }
  try {
    await store.initAgoraEngine(String(appId), String(route.params.roomId), String(token));
    status.value = "Waiting for others to join...";
    await playLocal();
  } catch (e) {
    error.value = "Could not start the call. Check camera and microphone permission.";
    status.value = "";
    await store.leaveAgoraSession().catch(() => undefined);
  }
});

// A participant who joins after we did needs their tile started.
watch(
  () => store.remoteUsers.length,
  () => {
    if (store.remoteUsers.length) status.value = "";
  },
);

const toggle = async (kind) => {
  const track = kind === "audio" ? store.localTracks.audioTrack : store.localTracks.videoTrack;
  if (!track) return;
  const next = kind === "audio" ? !micOn.value : !camOn.value;
  await track.setEnabled(next);
  if (kind === "audio") micOn.value = next;
  else camOn.value = next;
};

const leave = async () => {
  await store.leaveAgoraSession().catch(() => undefined);
  router.push({ name: "Dashboard" });
};

// Closing the tab or navigating away must release the camera and microphone.
onBeforeUnmount(() => {
  void store.leaveAgoraSession();
});
</script>
