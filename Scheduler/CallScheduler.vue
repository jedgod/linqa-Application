<template>
  <form
    class="p-5 bg-white border border-gray-100 rounded-xl shadow-sm space-y-4"
    @submit.prevent="submit"
  >
    <h2 class="text-sm font-semibold uppercase tracking-wider text-gray-400">
      Schedule a call
    </h2>

    <!-- Quick presets -->
    <div class="flex flex-wrap gap-2" role="group" aria-label="Quick times">
      <button
        v-for="preset in presets"
        :key="preset.key"
        type="button"
        class="px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors"
        :class="
          selectedKey === preset.key
            ? 'bg-blue-600 text-white border-blue-600'
            : 'bg-white text-gray-700 border-gray-200 hover:border-blue-400'
        "
        :aria-pressed="selectedKey === preset.key"
        @click="pick(preset)"
      >
        {{ preset.label }}
      </button>
    </div>

    <!-- Custom date and time -->
    <label class="block text-xs font-medium text-gray-600">
      Or choose a time
      <input
        v-model="custom"
        type="datetime-local"
        :min="minLocal"
        class="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
        @input="selectedKey = 'custom'"
      />
    </label>

    <p v-if="scheduledAt" class="text-xs text-gray-500">
      Starts
      <span class="font-medium text-gray-700">{{ summary }}</span>
    </p>
    <p v-if="error" class="text-xs text-red-600" role="alert">{{ error }}</p>

    <button
      type="submit"
      :disabled="!scheduledAt || busy"
      class="w-full px-4 py-2.5 text-sm font-bold rounded-lg text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
    >
      {{ busy ? "Scheduling..." : "Schedule call" }}
    </button>
  </form>
</template>

<script setup>
import { computed, ref } from "vue";

const emit = defineEmits(["schedule-created"]);

const selectedKey = ref(null);
const chosen = ref(null); // Date from a preset
const custom = ref("");
const busy = ref(false);
const error = ref("");

const round15 = (date) => {
  const d = new Date(date);
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15);
  return d;
};
const inMinutes = (m) => round15(new Date(Date.now() + m * 60000));
const tomorrowAt = (hour) => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d;
};

// Computed each render so "in 30 min" is always relative to now.
const presets = computed(() => [
  { key: "30m", label: "In 30 min", at: inMinutes(30) },
  { key: "1h", label: "In 1 hour", at: inMinutes(60) },
  { key: "3h", label: "In 3 hours", at: inMinutes(180) },
  { key: "t9", label: "Tomorrow 9:00", at: tomorrowAt(9) },
  { key: "t14", label: "Tomorrow 14:00", at: tomorrowAt(14) },
]);

const pad = (n) => String(n).padStart(2, "0");
const toLocalInput = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const minLocal = computed(() => toLocalInput(new Date()));

const scheduledAt = computed(() => {
  const date =
    selectedKey.value === "custom"
      ? custom.value
        ? new Date(custom.value)
        : null
      : chosen.value;
  return date && !Number.isNaN(date.getTime()) ? date : null;
});

const summary = computed(() =>
  scheduledAt.value
    ? scheduledAt.value.toLocaleString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "",
);

const pick = (preset) => {
  selectedKey.value = preset.key;
  chosen.value = preset.at;
  custom.value = toLocalInput(preset.at);
  error.value = "";
};

const submit = async () => {
  error.value = "";
  if (!scheduledAt.value) return;
  if (scheduledAt.value.getTime() <= Date.now()) {
    error.value = "Choose a time in the future.";
    return;
  }
  busy.value = true;
  try {
    // The parent performs the request; a rejected promise there is shown by the parent.
    emit("schedule-created", { scheduledAt: scheduledAt.value.toISOString() });
    selectedKey.value = null;
    chosen.value = null;
    custom.value = "";
  } finally {
    busy.value = false;
  }
};
</script>
