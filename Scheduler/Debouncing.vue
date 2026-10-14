<!--
  Renderless join lock. Wrap any "start a call" button: after run() the slot reports locked=true for `ms`
  milliseconds, so a double tap, or both people tapping Join together, cannot ring the same call twice.
  Mirrors the app's join lock (clients/mobile/services/scheduled-call-join.ts).
-->
<template>
  <slot :locked="locked" :run="run" />
</template>

<script setup>
import { onUnmounted, ref } from "vue";

const props = defineProps({
  ms: { type: Number, default: 10000 },
});
const emit = defineEmits(["locked", "unlocked"]);

const locked = ref(false);
let timer = null;

const unlock = () => {
  if (timer) clearTimeout(timer);
  timer = null;
  if (locked.value) {
    locked.value = false;
    emit("unlocked");
  }
};

// Runs `action` unless a lock is active. If the action fails or reports a problem, the lock is released
// at once so the person can try again.
const run = async (action) => {
  if (locked.value) return undefined;
  locked.value = true;
  emit("locked");
  timer = setTimeout(unlock, props.ms);
  try {
    const result = await action();
    if (result === false) unlock();
    return result;
  } catch (error) {
    unlock();
    throw error;
  }
};

onUnmounted(() => timer && clearTimeout(timer));
defineExpose({ run, locked, unlock });
</script>
