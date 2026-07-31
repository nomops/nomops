import type { INodeTypeDescription } from '@nomops/workflow';

export const editImageDescription: INodeTypeDescription = {
  displayName: 'Edit Image',
  name: 'editImage',
  group: ['transform'],
  categories: ['dataTransformation'],
  aliases: ['resize image', 'crop image', 'watermark'],
  version: 1,
  description: 'Resize, crop, or watermark an image',
  defaults: { name: 'Edit Image' },
  inputs: ['main'],
  outputs: ['main'],
  properties: [
    {
      displayName: 'Operation', name: 'operation', type: 'options', default: 'resize', noDataExpression: true,
      options: [{ name: 'Crop', value: 'crop' }, { name: 'Resize', value: 'resize' }, { name: 'Watermark', value: 'watermark' }],
    },
    { displayName: 'Input Binary Field', name: 'binaryPropertyName', type: 'string', default: 'data', required: true },
    { displayName: 'Destination Output Field', name: 'destinationField', type: 'string', default: 'data', required: true },
    {
      displayName: 'Width', name: 'width', type: 'number', default: 500, required: true,
      displayOptions: { show: { operation: ['resize', 'crop'] } },
    },
    {
      displayName: 'Height', name: 'height', type: 'number', default: 500, required: true,
      displayOptions: { show: { operation: ['resize', 'crop'] } },
    },
    {
      displayName: 'Resize Mode', name: 'resizeMode', type: 'options', default: 'inside',
      displayOptions: { show: { operation: ['resize'] } },
      options: [{ name: 'Cover', value: 'cover' }, { name: 'Fill', value: 'fill' }, { name: 'Fit Inside', value: 'inside' }],
    },
    {
      displayName: 'Position X', name: 'positionX', type: 'number', default: 0,
      displayOptions: { show: { operation: ['crop'] } },
    },
    {
      displayName: 'Position Y', name: 'positionY', type: 'number', default: 0,
      displayOptions: { show: { operation: ['crop'] } },
    },
    {
      displayName: 'Watermark Text', name: 'watermarkText', type: 'string', default: 'nomops', required: true,
      displayOptions: { show: { operation: ['watermark'] } },
    },
    {
      displayName: 'Watermark Position', name: 'watermarkPosition', type: 'options', default: 'southeast',
      displayOptions: { show: { operation: ['watermark'] } },
      options: [
        { name: 'Center', value: 'center' }, { name: 'Northwest', value: 'northwest' },
        { name: 'Northeast', value: 'northeast' }, { name: 'Southwest', value: 'southwest' },
        { name: 'Southeast', value: 'southeast' },
      ],
    },
    {
      displayName: 'Font Size', name: 'fontSize', type: 'number', default: 32,
      displayOptions: { show: { operation: ['watermark'] } },
    },
    {
      displayName: 'Opacity', name: 'opacity', type: 'number', default: 0.6,
      displayOptions: { show: { operation: ['watermark'] } },
    },
    {
      displayName: 'Output Format', name: 'format', type: 'options', default: 'keep',
      options: [{ name: 'Keep Input Format', value: 'keep' }, { name: 'JPEG', value: 'jpeg' }, { name: 'PNG', value: 'png' }, { name: 'WebP', value: 'webp' }],
    },
    { displayName: 'Quality', name: 'quality', type: 'number', default: 90 },
    { displayName: 'File Name', name: 'fileName', type: 'string', default: '' },
  ],
};
