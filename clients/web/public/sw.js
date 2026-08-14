self.addEventListener("push", (event) => {
  const data = event.data ? event.data.text() : "New Linqa notification";
  event.waitUntil(self.registration.showNotification("Linqa", { body: data }));
});
