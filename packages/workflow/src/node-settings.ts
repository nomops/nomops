/**
 * 节点级设置的归一化（Layer 1，纯计算）。
 *
 * NDV Settings tab 上的字段是「用户意图」，形态宽松（可缺省、可越界、可与旧字段并存）；
 * 引擎需要的是「确定的行为」。两者之间的翻译全部集中在本文件——
 * 引擎与前端都从这里取，避免各自散写默认值与钳制逻辑而漂移。
 */

import type { INode, IWorkflowSettings } from './interfaces.js';

/** 节点报错时的行为（三态）。 */
export type NodeOnError = 'stopWorkflow' | 'continueRegularOutput' | 'continueErrorOutput';

/* ── 重试的取值域（越界即钳制，不报错：设置面板的数字框挡不住 API 直传） ── */
export const RETRY_MAX_TRIES_DEFAULT = 3;
export const RETRY_MAX_TRIES_MIN = 2;
export const RETRY_MAX_TRIES_MAX = 5;
export const RETRY_WAIT_MS_DEFAULT = 1000;
/** 注意：显式传 0 会落回默认 1000（0 被视作「没填」）——与基线行为一致。 */
export const RETRY_WAIT_MS_MIN = 0;
export const RETRY_WAIT_MS_MAX = 5000;

export interface IResolvedRetry {
  /** false 时 maxTries 恒为 1（即「只跑一次」，调用方无需再判 enabled）。 */
  enabled: boolean;
  /** 总尝试次数（含首次），已钳制。 */
  maxTries: number;
  /** 两次尝试之间的等待毫秒，已钳制。 */
  waitBetweenTries: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 0 / NaN / 非数字都退回默认值——「尝试 0 次」「等待 NaN 毫秒」不是有意义的意图。 */
function toInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n !== 0 ? Math.trunc(n) : fallback;
}

/**
 * 解析节点报错行为。
 *
 * `onError` 是三态字段，`continueOnError` 是它的布尔前身。二者并存时 onError 优先——
 * 新字段是用户在 UI 上的显式选择，旧字段可能只是历史工作流 JSON 里的残留。
 */
export function resolveOnError(node: INode): NodeOnError {
  if (
    node.onError === 'stopWorkflow' ||
    node.onError === 'continueRegularOutput' ||
    node.onError === 'continueErrorOutput'
  ) {
    return node.onError;
  }
  // 向后兼容：旧工作流只有布尔字段，其语义等同于「从错误端口继续」
  return node.continueOnError === true ? 'continueErrorOutput' : 'stopWorkflow';
}

/** 解析重试设置。未开启重试时返回 maxTries=1，调用方按统一的 for 循环处理即可。 */
export function resolveRetry(node: INode): IResolvedRetry {
  if (node.retryOnFail !== true) {
    return { enabled: false, maxTries: 1, waitBetweenTries: 0 };
  }
  return {
    enabled: true,
    maxTries: clamp(
      toInt(node.maxTries, RETRY_MAX_TRIES_DEFAULT),
      RETRY_MAX_TRIES_MIN,
      RETRY_MAX_TRIES_MAX,
    ),
    waitBetweenTries: clamp(
      toInt(node.waitBetweenTries, RETRY_WAIT_MS_DEFAULT),
      RETRY_WAIT_MS_MIN,
      RETRY_WAIT_MS_MAX,
    ),
  };
}

/**
 * 工作流执行超时 → 毫秒。`settings.executionTimeout` 单位是**秒**（与设置面板一致）。
 * 缺省 / 非正数 / 非法值 = 不限时，返回 0。
 */
export function resolveExecutionTimeoutMs(settings: IWorkflowSettings | undefined): number {
  const seconds = toInt(settings?.executionTimeout, 0);
  return seconds > 0 ? seconds * 1000 : 0;
}
