import assert from "node:assert/strict";
import test from "node:test";
import { fingerprintWeb, managementIdentityFromRows, type WebProbeResult } from "../src/server/discovery";

function webResult(overrides: Partial<WebProbeResult>): WebProbeResult {
  return {
    ok: true,
    finalUrl: "https://10.1.1.199/",
    status: 200,
    headers: {},
    redirects: [],
    bodyText: "",
    ...overrides,
  };
}

test("reconhece o XCC real pelo nome do certificado TLS", () => {
  const certificate = "CN=XCC-7X06-J500033C / Issuer=XCC-7X06-J500033C / Valido ate Apr 3 2033";
  const fingerprint = fingerprintWeb(webResult({ certificate }));

  assert.equal(fingerprint.product, "Lenovo XClarity Controller");
  assert.equal(fingerprint.type, "server management");
  assert.equal(fingerprint.confidence, "alta");

  const identity = managementIdentityFromRows([{
    Produto: fingerprint.product,
    Tipo: fingerprint.type,
    Certificado: certificate,
  }]);
  assert.deepEqual(identity, { vendor: "Lenovo", name: "XCC-7X06-J500033C" });
});

test("reconhece Dell iDRAC e HPE iLO pela interface web", () => {
  const idrac = fingerprintWeb(webResult({ title: "Integrated Dell Remote Access Controller", bodyText: "iDRAC login" }));
  const ilo = fingerprintWeb(webResult({ finalUrl: "https://10.1.1.200/", title: "HPE iLO 5", bodyText: "Integrated Lights-Out" }));

  assert.equal(idrac.product, "Dell iDRAC");
  assert.equal(ilo.product, "HPE iLO");
});

test("nao inventa controladora quando ha apenas HTTPS generico", () => {
  const fingerprint = fingerprintWeb(webResult({ title: "Administration", headers: { server: "nginx" } }));
  assert.equal(fingerprint.product, "");
  assert.equal(managementIdentityFromRows([{ Produto: "nao confirmado", Certificado: "CN=generic" }]), undefined);
});
