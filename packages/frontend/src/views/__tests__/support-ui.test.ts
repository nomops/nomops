import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../../api/client.js';
import SupportView from '../SupportView.vue';

beforeEach(()=>vi.restoreAllMocks());

describe('Get support UI',()=>{
  it('shows administrator guidance without an unusable submit button when disabled',async()=>{
    vi.spyOn(api.support,'status').mockResolvedValue({enabled:false});
    const wrapper=mount(SupportView);await flushPromises();
    expect(wrapper.find('[data-test="support-disabled"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="support-submit"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('NOMOPS_SUPPORT_URL');
    expect(wrapper.text()).toContain('Token 只留在服务端');
  });

  it('submits accessible form fields once and shows the site ticket id',async()=>{
    vi.spyOn(api.support,'status').mockResolvedValue({enabled:true});
    const submit=vi.spyOn(api.support,'submit').mockResolvedValue({id:'site-ticket-42',status:'open',createdAt:'2026-08-14T03:00:00.000Z'});
    const wrapper=mount(SupportView);await flushPromises();
    await wrapper.find('[data-test="support-name"]').setValue('Ada');await wrapper.find('[data-test="support-email"]').setValue('ada@example.com');
    await wrapper.find('[data-test="support-subject"]').setValue('Queue issue');await wrapper.find('[data-test="support-description"]').setValue('The queue worker does not start.');
    await wrapper.find('form').trigger('submit');await flushPromises();
    expect(submit).toHaveBeenCalledOnce();expect(submit.mock.calls[0]?.[1]).toMatch(/^[-A-Za-z0-9]{8,}$/);
    expect(wrapper.find('[data-test="support-success"]').text()).toContain('site-ticket-42');
  });

  it('disables duplicate submission while pending and renders a sanitized failure state',async()=>{
    vi.spyOn(api.support,'status').mockResolvedValue({enabled:true});let rejectRequest:(error:Error)=>void=()=>undefined;
    vi.spyOn(api.support,'submit').mockImplementation(()=>new Promise((_resolve,reject)=>{rejectRequest=reject;}));
    const wrapper=mount(SupportView);await flushPromises();
    await wrapper.find('[data-test="support-name"]').setValue('Ada');await wrapper.find('[data-test="support-email"]').setValue('ada@example.com');
    await wrapper.find('[data-test="support-subject"]').setValue('Queue issue');await wrapper.find('[data-test="support-description"]').setValue('The queue worker does not start.');
    await wrapper.find('form').trigger('submit');await flushPromises();expect(wrapper.find<HTMLButtonElement>('[data-test="support-submit"]').element.disabled).toBe(true);
    rejectRequest(new ApiError('支持服务暂时不可用，请稍后重试',502,{code:'support_unavailable'}));await flushPromises();
    expect(wrapper.find('[data-test="support-error"]').text()).toContain('支持服务暂时不可用');
    expect(wrapper.find<HTMLButtonElement>('[data-test="support-submit"]').element.disabled).toBe(false);
  });

  it('states the exact secret and metadata boundaries',async()=>{
    vi.spyOn(api.support,'status').mockResolvedValue({enabled:true});const wrapper=mount(SupportView);await flushPromises();
    expect(wrapper.text()).toContain('请勿提交密码、API Key、Token、凭证明文、工作流敏感数据或未经脱敏的日志。');
    expect(wrapper.text()).toContain('自动发送的元数据只有产品版本和部署模式');
  });
});
