/**
 * A fenced code block scrolls sideways by default and soft-wraps when the
 * reader asks for it. The wrap toggle lives beside the copy button in the head,
 * reports itself as a pressed control, and stays lit while wrapping is engaged;
 * the wrapped body gives up the fit-content column that the scrolling mode
 * depends on.
 *
 * The first frame is rendered for real through Vite SSR with the production
 * component and catalog, so the head's shape and accessible names are checked
 * on markup rather than on the source. Flipping the toggle is a renderer state
 * change that needs a real DOM to click, so the mode and its CSS read as
 * source and style contracts here, next to the other code-block chrome
 * contracts.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { slotSsr } from "./helpers/slot-ssr.mjs";
import { loadStyles } from "./helpers/styles.mjs";

const markdownSource = await readFile(
  new URL("../src/components/Markdown.tsx", import.meta.url),
  "utf8",
);
const stylesSource = await loadStyles();

/** Just the `CodeBlock` definition, so assertions cannot match another block. */
function codeBlockSource() {
  const start = markdownSource.indexOf("function CodeBlock(");
  const end = markdownSource.indexOf("\nfunction useNearViewport", start);
  assert.ok(start > 0 && end > start, "CodeBlock should sit between its helpers");
  return markdownSource.slice(start, end);
}

/** The `<button …>` in `markup` whose class list holds `className`. */
function button(markup, className) {
  const match = markup.match(
    new RegExp(`<button[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>`),
  );
  assert.ok(match, `the head should render a .${className} button`);
  return match[0];
}

test("the rendered head pairs a wrap toggle with the copy button", async (t) => {
  const ssr = await slotSsr(t);
  const { Markdown } = await ssr.load("/src/components/Markdown.tsx");
  const html = ssr.render(
    createElement(Markdown, { source: "```ts\nconst x = 1;\n```" }),
  );

  const block = html.slice(html.indexOf('<div class="code-block"'));
  assert.ok(
    block.startsWith('<div class="code-block"'),
    "a fresh block renders unwrapped, exactly as before this control existed",
  );
  const head = block.slice(0, block.indexOf("<pre"));
  assert.match(head, /<span class="code-block-lang">ts<\/span>/);

  // Both actions share the head's right rail, with the wrap toggle first.
  const rail = head.slice(head.indexOf('<div class="code-block-actions">'));
  const wrap = button(rail, "code-wrap-btn");
  const copy = button(rail, "code-copy-btn");
  assert.ok(
    rail.indexOf("code-wrap-btn") < rail.indexOf("code-copy-btn"),
    "the wrap toggle sits before the copy button",
  );

  // The toggle is one pressed control; its accessible name is the stable action
  // name the catalog ships, not the transient "disable" tooltip.
  assert.match(wrap, /aria-pressed="false"/);
  assert.match(wrap, /aria-label="Wrap lines"/);
  // Copy keeps its own control and label untouched.
  assert.match(copy, /aria-label="Copy"/);
});

test("the CodeBlock wiring carries the wrap mode and both actions", () => {
  const block = codeBlockSource();

  // The block root carries the mode, so the CSS has one place to read it.
  assert.match(block, /className=\{`code-block\$\{wrapped \? " wrapped" : ""\}`\}/);
  assert.match(block, /const \[wrapped, setWrapped\] = useState\(false\)/);

  // One rail holds both head actions, wrap first and copy still on the right.
  assert.match(block, /className="code-block-actions"/);
  const rail = block.slice(
    block.indexOf('className="code-block-actions"'),
    block.indexOf("</div>", block.indexOf('className="code-block-actions"')),
  );
  assert.match(rail, /code-wrap-btn/);
  assert.match(rail, /code-copy-btn/);
  assert.ok(
    rail.indexOf("code-wrap-btn") < rail.indexOf("code-copy-btn"),
    "the wrap toggle should precede the copy button",
  );

  // The toggle is one pressed control carrying the mode.
  assert.match(
    rail,
    /className=\{`code-wrap-btn\$\{wrapped \? " active" : ""\}`\}/,
  );
  assert.match(rail, /tooltip=\{wrapLabel\}/);
  // Pressed state carries the mode; the accessible name stays a stable action
  // name, exactly like the copy button's label/tooltip split.
  assert.match(rail, /ariaLabel=\{t\("chat\.wrapLines"\)\}/);
  assert.match(rail, /aria-pressed=\{wrapped\}/);
  assert.match(rail, /<IconTextWrap size=\{13\} \/>/);
  assert.match(
    block,
    /const wrapLabel = wrapped \? t\("chat\.unwrapLines"\) : t\("chat\.wrapLines"\)/,
  );
  // The copy action keeps its own state and stays where users know it.
  assert.match(rail, /copied \? "copied" : ""/);
  assert.match(rail, /ariaLabel=\{t\("chat\.copy"\)\}/);
  assert.match(rail, /onClick=\{\(\) => copy\(code\)\}/);
});

test("wrapped mode trades the sideways scroll for soft wrapping", () => {
  // Unwrapped stays exactly as before: one long pre column that scrolls.
  assert.match(
    stylesSource,
    /\.prose-chat \.code-block pre code\s*\{[\s\S]*?white-space:\s*pre;/,
  );
  const wrapped = stylesSource.match(
    /\.prose-chat \.code-block\.wrapped pre code\s*\{[^}]*\}/,
  );
  assert.ok(wrapped, "wrapped code needs its own column rule");
  assert.match(wrapped[0], /white-space:\s*pre-wrap/);
  // Soft wrapping only helps if the fit-content column gives way too.
  assert.match(wrapped[0], /width:\s*auto/);
  assert.match(wrapped[0], /min-width:\s*0/);
  assert.match(wrapped[0], /overflow-wrap:\s*anywhere/);
  // The card keeps its one plate: wrapping paints nothing new.
  assert.doesNotMatch(wrapped[0], /background|color:/);
});

test("the engaged wrap toggle stays lit without hover", () => {
  // Both head actions share one chrome rule and one hover fill.
  assert.match(
    stylesSource,
    /\.code-block \.code-copy-btn,\s*\.code-block \.code-wrap-btn\s*\{[^}]*opacity:\s*0\.75/,
  );
  assert.match(
    stylesSource,
    /\.code-block \.code-copy-btn:hover,\s*\.code-block \.code-wrap-btn:hover\s*\{[^}]*background:\s*var\(--ds-code-hover-bg\)/,
  );
  assert.match(stylesSource, /\.code-block-actions\s*\{[^}]*display:\s*flex/);

  // A wrapped block advertises itself while the pointer is elsewhere.
  assert.match(
    stylesSource,
    /\.code-block \.code-wrap-btn\.active\s*\{[^}]*opacity:\s*1/,
  );
  const active = stylesSource.match(
    /\.code-block \.code-wrap-btn\.active\s*\{[^}]*background[^}]*\}/,
  );
  assert.ok(active, "the engaged toggle needs its own plate rule");
  assert.match(active[0], /background:\s*var\(--ds-code-hover-bg\)/);
  // Ink follows the code plate (dark one-dark-pro / light one-light), not the
  // muted chrome tier the idle button uses.
  assert.match(active[0], /color:\s*inherit/);
  // The reveal-on-hover group keeps the engaged state visible at rest.
  assert.match(
    stylesSource,
    /\.code-block:focus-within \.code-wrap-btn,\s*\.code-block \.code-wrap-btn\.active\s*\{[^}]*opacity:\s*1/,
  );
});

test("the light theme keeps the head controls on the code ink", () => {
  const light = stylesSource.match(
    /:root\[data-theme="light"\] \.code-block \.code-copy-btn,\s*:root\[data-theme="light"\] \.code-block \.code-wrap-btn\s*\{[^}]*\}/,
  );
  assert.ok(light, "light theme should tune both head controls together");
  assert.match(light[0], /color:\s*color-mix\(in oklab, #383a42 62%, transparent\)/);
});
