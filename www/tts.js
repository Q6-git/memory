// 영어 발음 듣기: 앱에서는 안드로이드 기본 TTS(플러그인), 브라우저에서는 Web Speech API
const Cap = window.Capacitor;
const Plugin = Cap?.isNativePlatform?.() ? Cap.registerPlugin('TextToSpeech') : null;
const web = !Plugin && 'speechSynthesis' in window ? window.speechSynthesis : null;

export const supported = !!(Plugin || web);

export function stop() {
  Plugin?.stop().catch(() => {});
  web?.cancel();
}

export function speak(text, { slow = false } = {}) {
  if (!text) return;
  stop();
  const rate = slow ? 0.7 : 1;
  if (Plugin) {
    Plugin.speak({ text, lang: 'en-US', rate, pitch: 1, volume: 1, category: 'playback' }).catch((e) => console.warn('TTS', e));
  } else if (web) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = rate;
    const voice = web.getVoices().find((v) => v.lang === 'en-US');
    if (voice) u.voice = voice;
    web.speak(u);
  }
}
