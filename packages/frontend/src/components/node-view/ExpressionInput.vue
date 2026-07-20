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
import { autocompletion, type Completion, type CompletionContext } from '@codemirror/autocomplete';

const props = defineProps<{
  modelValue: string;
  placeholder?: string;
  /** D117:上游输入首 item 的 $json 成员路径(如 user.name),用于 `$json.` 变量树补全。 */
  jsonFields?: string[];
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const host = ref<HTMLElement>();
let view: EditorView | null = null;

/**
 * 自动补全弹层样式 —— 逐值对标参考基线 2.30.4 实测（dark）：
 * 面板 bg light-3 / 圆角 4 / 投影 0 2px 12px black-10%；列表 CommitMono 12px、
 * 条目 22px 高(衬 2×8) 白字、选中 = neutral-700 底 + purple-400 字；
 * 分组头 <completion-section> "SUGGESTED" 10px/600 大写；右侧说明卡 280 宽、圆角 0 4 4 0、衬 12。
 * 用 EditorView.theme（作用域挂在编辑器根类上、优先级高于 CodeMirror 运行时默认样式），
 * 避免与全局 CSS 打优先级战。
 */
const autocompleteTheme = EditorView.theme({
  '.cm-tooltip.cm-tooltip-autocomplete': {
    background: 'var(--color--background--light-3)',
    border: 'none',
    borderRadius: 'var(--radius)',
    boxShadow: '0 2px 12px var(--color--black-alpha-100)',
    fontFamily: 'var(--font-family)',
    padding: '0',
  },
  '.cm-tooltip-autocomplete > ul': {
    fontFamily: 'var(--font-family--monospace) !important',
    fontSize: 'var(--font-size--2xs)',
    lineHeight: '12px',
    maxWidth: '240px',
    border: 'var(--border-width) var(--border-style) var(--border-color)',
    borderRadius: 'var(--radius) 0 0 var(--radius)',
  },
  '.cm-tooltip-autocomplete > ul > li': {
    padding: '2px 8px !important',
    lineHeight: '18px',
    fontFamily: 'var(--font-family--monospace) !important',
    color: 'var(--color--text--shade-1)',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    background: 'var(--color--neutral-700)',
    color: 'var(--autocomplete--item--color--selected)',
  },
  '.cm-tooltip-autocomplete completion-section': {
    display: 'block !important',
    fontFamily: 'var(--font-family)',
    fontSize: '10px',
    fontWeight: 'var(--font-weight--bold)',
    textTransform: 'uppercase',
    color: 'var(--color--text--shade-1)',
    padding: '2px 4px !important',
    borderBottom: 'none',
  },
  '.cm-tooltip.cm-completionInfo': {
    width: '280px',
    maxWidth: 'none',
    background: 'var(--color--background--light-3)',
    border: 'none',
    borderRadius: '0 var(--radius) var(--radius) 0',
    boxShadow: '0 2px 12px var(--color--black-alpha-100)',
    fontFamily: 'var(--font-family)',
    fontSize: 'var(--font-size--2xs)',
    padding: '0',
    margin: '0',
  },
  '.cm-completionInfo .autocomplete-info-container': { padding: '12px' },
  '.cm-completionInfo .aic-title': {
    fontFamily: 'var(--font-family--monospace)',
    color: 'var(--autocomplete--item--color--selected)',
    marginBottom: '4px',
  },
  '.cm-completionInfo .aic-desc': { color: 'var(--color--text--shade-1)', lineHeight: '1.5' },
});

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

/**
 * `$` 全局名补全 —— 只列表达式引擎（@nomops/workflow evaluator）真实注入的作用域，
 * 不提供引擎没有的函数。弹层视觉对标参考基线 2.30.4 实测（SUGGESTED 分组 + 右侧说明卡）。
 */
function makeInfo(title: string, desc: string): Node {
  const box = document.createElement('div');
  box.className = 'autocomplete-info-container';
  const t = document.createElement('div');
  t.className = 'aic-title';
  t.textContent = title;
  const d = document.createElement('div');
  d.className = 'aic-desc';
  d.textContent = desc;
  box.append(t, d);
  return box;
}

const DOLLAR_COMPLETIONS: Completion[] = (
  [
    ['$json', 'Returns the JSON input data to the current node, for the current item.'],
    ['$now', 'The current timestamp as an ISO 8601 string.'],
    ['$itemIndex', 'The index of the current item within the input items.'],
    ['$items', 'All input items of the current node.'],
    ['$node', 'Output of an executed node: $node["Node Name"].json.'],
    ['$workflow', 'Workflow metadata: $workflow.id and $workflow.name.'],
    ['$vars', 'Project variables: $vars.KEY.'],
    ['$parameter', 'Parameters of the current node (for declarative routing).'],
  ] as const
).map(([label, desc]) => ({
  label,
  section: 'Suggested',
  info: () => makeInfo(label, desc),
}));

/** 是否处在 {{ }} 表达式内部（最近一个 "{{" 之后且未被 "}}" 关闭）。 */
function insideExpression(context: CompletionContext): boolean {
  const before = context.state.sliceDoc(0, context.pos);
  const open = before.lastIndexOf('{{');
  return open !== -1 && before.indexOf('}}', open) === -1;
}

function dollarCompletions(context: CompletionContext) {
  if (!insideExpression(context)) return null;
  const word = context.matchBefore(/\$\w*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  return { from: word.from, options: DOLLAR_COMPLETIONS };
}

/** D117:`$json.` → 成员级变量树(上游输入字段路径)。 */
function jsonMemberCompletions(context: CompletionContext) {
  if (!insideExpression(context)) return null;
  const m = context.matchBefore(/\$json\.[\w.$[\]]*/);
  if (!m) return null;
  const from = m.from + '$json.'.length;
  const options: Completion[] = (props.jsonFields ?? []).map((f) => ({
    label: f,
    section: 'Fields',
    info: () => makeInfo(`$json.${f}`, 'Field from the input data of the current item.'),
  }));
  if (!options.length) return null;
  return { from, options };
}

onMounted(() => {
  view = new EditorView({
    parent: host.value!,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        placeholder(props.placeholder ?? 'Supports {{ $json.field }} expressions'),
        autocompletion({ override: [jsonMemberCompletions, dollarCompletions], icons: false }),
        autocompleteTheme,
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
