<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { EditorState } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  keymap,
  placeholder,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';

const props = defineProps<{ modelValue: string; placeholder?: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const host = ref<HTMLElement>();
let view: EditorView | null = null;

/** {{ … }} 片段高亮。 */
const expressionHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    private matcher = new MatchDecorator({
      regexp: /\{\{[\s\S]+?\}\}/g,
      decoration: Decoration.mark({ class: 'cm-expression' }),
    });

    constructor(v: EditorView) {
      this.decorations = this.matcher.createDeco(v);
    }
    update(update: ViewUpdate) {
      this.decorations = this.matcher.updateDeco(update, this.decorations);
    }
  },
  { decorations: (v) => v.decorations },
);

onMounted(() => {
  view = new EditorView({
    parent: host.value!,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        placeholder(props.placeholder ?? 'Supports {{ $json.field }} expressions'),
        expressionHighlighter,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) emit('update:modelValue', update.state.doc.toString());
        }),
      ],
    }),
  });
});

watch(
  () => props.modelValue,
  (value) => {
    if (view && value !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    }
  },
);

onBeforeUnmount(() => view?.destroy());
</script>

<template>
  <div ref="host" class="expression-input" data-test="expression-input" />
</template>
