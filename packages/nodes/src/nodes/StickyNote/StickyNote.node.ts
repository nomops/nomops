import type { INodeType, INodeTypeDescription } from '@nomops/workflow';

export const stickyNoteDescription: INodeTypeDescription = {
  displayName: 'Sticky Note',
  name: 'stickyNote',
  group: ['organize'],
  version: 1,
  description: 'Annotate the canvas — sticky notes never execute',
  defaults: { name: 'Sticky Note' },
  inputs: [],
  outputs: [],
  properties: [
    {
      displayName: 'Content',
      name: 'content',
      type: 'string',
      // D079:默认 markdown(标题 + 粗体 + 链接)
      default:
        "## I'm a note \n**Double click** to edit me. [Guide](https://github.com/nomops/nomops/tree/main/docs)",
      noDataExpression: true,
    },
    {
      displayName: 'Color',
      name: 'color',
      type: 'options',
      default: 'yellow',
      noDataExpression: true,
      options: [
        { name: 'Yellow', value: 'yellow' },
        { name: 'Gold', value: 'gold' },
        { name: 'Red', value: 'red' },
        { name: 'Green', value: 'green' },
        { name: 'Blue', value: 'blue' },
        { name: 'Purple', value: 'purple' },
        { name: 'Gray', value: 'neutral' },
      ],
    },
  ],
};

/**
 * 便签节点：只存在于画布（无端口、无 execute）。
 * 引擎永远不会执行它——没有任何连接能到达；起点选择也排除无 main 出向的节点。
 */
export class StickyNote implements INodeType {
  description = stickyNoteDescription;
}
