import { api } from './api';

/**
 * Browser notifications. With Web Push the service worker (public/sw.js) shows
 * them even when the site is closed; where push is unavailable, the app falls
 * back to showing them itself while a tab is open (see `showInTabNotification`).
 */
export type PushState =
  /** This browser has no notification support (e.g. iPhone Safari outside the home screen app). */
  | 'unsupported'
  /** The user blocked notifications for this site. */
  | 'denied'
  /** Not turned on in this browser yet. */
  | 'off'
  /** Push is on: notifications arrive even when the site is closed. */
  | 'on'
  /** Permission granted but push could not be set up (server has no keys, or the browser refused): only while a tab is open. */
  | 'tab-only';

const OFF_KEY = 'god.push.off';
const SW_URL = '/sw.js';

let pushActive = false;
/** True when the service worker is delivering notifications (so the app must not show its own). */
export const isPushActive = () => pushActive;

export const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window;
const pushSupported = () => notificationsSupported() && 'serviceWorker' in navigator && 'PushManager' in window;

function turnedOffHere(): boolean {
  try {
    return localStorage.getItem(OFF_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberOff(off: boolean) {
  try {
    if (off) localStorage.setItem(OFF_KEY, '1');
    else localStorage.removeItem(OFF_KEY);
  } catch {
    // Storage unavailable: the choice just isn't remembered.
  }
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration(SW_URL);
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Subscribes this browser (permission must already be granted) and tells the server who it belongs to. */
async function subscribe(): Promise<boolean> {
  if (!pushSupported()) return false;
  const { publicKey } = await api.push.config();
  if (!publicKey) return false;
  const reg = await navigator.serviceWorker.register(SW_URL);
  await navigator.serviceWorker.ready;
  const key = base64UrlToBytes(publicKey);
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with an older server key has to be replaced.
  const existingKey = sub?.options.applicationServerKey;
  if (sub && existingKey && new Uint8Array(existingKey).join() !== key.join()) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return false;
  await api.push.subscribe({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
  return true;
}

export async function getPushState(): Promise<PushState> {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted' || turnedOffHere()) return 'off';
  return pushActive || (await currentSubscription()) ? 'on' : 'tab-only';
}

/** Asks for permission (if needed) and turns notifications on in this browser. */
export async function enableNotifications(): Promise<PushState> {
  if (!notificationsSupported()) return 'unsupported';
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  rememberOff(false);
  try {
    pushActive = await subscribe();
  } catch {
    pushActive = false;
  }
  return pushActive ? 'on' : 'tab-only';
}

/** Turns notifications off in this browser (the permission itself can only be changed in browser settings). */
export async function disableNotifications(): Promise<PushState> {
  rememberOff(true);
  pushActive = false;
  const sub = await currentSubscription().catch(() => null);
  if (sub) {
    await api.push.unsubscribe(sub.endpoint).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  return 'off';
}

/**
 * After sign-in: if this browser already allowed notifications, attach its
 * subscription to the signed-in user (it may have belonged to someone else).
 */
export async function syncNotificationsAfterSignIn(): Promise<void> {
  if (!notificationsSupported() || Notification.permission !== 'granted' || turnedOffHere()) return;
  try {
    pushActive = await subscribe();
  } catch {
    pushActive = false;
  }
}

/** Before sign-out: stop pushes for this user in this browser, keeping the browser's permission. */
export async function detachNotificationsOnSignOut(): Promise<void> {
  pushActive = false;
  const sub = await currentSubscription().catch(() => null);
  if (sub) await api.push.unsubscribe(sub.endpoint).catch(() => {});
}

/**
 * The fallback while a tab is open: shows a notification from the page itself
 * when push isn't delivering, and only if the tab is hidden or unfocused.
 */
export function showInTabNotification(title: string, options: { body: string; tag: string; url: string }, onOpen: (url: string) => void) {
  if (pushActive || !notificationsSupported() || Notification.permission !== 'granted' || turnedOffHere()) return;
  if (document.visibilityState === 'visible' && document.hasFocus()) return;
  try {
    const n = new Notification(title, { body: options.body, tag: options.tag, icon: '/icon-192.png' });
    n.onclick = () => {
      window.focus();
      onOpen(options.url);
      n.close();
    };
  } catch {
    // Some browsers (e.g. Android Chrome) only allow notifications from a service worker.
  }
}
