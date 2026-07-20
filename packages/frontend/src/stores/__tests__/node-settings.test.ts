import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { INode } from '@nomops/workflow';
import { resolveOnError, resolveRetry } from '@nomops/workflow';
import { useEditorStore } from '../editor.js';

/**
 * NDV Settings tab 写入的节点级设置（B0）。
 *
 * 这里守的是**前后端语义一致**：UI 写进 node 的值，必须能被引擎的归一化函数
 * 读成预期行为。字段一旦只存不用（或存的形状引擎读不懂），用户配了等于没配。
 */
const node = (extra: Partial<INode> = {}): INode => ({
  id: 'n1',
  name: 'N',
  type: 'nomops.set',
  typeVersion: 1,
  position: [0, 0],
  parameters: {},
  ...extra,
});

let editor: ReturnType<typeof useEditorStore>;

beforeEach(() => {
  setActivePinia(createPinia());
  editor = useEditorStore();
  editor.nodes = [node()];
});

const target = () => editor.nodes[0]!;

describe('onError 写入', () => {
  it('三个取值都能写进节点，且引擎读回同一语义', () => {
    for (const value of ['stopWorkflow', 'continueRegularOutput', 'continueErrorOutput'] as const) {
      editor.setNodeSetting('N', 'onError', value);
      expect(target().onError).toBe(value);
      expect(resolveOnError(target())).toBe(value);
    }
  });

  it('同步旧的 continueOnError 字段（历史工作流与外部 API 仍在读它）', () => {
    editor.setNodeSetting('N', 'onError', 'continueErrorOutput');
    expect(target().continueOnError).toBe(true);

    editor.setNodeSetting('N', 'onError', 'continueRegularOutput');
    expect(target().continueOnError).toBe(false);

    editor.setNodeSetting('N', 'onError', 'stopWorkflow');
    expect(target().continueOnError).toBe(false);
  });
});

describe('重试字段写入', () => {
  it('retryOnFail 关闭时引擎只跑一次', () => {
    expect(resolveRetry(target())).toMatchObject({ enabled: false, maxTries: 1 });
  });

  it('打开后写入的 maxTries / waitBetweenTries 被引擎原样采纳', () => {
    editor.setNodeSetting('N', 'retryOnFail', true);
    editor.setNodeSetting('N', 'maxTries', 4);
    editor.setNodeSetting('N', 'waitBetweenTries', 2500);

    expect(resolveRetry(target())).toEqual({
      enabled: true,
      maxTries: 4,
      waitBetweenTries: 2500,
    });
  });

  it('★UI 若被绕过传入越界值，引擎侧钳制兜底（不报错、不放行）', () => {
    editor.setNodeSetting('N', 'retryOnFail', true);
    editor.setNodeSetting('N', 'maxTries', 999);
    editor.setNodeSetting('N', 'waitBetweenTries', 999_999);

    expect(resolveRetry(target())).toEqual({
      enabled: true,
      maxTries: 5,
      waitBetweenTries: 5000,
    });
  });
});

describe('布尔开关写入', () => {
  it('alwaysOutputData / executeOnce 落到节点上', () => {
    editor.setNodeSetting('N', 'alwaysOutputData', true);
    editor.setNodeSetting('N', 'executeOnce', true);

    expect(target().alwaysOutputData).toBe(true);
    expect(target().executeOnce).toBe(true);
  });
});

describe('编辑器集成', () => {
  it('改设置标脏（触发保存按钮）', () => {
    editor.dirty = false;
    editor.setNodeSetting('N', 'executeOnce', true);
    expect(editor.dirty).toBe(true);
  });

  it('改设置可撤销', () => {
    editor.setNodeSetting('N', 'maxTries', 5);
    expect(target().maxTries).toBe(5);

    editor.undo();
    expect(target().maxTries).toBeUndefined();
  });

  it('节点名不存在时静默忽略（不抛错崩掉画布）', () => {
    expect(() => editor.setNodeSetting('NOPE', 'executeOnce', true)).not.toThrow();
  });
});
