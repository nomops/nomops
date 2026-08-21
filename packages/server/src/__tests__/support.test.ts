import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { OperationalError, type IHttpRequestOptions } from '@nomops/workflow';
import { createApp } from '../app.js';
import { bootstrap, type BootstrapResult } from '../bootstrap.js';
import { inviteUser, setupOwner } from './helpers.js';

const upstreamResult={id:'site-ticket-1',status:'open',createdAt:'2026-08-14T03:00:00.000Z'};
const form={requesterName:'Ada',requesterEmail:'ada@example.com',subject:'Queue mode issue',description:'The queue worker does not start after deployment.'};
const key='support-request-0001';
const boots:BootstrapResult[]=[];
afterEach(async()=>{for(const boot of boots.splice(0))await boot.shutdown();vi.restoreAllMocks();});

async function start(options:Parameters<typeof bootstrap>[0]) {
  const boot=await bootstrap({dbConfig:{type:'sqlite',filename:':memory:'},...(options as object)});
  boots.push(boot);return {boot,app:createApp(boot.services)};
}

describe('self-hosted support integration',()=>{
  it('is disabled unless both server-only settings exist and never returns the token',async()=>{
    const {app}=await start({support:{url:'https://support.example.com',productVersion:'1.2.3',deploymentMode:'regular'}});
    const owner=await setupOwner(app,'owner@example.com');
    const status=await request(app).get('/api/support/status').set('authorization',`Bearer ${owner.token}`).expect(200);
    expect(status.body).toEqual({enabled:false});
    expect(JSON.stringify(status.body)).not.toContain('nomops_support_');
    await request(app).post('/api/support/tickets').set('authorization',`Bearer ${owner.token}`).set('Idempotency-Key',key).send(form).expect(503);
  });

  it('requires a login session and lets an ordinary invited member submit',async()=>{
    const seen:IHttpRequestOptions[]=[];
    const {app}=await start({support:{url:'https://support.example.com/base?ignored=1',token:'nomops_support_test-secret',productVersion:'1.2.3',deploymentMode:'queue'},supportHttpRequest:async(options)=>{seen.push(options);return upstreamResult;}});
    const owner=await setupOwner(app,'owner@example.com');
    const member=await inviteUser(app,owner.token,'member@example.com',{role:'member'});
    await request(app).post('/api/support/tickets').set('Idempotency-Key',key).send(form).expect(401);
    const result=await request(app).post('/api/support/tickets').set('authorization',`Bearer ${member.token}`).set('Idempotency-Key',key).send(form).expect(201);
    expect(result.body).toEqual(upstreamResult);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({url:'https://support.example.com/api/instance/v1/tickets',method:'POST',urlTrust:'user-controlled'});
    expect(seen[0]?.headers).toMatchObject({authorization:'Bearer nomops_support_test-secret','idempotency-key':key});
    expect(seen[0]?.body).toEqual({...form,productVersion:'1.2.3',deploymentMode:'queue'});
  });

  it('strictly validates fields and the idempotency key before outbound I/O',async()=>{
    const outbound=vi.fn(async()=>upstreamResult);
    const {app}=await start({support:{url:'https://support.example.com',token:'secret',productVersion:'1.0.0',deploymentMode:'regular'},supportHttpRequest:outbound});
    const owner=await setupOwner(app,'owner@example.com');const auth={authorization:`Bearer ${owner.token}`};
    await request(app).post('/api/support/tickets').set(auth).send(form).expect(400);
    await request(app).post('/api/support/tickets').set(auth).set('Idempotency-Key',key).send({...form,workflowJson:{secret:true}}).expect(400);
    await request(app).post('/api/support/tickets').set(auth).set('Idempotency-Key',key).send({...form,requesterEmail:'invalid'}).expect(400);
    expect(outbound).not.toHaveBeenCalled();
  });

  it('retries transient failures with the same idempotency key',async()=>{
    const seen:IHttpRequestOptions[]=[];let attempt=0;
    const {app}=await start({support:{url:'https://support.example.com',token:'secret',productVersion:'1.0.0',deploymentMode:'regular'},supportHttpRequest:async(options)=>{seen.push(options);attempt+=1;if(attempt===1)throw new OperationalError('upstream failed',{status:500,body:{internal:'hidden'}});return upstreamResult;}});
    const owner=await setupOwner(app,'owner@example.com');
    await request(app).post('/api/support/tickets').set('authorization',`Bearer ${owner.token}`).set('Idempotency-Key',key).send(form).expect(201);
    expect(seen).toHaveLength(2);
    expect(seen.map(item=>item.headers?.['idempotency-key'])).toEqual([key,key]);
  });

  it.each([
    [400,502,'support_upstream_rejected'],[401,503,'support_authentication_failed'],[409,409,'support_idempotency_conflict'],
    [429,429,'support_rate_limited'],[500,502,'support_unavailable'],
  ])('maps upstream %s to a stable sanitized response',async(upstreamStatus,localStatus,code)=>{
    const {app}=await start({support:{url:'https://support.example.com',token:'top-secret-token',productVersion:'1.0.0',deploymentMode:'regular'},supportHttpRequest:async()=>{throw new OperationalError(`database /private/path Bearer top-secret-token`,{status:upstreamStatus,body:{stack:'private stack',token:'top-secret-token'}});}});
    const owner=await setupOwner(app,`owner-${upstreamStatus}@example.com`);
    const response=await request(app).post('/api/support/tickets').set('authorization',`Bearer ${owner.token}`).set('Idempotency-Key',key).send(form).expect(localStatus);
    expect(response.body.error.code).toBe(code);
    expect(JSON.stringify(response.body)).not.toMatch(/private|database|stack|top-secret-token/i);
  });

  it('maps bounded timeouts without leaking Authorization or upstream errors to logs',async()=>{
    const log=vi.spyOn(console,'log').mockImplementation(()=>undefined);const error=vi.spyOn(console,'error').mockImplementation(()=>undefined);
    const {app}=await start({support:{url:'https://support.example.com',token:'never-log-this-token',productVersion:'1.0.0',deploymentMode:'regular'},supportTimeoutMs:5,supportHttpRequest:(options)=>new Promise((_resolve,reject)=>options.signal?.addEventListener('abort',()=>reject(new Error('Bearer never-log-this-token')),{once:true}))});
    const owner=await setupOwner(app,'owner@example.com');
    const response=await request(app).post('/api/support/tickets').set('authorization',`Bearer ${owner.token}`).set('Idempotency-Key',key).send(form).expect(504);
    expect(response.body.error.code).toBe('support_timeout');
    expect(log).not.toHaveBeenCalled();expect(error).not.toHaveBeenCalled();
  });

  it('uses the production SSRF boundary and blocks a loopback support URL before sending secrets',async()=>{
    const {app}=await start({support:{url:'http://127.0.0.1:65530',token:'do-not-send',productVersion:'1.0.0',deploymentMode:'regular'}});
    const owner=await setupOwner(app,'owner@example.com');
    const response=await request(app).post('/api/support/tickets').set('authorization',`Bearer ${owner.token}`).set('Idempotency-Key',key).send(form).expect(502);
    expect(response.body.error.code).toBe('support_unavailable');
    expect(JSON.stringify(response.body)).not.toContain('do-not-send');
  });
});
