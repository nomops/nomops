import { Router } from 'express';
import { z } from 'zod';
import type { AppServices } from '../app-services.js';
import { SupportServiceError } from '../services/support-service.js';

const ticketSchema=z.object({
  requesterName:z.string().trim().min(1).max(100),
  requesterEmail:z.string().trim().email().max(254),
  subject:z.string().trim().min(1).max(200),
  description:z.string().trim().min(10).max(10_000),
}).strict();
const idempotencyPattern=/^[A-Za-z0-9._:-]{8,128}$/;

function error(res: import('express').Response,status:number,code:string,message:string):void {
  res.status(status).json({error:{code,message}});
}

export function createSupportRouter(services:AppServices):Router {
  const router=Router();
  router.use((req,res,next)=>{
    if(req.auth?.authType!=='session'){error(res,401,'session_required','必须使用已登录用户会话');return;}
    next();
  });
  router.get('/status',(_req,res)=>res.json(services.support.status()));
  router.post('/tickets',async(req,res)=>{
    const parsed=ticketSchema.safeParse(req.body);
    if(!parsed.success){error(res,400,'validation_error','支持请求参数无效');return;}
    const idempotencyKey=req.header('Idempotency-Key')??'';
    if(!idempotencyPattern.test(idempotencyKey)){error(res,400,'invalid_idempotency_key','Idempotency-Key 必须为 8–128 位安全字符');return;}
    try {
      const result=await services.support.submit(parsed.data,idempotencyKey);
      res.status(201).json(result);
    } catch(cause) {
      if(cause instanceof SupportServiceError){error(res,cause.status,cause.code,cause.message);return;}
      error(res,502,'support_unavailable','支持服务暂时不可用，请稍后重试');
    }
  });
  return router;
}
