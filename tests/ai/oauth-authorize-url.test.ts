// The authorize URL both subscription logins open, byte for byte. These are
// third-party endpoints nothing here can test against, so the query — the
// params, their values and their order — is pinned to what shipped. The three
// expected strings were produced by running the pre-dedupe implementations of
// anthropic-oauth.ts and openai-oauth.ts, not written by hand. Run: bun test.

import { expect, test } from "bun:test";
import { MANUAL_REDIRECT_URI, buildAuthUrl as anthropicAuthUrl } from "../../src/ai/anthropic-oauth";
import { buildAuthUrl as openaiAuthUrl } from "../../src/ai/openai-oauth";

const CHALLENGE = "the-challenge";
const STATE = "the-state";

test("the Anthropic loopback authorize URL is unchanged", () => {
  expect(anthropicAuthUrl(CHALLENGE, STATE)).toBe(
    "https://claude.ai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A53692%2Fcallback&scope=org%3Acreate_api_key+user%3Aprofile+user%3Ainference+user%3Asessions%3Aclaude_code+user%3Amcp_servers+user%3Afile_upload&code_challenge=the-challenge&code_challenge_method=S256&state=the-state",
  );
});

test("the Anthropic paste-fallback authorize URL is unchanged", () => {
  expect(anthropicAuthUrl(CHALLENGE, STATE, MANUAL_REDIRECT_URI)).toBe(
    "https://claude.ai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&redirect_uri=https%3A%2F%2Fconsole.anthropic.com%2Foauth%2Fcode%2Fcallback&scope=org%3Acreate_api_key+user%3Aprofile+user%3Ainference+user%3Asessions%3Aclaude_code+user%3Amcp_servers+user%3Afile_upload&code_challenge=the-challenge&code_challenge_method=S256&state=the-state",
  );
});

// OpenAI's paste fallback opens the loopback URL above; there is no second one.
test("the OpenAI authorize URL is unchanged", () => {
  expect(openaiAuthUrl(CHALLENGE, STATE)).toBe(
    "https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_EMoamEEZ73f0CkXaXp7hrann&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&scope=openid+profile+email+offline_access&code_challenge=the-challenge&code_challenge_method=S256&state=the-state&id_token_add_organizations=true&codex_cli_simplified_flow=true&originator=pi",
  );
});
