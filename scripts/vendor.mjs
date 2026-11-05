// @capacitor/core(ESM)를 www/vendor로 복사한다. 번들러 없이 앱에서 import하기 위해.
// (안드로이드 네이티브 브리지에는 registerPlugin이 없어서, core 런타임이 꼭 있어야 한다)
import { copyFileSync, mkdirSync } from 'node:fs';
const src = new URL('../node_modules/@capacitor/core/dist/index.js', import.meta.url);
const dest = new URL('../www/vendor/capacitor-core.js', import.meta.url);
mkdirSync(new URL('.', dest), { recursive: true });
copyFileSync(src, dest);
console.log('copied @capacitor/core → www/vendor/capacitor-core.js');
