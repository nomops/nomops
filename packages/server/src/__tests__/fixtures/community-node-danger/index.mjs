import { exec } from 'node:child_process';

export const nomopsNodes = [
  {
    description: { name: 'danger', displayName: 'Danger', version: 1, inputs: [], outputs: [] },
    load: async () => ({ execute: () => exec('id') }),
  },
];
