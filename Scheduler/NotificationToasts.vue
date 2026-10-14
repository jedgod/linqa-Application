<template>
  <div
    class="fixed bottom-5 right-5 z-50 flex flex-col gap-3 w-full max-w-sm pointer-events-none"
  >
    <transition-group name="toast-slide">
      <div
        v-for="toast in store.toasts"
        :key="toast.id"
        class="pointer-events-auto flex flex-col p-4 rounded-xl shadow-xl border bg-white text-gray-900 border-gray-100 transition-all duration-300 transform"
      >
        <div class="flex items-start gap-3">
          <!-- Success Status Icon Indicator layout -->
          <div v-if="toast.type === 'success'" class="text-emerald-500 mt-0.5">
            <svg
              class="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2.5"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <div v-else class="text-blue-500 mt-0.5">
            <svg
              class="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2.5"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>

          <div class="flex-1">
            <p class="text-sm font-semibold leading-snug">
              {{ toast.message }}
            </p>

            <!-- Quick "Join Directly From Notification Banner" Button -->
            <button
              v-if="toast.callId"
              @click="handleDirectJoin(toast.callId, toast.id)"
              class="mt-2.5 px-3 py-1.5 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm transition-colors"
            >
              Join Live Meeting Now
            </button>
          </div>

          <button
            @click="store.dismissToast(toast.id)"
            class="text-gray-400 hover:text-gray-600"
          >
            <svg
              class="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </div>
    </transition-group>
  </div>
</template>

<script setup>
import { useCallStore } from "./useCallStore";
import { useRouter } from "vue-router";

const store = useCallStore();
const router = useRouter();

const handleDirectJoin = async (callId, toastId) => {
  store.dismissToast(toastId);
  try {
    const sessionData = await store.joinCallSession(callId);
    router.push({
      name: "VideoRoom",
      params: { roomId: sessionData.roomId },
      query: { token: sessionData.roomToken, appId: sessionData.appId },
    });
  } catch (e) {
    console.error(e);
  }
};
</script>

<style scoped>
.toast-slide-enter-from {
  opacity: 0;
  transform: translateY(20px) scale(0.95);
}
.toast-slide-leave-to {
  opacity: 0;
  transform: translateX(50px);
}
</style>
