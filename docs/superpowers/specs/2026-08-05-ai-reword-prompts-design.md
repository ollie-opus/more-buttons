# AI Reword Prompt Overhaul — Design

**Date:** 2026-08-05
**Status:** Approved

## Problem

Two issues with the current `config/aiPrompts.json` prompts:

1. **"Simple" drifts casual.** Three compounding instructions — "11–13-year-old
   reading level", "avoid technical jargon", "friendly tone" — make the
   on-device model chatty. Example: "Reminder tasks are not manually resolvable
   using the 'resolve' button" became "You can't fix reminder tasks with the
   'resolve' button… the reminder will disappear automatically." That reads as
   less appropriate for help documentation, not simpler.
2. **No formatting allowed.** The prompts forbid introducing any formatting or
   structure, so the rewriter never uses inline code for UI names, bold for key
   terms, or lists for steps — formatting the rich text editor fully supports.

## Decisions (user-confirmed)

- **Simple tone = professional plain.** Short sentences, everyday words, but
  the neutral register of good help documentation — never chatty or
  conversational. Product/UI terms (button names, feature names) are kept
  exactly as written.
- **Add palette = inline marks + lists.** The rewriter may add bold, italic,
  underline, strikethrough, highlight, inline code, and may convert genuinely
  sequential/enumerable prose into numbered/bulleted lists. Links and
  `mb-label` spans are preserve-only. Anything the RTE does not support
  (headings, tables, blockquotes, fenced code blocks, horizontal rules,
  images) stays banned.
- **Shared rules block.** The formatting rules are identical across entries
  and must track the RTE's feature set over time, so they live once in the
  config, not duplicated per entry.

## Design

### 1. Config shape

`config/aiPrompts.json` becomes:

```json
{
  "shared": "<formatting rules appended to every system prompt>",
  "prompts": [
    { "label": "Simple", "system": "<tone-only prompt>" },
    { "label": "Advanced", "system": "<tone-only prompt>" }
  ]
}
```

`validatePromptsConfig` in `scripts/aiReword.js` accepts both shapes:

- Legacy plain array of `{label, system}` — unchanged behaviour.
- New object — `shared` (optional string) is appended to each entry's system
  prompt as `entry.system + "\n\n" + shared`.

Composition happens inside the pure validator so it remains unit-tested and
the engine (`loadAiPrompts`, background worker, popover) needs no changes.

### 2. Prompt content

**Simple (tone paragraph):** rewrite for everyday users of a software
knowledge base; clear, concise British English; prefer short sentences and
everyday words; keep the neutral, professional register of good help
documentation — never chatty or conversational; no rhetorical questions, no
filler ("simply", "just", "don't worry"); keep product and UI terms (button
names, feature names, setting labels) exactly as written; preserve meaning
and accuracy while improving wording, grammar, readability, and flow.

**Advanced (tone paragraph):** current tone text kept (experienced users,
15–17 reading level, technical terminology where it aids clarity); loses only
its duplicated formatting section.

**Shared (formatting rules):**

- Preserve all existing Markdown and HTML formatting, including
  `^^underline^^`, `==highlight==`, `<span class="mb-label …">` label spans,
  links, and anchors.
- May add, where it genuinely improves scannability: `**bold**` for key terms
  and warnings; `*italic*` for gentle emphasis; `` `inline code` `` for UI
  element names, button labels, and literal values the user types or clicks;
  `^^underline^^`, `~~strikethrough~~`, `==highlight==` sparingly; numbered
  lists for sequential steps and bulleted lists for sets of parallel items
  (4-space indent for nesting) — only when the original genuinely describes
  such a sequence or set.
- Never add: headings, tables, blockquotes, fenced code blocks, horizontal
  rules, images, links, or label spans.
- Respond with only the rewritten text — no preamble, no wrapping fences.

### 3. Guards

`stripInventedHeadings` and `normalizeModelOutput` are unchanged — they police
headings and fence-wrapping, both still banned. Lists were previously blocked
only by prompt wording, so no guard change is needed to allow them.

**Accepted risk:** the small on-device model may over-bullet. The "only when
the original genuinely describes a sequence/set" wording gates this; if it
over-triggers in practice, tighten the wording then — no pre-emptive
list-stripper.

### 4. Tests

`tests/aiReword.test.mjs` gains `validatePromptsConfig` cases: new object
shape, legacy array still accepted, shared-block composition (appended with a
blank line), missing/empty `prompts`, non-string `shared`, and the existing
error paths against both shapes.

## Files touched

- `config/aiPrompts.json` — new shape + rewritten prompts
- `scripts/aiReword.js` — `validatePromptsConfig` only
- `tests/aiReword.test.mjs` — new/updated cases

No manifest change (no new script file).
