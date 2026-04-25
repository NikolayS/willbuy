/**
 * Custom ESLint rule: bans the reserved continuation identifiers from
 * spec §2 #12 (`conversation_id`, `session_id`, `thread_id`,
 * `previous_response_id`, `cached_prompt_id`, `parent_message_id`,
 * `context_id`, `assistant_id`, `run_id`) ANYWHERE in the repo, with a
 * single allow-list line for the rule definition itself.
 *
 * The rule walks the AST (typescript-eslint extends ESLint's AST so we
 * can intercept TS-only nodes the same way we intercept regular ones),
 * which catches matches inside:
 *
 *   - variable / const / let declarations
 *   - object-literal properties (including shorthand)
 *   - function parameters (incl. destructured)
 *   - object destructure patterns at binding sites
 *   - TypeScript interface / type-literal property signatures
 *   - import + export specifiers
 *
 * A regex over file bytes would catch the literal substrings but ALSO
 * flag every comment that talks about the rule, every fixture, every
 * spec excerpt — which is why we walk the AST.
 *
 * Issue #5 acceptance #6.
 */

// Spec §2 #12. Keep the list narrow — it is the authoritative set the rule
// blocks. The amendments file may add provider-specific aliases later;
// when that happens, add them here, NOT in a separate config knob (the
// rule is the single source of truth and reviewers grep for this list).
const FORBIDDEN = new Set([
  'conversation_id',
  'session_id',
  'thread_id',
  'previous_response_id',
  'cached_prompt_id',
  'parent_message_id',
  'context_id',
  'assistant_id',
  'run_id',
]);

function isForbidden(name) {
  return typeof name === 'string' && FORBIDDEN.has(name);
}

function reportIfForbidden(context, node, name) {
  if (isForbidden(name)) {
    context.report({
      node,
      messageId: 'banned',
      data: { name },
    });
  }
}

function nameFromKey(keyNode) {
  if (!keyNode) return null;
  if (keyNode.type === 'Identifier') return keyNode.name;
  if (keyNode.type === 'Literal' && typeof keyNode.value === 'string') return keyNode.value;
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow reserved LLM continuation identifiers (spec §2 #12) anywhere in source — fresh-context guarantee.',
    },
    schema: [],
    messages: {
      banned:
        "Reserved LLM continuation identifier '{{name}}' is forbidden anywhere in the repo (spec §2 #12 fresh-context guarantee). Use logical_request_key + transport_attempts instead.",
    },
  },
  create(context) {
    return {
      // Plain bindings: `const session_id = …`, `let thread_id`, function
      // parameters declared as identifiers, etc. typescript-eslint resolves
      // parameter and destructure patterns to Identifier leaves so this
      // single visitor catches them all.
      Identifier(node) {
        // Skip plain references and member-expression property lookups —
        // re-using a forbidden NAME at a read site is still a leak (e.g.
        // `obj.session_id`). We DO want to flag every binding/property
        // appearance; not flagging member access would let stateful code
        // sneak through. Members are caught by MemberExpression below.
        if (!isForbidden(node.name)) return;

        // De-dup: skip Identifier visits that we will already report from
        // a more specific visitor (Property, ImportSpecifier, etc) so
        // each binding flags exactly once.
        const parent = node.parent;
        if (!parent) {
          reportIfForbidden(context, node, node.name);
          return;
        }
        // The Property / TSPropertySignature visitors below report the key.
        // For shorthand `{ x }` (object literal) and `{ x }` (destructure),
        // key === value (same node), and the Property visitor fires once;
        // skip the Identifier visit either way to avoid double-reporting.
        if (
          (parent.type === 'Property' || parent.type === 'PropertyDefinition') &&
          (parent.key === node || (parent.shorthand && parent.value === node))
        ) {
          return;
        }
        if (parent.type === 'TSPropertySignature' && parent.key === node) return;
        if (parent.type === 'TSMethodSignature' && parent.key === node) return;
        // Import/export specifier visitors below.
        if (
          (parent.type === 'ImportSpecifier' && (parent.imported === node || parent.local === node)) ||
          (parent.type === 'ExportSpecifier' && (parent.exported === node || parent.local === node)) ||
          (parent.type === 'ImportDefaultSpecifier' && parent.local === node) ||
          (parent.type === 'ImportNamespaceSpecifier' && parent.local === node)
        ) {
          return;
        }
        // MemberExpression .property reads are reported here directly —
        // no specific visitor below.
        if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) {
          context.report({ node, messageId: 'banned', data: { name: node.name } });
          return;
        }
        // Anything else: the binding/parameter/reference itself.
        context.report({ node, messageId: 'banned', data: { name: node.name } });
      },
      // Object literal properties: `{ thread_id: '…' }`. Catches both
      // shorthand (`{ thread_id }`) — which Identifier already covers —
      // and explicit-key form.
      Property(node) {
        const name = nameFromKey(node.key);
        reportIfForbidden(context, node.key, name);
      },
      // Class properties: `class X { run_id = '…' }`.
      PropertyDefinition(node) {
        const name = nameFromKey(node.key);
        reportIfForbidden(context, node.key, name);
      },
      // TS interface / type-literal property signatures:
      // `interface X { conversation_id: string }`.
      TSPropertySignature(node) {
        const name = nameFromKey(node.key);
        reportIfForbidden(context, node.key, name);
      },
      TSMethodSignature(node) {
        const name = nameFromKey(node.key);
        reportIfForbidden(context, node.key, name);
      },
      // Import/export specifiers: `import { run_id } from 'x'`.
      ImportSpecifier(node) {
        if (node.imported && node.imported.type === 'Identifier') {
          reportIfForbidden(context, node.imported, node.imported.name);
        }
        if (node.local && node.local.type === 'Identifier' && node.local !== node.imported) {
          reportIfForbidden(context, node.local, node.local.name);
        }
      },
      ExportSpecifier(node) {
        if (node.exported && node.exported.type === 'Identifier') {
          reportIfForbidden(context, node.exported, node.exported.name);
        }
        if (node.local && node.local.type === 'Identifier' && node.local !== node.exported) {
          reportIfForbidden(context, node.local, node.local.name);
        }
      },
    };
  },
};

export default {
  rules: {
    'no-reserved-llm-identifiers': rule,
  },
};
