// Projects with several Sessions: made from takes picked in Takes, with takes
// added, reordered and removed in the editor (all undoable), Cuts that stay
// inside their take, the list of Projects in the Edit tab, and deleting a take
// that Projects use. Runs in Chrome and Firefox.

import { expect, test, type Page } from '@playwright/test';
import { fixtureSpec } from '../fixtures/spec.ts';
import { readOpfsJson, recordTake } from '../helpers/app.ts';
import { useFixtureMedia } from '../helpers/fake-media.ts';
import type { Project } from '../../src/lib/storage/project-file.ts';
import type { Session } from '../../src/lib/storage/session-file.ts';

test.beforeEach(async ({ context, browserName }) => {
	if (browserName === 'firefox') await context.addInitScript(useFixtureMedia, fixtureSpec);
});

const projectFile = (page: Page, id: string) => readOpfsJson<Project>(page, `projects/${id}/project.json`);
const openProjectId = async (page: Page) => (await page.getByTestId('editor').getAttribute('data-project-id'))!;
/** The takes in the open Project, in order, by title. */
const projectTakes = (page: Page) => page.getByTestId('project-take').locator('.take-name').allInnerTexts();

/** Records three takes, renamed A, B and C (C is the newest, listed first). */
async function threeTakes(page: Page): Promise<Record<'A' | 'B' | 'C', Session>> {
	const sessions: Session[] = [];
	for (const name of ['A', 'B', 'C']) {
		sessions.push(await recordTake(page, 3));
		await page.getByRole('tab', { name: 'Takes' }).click();
		const row = page.getByRole('region', { name: 'Takes' }).locator(`[data-session-id="${sessions.at(-1)!.id}"]`);
		await row.getByRole('button', { name: 'More actions' }).click();
		await page.getByRole('button', { name: 'Rename', exact: true }).click();
		await row.getByRole('textbox', { name: 'Take name' }).fill(name);
		await row.getByRole('textbox', { name: 'Take name' }).press('Enter');
		await expect(row.getByTestId('take-title')).toHaveText(name);
		await page.getByRole('tab', { name: 'Record' }).click();
	}
	const [A, B, C] = sessions as [Session, Session, Session];
	return { A, B, C };
}

/** Drags across the first lane from one share of its width to another. */
async function dragAcrossLane(page: Page, from: number, to: number) {
	const box = (await page.getByTestId('lane').first().boundingBox())!;
	const y = box.y + box.height / 2;
	await page.mouse.move(box.x + box.width * from, y);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * to, y, { steps: 8 });
	await page.mouse.up();
}

test('a Project of several takes: add, reorder and remove them, Cut across a boundary, undo it all', async ({ page }) => {
	test.setTimeout(150_000);
	await page.goto('/');
	const { A, B, C } = await threeTakes(page);
	await page.getByRole('tab', { name: 'Takes' }).click();
	const takes = page.getByRole('region', { name: 'Takes' });

	// Tick C and A in Takes: Edit together needs two, and keeps the order they're listed in.
	await takes.locator(`[data-session-id="${C.id}"]`).getByRole('checkbox').check();
	await expect(page.getByTestId('chosen')).toContainText('1 take selected');
	await expect(page.getByRole('button', { name: 'Edit together' })).toBeDisabled();
	await takes.locator(`[data-session-id="${A.id}"]`).getByRole('checkbox').check();
	await page.getByRole('button', { name: 'Edit together' }).click();
	await expect(page.getByTestId('editor')).toBeVisible();
	expect(await projectTakes(page)).toEqual(['C', 'A']);
	await expect(page.getByTestId('project-title')).toHaveText('C and 1 more');
	await expect(page.getByTestId('boundary')).toHaveCount(1);
	await expect(page.getByTestId('takes-row')).toContainText('1 · C');
	await expect(page.getByTestId('takes-row')).toContainText('2 · A');
	await expect(page.getByTestId('lane')).toHaveCount(1);
	const id = await openProjectId(page);
	expect((await projectFile(page, id)).sessions.map((s) => s.sessionId)).toEqual([C.id, A.id]);

	// Add B from the picker, which offers only takes not in the Project yet.
	await page.getByRole('button', { name: 'Add takes' }).click();
	const picker = page.getByTestId('take-picker');
	await expect(picker.getByRole('checkbox')).toHaveCount(1);
	await picker.getByRole('checkbox', { name: 'B' }).check();
	await page.getByRole('button', { name: 'Add', exact: true }).click();
	expect(await projectTakes(page)).toEqual(['C', 'A', 'B']);
	await page.getByRole('button', { name: 'Add takes' }).click();
	await expect(page.getByText('Every Ready take is already in this project.')).toBeVisible();
	await page.getByRole('button', { name: 'Cancel' }).click();

	// Reorder with the buttons, and by dragging.
	await page.getByRole('button', { name: 'Move “B” earlier' }).click();
	expect(await projectTakes(page)).toEqual(['C', 'B', 'A']);
	await expect(page.getByRole('button', { name: 'Move “C” earlier' })).toBeDisabled();
	await expect(page.getByRole('button', { name: 'Move “A” later' })).toBeDisabled();
	await page.getByTestId('project-take').nth(2).dragTo(page.getByTestId('project-take').nth(0));
	expect(await projectTakes(page)).toEqual(['A', 'C', 'B']);
	await expect.poll(async () => (await projectFile(page, id)).sessions.map((s) => s.sessionId)).toEqual([A.id, C.id, B.id]);

	// A Cut dragged across the boundary between A and C becomes one Cut in each, neither crossing it.
	await expect(page.getByTestId('boundary')).toHaveCount(2);
	const boundary = Number(await page.getByTestId('boundary').first().evaluate((b) => getComputedStyle(b).getPropertyValue('--at')));
	await dragAcrossLane(page, boundary - 0.08, boundary + 0.08);
	await page.keyboard.press('Delete');
	await expect(page.getByTestId('cut')).toHaveCount(2);
	await expect.poll(async () => (await projectFile(page, id)).sessions.map((s) => s.cuts.length)).toEqual([1, 1, 0]);
	const saved = await projectFile(page, id);
	const aLength = A.recordings[0]!.segments[0]!.durationUs!;
	expect(saved.sessions[0]!.cuts[0]!.endUs).toBe(aLength);
	expect(saved.sessions[1]!.cuts[0]!.startUs).toBe(0);

	// Removing a take drops its Cuts; undo brings back both. Redo removes it again.
	await page.getByRole('button', { name: 'Remove “A” from this project' }).click();
	expect(await projectTakes(page)).toEqual(['C', 'B']);
	await expect(page.getByTestId('cut')).toHaveCount(1);
	await expect.poll(async () => (await projectFile(page, id)).sessions.length).toBe(2);
	await page.keyboard.press('ControlOrMeta+z');
	expect(await projectTakes(page)).toEqual(['A', 'C', 'B']);
	await expect(page.getByTestId('cut')).toHaveCount(2);
	await expect.poll(async () => (await projectFile(page, id)).sessions.map((s) => s.cuts.length)).toEqual([1, 1, 0]);
	await page.keyboard.press('ControlOrMeta+Shift+z');
	expect(await projectTakes(page)).toEqual(['C', 'B']);

	// Undo steps back through the reorders and the add too.
	await page.keyboard.press('ControlOrMeta+z');
	await page.keyboard.press('ControlOrMeta+z');
	await page.keyboard.press('ControlOrMeta+z');
	expect(await projectTakes(page)).toEqual(['C', 'B', 'A']);
	await page.keyboard.press('ControlOrMeta+z');
	expect(await projectTakes(page)).toEqual(['C', 'A', 'B']);
	await page.keyboard.press('ControlOrMeta+z');
	expect(await projectTakes(page)).toEqual(['C', 'A']);

	// After a reload the Edit tab reopens it as saved.
	await expect.poll(async () => (await projectFile(page, id)).sessions.length).toBe(2);
	await page.reload();
	await page.getByRole('tab', { name: 'Edit' }).click();
	await expect(page.getByTestId('editor')).toHaveAttribute('data-project-id', id);
	expect(await projectTakes(page)).toEqual(['C', 'A']);
});

test('the list of Projects: open, rename and delete; Projects share a take with their own Cuts; deleting a used take warns', async ({ page }) => {
	test.setTimeout(150_000);
	await page.goto('/');
	const { A, B } = await threeTakes(page);
	await page.getByRole('tab', { name: 'Takes' }).click();
	const takes = page.getByRole('region', { name: 'Takes' });

	// A Project of A and B, with a Cut in A.
	await takes.locator(`[data-session-id="${A.id}"]`).getByRole('checkbox').check();
	await takes.locator(`[data-session-id="${B.id}"]`).getByRole('checkbox').check();
	await page.getByRole('button', { name: 'Edit together' }).click();
	const together = await openProjectId(page);
	// B is listed first (newer), so A is the second half of the timeline.
	await dragAcrossLane(page, 0.7, 0.8);
	await page.keyboard.press('Delete');
	await expect.poll(async () => (await projectFile(page, together)).sessions[1]!.cuts.length).toBe(1);

	// Edit on A alone makes a Project of its own, whose Cuts are its own.
	await page.getByRole('tab', { name: 'Takes' }).click();
	await takes.locator(`[data-session-id="${A.id}"]`).getByRole('button', { name: 'Edit' }).click();
	const solo = await openProjectId(page);
	expect(solo).not.toBe(together);
	await expect(page.getByTestId('cut')).toHaveCount(0);
	await dragAcrossLane(page, 0.1, 0.3);
	await page.keyboard.press('Delete');
	await expect.poll(async () => (await projectFile(page, solo)).sessions[0]!.cuts.length).toBe(1);
	expect((await projectFile(page, together)).sessions[1]!.cuts).toHaveLength(1);

	// The list: both Projects, newest first. Rename one and open the other.
	await page.getByRole('button', { name: 'All projects' }).click();
	const list = page.getByTestId('project');
	await expect(list).toHaveCount(2);
	await expect(list.nth(0)).toContainText('A');
	await expect(list.nth(0)).toContainText('1 take');
	await expect(list.nth(1)).toContainText('2 takes');
	await list.nth(1).getByRole('button', { name: 'More actions' }).click();
	await page.getByRole('button', { name: 'Rename', exact: true }).click();
	await list.nth(1).getByRole('textbox', { name: 'Project name' }).fill('Episode 1');
	await list.nth(1).getByRole('textbox', { name: 'Project name' }).press('Enter');
	await expect(list.nth(1).getByTestId('project-name')).toHaveText('Episode 1');
	await expect.poll(async () => (await projectFile(page, together)).title).toBe('Episode 1');
	await list.nth(1).getByRole('button', { name: 'Open' }).click();
	await expect(page.getByTestId('editor')).toHaveAttribute('data-project-id', together);
	await expect(page.getByTestId('project-title')).toHaveText('Episode 1');

	// Renamed in the editor's header too.
	await page.getByTestId('project-title').click();
	await page.getByRole('textbox', { name: 'Project name' }).fill('Episode 1, cut');
	await page.getByRole('textbox', { name: 'Project name' }).press('Enter');
	await expect.poll(async () => (await projectFile(page, together)).title).toBe('Episode 1, cut');

	// Deleting A warns that both Projects use it, and takes it out of them.
	await page.getByRole('tab', { name: 'Takes' }).click();
	const rowA = takes.locator(`[data-session-id="${A.id}"]`);
	await rowA.getByRole('button', { name: 'More actions' }).click();
	await page.getByRole('button', { name: 'Delete…', exact: true }).click();
	await expect(rowA.getByTestId('used-in')).toContainText('used in 2 projects');
	await expect(rowA.getByTestId('used-in')).toContainText('“Episode 1, cut”');
	await rowA.getByRole('button', { name: 'Delete', exact: true }).click();
	await expect(rowA).toHaveCount(0);
	await expect.poll(async () => (await projectFile(page, together)).sessions.map((s) => s.sessionId)).toEqual([B.id]);
	await expect.poll(async () => (await projectFile(page, solo)).sessions).toEqual([]);

	// Deleting a Project keeps its takes.
	await page.getByRole('tab', { name: 'Edit' }).click();
	expect(await projectTakes(page)).toEqual(['B']);
	await page.getByRole('button', { name: 'All projects' }).click();
	await expect(list.nth(1)).toContainText('1 take');
	await list.nth(1).getByRole('button', { name: 'More actions' }).click();
	await page.getByRole('button', { name: 'Delete…', exact: true }).click();
	await page.getByRole('button', { name: 'Delete project' }).click();
	await expect(list).toHaveCount(1);
	await expect(list.first()).toContainText('0 takes');
	await page.getByRole('tab', { name: 'Takes' }).click();
	await expect(takes.locator(`[data-session-id="${B.id}"]`)).toBeVisible();

	// The emptied Project says so, and can take takes again.
	await page.getByRole('tab', { name: 'Edit' }).click();
	await list.first().getByRole('button', { name: 'Open' }).click();
	await expect(page.getByTestId('no-takes')).toBeVisible();
	await page.getByRole('button', { name: 'Add takes' }).click();
	await page.getByTestId('take-picker').getByRole('checkbox').first().check();
	await page.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(page.getByTestId('no-takes')).toHaveCount(0);
	await expect(page.getByTestId('lane')).toHaveCount(1);
});
