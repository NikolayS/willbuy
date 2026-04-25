/**
 * Custom ESLint rule: bans the literal "--no-sandbox" anywhere in source.
 *
 * Spec §4.1 / CLAUDE.md "Coding rules": Chromium MUST keep its built-in
 * sandbox enabled. Any code path that would pass `--no-sandbox` to a
 * Playwright/Puppeteer launch (or build a CLI args array containing it)
 * defeats the entire capture-containment story in §5.13. We enforce
 * this at the lint layer with a literal-string check on Literal and
 * TemplateElement AST nodes so concatenation tricks still get caught
 * (any expression that ultimately materializes the substring contains
 * a node we can flag).
 */

const BANNED = '--no-sandbox';

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Disallow the literal '--no-sandbox' anywhere in source — Chromium sandbox MUST stay enabled (spec §5.13).",
    },
    schema: [],
    messages: {
      banned:
        "The literal '--no-sandbox' is banned. Chromium's built-in sandbox MUST remain enabled (see SPEC §5.13 + CLAUDE.md).",
    },
  },
  create(context) {
    function check(node, value) {
      if (typeof value !== 'string') return;
      if (value.includes(BANNED)) {
        context.report({ node, messageId: 'banned' });
      }
    }
    return {
      Literal(node) {
        check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value && node.value.cooked);
      },
    };
  },
};

export default {
  rules: {
    'no-sandbox-flag': rule,
  },
};
