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

/**
 * 执行暂停信号（控制流，不是错误）：节点 execute 抛出它表示「在此挂起」。
 * 引擎捕获后把当前帧带 resumed 标记压回栈、置 waitTill、以 waiting 状态收束；
 * 恢复时同一节点再次执行，节点用 ctx.isResumed() 区分首跑/续跑。
 * waitTill 缺省 = 无限期等待外部信号（resume API / 回调）。
 */
export class ExecutionPause extends Error {
  /** epoch 毫秒；undefined = 等外部信号。 */
  readonly waitTill?: number;

  constructor(options: { waitTill?: number } = {}) {
    super('execution paused');
    this.name = 'ExecutionPause';
    this.waitTill = options.waitTill;
  }
}
