import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ApiError, api, type WorkflowRow } from '../../api/client.js';
import { useEditorStore } from '../editor.js';

const workflow = (version = 1): WorkflowRow => ({
  id: 'wf-lock',
  version,
  name: 'Shared draft',
  description: null,
  active: false,
  nodes: [],
  connections: {},
  settings: null,
  pinData: null,
  folderId: null,
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z',
  publishedDirty: true,
});

beforeEach(() => {
  setActivePinia(createPinia());
  vi.restoreAllMocks();
});

describe('editor optimistic save queue', () => {
  it('loads and sends the server version, then adopts the incremented version', async () => {
    vi.spyOn(api.workflows, 'get').mockResolvedValue(workflow());
    const update = vi.spyOn(api.workflows, 'update').mockResolvedValue({ ...workflow(2), name: 'Renamed' });
    const editor = useEditorStore();
    await editor.load('wf-lock');
    editor.setName('Renamed');

    await editor.save();

    expect(update).toHaveBeenCalledWith('wf-lock', expect.objectContaining({ version: 1, name: 'Renamed' }));
    expect(editor.version).toBe(2);
    expect(editor.dirty).toBe(false);
  });

  it('keeps local changes dirty and exposes a recoverable conflict on 409', async () => {
    vi.spyOn(api.workflows, 'get').mockResolvedValue(workflow());
    vi.spyOn(api.workflows, 'update').mockRejectedValue(
      new ApiError('Workflow was changed in another session', 409, { expectedVersion: 1, currentVersion: 2 }),
    );
    const editor = useEditorStore();
    await editor.load('wf-lock');
    editor.setName('Local unsaved name');

    await expect(editor.save()).rejects.toMatchObject({ status: 409 });

    expect(editor.dirty).toBe(true);
    expect(editor.name).toBe('Local unsaved name');
    expect(editor.saveConflict).toEqual({
      message: 'Workflow was changed in another session',
      expectedVersion: 1,
      currentVersion: 2,
    });
  });

  it('serializes overlapping saves and drains edits made during the first request', async () => {
    vi.spyOn(api.workflows, 'get').mockResolvedValue(workflow());
    let releaseFirst!: (row: WorkflowRow) => void;
    const firstResponse = new Promise<WorkflowRow>((resolve) => { releaseFirst = resolve; });
    const update = vi.spyOn(api.workflows, 'update')
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValueOnce({ ...workflow(3), name: 'Name A', description: 'Description B' });
    const editor = useEditorStore();
    await editor.load('wf-lock');
    editor.setName('Name A');

    const firstSave = editor.save();
    editor.setDescription('Description B');
    const overlappingSave = editor.save();
    releaseFirst({ ...workflow(2), name: 'Name A' });
    await Promise.all([firstSave, overlappingSave]);

    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ version: 2, description: 'Description B' }));
    expect(editor.version).toBe(3);
    expect(editor.dirty).toBe(false);
  });
});
