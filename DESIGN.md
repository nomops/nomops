---
name: nomops
description: Dark, dense, single-accent design system for a node-based workflow automation editor — a high-fidelity replica, documented so net-new surfaces stay on-token.
colors:
  signal-orange: "#ff6900"
  signal-orange-bright: "#ff8904"
  signal-orange-deep: "#f54900"
  graphite-base: "#171717"
  graphite-panel: "#262626"
  graphite-raised: "#2b2b2b"
  graphite-edge: "#323232"
  ink: "#e5e5e5"
  ink-dim: "#bbbbbb"
  ink-faint: "#999999"
  white: "#ffffff"
  success-green: "#00a63e"
  alert-red: "#e7000b"
  running-gold: "#e6a23d"
  warning-gold: "#b57617"
  info-blue: "#155dfc"
typography:
  display:
    fontFamily: "InterVariable, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  headline:
    fontFamily: "InterVariable, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.3
  title:
    fontFamily: "InterVariable, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "InterVariable, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.3
  label:
    fontFamily: "InterVariable, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.25
  code:
    fontFamily: "CommitMono, ui-monospace, Menlo, Consolas, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.3
rounded:
  sm: "4px"
  md: "8px"
  lg: "16px"
  full: "9999px"
spacing:
  4xs: "4px"
  3xs: "6px"
  2xs: "8px"
  xs: "12px"
  sm: "16px"
  md: "20px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.signal-orange}"
    textColor: "{colors.white}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "32px"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "{colors.signal-orange-deep}"
  button-secondary:
    backgroundColor: "{colors.graphite-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "32px"
  input:
    backgroundColor: "{colors.graphite-panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 8px"
    height: "32px"
  panel:
    backgroundColor: "{colors.graphite-panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
---

# Design System: nomops

## 1. Overview

**Creative North Star: "The Control Room"**

nomops is a dark instrument panel for building and watching automations run. The whole surface is a near-black graphite console; on it, every node's input and output is a legible readout, and a single **Signal Orange** is the only chromatic voice — it marks the primary action and the thing that is *running right now*, nothing else. The mood is precise, dense, and utilitarian: an operator's console, not a showroom. Delight is not a goal here; **control** is. If a screen makes you feel calm and in command of a lot of moving data at once, it is working.

This system is unusual in one important way: **it is documented from extraction, not invention.** Its values were pulled verbatim from a mature baseline product (883/883 computed values, equivalence-verified) and re-homed into `packages/frontend/src/design-tokens.css`, which is the single source of truth. The job of this document is therefore not to inspire new directions — it is to keep **net-new surfaces** (agents, AI builder, dynamic credentials, federation) so faithful to the extracted grammar that they read as native to the app. On baseline-covered surfaces, fidelity is the spec; divergence is a defect tracked in `diff-ledger.md`, not a creative liberty.

It explicitly rejects the marketing-SaaS visual vocabulary: no gradient text, no glassmorphism, no hero-metric templates, no tiny uppercase tracked eyebrows above every section, no `01 / 02 / 03` numbered scaffolding, no identical icon-card grids, no colored side-stripe borders. Those belong to landing pages selling a tool. This *is* the tool.

**Key Characteristics:**
- **Dark by default.** `data-theme="dark"` on `<body>`; a light theme exists but the console is designed dark-first.
- **One accent, high discipline.** Signal Orange (`#ff6900`) for primary-action and running/active state only. Everything else is graphite and ink.
- **Dense and tight.** 4px control radius, 32px control height, 14px UI text, minimal motion.
- **Token-locked.** Every color, size, and radius is a `design-tokens.css` name. Raw hex in a component is wrong on sight.
- **Data-first.** The interface exists to make node I/O visible; decoration always yields to legibility.

## 2. Colors

A near-black graphite stack carrying ink-gray text, cut by exactly one warm accent and a small set of functional status colors.

### Primary
- **Signal Orange** (`#ff6900`, orange-500): the sole brand accent. Primary buttons, focus rings, active/selected nav, and the border of a **running** node. Its scarcity is the entire point — it always means "act here" or "this is live."
- **Signal Orange Bright** (`#ff8904`, orange-400): lighter fills and subtle active tints (`--color--primary--tint-1`).
- **Signal Orange Deep** (`#f54900`, orange-600): hover / pressed state of primary controls.

### Neutral
The graphite console is built by *stepping down* a single gray ramp, not by stacking shadows:
- **Graphite Base** (`#171717`, neutral-950): the body and canvas substrate — the darkest floor.
- **Graphite Panel** (`#262626`, neutral-900): panels, cards, inputs, the NDV drawer — one step up from the floor.
- **Graphite Raised** (`#2b2b2b`, neutral-850): hover surfaces and secondary-button fill.
- **Graphite Edge** (`#323232`, neutral-800): the highest common surface step; subtle dividers.
- **Ink** (`#e5e5e5`, neutral-200): primary text (`--color--text`).
- **Ink Dim** (`#bbbbbb`, neutral-400): secondary text, labels.
- **Ink Faint** (`#999999`, neutral-500): tertiary text and placeholders.
- **White** (`#ffffff`): high-emphasis text and the label on a primary button.
- Borders are not solid grays but **white-alpha** overlays: `rgba(255,255,255,0.1)` (default) and `rgba(255,255,255,0.2)` (strong), so edges read consistently as the surface underneath changes step.

### Status & Feedback
Functional only — never decorative. Each maps to an execution or validation meaning:
- **Success Green** (`#00a63e`, green-600): completed / valid / node succeeded.
- **Alert Red** (`#e7000b`, red-600): error / failed node / destructive confirm.
- **Running Gold** (`#e6a23d`, gold-400): the *executing / waiting* state on the canvas and in logs.
- **Warning Gold** (`#b57617`, gold-600): non-blocking warnings.
- **Info Blue** (`#155dfc`, blue-600): informational accents and code-editor primitives.

### Named Rules
**The One Signal Rule.** Signal Orange is the only non-neutral, non-status color allowed in the chrome. It carries one of two meanings — *primary action* or *running/active* — and never appears as decoration, gradient, or "brand flavor." If orange is on screen more than a couple of times, one of them is wrong.

**The Tonal-Stack Rule.** Depth is a step along the graphite ramp (`#171717 → #262626 → #2b2b2b`), not a shadow and never a new hue. A "lighter panel" is the next neutral step, full stop.

## 3. Typography

**Display / UI Font:** InterVariable (with `sans-serif` fallback)
**Code / Data Font:** CommitMono (with `ui-monospace, Menlo, Consolas` fallback)

**Character:** Two faces, one job each. InterVariable is the neutral, information-dense workhorse of the entire console — quiet, legible at 13–14px, never expressive. CommitMono is reserved for anything that *is data*: the Code node, `{{ expressions }}`, JSON output, IDs, log lines. The pairing contrasts on the only axis that matters here — "this is chrome" vs. "this is a value you can copy."

### Hierarchy
This is a tool, not a page: type tops out at 28px and there is no hero scale.
- **Display** (600, `1.75rem` / 28px, lh 1.3): the largest thing on screen — a page or empty-state title. Rare.
- **Headline** (600, `1.25rem` / 20px, lh 1.3): view and section headings.
- **Title** (600, `1.125rem` / 18px, lh 1.3): panel / card / modal titles.
- **Body** (400, `0.875rem` / 14px, lh 1.3): the workhorse — menus, tables, descriptions, most UI text. (`--font-size--md`/16px is the document base, but 14px is the dominant working size.)
- **Label** (500, `0.8125rem` / 13px, lh 1.25): buttons, field labels, table headers, meta. Medium weight, **no letter-spacing, no uppercasing.**
- **Code** (400, `0.8125rem` / 13px, CommitMono): expressions, code editor, JSON, IDs, log output.

### Named Rules
**The Two-Face Rule.** InterVariable for chrome, CommitMono for data. Anything a user might read *as a value* — an expression, a key, an ID, output — is mono. Never render UI chrome in mono for "techie flavor," and never render data in Inter.

**The No-Eyebrow Rule.** Labels are sentence-case, medium-weight, untracked. The uppercase-tracked eyebrow (`ABOUT`, `PROCESS`) is banned — it is a marketing tell and appears nowhere in this console.

## 4. Elevation

This system is **tonal-first**. At rest, everything is flat: depth is communicated by the graphite step (`#171717` floor → `#262626` panel → `#2b2b2b` raised), not by shadow. Shadows exist only for surfaces that genuinely *float above the canvas* — modals, dropdowns, popovers, the command palette — and even then they are restrained and cool, never a soft decorative glow.

### Shadow Vocabulary (overlays only)
- **Overlay Base** (`box-shadow: 0 2px 4px rgba(0,0,0,0.2), 0 0 6px rgba(0,0,0,0.1)`): default resting shadow for a floating surface (`--shadow`).
- **Overlay Lifted** (`box-shadow: 0 15px 45px rgba(0,0,0,0.2), 0 5px 10px rgba(0,0,0,0.2)`): modals and large popovers that sit well above the canvas.
- **Hairline Outline** (`box-shadow: 0 0 0 1px rgba(255,255,255,0.1)`): a 1px ring used in place of a border to separate a floating surface from the graphite behind it (`--shadow--outline`).

### Named Rules
**The Flat-Canvas Rule.** The canvas and its panels are flat. A shadow means "this element left the plane" (it floats over the workflow). If an element isn't an overlay, it gets a tonal step or a white-alpha border — never a shadow.

## 5. Components

Controls are small, tight, and uniform: **32px tall, 4px radius, 14px/13px text.** The console reads as one instrument because every control obeys the same dimensions.

### Buttons
- **Shape:** tight rounded rectangle (`4px`, `--border-radius`), fixed `32px` height, `0 12px` padding, 13px/500 label.
- **Primary:** Signal Orange fill (`#ff6900`) with white label and an inset 1px orange ring plus a `0 1px 3px -1px` shadow. Hover → Signal Orange Deep (`#f54900`). This is the only filled-color button; use it once per context.
- **Secondary:** Graphite Raised fill (`#2b2b2b`) with ink label and a white-alpha border. Hover lifts one tonal step. The default button for everything that isn't the primary action.
- **Ghost / Tertiary:** transparent fill, ink-dim label, no border; hover fills to a faint white-alpha. For low-emphasis and icon actions.
- **Danger:** transparent fill with Alert Red border/label for destructive confirms.

### Inputs / Fields
- **Style:** Graphite Panel fill (`#262626`), ink text, `1px` white-alpha border, `4px` radius, `32px` height, `0 8px` padding.
- **Focus:** the border becomes **Signal Orange** — focus is the one place chrome earns the accent. No glow, just the ring shift.
- **Placeholder:** Ink Faint (`#999999`). **Error:** border shifts to Alert Red with a red helper line beneath.

### Cards / Panels
- **Corner Style:** two radii by role — **`4px`** (`--border-radius`) for controls and overlays (buttons, inputs, menus, palette); **`8px`** (`--radius--lg`) for *content* surfaces (resource-list rows, the NDV shell). Never larger.
- **Background:** Graphite Panel (`#262626`) on the Graphite Base floor.
- **Border:** `1px` white-alpha hairline; **no drop shadow** unless the panel is a true overlay (see Elevation).
- **Internal Padding:** `16px`–`20px` (`--spacing--sm`/`--spacing--md`).

### Navigation (left rail)
- **Style:** fixed `200px` graphite rail on the Base floor, non-resizable. Items are 14px ink-dim with an icon; **active** item is ink/white with a subtle raised fill; hover lifts one tonal step. The accent appears only as a thin state marker, not a filled pill.

### Menus / Dropdowns
- **Surface:** Graphite Raised (`#2b2b2b`, `--color--background--light-1`), `1px` white-alpha border, `4px` radius, `min-width: 250px`, `6px` padding. It floats, so it carries a real shadow — `0 12px 40px rgba(0,0,0,0.5)`.
- **Items:** `32px` tall, 14px/400 ink, `4px` radius, `10px` icon gap; `15px` icons are Ink Dim, brightening to Ink on hover. Hover fill is a faint `rgba(255,255,255,0.07)` — never the accent.
- **Separators:** `1px` white-alpha, `5px 4px` margin.
- **Badges:** a status pill, `10px`/600, `16px` radius. "New" is **neutral** — Ink Dim fill (`#bbbbbb`) on Graphite-700 text (`#444444`), *not* orange or blue. "Preview" is a muted purple tint. Badges never borrow Signal Orange.

### Tables & Resource Lists
Two related patterns; neither uses zebra striping or heavy grid lines — separation comes from the gap and the card border.
- **Resource list** (workflows / credentials / executions): a flex column of **row cards**, `8px` gap. Each row is Graphite Panel (`#262626`), `1px` white-alpha border, **`8px` radius** (`--radius--lg`), `16px` padding, `16px` internal gap. The name is 14px/500 and turns Signal Orange on hover; the meta line is 12px Ink Dim with dot separators.
- **Data table** (NDV output, JSON→table): a dense real `<table>` — `th`/`td` at **12px, `6px 8px`** padding. Column headers are **drag sources** for expression mapping, so they highlight to Signal Orange on hover. The alternative **schema view** is 12px rows (`5px 8px`) with monospace field paths in Signal Orange and Ink-Faint drag grips.

### NDV Drawer (Node Detail View)
The node editor, and the densest surface in the product. A full-screen overlay with a dark backdrop that deliberately **leaves a 25px gutter on left / right / bottom** so the canvas stays visible behind it — you never lose your place.
- **Header band:** `66px` tall — node icon + name (16px/400 white) on the left; a **Docs** pill (`28px`) and close ✕ on the right.
- **Three columns:** a fixed **`375px` Input** panel (Graphite Panel `#262626`) · a flexible **Parameters** column (Graphite Raised `#2b2b2b`) · an **Output** panel — divided by `4px` col-resize handles. The shell's bottom corners are `8px` (`--radius--lg`).
- **Floating node chips:** `34px` squares hug the vertical center of each edge, for one-click hops to adjacent nodes without leaving the drawer.

### Node Parameters & Expressions
The parameter form fills the NDV's middle column and is the densest input surface in the product. Two things set it apart from an ordinary input.
- **Recessed fields.** Unlike the standalone search input (Graphite Panel), a parameter field sits on the **darker floor** — Graphite Base (`#171717`, `--color--background--light-2`) with an **inset 1px white-alpha ring** rather than a border, `4px` radius, 14px white text, `32px` tall. On focus the inset ring turns **Signal Orange** (`inset 0 0 0 1px`). Labels sit above at 12px/400 white with an `8px` gap; rows stack with `10px` spacing.
- **Collection controls.** Rich params (IF conditions, Set key/value) are flex rows of 32px controls with a wider operator select, a ghost delete (`28px`, hover → Alert Red), and a secondary "Add" button (`30px`). The boolean **toggle** is a `32×16` pill — **green (`#00c950`) when on**, Graphite Base when off, white knob. MultiOption values are `28px` inset-ring chips.

**Expression editor (`{{ }}`).** Any field can flip to a CodeMirror expression editor:
- **Body:** CommitMono, white text on Graphite Base; near-white caret; on focus the editor border turns **Signal Orange**.
- **Resolvables:** a `{{ … }}` fragment is highlighted inline — **valid → green** (text `#7bf1a8` on a faint green wash `rgba(37,147,86,0.25)`, `2px` radius); **invalid → red**; unresolved → neutral.
- **Autocomplete:** a `$`-triggered popover on Graphite Panel (`#262626`), `4px` radius, `0 2px 12px` shadow. Items are **CommitMono 12px**, `22px` tall; the **selected** row is Graphite-700 fill (`#444444`) with **purple-400** text (`#a684ff`); a `SUGGESTED` section header (10px/600 uppercase) and a 280px description card on the right.
- **Syntax** follows a GitHub-dark palette: keywords `#f97583`, strings `#9ecbff`, variables/constants `#79b8ff`, functions `#b392f0`, comments `#6a737d`.

**The Expression-Feedback Rule.** Green and red live in the expression editor (and the toggle) to mean *resolves / valid / on* and *fails / invalid* — never decoration. Signal Orange stays for action and running; expression validity is the green/red channel, and purple is reserved for the two "selected/pinned" moments (autocomplete selection, pinned node).

### Command Palette (⌘K)
- **Surface:** `700px` wide (max `92vw`), Graphite Panel (`#262626`), `1px` white-alpha border, `4px` radius, dropped at **`20vh`** from the top. **No backdrop dim** — it floats over an undimmed console.
- **Search row:** `48px` tall, 14px text, `0 32px 0 16px` padding, bottom-bordered. An optional context chip sits at the left (Graphite Raised, 12px).
- **List:** `8px` padding, `352px` max-height. Group labels are 12px Ink Dim; items are `40px` tall with a `24px` icon (16px glyph) and a raised fill when active. `⌘K`-style `.kbd` chips are 11px, bordered, `4px` radius.

### Toasts
Transient feedback is a **pill, not a card**, and it borrows the status palette on the graphite surface. The canonical instance is the canvas run-error toast: Graphite Panel fill (`#262626`), a **1px status-color border with matching status-color text**, `6px 12px` padding, `6px` radius, 12px, dropped bottom-center over the canvas (`max-width: 60%`). Generalize by status — **Alert Red** for errors, **Success Green** for confirmations, **Warning Gold** for warnings. The border and text carry the meaning; the fill stays graphite. No filled-color toast backgrounds, no decorative icons.

### Empty States
An empty list is an **invitation**, not a blank void — rendered as a dashed placeholder. The primary pattern is a centered **2px dashed** `border-strong` card, `14px` radius, transparent fill, Ink-Dim text; when it's actionable ("Start from scratch") it's a `220×200` button whose border and text turn **Signal Orange on hover**, with a `34px` `+` glyph at `0.7` opacity. Credential and other empties reuse the same dashed-card treatment (`2px` dashed, `14px` radius, `48px 24px` padding, centered).

**The Dashed-Empty Rule.** A dashed border means "nothing here yet — add one"; a solid border means the thing exists. Only a *create* action lights the dashed card to Signal Orange on hover.

### Enterprise Lock States
License-gated features never show a hidden or broken UI — they show a consistent **lock**, sized to what's gated:
- **Full lock card** (`.locked-card`): replaces an entire gated page. Max-width `880px`, **1px dashed** border, `8px` radius, `56px 40px` padding, centered — a 20px/500 title, 14px Ink-Dim description, and a centered action row (a **See plans** / **More info** button linking out to pricing).
- **Upgrade card** (`.ent-*`): a smaller in-page block with a faux stacked-cards glyph, an "Upgrade to Enterprise" title, a ≤`460px` description, and a **primary orange "Upgrade" button** (`36px`, `6px` radius) beside a "Learn more" text link.
- **Inline upgrade chip** (`.chip-upgrade`): a muted `11px` outline pill (`1px` border, `6px` radius, Ink-Dim) next to an individual gated control — e.g. "Enforce two-factor authentication `Upgrade`". The gate stays quiet; **never** the accent.
- **Amber activation banner** (`.users-upgrade`): for "activate to use" — a tinted `rgba(245,166,35,0.12)` fill, `rgba(245,166,35,0.32)` border, amber text (`#f5a623`), 13.5px.

### Canvas Node — *signature component*
The node is the heart of the product and the one place color does the most work. It is a graphite rounded rectangle (`#262626`, ~`4px`) with an icon, a name, and typed I/O ports on its sides. Its **border encodes execution state**, and this is load-bearing UX, not styling:
- **Idle:** white-alpha border.
- **Running:** **Signal Orange** border (`--node--border-color--running`) — the live signal.
- **Success:** Success Green.
- **Error:** Alert Red.
- **Pinned:** Purple (`--node--border-color--pinned`) — the one sanctioned non-orange, non-status accent, and only because "pinned data" is a distinct concept that must not be confused with a run state.
- Connections are neutral bezier links; data flows left→right, and the *reason the whole product is dark* is so these state colors read instantly against the canvas.

## 6. Do's and Don'ts

### Do:
- **Do** treat `design-tokens.css` as law — every color, size, radius, and spacing value is a token *name* (`var(--color--primary)`, `var(--spacing--sm)`), never a literal.
- **Do** reserve **Signal Orange** (`#ff6900`) for exactly two meanings: primary action, or running/active. Keep it scarce.
- **Do** build depth by stepping the graphite ramp (`#171717 → #262626 → #2b2b2b`); reach for a shadow only when the element truly floats above the canvas.
- **Do** keep controls at `32px` height, `4px` radius, 13–14px text. Uniformity is the aesthetic.
- **Do** render data — expressions, IDs, JSON, logs — in **CommitMono**, and chrome in **InterVariable**.
- **Do** design net-new surfaces by extending the *nearest existing baseline pattern* (rail, NDV drawer, table, node), so they feel native.
- **Do** render gated (license-only) features as a **lock** — full lock card, upgrade card, or inline `Upgrade` chip — never a hidden or broken UI.
- **Do** signal empty and "add new" states with a **2px dashed** border; solid borders mean the thing already exists.
- **Do** verify a surface against the baseline with **side-by-side screenshots + live computed-style** before calling it done — "looks about right" is not acceptance.

### Don't:
- **Don't** redesign a baseline-covered surface. A prettier layout, a new accent, an added animation is a **defect** logged in `diff-ledger.md`, not an improvement. If it looks "nicer" than the baseline, that is the bug.
- **Don't** write a raw hex or px value into a component. If a value isn't a token name, it's wrong before anyone looks at it.
- **Don't** use gradient text (`background-clip: text`), glassmorphism, hero-metric templates, uppercase tracked eyebrows, `01 / 02 / 03` section numbering, identical icon-card grids, or colored side-stripe borders (`border-left > 1px`). None exist in this console.
- **Don't** assume a light background. Dark is the default; test dark first.
- **Don't** spend Signal Orange on decoration, gradients, or "brand warmth." Warmth is not a goal; control is.
- **Don't** copy a third-party vendor's real logo — use a brand-color letter monogram (trademark safety).
- **Don't** ever let a decrypted credential reach the UI, a log, or an API response.
- **Don't** print the baseline product's real name anywhere in the repo — it is always "基线 / the baseline."
