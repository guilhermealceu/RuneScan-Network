import assert from "node:assert/strict";
import test from "node:test";
import { AccessController, getAccessPolicy } from "../src/server/access-policy";

test("usa somente o computador local por padrao", () => {
  const policy = getAccessPolicy({});
  assert.equal(policy.host, "127.0.0.1");
  assert.equal(policy.lanEnabled, false);
  assert.equal(policy.authRequired, false);
});

test("recusa acesso pela rede sem token forte", () => {
  assert.throws(
    () => getAccessPolicy({ ALLOW_LAN_ACCESS: "true" }),
    /API_TOKEN com pelo menos 24 caracteres/,
  );
  assert.throws(
    () => getAccessPolicy({ ALLOW_LAN_ACCESS: "true", API_TOKEN: "curto" }),
    /API_TOKEN com pelo menos 24 caracteres/,
  );
});

test("libera a rede com token forte e exige autenticacao", () => {
  const policy = getAccessPolicy({
    ALLOW_LAN_ACCESS: "true",
    API_TOKEN: "token-seguro-com-24-caracteres",
  });
  assert.equal(policy.host, "0.0.0.0");
  assert.equal(policy.authRequired, true);
});

test("sessao aceita o token correto e expira", () => {
  let now = 1_000;
  const policy = getAccessPolicy({
    ALLOW_LAN_ACCESS: "true",
    API_TOKEN: "token-seguro-com-24-caracteres",
  });
  const access = new AccessController(policy, () => now);

  assert.equal(access.createSession("token-incorreto"), null);
  const session = access.createSession("token-seguro-com-24-caracteres");
  assert.ok(session);
  assert.equal(access.isAuthorized(`outra=x; runescan_session=${session}`), true);

  now += 8 * 60 * 60 * 1000;
  assert.equal(access.isAuthorized(`runescan_session=${session}`), false);
});
