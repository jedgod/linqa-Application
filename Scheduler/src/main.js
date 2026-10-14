// Entry for the src/ variant of the scheduler widgets (CallScheduler, JoinButton, ReadyToJoinBanner).
import { createApp } from "vue";
import "./assets/tailwind.css";
import CallScheduler from "./components/CallScheduler.vue";

createApp(CallScheduler).mount("#app");
