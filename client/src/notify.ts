// Browser notifications when the tab is in the background (only if the user allowed them).
export function notify(title: string, body: string) {
  try {
    if (document.visibilityState === 'visible') return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    new Notification(title, { body, icon: '/favicon.svg', tag: title });
  } catch {
    /* ignore */
  }
}

export async function askNotificationPermission() {
  try {
    if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
  } catch {
    /* ignore */
  }
}
