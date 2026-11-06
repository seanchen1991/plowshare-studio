// Renders the app icons from public/icon.svg, for the web app manifest. Run
// with `pnpm icons` after changing the SVG; the PNGs are committed.
// Usage: node scripts/make-icons.ts

import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const svg = readFileSync('public/icon.svg', 'utf8');
// Maskable icons are cropped to a circle or squircle by the system: the mark sits in the middle 80%, on a full bleed.
const maskable = svg.replace('rx="112" ', '').replace('<circle cx="256" cy="256" r="150"', '<circle cx="256" cy="256" r="120"').replace('r="92"', 'r="74"').replace('stroke-width="28"', 'stroke-width="22"');

const browser = await chromium.launch();
for (const [name, source, size] of [
	['icon-192.png', svg, 192],
	['icon-512.png', svg, 512],
	['icon-maskable-512.png', maskable, 512]
] as const) {
	const page = await browser.newPage({ viewport: { width: size, height: size } });
	await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${source}`);
	await page.screenshot({ path: `public/${name}`, omitBackground: true });
	await page.close();
}
await browser.close();
