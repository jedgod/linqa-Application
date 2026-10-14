// Entry point. Needs: npm install vue vue-router pinia axios agora-rtc-sdk-ng
import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router from "./router";
import "./style.css";

createApp(App).use(createPinia()).use(router).mount("#app");
