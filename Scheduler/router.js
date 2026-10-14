import { createRouter, createWebHistory } from "vue-router";
import CallsDashboard from "./CallsDashboard.vue";
import VideoRoom from "./VideoRoom.vue";

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "Dashboard", component: CallsDashboard },
    { path: "/room/:roomId", name: "VideoRoom", component: VideoRoom },
  ],
});
