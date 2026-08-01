import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (name: string) => readFileSync(resolve(process.cwd(), `src/views/${name}`), 'utf8');
const agents = read('AgentsView.vue');
const assistant = read('InstanceAiView.vue');
const chat = read('ChatView.vue');

describe('AI workspace nested states', () => {
  it('separates agent workspace loading, failure, and retry states', () => {
    expect(agents).toContain('title="Loading agent workspace"');
    expect(agents).toContain('title="Could not load agent workspace"');
    expect(agents).toContain('@click="select(selected)"');
    expect(agents).not.toContain('api.agents.memory(selected.value.id).catch(() => [])');
  });

  it('separates assistant workspace loading, failure, and retry states', () => {
    expect(assistant).toContain('title="Loading assistant workspace"');
    expect(assistant).toContain('title="Could not load assistant workspace"');
    expect(assistant).toContain('@click="select(selected)"');
    expect(assistant).not.toContain('api.instanceAi.actions(selected.value.id).catch(() => [])');
  });

  it('reports recall progress, failure, retry, and no-match states', () => {
    expect(assistant).toContain("{{ recallLoading ? 'Recalling…' : 'Recall' }}");
    expect(assistant).toContain('v-if="recallError"');
    expect(assistant).toContain('@click="doRecall">Retry</button>');
    expect(assistant).toContain('title="No matching memory"');
  });

  it('does not disguise chat surface failures as empty data', () => {
    expect(chat).toContain('title="Loading chat workspace"');
    expect(chat).toContain('title="Could not load chat workspace"');
    expect(chat).toContain('@click="loadChatSurface"');
    expect(chat).toContain('Promise.all([loadPersisted(), loadWorkflowAgents(), loadProviders()])');
  });

  it('provides feedback for nested mutations and file downloads', () => {
    expect(agents).toContain("title: c.active ? 'Channel paused' : 'Channel resumed'");
    expect(agents).toContain("title: 'Agent file downloaded'");
    expect(assistant).toContain("title: 'Assistant action rejected'");
    expect(chat).toContain("title: 'Workflow added to canvas'");
    expect(chat).toContain("title: 'Personal agent created'");
  });
});
