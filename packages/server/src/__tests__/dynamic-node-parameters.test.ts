import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  ILoadOptionsContext,
  INodeType,
  INodeTypeDescription,
  IResourceLocatorContext,
} from '@nomops/workflow';
import { createApp } from '../app.js';
import { bootstrap, type BootstrapResult } from '../bootstrap.js';

const description: INodeTypeDescription = {
  displayName: 'Resource Demo',
  name: 'resourceDemo',
  group: ['output'],
  version: 1,
  description: 'Dynamic parameter integration fixture',
  defaults: { name: 'Resource Demo' },
  inputs: ['main'],
  outputs: ['main'],
  requestDefaults: { baseUrl: 'https://resources.test' },
  credentials: [{ name: 'resourceApi', required: true }],
  properties: [
    {
      displayName: 'Region',
      name: 'region',
      type: 'options',
      default: 'eu',
      options: [{ name: 'EU', value: 'eu' }, { name: 'US', value: 'us' }],
    },
    {
      displayName: 'Channel',
      name: 'channel',
      type: 'options',
      default: '',
      typeOptions: { loadOptionsMethod: 'channels', loadOptionsDependsOn: ['region'] },
    },
    {
      displayName: 'Team',
      name: 'team',
      type: 'options',
      default: '',
      typeOptions: {
        loadOptionsDependsOn: ['region'],
        loadOptions: {
          request: { url: '/teams?region={{ $parameter.region }}' },
          resultsPath: 'teams',
          name: 'label',
          value: 'id',
        },
      },
    },
    {
      displayName: 'Target',
      name: 'target',
      type: 'resourceLocator',
      default: { mode: 'list', value: '' },
      modes: [
        { displayName: 'From list', name: 'list', searchListMethod: 'searchChannels' },
        { displayName: 'By URL', name: 'url' },
        { displayName: 'By ID', name: 'id' },
      ],
    },
  ],
};

class ResourceDemo implements INodeType {
  description = description;
  methods = {
    loadOptions: {
      channels: async function (this: ILoadOptionsContext) {
        const credential = await this.getCredentials('resourceApi');
        const region = String(this.getCurrentNodeParameter('region') ?? '');
        const response = await this.helpers.httpRequest({
          url: `https://resources.test/channels?region=${encodeURIComponent(region)}`,
          headers: { authorization: `Bearer ${String(credential['token'])}` },
        }) as { channels: Array<{ id: string; label: string }> };
        return response.channels.map((channel) => ({ name: channel.label, value: channel.id }));
      },
    },
    resourceLocator: {
      searchChannels: async function (this: IResourceLocatorContext) {
        const credential = await this.getCredentials('resourceApi');
        const response = await this.helpers.httpRequest({
          url: `https://resources.test/search?q=${encodeURIComponent(this.filter ?? '')}`,
          headers: { authorization: `Bearer ${String(credential['token'])}` },
        }) as { channels: Array<{ id: string; label: string }> };
        return { results: response.channels.map((channel) => ({ name: channel.label, value: channel.id })) };
      },
    },
  };
}

describe('dynamic node parameters', () => {
  let boot: BootstrapResult;
  let token: string;
  let userId: string;
  let credentialId: string;
  const upstream = vi.fn(async (options: unknown) => {
    const requestOptions = options as { url: string };
    return requestOptions.url.includes('/search')
      ? { channels: [{ id: 'C2', label: 'Product' }] }
      : requestOptions.url.includes('/teams')
        ? { teams: [{ id: 'T1', label: 'Platform' }] }
      : { channels: [{ id: 'C1', label: 'Engineering' }] };
  });

  beforeAll(async () => {
    boot = await bootstrap({ dbConfig: { type: 'sqlite' }, httpRequest: upstream });
    boot.services.nodeLoader.register([{
      type: 'nomops.resourceDemo',
      description,
      load: async () => ResourceDemo,
    }]);
    const app = createApp(boot.services);
    const registration = await request(app).post('/auth/register').send({ email: 'dynamic@test.dev', password: 'password-123' }).expect(201);
    userId = registration.body.user.id;
    token = (await request(app).post('/auth/login').send({ email: 'dynamic@test.dev', password: 'password-123' }).expect(200)).body.token;
    credentialId = (await request(app)
      .post('/api/credentials')
      .set({ authorization: `Bearer ${token}` })
      .send({ name: 'Resource API', type: 'resourceApi', data: { token: 'plain-secret-token' } })
      .expect(201)).body.id;
  });

  afterAll(async () => boot.shutdown());

  it('uses the selected project credential to load a real upstream resource list', async () => {
    const response = await request(createApp(boot.services))
      .post('/api/dynamic-node-parameters/options')
      .set({ authorization: `Bearer ${token}` })
      .send({
        nodeType: 'nomops.resourceDemo',
        nodeVersion: 1,
        propertyName: 'channel',
        currentNodeParameters: { region: 'eu' },
        credentials: { resourceApi: { id: credentialId } },
      })
      .expect(200);

    expect(response.body).toEqual([{ name: 'Engineering', value: 'C1' }]);
    expect(upstream).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://resources.test/channels?region=eu',
      headers: { authorization: 'Bearer plain-secret-token' },
    }));
    expect(JSON.stringify(response.body)).not.toContain('plain-secret-token');
  });

  it('supports resource locator search without returning credential plaintext', async () => {
    const response = await request(createApp(boot.services))
      .post('/api/dynamic-node-parameters/resource-locator-results')
      .set({ authorization: `Bearer ${token}` })
      .send({
        nodeType: 'nomops.resourceDemo',
        propertyName: 'target',
        currentNodeParameters: {},
        credentials: { resourceApi: { id: credentialId } },
        filter: 'prod',
      })
      .expect(200);
    expect(response.body).toEqual({ results: [{ name: 'Product', value: 'C2' }] });
    expect(JSON.stringify(response.body)).not.toContain('plain-secret-token');
  });

  it('executes declarative loadOptions and maps the configured response paths', async () => {
    const response = await request(createApp(boot.services))
      .post('/api/dynamic-node-parameters/options')
      .set({ authorization: `Bearer ${token}` })
      .send({
        nodeType: 'nomops.resourceDemo',
        propertyName: 'team',
        currentNodeParameters: { region: 'us' },
        credentials: {},
      })
      .expect(200);
    expect(response.body).toEqual([{ name: 'Platform', value: 'T1' }]);
    expect(upstream).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://resources.test/teams?region=us' }));
  });

  it('rejects undeclared properties and credentials from another project', async () => {
    const app = createApp(boot.services);
    const otherProject = await boot.services.repos.projects.create({ name: 'Other project', type: 'team' });
    await boot.services.repos.projects.addMember(otherProject.id, userId, 'project:owner');

    await request(app)
      .post('/api/dynamic-node-parameters/options')
      .set({ authorization: `Bearer ${token}` })
      .send({ nodeType: 'nomops.resourceDemo', propertyName: 'missing', currentNodeParameters: {}, credentials: {} })
      .expect(404);
    const crossProject = await request(app)
      .post('/api/dynamic-node-parameters/options')
      .set({ authorization: `Bearer ${token}`, 'x-project-id': otherProject.id })
      .send({
        nodeType: 'nomops.resourceDemo',
        propertyName: 'channel',
        currentNodeParameters: { region: 'us' },
        credentials: { resourceApi: { id: credentialId } },
      })
      .expect(502);
    expect(JSON.stringify(crossProject.body)).not.toContain('plain-secret-token');
  });
});
