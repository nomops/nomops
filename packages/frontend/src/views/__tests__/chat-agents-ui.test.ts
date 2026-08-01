import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(resolve(process.cwd(), `src/views/${file}`), 'utf8');
const chat = read('ChatView.vue');
const agents = read('AgentsView.vue');
const assistant = read('InstanceAiView.vue');

describe('chat and agents UI', () => {
  it('confirms chat and personal-agent deletion before mutating local state', () => {
    expect(chat).toContain("title: 'Delete chat?'");
    expect(chat).toContain("title: 'Delete personal agent?'");
    expect(chat).toContain('await ui.requestConfirm({');
    expect(chat).toContain("title: 'Chat deleted'");
  });

  it('does not present an inert tools control as available', () => {
    expect(chat).toContain('data-test="chat-tools" disabled');
    expect(chat).toContain('Tool selection is managed by the selected model or agent');
  });

  it('moves all agent destructive actions into product confirms', () => {
    for (const title of ['Delete scheduled task?', 'Delete agent file?', 'Disconnect channel?', 'Delete agent?']) {
      expect(agents).toContain(`title: '${title}'`);
    }
    expect(agents).not.toContain('window.confirm(');
    expect(agents).toContain('title="Loading agents"');
  });

  it('protects assistant restore, delete, and MCP disconnect actions', () => {
    for (const title of ['Disconnect MCP server?', 'Restore checkpoint?', 'Delete assistant thread?']) {
      expect(assistant).toContain(`title: '${title}'`);
    }
    expect(assistant).not.toContain('window.confirm(');
    expect(assistant).toContain('title="Loading assistant threads"');
  });

  it('uses semantic close icons and responsive management layouts', () => {
    expect(chat).toContain('aria-label="Delete chat"');
    expect(assistant).toContain('aria-label="Delete assistant thread"');
    expect(agents).toContain('@media (max-width: 780px)');
    expect(assistant).toContain('@media (max-width: 700px)');
  });
});
