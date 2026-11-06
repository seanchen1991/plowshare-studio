import { describe, expect, it } from 'vitest';
import { autoDownloadName, chooseFolderName, numberedName, showFolderName, type FolderEntry } from './backup-names.ts';

describe('showFolderName', () => {
	it('lowercases and joins words with hyphens', () => {
		expect(showFolderName('Tilling Our Commons')).toBe('tilling-our-commons');
		expect(showFolderName('  Q&A: Live!! / 2026 ')).toBe('q-a-live-2026');
	});

	it('drops accents and keeps other scripts', () => {
		expect(showFolderName('Café Crème')).toBe('cafe-creme');
		expect(showFolderName('ポッドキャスト 1')).toBe('ポッドキャスト-1');
	});

	it('falls back when nothing is left, and stays short', () => {
		expect(showFolderName('!!!')).toBe('show');
		const long = showFolderName('word '.repeat(30));
		expect(long.length).toBeLessThanOrEqual(60);
		expect(long.endsWith('-')).toBe(false);
	});
});

describe('chooseFolderName', () => {
	const disk = (entries: Record<string, FolderEntry>) => (name: string) => entries[name] ?? 'missing';

	it('uses the slug when it is free, empty or already ours', () => {
		expect(chooseFolderName('Tilling Our Commons', disk({}), new Set())).toBe('tilling-our-commons');
		expect(chooseFolderName('Tilling Our Commons', disk({ 'tilling-our-commons': 'reusable' }), new Set())).toBe('tilling-our-commons');
	});

	it('adds -2, -3 when another Show has the name or something else is there', () => {
		expect(chooseFolderName('Tilling Our Commons', disk({ 'tilling-our-commons': 'taken' }), new Set())).toBe('tilling-our-commons-2');
		expect(chooseFolderName('Tilling our commons!', disk({ 'tilling-our-commons-2': 'taken' }), new Set(['tilling-our-commons']))).toBe(
			'tilling-our-commons-3'
		);
	});
});

describe('file names', () => {
	it('starts automatic downloads with the Show’s name', () => {
		expect(autoDownloadName('2026-11-06 Take 3.webm', 'Tilling: Our Commons')).toBe('Tilling Our Commons – 2026-11-06 Take 3.webm');
		expect(autoDownloadName('2026-11-06 Take 3.webm', undefined)).toBe('2026-11-06 Take 3.webm');
	});

	it('numbers a name already used by a different file', () => {
		expect(numberedName('2026-11-06 Take 3.webm', 1)).toBe('2026-11-06 Take 3.webm');
		expect(numberedName('2026-11-06 Take 3.webm', 2)).toBe('2026-11-06 Take 3 (2).webm');
	});
});
