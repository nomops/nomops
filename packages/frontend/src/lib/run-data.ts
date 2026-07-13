import type { IConnections, INodeExecutionData, IRunData, ITaskData } from '@nomops/workflow';

/** NDV 数据视图的纯逻辑（从组件抽出，可单测）。 */

/** 节点最近一次运行记录。 */
export function lastRunOf(runData: IRunData, nodeName: string): ITaskData | null {
  const runs = runData[nodeName];
  return runs?.[runs.length - 1] ?? null;
}

/** 输出端口 items（null 端口归空数组）。 */
export function outputPorts(taskData: ITaskData | null): INodeExecutionData[][] {
  return (taskData?.data?.['main'] ?? []).map((port) => port ?? []);
}

/** 输入 items = 上游节点对应输出端口的数据（引擎只记录输出）。 */
export function inputItemsFor(
  connections: IConnections,
  runData: IRunData,
  nodeName: string,
): INodeExecutionData[] {
  for (const [source, byType] of Object.entries(connections)) {
    for (const [outIdx, endpoints] of (byType['main'] ?? []).entries()) {
      if (endpoints?.some((ep) => ep.node === nodeName)) {
        const last = lastRunOf(runData, source);
        return last?.data?.['main']?.[outIdx] ?? [];
      }
    }
  }
  return [];
}

/** items 为扁平对象时给出表格结构，否则 null（回退 JSON 展示）。 */
export function tableOf(items: INodeExecutionData[]): { columns: string[]; rows: unknown[][] } | null {
  if (items.length === 0) return null;
  const flat = items.every((it) =>
    Object.values(it.json).every((v) => v === null || typeof v !== 'object'),
  );
  if (!flat) return null;
  const columns = [...new Set(items.flatMap((it) => Object.keys(it.json)))];
  return { columns, rows: items.map((it) => columns.map((c) => it.json[c])) };
}
