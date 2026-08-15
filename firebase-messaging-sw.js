// Shared across every app in the hub (registered with hub-wide scope
// from whichever app the person enabled notifications in) — receives
// pushes in the background and shows them as real notifications.
importScripts('https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDFX7_fLi82PqkSUK7mi4bRzOPF1efcAeE",
  authDomain: "bedsidercc.firebaseapp.com",
  projectId: "bedsidercc",
  storageBucket: "bedsidercc.firebasestorage.app",
  messagingSenderId: "950958384975",
  appId: "1:950958384975:web:6f43dec5a7ba842c69c73a",
});

const messaging = firebase.messaging();
const DEFAULT_ICON = 'assets/rcc-logo-plain.png';
const DEFAULT_URL = 'https://nchlshodge.github.io/rcchub/';

messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  const url = (payload.data && payload.data.url) || DEFAULT_URL;
  self.registration.showNotification(title || 'RCC App Hub', {
    body: body || '',
    icon: DEFAULT_ICON,
    badge: DEFAULT_ICON,
    data: { url },
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || DEFAULT_URL;
  event.waitUntil(clients.openWindow(url));
});
