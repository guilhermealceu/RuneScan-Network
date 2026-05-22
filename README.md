# RuneScan Network

Central local para descoberta real de rede, inventario inicial, topologia inferida e triagem tecnica de ativos.

Nao ha fallback mockado. Se a rede nao responder, se o firewall bloquear ou se uma ferramenta externa nao existir, o resultado mostra isso explicitamente nos coletores.

## Estrutura atual

- `server.ts`: API HTTP, Vite e IA local via Ollama.
- `src/server/discovery.ts`: orquestrador de coletores de rede.
- `src/types.ts`: contrato compartilhado entre backend e frontend.
- `src/components/NetworkDashboard.tsx`: painel operacional.
- `src/components/NetworkTree.tsx`: topologia inferida.

## Coletores disponiveis

- Nativo: ICMP, ARP local, DNS reverso e conexao TCP em portas comuns.
- Nmap: detectado automaticamente no `PATH` ou em `C:\Program Files*\Nmap`; usado para ping sweep amplo e enriquecimento de portas/servicos.
- TShark/Wireshark CLI: detectado automaticamente; preparado como fonte de captura passiva futura.
- Netsh: detectado no Windows para contexto local.
- NirSoft Wireless Network Watcher: detectado como `WNetWatcher.exe`; usado como fonte auxiliar por CSV.
- Telnet exposure check: confirma porta 23 aberta e tenta ler apenas banner inicial, sem login, senha ou comandos.
- SNMP: planejado para confirmar VLANs, interfaces, ARP, tabela MAC e inventario.
- SSH/CLI: planejado para switches/roteadores quando SNMP nao bastar.
- NirSoft utilities: planejado como fonte auxiliar portatil em Windows, sem download automatico.

## Rodar localmente

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`.

Variaveis uteis:

```bash
PORT=3000
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3
DISABLE_LIVE_SCAN=false
```

## Endpoints

```text
GET /api/config
GET /api/tools
GET /api/scan?target=10.10.0.0/16,10.10.100.0/24&useNmap=true&useNirsoft=false
GET /api/scan/stream?target=10.10.0.0/16,10.10.100.0/24&useNmap=true&useNirsoft=false
POST /api/ai/analyze-device
```

`/api/scan/stream` usa Server-Sent Events para enviar etapas e snapshots parciais enquanto a varredura roda. A UI usa esse endpoint para mostrar progresso sem apagar o resultado anterior.

O campo `target` aceita CIDR e ranges explicitos no estilo Advanced IP Scanner:

```text
10.10.100.1-254
10.10.100.10-10.10.100.80
10.10.0.1-254,10.10.2.1-254,10.10.100.0/24
```

NirSoft fica desligado por padrao porque o `WNetWatcher.exe` pode demorar ou segurar o processo em alguns Windows. Ative manualmente quando quiser testar essa fonte auxiliar.

O parecer via Ollama e manual: selecionar um ativo nao chama IA automaticamente. Clique em `Gerar parecer` no detalhe do ativo quando quiser consultar o modelo local.

## Caminho para VLAN e topologia real

Ping e ARP mostram presenca, mas nao confirmam VLAN. Para uma visao confiavel em cliente, a ordem boa e:

1. Descobrir gateways e redes diretamente conectadas.
2. Consultar switches/roteadores via SNMP com credenciais autorizadas.
3. Coletar tabela ARP, MAC address-table, interfaces, VLAN database e LLDP/CDP.
4. Cruzar MAC/IP/porta/interface para montar topologia fisica.
5. Enriquecer com Nmap e, quando permitido, captura passiva com TShark.

## Escopo amplo

O campo de alvo aceita varios CIDRs separados por virgula, espaco ou ponto e virgula.

Exemplo:

```text
10.10.0.0/16, 10.10.100.0/24
```

Para escopos menores (`/24` a `/30`), o coletor nativo tambem roda ICMP/ARP/TCP. Para escopos amplos como `/16`, o Nmap faz primeiro uma descoberta de segmentos sondando candidatos de gateway (`.1` e `.254`) de cada `/24`; depois o app aprofunda nos `/24` informados explicitamente e limita a sondagem de servicos aos primeiros 512 hosts descobertos.
