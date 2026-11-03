/** 1:02:03 or 2:03, from microseconds. */
export function formatDuration(us: number): string {
	const total = Math.floor(us / 1e6);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = String(total % 60).padStart(2, '0');
	return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
