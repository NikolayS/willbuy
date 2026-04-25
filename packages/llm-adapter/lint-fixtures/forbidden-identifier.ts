// Lint fixture: contains a forbidden continuation identifier per spec §2 #15.
// The custom willbuy/no-reserved-llm-identifiers rule MUST flag this file.
// Direct variable declaration is the simplest possible match site.

export const session_id = 'should-be-flagged';
