#!/usr/bin/env bash
set -euo pipefail

BASE_URL="https://willbuy.dev"
PASS=0
FAIL=0

# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────

pass() {
  echo "PASS ✓  $1"
  (( PASS++ )) || true
}

fail() {
  echo "FAIL ✗  $1 — $2"
  (( FAIL++ )) || true
}

# Run curl; suppress stderr; capture HTTP status code only.
# Usage: http_code=$(get_status <curl-args...>)
http_get() {
  curl -s --max-time 10 -o /dev/null -w "%{http_code}" "$@" 2>/dev/null || echo "000"
}

# Run curl; capture both body and HTTP status in one shot.
# Prints "<status>\n<body>" to stdout.
http_get_with_body() {
  # Write body to a temp file so we can capture both status and body.
  local tmp
  tmp=$(mktemp)
  local status
  status=$(curl -s --max-time 10 -w "%{http_code}" -o "$tmp" "$@" 2>/dev/null) || status="000"
  echo "$status"
  cat "$tmp"
  rm -f "$tmp"
}

# ──────────────────────────────────────────────
# Test 1 — API health
# GET /health → 200 + body contains "status":"ok"
# ──────────────────────────────────────────────
{
  tmp=$(mktemp)
  status=$(curl -s --max-time 10 -w "%{http_code}" -o "$tmp" "${BASE_URL}/health" 2>/dev/null) || status="000"
  body=$(cat "$tmp"); rm -f "$tmp"
  if [[ "$status" == "200" ]] && echo "$body" | grep -q '"status":"ok"'; then
    pass "1. API health (GET /health → 200 + status:ok)"
  elif [[ "$status" != "200" ]]; then
    fail "1. API health" "expected 200, got $status"
  else
    fail "1. API health" "got 200 but body missing '\"status\":\"ok\"' — body: ${body:0:120}"
  fi
}

# ──────────────────────────────────────────────
# Test 2 — Demo report fixture
# GET /r/test-fixture → 200
# ──────────────────────────────────────────────
{
  status=$(http_get "${BASE_URL}/r/test-fixture")
  if [[ "$status" == "200" ]]; then
    pass "2. Demo report (GET /r/test-fixture → 200)"
  else
    fail "2. Demo report" "expected 200, got $status"
  fi
}

# ──────────────────────────────────────────────
# Test 3 — Dashboard auth redirect
# GET /dashboard (no cookie) → 302 to /sign-in
# ──────────────────────────────────────────────
{
  location=$(curl -s --max-time 10 -o /dev/null -w "%{redirect_url}" \
    "${BASE_URL}/dashboard" 2>/dev/null) || location=""
  status=$(http_get "${BASE_URL}/dashboard")
  if [[ "$status" == "302" ]] && echo "$location" | grep -q "sign-in"; then
    pass "3. Dashboard auth redirect (GET /dashboard → 302 → /sign-in)"
  elif [[ "$status" == "302" ]]; then
    fail "3. Dashboard auth redirect" "got 302 but redirect_url='$location' (expected /sign-in)"
  else
    fail "3. Dashboard auth redirect" "expected 302, got $status"
  fi
}

# ──────────────────────────────────────────────
# Test 4 — Sign-in API accepts JSON
# POST /api/auth/magic-link {"email":"smoke@willbuy.dev"} → 202
# ──────────────────────────────────────────────
{
  status=$(http_get \
    -X POST \
    -H "Content-Type: application/json" \
    -d '{"email":"smoke@willbuy.dev"}' \
    "${BASE_URL}/api/auth/magic-link")
  if [[ "$status" == "202" ]]; then
    pass "4. Sign-in API accepts JSON (POST /api/auth/magic-link → 202)"
  else
    fail "4. Sign-in API accepts JSON" "expected 202, got $status"
  fi
}

# ──────────────────────────────────────────────
# Test 5 — Sign-out 415 fix
# POST /api/auth/sign-out with form body → 302 (not 415)
# ──────────────────────────────────────────────
{
  status=$(http_get \
    -X POST \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "" \
    "${BASE_URL}/api/auth/sign-out")
  if [[ "$status" == "302" ]]; then
    pass "5. Sign-out 415 fix (POST /api/auth/sign-out form body → 302)"
  elif [[ "$status" == "415" ]]; then
    fail "5. Sign-out 415 fix" "got 415 — fix not deployed"
  else
    fail "5. Sign-out 415 fix" "expected 302, got $status"
  fi
}

# ──────────────────────────────────────────────
# Test 6 — Domain verify form accepts form body
# POST /api/domains/example.com/verify (form body, no cookie) → 401 (not 415)
# ──────────────────────────────────────────────
{
  status=$(http_get \
    -X POST \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "" \
    "${BASE_URL}/api/domains/example.com/verify")
  if [[ "$status" == "401" ]]; then
    pass "6. Domain verify 415 fix (POST /api/domains/.../verify form body → 401)"
  elif [[ "$status" == "415" ]]; then
    fail "6. Domain verify 415 fix" "got 415 — fix not deployed"
  else
    fail "6. Domain verify 415 fix" "expected 401, got $status"
  fi
}

# ──────────────────────────────────────────────
# Test 7 — Stripe webhook route exists (nginx block)
# POST /stripe/webhook (empty body) → 400 (missing sig), not 404
# ──────────────────────────────────────────────
{
  status=$(http_get \
    -X POST \
    -H "Content-Type: application/json" \
    -d "{}" \
    "${BASE_URL}/stripe/webhook")
  if [[ "$status" == "400" ]]; then
    pass "7. Stripe webhook route (POST /stripe/webhook → 400 missing-sig, not 404)"
  elif [[ "$status" == "404" ]]; then
    fail "7. Stripe webhook route" "got 404 — nginx /stripe/ block not deployed"
  else
    fail "7. Stripe webhook route" "expected 400, got $status"
  fi
}

# ──────────────────────────────────────────────
# Test 8 — Credits page (no session) → 302 to /sign-in
# ──────────────────────────────────────────────
{
  location=$(curl -s --max-time 10 -o /dev/null -w "%{redirect_url}" \
    "${BASE_URL}/dashboard/credits" 2>/dev/null) || location=""
  status=$(http_get "${BASE_URL}/dashboard/credits")
  if [[ "$status" == "302" ]] && echo "$location" | grep -q "sign-in"; then
    pass "8. Credits page redirect (GET /dashboard/credits → 302 → /sign-in)"
  elif [[ "$status" == "302" ]]; then
    fail "8. Credits page redirect" "got 302 but redirect_url='$location' (expected /sign-in)"
  else
    fail "8. Credits page redirect" "expected 302, got $status"
  fi
}

# ──────────────────────────────────────────────
# Summary
# ──────────────────────────────────────────────
echo ""
echo "──────────────────────────────────────────"
echo "Results: ${PASS} passed, ${FAIL} failed"
echo "──────────────────────────────────────────"

if [[ $FAIL -eq 0 ]]; then
  echo "All checks passed."
  exit 0
else
  echo "Some checks failed — see above."
  exit 1
fi
