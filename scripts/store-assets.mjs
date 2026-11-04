import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
await mkdir('assets/store', { recursive: true });
await sharp('assets/icons/icon.svg').resize(300, 300).png().toFile('assets/store/logo-300.png');
await sharp('assets/store/promo-440x280.svg').png().toFile('assets/store/promo-440x280.png');
console.log('Generated 300×300 store logo and 440×280 promotional tile.');
