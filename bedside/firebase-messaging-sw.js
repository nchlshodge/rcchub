// Runs in the background (even when Bedside isn't open in a tab) to
// receive pushes and show them as real phone/desktop notifications.
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

messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  self.registration.showNotification(title || 'Bedside', {
    body: body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('https://nchlshodge.github.io/rcchub/bedside/'));
});
