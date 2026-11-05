// 네이티브 앱(Capacitor)에서의 로컬 알림.
// 번들러 없이 쓰기 위해, Capacitor가 웹뷰에 넣어 주는 전역 window.Capacitor를 사용한다.
import { planNotifications } from './scheduler.js';

const Cap = window.Capacitor;
export const isNative = !!Cap?.isNativePlatform?.();
const LN = isNative ? Cap.registerPlugin('LocalNotifications') : null;

const CHANNEL = 'review';

export async function permission() {
  if (!LN) return 'unsupported';
  const { display } = await LN.checkPermissions();
  return display === 'granted' ? 'granted' : display === 'denied' ? 'denied' : 'default';
}

export async function requestPermission() {
  if (!LN) return 'unsupported';
  const { display } = await LN.requestPermissions();
  if (display === 'granted' && Cap.getPlatform() === 'android') {
    await LN.createChannel({ id: CHANNEL, name: '복습 알림', importance: 4, vibration: true }).catch(() => {});
    // Android 12+: 정확한 시각 알림 권한이 꺼져 있으면 설정 화면으로 안내
    try {
      const { exact_alarm } = await LN.checkExactNotificationSetting();
      if (exact_alarm !== 'granted') await LN.changeExactNotificationSetting();
    } catch {
      /* 구버전 Android */
    }
  }
  return display === 'granted' ? 'granted' : 'denied';
}

let pendingSync = Promise.resolve();

/** 카드가 바뀔 때마다 예약된 알림을 통째로 다시 계획한다 */
export function syncNotifications(cards, settings) {
  if (!LN) return Promise.resolve();
  pendingSync = pendingSync.then(() => doSync(cards, settings)).catch((e) => console.warn('알림 예약 실패', e));
  return pendingSync;
}

async function doSync(cards, settings) {
  const { notifications } = await LN.getPending();
  if (notifications.length) await LN.cancel({ notifications: notifications.map((n) => ({ id: n.id })) });
  if (!settings.notify || (await permission()) !== 'granted') return;

  const plan = planNotifications(cards, { quietStart: settings.quietStart, quietEnd: settings.quietEnd });
  if (!plan.length) return;
  await LN.schedule({
    notifications: plan.map((p) => ({
      id: p.id,
      title: p.title,
      body: p.body,
      schedule: { at: new Date(p.at), allowWhileIdle: true },
      channelId: CHANNEL,
      extra: { view: 'review' },
    })),
  });
}

export async function testNotification() {
  if (!LN) return;
  await LN.schedule({
    notifications: [{ id: 9999, title: '테스트 알림', body: '이렇게 복습 시간을 알려드려요.', schedule: { at: new Date(Date.now() + 3000) }, channelId: CHANNEL }],
  });
}

/** 알림을 눌러 앱이 열리면 호출 */
export function onNotificationTap(fn) {
  LN?.addListener('localNotificationActionPerformed', (e) => fn(e.notification?.extra?.view || 'review'));
}
