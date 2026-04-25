// RED stub. Implementation lands in the green commit.

export const REDACTOR_VERSION = 1;

export type RedactionKind =
  | 'openai_secret'
  | 'slack_token'
  | 'aws_access_key'
  | 'github_pat'
  | 'gitlab_pat'
  | 'jwt'
  | 'email'
  | 'labeled_secret';

export type RedactionResult = {
  redacted: string;
  counts: Partial<Record<RedactionKind, number>>;
  redactor_v: number;
};

export function redact(_input: string): RedactionResult {
  throw new Error('redactor not implemented');
}
