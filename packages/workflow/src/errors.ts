/**
 * 错误类层级（docs/05 第三节）。
 * - OperationalError：可预期的操作错误（用户输入错、配置错、找不到资源等）。
 * - UnexpectedError：非预期错误（bug）。
 * 两者都带 `context` 以携带定位信息（哪个节点/参数/item）。
 */

export interface IErrorContext {
  [key: string]: unknown;
}

export class OperationalError extends Error {
  readonly context: IErrorContext;

  constructor(message: string, context: IErrorContext = {}) {
    super(message);
    this.name = new.target.name;
    this.context = context;
  }
}

export class UnexpectedError extends Error {
  readonly context: IErrorContext;

  constructor(message: string, context: IErrorContext = {}) {
    super(message);
    this.name = new.target.name;
    this.context = context;
  }
}
