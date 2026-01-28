// push-notifications.js - Client-side Push Notification Manager

class PushNotificationManager {
  constructor() {
    this.registration = null;
    this.subscription = null;
    this.publicKey = null;
  }

  // Initialize push notifications
  async init(userEmail) {
    try {
      // Check if service workers are supported
      if (!('serviceWorker' in navigator)) {
        console.warn('Service workers not supported');
        return false;
      }

      // Check if push messaging is supported
      if (!('PushManager' in window)) {
        console.warn('Push messaging not supported');
        return false;
      }

      // Get VAPID public key from server
      const response = await fetch('/vapid-public-key');
      const data = await response.json();
      this.publicKey = data.publicKey;

      // Register service worker
      this.registration = await navigator.serviceWorker.register('/service-worker.js');
      console.log('✅ Service Worker registered');

      // Wait for service worker to be ready
      await navigator.serviceWorker.ready;

      // Check current permission
      const permission = await this.checkPermission();
      
      if (permission === 'granted') {
        await this.subscribe(userEmail);
      } else if (permission === 'default') {
        // Don't auto-request, let user trigger it
        console.log('ℹ️ Notification permission not yet requested');
      }

      return true;
    } catch (err) {
      console.error('❌ Push notification init error:', err);
      return false;
    }
  }

  // Check notification permission
  async checkPermission() {
    if (!('Notification' in window)) {
      return 'denied';
    }
    return Notification.permission;
  }

  // Request notification permission
  async requestPermission() {
    try {
      const permission = await Notification.requestPermission();
      console.log('Notification permission:', permission);
      return permission;
    } catch (err) {
      console.error('Error requesting permission:', err);
      return 'denied';
    }
  }

  // Subscribe to push notifications
  async subscribe(userEmail) {
    try {
      if (!this.registration) {
        console.error('Service worker not registered');
        return false;
      }

      // Check if already subscribed
      let subscription = await this.registration.pushManager.getSubscription();

      if (!subscription) {
        // Create new subscription
        subscription = await this.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: this.urlBase64ToUint8Array(this.publicKey)
        });
        console.log('✅ New push subscription created');
      } else {
        console.log('ℹ️ Already subscribed to push notifications');
      }

      this.subscription = subscription;

      // Send subscription to server
      const response = await fetch('/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: userEmail,
          subscription: subscription.toJSON()
        })
      });

      const data = await response.json();
      
      if (data.success) {
        console.log('✅ Subscription saved to server');
        return true;
      } else {
        console.error('Failed to save subscription:', data.error);
        return false;
      }
    } catch (err) {
      console.error('❌ Subscription error:', err);
      return false;
    }
  }

  // Unsubscribe from push notifications
  async unsubscribe() {
    try {
      if (!this.subscription) {
        const subscription = await this.registration.pushManager.getSubscription();
        if (subscription) {
          await subscription.unsubscribe();
          console.log('✅ Unsubscribed from push notifications');
        }
      } else {
        await this.subscription.unsubscribe();
        console.log('✅ Unsubscribed from push notifications');
      }
      return true;
    } catch (err) {
      console.error('❌ Unsubscribe error:', err);
      return false;
    }
  }

  // Show a test notification
  async showTestNotification() {
    try {
      const permission = await this.checkPermission();
      
      if (permission !== 'granted') {
        const newPermission = await this.requestPermission();
        if (newPermission !== 'granted') {
          alert('Please allow notifications to use this feature');
          return false;
        }
      }

      if (this.registration) {
        await this.registration.showNotification('MessMate Test', {
          body: 'Notifications are working! 🎉',
          icon: '/icon-192x192.png',
          badge: '/badge-72x72.png',
          vibrate: [200, 100, 200]
        });
        return true;
      }

      return false;
    } catch (err) {
      console.error('Test notification error:', err);
      return false;
    }
  }

  // Helper function to convert VAPID key
  urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/\-/g, '+')
      .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }
}

// Create global instance
const pushManager = new PushNotificationManager();

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    const userEmail = localStorage.getItem('messmate_user_email');
    if (userEmail) {
      pushManager.init(userEmail);
    }
  });
} else {
  const userEmail = localStorage.getItem('messmate_user_email');
  if (userEmail) {
    pushManager.init(userEmail);
  }
}