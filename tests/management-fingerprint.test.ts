import assert from "node:assert/strict";
import test from "node:test";
import { canReplaceInferredDeviceName, fingerprintWeb, managementIdentityFromRows, type WebProbeResult } from "../src/server/discovery";

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

test("reconhece interface TP-Link e a apresenta como equipamento de rede", () => {
  const fingerprint = fingerprintWeb(webResult({ title: "TP-Link", bodyText: "TP-Link Technologies Co., Ltd. Log In" }));

  assert.equal(fingerprint.product, "TP-Link (equipamento de rede)");
  assert.equal(fingerprint.type, "network device");
  assert.equal(fingerprint.confidence, "alta");
  assert.deepEqual(managementIdentityFromRows([{ Produto: fingerprint.product, Tipo: fingerprint.type }]), {
    vendor: "TP-Link Systems Inc.",
    name: "TP-Link (equipamento de rede)",
  });
});

test("reconhece a pagina publica do FOG sem precisar autenticar", () => {
  const fingerprint = fingerprintWeb(webResult({
    finalUrl: "http://10.0.0.19/fog/management/index.php",
    title: "FOG Project",
    bodyText: "FOG Project Username Password Estimated FOG Sites",
  }));

  assert.equal(fingerprint.product, "FOG Project");
  assert.equal(fingerprint.type, "server imaging/deployment");
  assert.equal(fingerprint.confidence, "alta");
});

test("reconhece a pagina publica do Checkmk sem precisar autenticar", () => {
  const fingerprint = fingerprintWeb(webResult({
    finalUrl: "http://10.0.0.60/cmk/check_mk/login.py?_origtarget=index.py",
    title: "checkmk",
    bodyText: "checkmk Username Password Version: 2.3.0p47 © Checkmk GmbH",
  }));

  assert.equal(fingerprint.product, "Checkmk");
  assert.equal(fingerprint.type, "server monitoring");
  assert.equal(fingerprint.confidence, "alta");
});

test("reconhece a pagina publica do Passbolt sem precisar autenticar", () => {
  const fingerprint = fingerprintWeb(webResult({
    finalUrl: "https://10.0.0.141/auth/login?redirect=%2F&locale=pt-BR",
    title: "Passbolt",
    bodyText: "Passbolt Por favor, digite seu e-mail para continuar. Eu aceito os termos",
  }));

  assert.equal(fingerprint.product, "Passbolt");
  assert.equal(fingerprint.type, "server password management");
  assert.equal(fingerprint.confidence, "alta");
});

test("reconhece o login do pfSense sem precisar autenticar", () => {
  const fingerprint = fingerprintWeb(webResult({
    finalUrl: "https://10.0.0.1/",
    title: "pfSense - Login",
    bodyText: "pfSense Login Netgate firewall",
  }));

  assert.equal(fingerprint.product, "pfSense");
  assert.equal(fingerprint.type, "router/firewall");
  assert.equal(fingerprint.confidence, "alta");
});

test("reconhece o titulo e HTML do Xibo sem precisar autenticar", () => {
  const fingerprint = fingerprintWeb(webResult({
    finalUrl: "http://10.0.0.12/login",
    title: "Xibo Digital Signage",
    bodyText: "Xibo Open Source Digital Signage Solution. Released under the AGPLv3 or later.",
  }));

  assert.equal(fingerprint.product, "Xibo Digital Signage");
  assert.equal(fingerprint.type, "server digital signage");
  assert.equal(fingerprint.confidence, "alta");
});

test("fingerprint de aplicacao substitui o nome inferido da VM", () => {
  assert.equal(canReplaceInferredDeviceName({
    name: "Proxmox VM (funcao nao identificada)",
    ip: "10.0.0.19",
    identitySource: "inferred",
  }), true);
  assert.equal(canReplaceInferredDeviceName({ name: "FOG-PRD", ip: "10.0.0.19" }), false);
});

test("usa titulo web especifico como identidade inferida quando nao ha assinatura", () => {
  const fingerprint = fingerprintWeb(webResult({ title: "Painel Acme Operacoes", bodyText: "Bem-vindo" }));
  assert.deepEqual(fingerprint, {
    product: "Painel Acme Operacoes",
    type: "web interface",
    confidence: "media",
    evidence: ["title: Painel Acme Operacoes"],
  });
});

test("nao trata titulo web generico ou transitorio como identidade", () => {
  for (const title of ["Login", "Loading Web Application", "Please wait"]) {
    const fingerprint = fingerprintWeb(webResult({ title, bodyText: "Usuario Senha" }));
    assert.equal(fingerprint.product, "");
  }
});

test("nao inventa controladora quando ha apenas HTTPS generico", () => {
  const fingerprint = fingerprintWeb(webResult({ title: "Administration", headers: { server: "nginx" } }));
  assert.equal(fingerprint.product, "");
  assert.equal(managementIdentityFromRows([{ Produto: "nao confirmado", Certificado: "CN=generic" }]), undefined);
});
