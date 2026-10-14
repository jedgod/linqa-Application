<template>
  <router-view />
  <!-- Join-window alerts show on every page, including while a call is open. -->
  <NotificationToasts />
</template>

<script setup>
import { onBeforeUnmount, onMounted } from "vue";
import NotificationToasts from "./NotificationToasts.vue";
import { useCallStore } from "./useCallStore";

const store = useCallStore();

onMounted(() => {
  void store.fetchScheduledCalls();
  store.startWindowPolling();
});

onBeforeUnmount(() => store.stopWindowPolling());
</script>
