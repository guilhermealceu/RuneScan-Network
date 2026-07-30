import type { Device, ScanResult } from './types';

const TYPE_LABEL: Record<Device['type'], string> = {
  router: 'Roteador',
  switch: 'Switch',
  network: 'Equipamento de rede',
  ap: 'Ponto de acesso Wi-Fi',
  workstation: 'Computador',
  notebook: 'Notebook',
  phone: 'Celular',
  tablet: 'Tablet',
  server: 'Servidor',
  camera: 'Camera',
  printer: 'Impressora',
  iot: 'Dispositivo conectado',
  unknown: 'Tipo ainda nao identificado',
};

const TYPE_ICON: Record<Device['type'], string> = {
  router: '🌐',
  switch: '🔀',
  network: '🌐',
  ap: '📡',
  workstation: '🖥️',
  notebook: '💻',
  phone: '📱',
  tablet: '📱',
  server: '🗄️',
  camera: '📷',
  printer: '🖨️',
  iot: '🔌',
  unknown: '❓',
};

const PORT_NAME: Record<number, string> = {
  21: 'FTP', 22: 'SSH', 23: 'Telnet', 53: 'DNS', 80: 'HTTP', 135: 'RPC',
  139: 'NetBIOS', 443: 'HTTPS', 445: 'SMB', 515: 'Impressao LPD',
  631: 'Impressao IPP', 3389: 'RDP', 5900: 'VNC', 8080: 'HTTP alternativo',
  8443: 'HTTPS alternativo',
};

export function buildHumanActionItems(devices: Device[]) {
  const telnet = devices.filter((device) => device.openPorts?.includes(23)).length;
  const remote = devices.filter((device) => [22, 23, 3389, 5900].some((port) => device.openPorts?.includes(port))).length;
  const sharing = devices.filter((device) => [135, 139, 445].some((port) => device.openPorts?.includes(port))).length;
  const unknown = devices.filter((device) => device.type === 'unknown').length;
  return [
    telnet ? `Validar ${telnet} dispositivo(s) com Telnet; o protocolo nao protege o trafego com criptografia.` : null,
    remote ? `Confirmar necessidade e restricoes de acesso remoto em ${remote} dispositivo(s).` : null,
    sharing ? `Revisar o alcance de RPC, NetBIOS ou SMB em ${sharing} dispositivo(s).` : null,
    unknown ? `Associar responsavel e funcao a ${unknown} dispositivo(s) ainda nao identificado(s).` : null,
  ].filter((item): item is string => Boolean(item));
}

export function exportExecutiveHtmlReport(result: ScanResult | null, devices: Device[]) {
  if (!devices.length) return;
  const exportedAt = new Date().toISOString();
  const online = devices.filter((device) => device.status === 'online');
  const high = online.filter((device) => device.riskLevel === 'high');
  const medium = online.filter((device) => device.riskLevel === 'medium');
  const identified = online.filter((device) => device.type !== 'unknown');
  const registered = online.filter((device) => device.responsible || device.department);
  const actions = buildHumanActionItems(online);
  const priorityRows = [...high, ...medium].slice(0, 15).map((device) => `<tr><td><strong>${escapeHtml(device.name)}</strong><small>${escapeHtml(device.ip)}</small></td><td>${escapeHtml(TYPE_LABEL[device.type])}</td><td>${escapeHtml(device.responsible || 'Nao definido')}<small>${escapeHtml(device.department || '')}</small></td><td>${escapeHtml(deviceAction(device))}</td></tr>`).join('');
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RuneScan | Relatorio executivo</title><style>
  :root{--ink:#17202a;--muted:#64748b;--line:#dfe5eb;--brand:#f15a24;--bg:#f4f6f8}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 Inter,system-ui,sans-serif}.page{max-width:1050px;margin:auto;padding:38px 20px}.card{background:#fff;border:1px solid var(--line);border-radius:18px;padding:28px;margin-bottom:20px}h1{margin:0;color:var(--brand);font-size:34px}h2{margin:0 0 12px}.meta,small{display:block;color:var(--muted)}.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-top:24px}.stat{border:1px solid var(--line);border-radius:12px;padding:14px;text-align:center}.stat b{display:block;font-size:25px}.stat span{font-size:10px;text-transform:uppercase;color:var(--muted)}li{margin:8px 0}table{width:100%;border-collapse:collapse}th,td{text-align:left;border-bottom:1px solid var(--line);padding:11px;vertical-align:top}th{font-size:10px;text-transform:uppercase;color:var(--muted)}@media(max-width:700px){.stats{grid-template-columns:repeat(2,1fr)}}@media print{body{background:#fff}.page{padding:0}.card{break-inside:avoid}}</style></head><body><main class="page">
  <section class="card"><h1>RUNESCAN</h1><p class="meta">Relatorio executivo · ${escapeHtml(result?.target || 'Rede local')} · ${escapeHtml(formatDate(exportedAt))}</p><p><strong>${online.length} equipamentos responderam.</strong> Este documento resume prioridades de gestao; detalhes de portas, servicos e evidencias ficam no relatorio tecnico.</p><div class="stats"><div class="stat"><b>${devices.length}</b><span>Inventario</span></div><div class="stat"><b>${online.length}</b><span>Online</span></div><div class="stat"><b>${high.length}</b><span>Revisar primeiro</span></div><div class="stat"><b>${identified.length}</b><span>Identificados</span></div><div class="stat"><b>${registered.length}</b><span>Com responsavel/setor</span></div></div></section>
  <section class="card"><h2>Decisoes recomendadas</h2><ol>${actions.map((action) => `<li>${escapeHtml(action)}</li>`).join('') || '<li>Manter o inventario atualizado e repetir a verificacao periodicamente.</li>'}</ol></section>
  <section class="card"><h2>Equipamentos que exigem acompanhamento</h2>${priorityRows ? `<table><thead><tr><th>Equipamento</th><th>Funcao</th><th>Responsavel</th><th>Proxima acao</th></tr></thead><tbody>${priorityRows}</tbody></table>` : '<p>Nenhum equipamento ficou nas prioridades alta ou media nesta execucao.</p>'}</section>
  <p class="meta">A prioridade organiza a revisao humana e nao comprova vulnerabilidade ou invasao.</p></main></body></html>`;
  downloadHtml(html, `runescan-relatorio-executivo-${exportedAt.replace(/[:.]/g, '-')}.html`);
}

export function exportHumanHtmlReport(result: ScanResult | null, devices: Device[]) {
  if (!devices.length) return;

  const exportedAt = new Date().toISOString();
  const online = devices.filter((device) => device.status === 'online');
  const first = online.filter((device) => device.riskLevel === 'high');
  const next = online.filter((device) => device.riskLevel === 'medium');
  const routine = online.filter((device) => (device.riskLevel || 'low') === 'low');
  const unknown = online.filter((device) => device.type === 'unknown');
  const web = online.filter((device) => [80, 443, 8080, 8443].some((port) => device.openPorts?.includes(port)));
  const inventory = [...devices].sort(sortDevices);
  const actions = buildHumanActionItems(online);

  const pools = (result?.vlans || []).filter((vlan) => vlan.onlineCount > 0).map((vlan) => `
    <div class="pool"><span>${escapeHtml(vlan.subnet)}</span><strong>${vlan.onlineCount} dispositivo${vlan.onlineCount === 1 ? '' : 's'}</strong></div>
  `).join('');

  const inventoryRows = inventory.map((device) => `
    <tr class="row-${device.riskLevel || 'low'}">
      <td><div class="identity"><span class="type-icon" aria-hidden="true">${TYPE_ICON[device.type]}</span><span><strong>${escapeHtml(device.name)}</strong><small>${escapeHtml(TYPE_LABEL[device.type])}${device.vendor ? ` · ${escapeHtml(device.vendor)}` : ''}</small></span></div></td>
      <td><span class="mono">${escapeHtml(device.ip)}</span><small>${escapeHtml(device.vlan)}${device.fixedIp ? ` · Fixo: ${escapeHtml(device.fixedIp)}` : ''}</small></td>
      <td>${escapeHtml(formatPorts(device.openPorts))}</td>
      <td><span class="tag tag-${device.riskLevel || 'low'}">${riskLabel(device.riskLevel)}</span></td>
      <td>${escapeHtml(deviceAction(device))}<small>${escapeHtml([device.responsible, device.department].filter(Boolean).join(' · ') || 'Responsavel/setor nao informado')}</small></td>
    </tr>
  `).join('');

  const localCtx = result?.localContext;
  const activeIface = localCtx?.activeInterface || localCtx?.interfaces?.find((i) => !i.internal);
  const netContextHtml = localCtx ? `
    <div style="background:#f8fafc;border:1px solid #dfe5eb;border-radius:12px;padding:12px 16px;margin:16px 0;font-size:12px;display:flex;flex-wrap:wrap;gap:18px;align-items:center;">
      <div><strong>Host Local:</strong> ${escapeHtml(localCtx.hostname)}</div>
      <div><strong>Gateway Padrão:</strong> ${escapeHtml(localCtx.defaultGateway || activeIface?.gateway || 'Não informado')}</div>
      <div><strong>Adaptador Ativo:</strong> ${escapeHtml(activeIface?.wifiSsid ? `Wi-Fi (${activeIface.wifiSsid})` : activeIface?.name || 'Rede Local')}</div>
      <div><strong>Modo de IP:</strong> <span style="font-weight:bold;color:${activeIface?.isStaticIp ? '#b42318' : '#067647'}">${activeIface?.isStaticIp ? '⚠️ IP FIXO (Estático)' : 'DHCP (Dinâmico)'}</span></div>
    </div>
  ` : '';

  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RuneScan | Relatorio de rede - ${escapeHtml(result?.target || 'Rede local')}</title>
<style>
:root{--bg:#f4f6f8;--paper:#fff;--ink:#17202a;--muted:#64748b;--line:#dfe5eb;--brand:#f15a24;--red:#b42318;--amber:#b54708;--green:#067647;--blue:#175cd3}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}.page{max-width:1120px;margin:auto;padding:38px 20px 70px}.hero,.section{background:var(--paper);border:1px solid var(--line);border-radius:22px;padding:30px;margin-bottom:24px}.brand{display:flex;justify-content:space-between;gap:24px;border-bottom:1px solid var(--line);padding-bottom:22px;margin-bottom:24px}.brand h1{margin:0;color:var(--brand);font-size:34px;letter-spacing:-1.5px}.brand p,.meta{margin:2px 0;color:var(--muted)}.meta{text-align:right;font:11px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace}.lead{font-size:19px;max-width:850px}.lead strong{color:var(--brand)}.note{background:#eff6ff;border-left:4px solid var(--blue);border-radius:0 12px 12px 0;padding:15px 17px;color:#25476d}.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:24px 0}.stat{background:#f8fafc;border:1px solid var(--line);border-radius:14px;padding:16px;text-align:center}.stat b{display:block;font-size:26px}.stat span,.label{color:var(--muted);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}.actions{background:#fff7ed;border:1px solid #fed7aa;border-radius:16px;padding:20px}.actions h2{font-size:17px;margin:0 0 8px}.actions li{margin:8px 0}.pools{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:18px}.pool{display:flex;justify-content:space-between;background:#f8fafc;border:1px solid var(--line);border-radius:10px;padding:9px 12px;font-size:12px}.section h2{font-size:23px;margin:0 0 6px}.intro{color:var(--muted);margin:0 0 20px}.legend,.coverage{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.legend>div,.coverage>div{border:1px solid var(--line);border-radius:14px;padding:16px}.legend strong,.coverage strong{display:block;margin-bottom:6px}.tag{display:inline-block;border-radius:999px;padding:4px 9px;white-space:nowrap;font-size:10px;font-weight:900}.tag-high{background:#fef3f2;color:var(--red)}.tag-medium{background:#fff7ed;color:var(--amber)}.tag-low{background:#ecfdf3;color:var(--green)}.status{background:#f1f5f9;color:#475467}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.08em;border-bottom:2px solid var(--line);padding:10px}td{vertical-align:top;border-bottom:1px solid var(--line);padding:13px 10px}td small{display:block;color:var(--muted);font:11px ui-monospace,SFMono-Regular,Consolas,monospace;margin-top:3px}.inventory-title{font-size:24px;margin:42px 0 4px;padding-left:12px;border-left:4px solid var(--brand)}.inventory-intro{color:var(--muted);margin:0 0 22px 16px}.device{background:var(--paper);border:1px solid var(--line);border-left-width:5px;border-radius:18px;padding:22px;margin-bottom:16px;break-inside:avoid}.device.high{border-left-color:#ef4444}.device.medium{border-left-color:#f59e0b}.device.low{border-left-color:#10b981}.device-head{display:flex;justify-content:space-between;gap:16px}.device h3{margin:0;font-size:18px}.ip{margin:2px 0;color:var(--brand);font:12px ui-monospace,SFMono-Regular,Consolas,monospace}.tags{display:flex;gap:6px;align-items:flex-start}.plain{background:#f8fafc;border-radius:12px;padding:13px 15px;margin:16px 0}.facts{display:grid;grid-template-columns:1fr 1fr;gap:24px}.facts span{display:block;color:var(--muted);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}.facts strong{display:block;margin-top:4px}.facts small{display:block;color:var(--muted);margin-top:3px}.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.services{display:flex;flex-wrap:wrap;gap:7px;margin-top:14px}.services span{background:#f1f5f9;border:1px solid var(--line);border-radius:8px;padding:6px 9px;font-size:11px}details{margin-top:14px;border-top:1px dashed var(--line);padding-top:11px}summary{cursor:pointer;color:var(--muted);font-weight:800;font-size:12px}details p{color:var(--muted);font-size:11px}footer{text-align:center;color:var(--muted);margin-top:55px;font-size:11px}.glossary dt{font-weight:800;margin-top:10px}.glossary dd{margin-left:0;color:var(--muted)}
.identity{display:flex;align-items:center;gap:9px;min-width:155px}.type-icon{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;background:#f1f5f9;border-radius:7px;font-size:17px;flex:0 0 auto}.row-high{border-left:3px solid #ef4444}.row-medium{border-left:3px solid #f59e0b}.row-low{border-left:3px solid transparent}.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.inventory-title{border-left:0;padding-left:0}.inventory-intro{margin-left:0}.hero,.section{border-radius:14px}.device,.plain,.facts,.services,details{display:none}
@media(max-width:760px){.brand{flex-direction:column}.meta{text-align:left}.stats{grid-template-columns:repeat(2,1fr)}.legend,.coverage,.pools{grid-template-columns:1fr}}
@media print{body{background:#fff}.page{max-width:none;padding:0}.hero,.section{box-shadow:none}.device{break-inside:avoid}details>*{display:block!important}}
</style></head><body><main class="page">
<header class="hero"><div class="brand"><div><h1>RUNESCAN</h1><p>Relatorio de descoberta e exposicao da rede</p></div><div class="meta">Gerado em ${escapeHtml(formatDate(exportedAt))}<br>Escopo: ${escapeHtml(result?.target || 'Rede local')}</div></div>
<p class="lead"><strong>${online.length} dispositivos responderam.</strong> ${first.length} devem ser revisados primeiro, ${next.length} podem ser revisados em seguida e ${routine.length} nao apresentaram alerta prioritario nesta varredura.</p>
${netContextHtml}
<p class="note"><strong>Importante:</strong> o relatorio mostra sinais observados na rede. Ele nao comprova invasao, vulnerabilidade ou configuracao incorreta. Antes de bloquear um servico, confirme sua funcao com o responsavel pelo equipamento.</p>
<div class="stats"><div class="stat"><b>${devices.length}</b><span>Encontrados</span></div><div class="stat"><b>${online.length}</b><span>Responderam</span></div><div class="stat"><b style="color:var(--red)">${first.length}</b><span>Revisar primeiro</span></div><div class="stat"><b>${web.length}</b><span>Com interface web</span></div><div class="stat"><b>${unknown.length}</b><span>Sem tipo confirmado</span></div></div>
<div class="actions"><h2>O que fazer agora</h2><ol>${actions.map((action) => `<li>${escapeHtml(action)}</li>`).join('') || '<li>Nenhuma acao prioritaria foi gerada. Mantenha inventario e monitoramento periodicos.</li>'}</ol></div>
${pools ? `<div class="pools">${pools}</div>` : ''}</header>
<section class="section"><h2>Como ler as prioridades</h2><p class="intro">A cor organiza a ordem de verificacao; ela nao e um veredito de seguranca.</p><div class="legend"><div><strong class="tag tag-high">Revisar primeiro</strong>Ha uma porta sensivel ou um servico que merece validacao humana mais rapida.</div><div><strong class="tag tag-medium">Revisar depois</strong>Ha servicos acessiveis, mas sem o mesmo sinal de prioridade.</div><div><strong class="tag tag-low">Sem alerta prioritario</strong>Nada relevante apareceu nos testes feitos. Isso nao significa “comprovadamente seguro”.</div></div></section>
<h2 class="inventory-title">Dispositivos encontrados</h2><p class="inventory-intro">Cada equipamento aparece uma unica vez, ja ordenado por prioridade.</p><div class="table-wrap"><table><thead><tr><th>Dispositivo / Tipo</th><th>IP / Rede</th><th>Portas e servicos</th><th>Prioridade</th><th>Acao</th></tr></thead><tbody>${inventoryRows}</tbody></table></div>
<footer>RuneScan Network Intelligence · Rune Projects · &copy; ${new Date().getFullYear()}</footer></main></body></html>`;

  downloadHtml(html, `runescan-relatorio-tecnico-${exportedAt.replace(/[:.]/g, '-')}.html`);
}

function deviceAction(device: Device) {
  const ports = new Set(device.openPorts || []);
  if (ports.has(23)) return 'Confirmar a necessidade do Telnet e planejar substituicao por acesso criptografado.';
  if (ports.has(3389) || ports.has(5900)) return 'Confirmar quem pode usar o acesso remoto e restringir a origem quando possivel.';
  if ([135, 139, 445].some((port) => ports.has(port))) return 'Validar a necessidade do compartilhamento e limitar o acesso as redes autorizadas.';
  if (device.type === 'unknown') return 'Identificar o equipamento, sua funcao e o responsavel.';
  if (device.openPorts?.length) return 'Conferir se os servicos listados sao esperados para a funcao do equipamento.';
  return 'Manter no inventario e repetir a verificacao periodicamente.';
}

function formatPorts(ports?: number[]) {
  if (!ports?.length) return 'Nenhuma porta comum detectada';
  return ports.map((port) => `${port}${PORT_NAME[port] ? ` (${PORT_NAME[port]})` : ''}`).join(', ');
}

function riskLabel(risk?: Device['riskLevel']) {
  if (risk === 'high') return 'Revisar primeiro';
  if (risk === 'medium') return 'Revisar depois';
  return 'Sem alerta prioritario';
}

function sortDevices(a: Device, b: Device) {
  return riskWeight(b) - riskWeight(a) || ipNumber(a.ip) - ipNumber(b.ip);
}

function riskWeight(device: Device) {
  if (device.riskLevel === 'high') return 3;
  if (device.riskLevel === 'medium') return 2;
  return 1;
}

function ipNumber(ip: string) {
  return ip.split('.').reduce((value, octet) => value * 256 + Number(octet), 0);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value));
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function downloadHtml(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
