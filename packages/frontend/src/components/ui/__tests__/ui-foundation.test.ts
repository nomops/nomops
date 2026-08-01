import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import UiDialog from '../UiDialog.vue';
import UiConfirmHost from '../UiConfirmHost.vue';
import UiState from '../UiState.vue';
import UiToastHost from '../UiToastHost.vue';
import { useUiStore } from '../../../stores/ui.js';

beforeEach(() => {
  setActivePinia(createPinia());
  vi.useRealTimers();
});

describe('UiDialog', () => {
  it('提供产品内 dialog 语义，并支持 Escape 关闭', async () => {
    const wrapper = mount(UiDialog, {
      props: { open: true, title: 'Create project', testId: 'test-dialog' },
      slots: { default: '<input autofocus aria-label="Name" />' },
      attachTo: document.body,
    });

    expect(wrapper.get('[role="dialog"]').attributes('aria-modal')).toBe('true');
    expect(wrapper.get('[data-test="test-dialog"]').attributes('data-test')).toBe('test-dialog');
    await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Escape' });
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });

  it('可禁止遮罩关闭，避免提交中断', async () => {
    const wrapper = mount(UiDialog, { props: { open: true, closeOnOverlay: false } });
    await wrapper.get('[data-test="ui-dialog-overlay"]').trigger('mousedown');
    expect(wrapper.emitted('close')).toBeUndefined();
  });
});

describe('全局反馈', () => {
  it('确认框返回用户选择，不调用浏览器 confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const ui = useUiStore();
    const wrapper = mount(UiConfirmHost);
    const result = ui.requestConfirm({ title: 'Delete workflow?', message: 'This cannot be undone.', tone: 'danger' });
    await flushPromises();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(wrapper.get('[role="dialog"]').text()).toContain('Delete workflow?');
    await wrapper.get('[data-test="confirm-submit"]').trigger('click');
    await expect(result).resolves.toBe(true);
  });

  it('Toast 自动消失并支持主动关闭', async () => {
    vi.useFakeTimers();
    const ui = useUiStore();
    const wrapper = mount(UiToastHost);
    const id = ui.notify({ kind: 'success', title: 'Saved' }, 1000);
    await flushPromises();
    expect(wrapper.get('[data-test-toast="success"]').text()).toContain('Saved');

    vi.advanceTimersByTime(1000);
    await flushPromises();
    expect(ui.toasts.some((toast) => toast.id === id)).toBe(false);
  });
});

describe('UiState', () => {
  it('为加载和错误状态提供可访问语义', () => {
    const loading = mount(UiState, { props: { kind: 'loading', title: 'Loading data' } });
    expect(loading.get('[role="status"]').attributes('aria-busy')).toBe('true');

    const error = mount(UiState, { props: { kind: 'error', title: 'Could not load data' } });
    expect(error.get('[role="alert"]').text()).toContain('Could not load data');
  });
});
