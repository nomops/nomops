// 测试用「社区节点包」fixture：约定导出 nomopsNodes: ILoadableNodeType[]。
// 真实社区包由作者编译成这种形状；此处手写等价物，供 CommunityNodeService 动态 import。

const description = {
  displayName: 'Greet',
  name: 'greet',
  group: ['transform'],
  version: 1,
  description: 'Adds a greeting field to each item',
  defaults: { name: 'Greet' },
  inputs: ['main'],
  outputs: ['main'],
  properties: [],
};

class Greet {
  description = description;
  async execute() {
    const items = this.getInputData();
    return [items.map((it) => ({ json: { ...it.json, greeting: 'hello' } }))];
  }
}

export const nomopsNodes = [
  {
    // service 会把 type 归一到 <pkg>.greet；这里给个占位名即可
    type: 'greet',
    description,
    load: async () => Greet,
  },
];
