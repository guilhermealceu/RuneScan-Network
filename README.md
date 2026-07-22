# RuneScan Network

O RuneScan e um painel local para descobrir, identificar e diagnosticar equipamentos em uma rede IPv4. Ele combina recursos do Windows com ferramentas opcionais como Nmap, Wireshark/TShark, NirSoft e Ollama.

O objetivo e responder de forma pratica:

- Quais equipamentos estao na rede?
- Qual e o IP, nome, fabricante e tipo provavel de cada um?
- Quais portas e servicos responderam?
- Quais equipamentos devem ser revisados primeiro?
- Quais enderecos IP nao apareceram na varredura e podem ser candidatos para cadastro fixo?

> Use o RuneScan somente em redes e equipamentos para os quais voce tenha autorizacao.

## Como o projeto funciona

Quando uma varredura e iniciada, o RuneScan executa estas etapas:

1. Normaliza o IP, CIDR ou intervalo informado.
2. Usa ping, ARP, DNS reverso e conexoes TCP do proprio sistema.
3. Se o Nmap estiver instalado, melhora a descoberta e identifica portas, servicos e produtos.
4. Se habilitado, importa informacoes auxiliares do NirSoft Wireless Network Watcher.
5. Verifica interfaces HTTP/HTTPS sem fazer login ou clicar na pagina.
6. Confirma exposicao Telnet sem tentar autenticar.
7. Junta resultados repetidos e infere o tipo provavel do equipamento.
8. Exibe o inventario, a topologia inferida, os diagnosticos e os relatorios.

As atualizacoes aparecem em tempo real no navegador. O ultimo inventario e guardado localmente no navegador para nao desaparecer ao atualizar a pagina.

### O que os resultados significam

- **Porta aberta:** um servico respondeu pela rede. Isso nao comprova vulnerabilidade.
- **Tipo inferido:** o sistema encontrou sinais de que o equipamento pode ser uma impressora, servidor, computador, camera ou equipamento de rede. Quando nao ha evidencia suficiente, ele mostra tipo desconhecido.
- **Prioridade de revisao:** indica a ordem sugerida para validacao humana. Nao e prova de invasao ou falha.
- **Sub-rede/VLAN inferida:** representa o segmento IP observado. Uma VLAN real so pode ser confirmada com dados do equipamento de rede, por exemplo SNMP ou CLI autorizada.

## O que precisa ser instalado

O projeto foi desenvolvido principalmente para Windows.

### Obrigatorio

| Item | Para que serve | Instalacao |
| --- | --- | --- |
| Node.js 22 ou superior | Executa o servidor e a interface | Baixe em <https://nodejs.org/en/download> |
| npm | Instala as bibliotecas JavaScript | Ja acompanha o Node.js |

Sem nenhuma ferramenta adicional, o RuneScan ainda consegue usar ping, ARP, DNS e testes TCP nativos.

### Recomendado

| Ferramenta | Para que serve | Onde obter |
| --- | --- | --- |
| Nmap | Descoberta mais completa e identificacao de portas/servicos | <https://nmap.org/download> |
| Wireshark com TShark | Diagnostico passivo de trafego | <https://www.wireshark.org/download.html> |
| Ollama | Gera pareceres locais por IA sem enviar o inventario para um servico externo | <https://ollama.com/download/windows> |

No instalador do Wireshark, mantenha o componente **TShark** selecionado. Capturas de rede podem exigir que o RuneScan seja executado com permissao de administrador.

### Utilitarios NirSoft

O projeto reconhece estes executaveis:

- `WNetWatcher.exe`: descoberta auxiliar de dispositivos e fabricantes.
- `DNSDataView.exe`: consultas DNS auxiliares.
- `PingInfoView.exe`: diagnosticos ICMP e TCP.

Nesta copia do projeto eles devem estar em:

```text
tools/nirsoft/
├── WNetWatcher.exe
├── DNSDataView.exe
└── PingInfoView.exe
```

Se os arquivos nao estiverem presentes, obtenha-os nas paginas oficiais:

- <https://www.nirsoft.net/utils/wireless_network_watcher.html>
- <https://www.nirsoft.net/utils/dns_records_viewer.html>
- <https://www.nirsoft.net/utils/multiple_ping_tool.html>

Os utilitarios NirSoft sao opcionais. O Windows Defender ou outro antivirus pode alertar sobre ferramentas de rede; use somente arquivos baixados da fonte oficial e valide as politicas da sua empresa.

## Instalacao passo a passo

Abra o PowerShell na pasta do projeto.

### 1. Conferir o Node.js

```powershell
node --version
npm --version
```

O Node deve mostrar a versao 22 ou superior.

### 2. Instalar as dependencias do projeto

```powershell
npm install
```

### 3. Criar o arquivo de configuracao

```powershell
Copy-Item .env.example .env
```

O projeto ja possui valores padrao adequados para uso local. Edite o `.env` somente se precisar mudar porta, modelo ou comportamento.

### 4. Preparar o Ollama, se desejar usar IA

Com o Ollama instalado e aberto:

```powershell
ollama pull qwen2.5:3b
ollama list
```

O restante do RuneScan funciona mesmo sem Ollama; apenas os botoes de parecer por IA ficarao indisponiveis.

### 5. Iniciar o projeto

Modo de desenvolvimento:

```powershell
npm run dev
```

Depois abra:

```text
http://127.0.0.1:3005
```

Se a porta estiver ocupada, o servidor tenta as portas seguintes e informa o endereco correto no terminal.

### Acessar de outro computador da rede

Por seguranca, o RuneScan aceita somente conexoes do proprio computador por padrao. Para liberar o painel na rede local, edite o `.env`:

```env
ALLOW_LAN_ACCESS=true
API_TOKEN="use-aqui-um-token-com-pelo-menos-24-caracteres"
```

Reinicie o servidor e abra `http://IP-DO-COMPUTADOR:3005` na outra maquina. O RuneScan mostrara uma tela de entrada. A sessao fica valida por ate oito horas; o token nao e gravado no armazenamento do navegador.

Nao reutilize senha pessoal nesse campo e nao exponha a porta diretamente na internet.

## Como usar

### Informar o alvo

Exemplos aceitos:

```text
192.168.1.0/24
10.1.1.10
10.1.1.1-254
192.168.1.0/24, 192.168.2.0/24
```

Para a primeira varredura, prefira uma rede `/24`. Redes maiores levam mais tempo e geram mais trafego.

### Escolher os coletores

- **Nmap:** melhora a descoberta e identifica servicos.
- **NirSoft:** adiciona uma fonte auxiliar para a rede local.
- **Web:** identifica interfaces HTTP/HTTPS sem autenticar.
- **Insights:** mostra ou oculta graficos e topologia.

Clique em **Varrer rede** e acompanhe as etapas no indicador de progresso.

### Abrir um equipamento

Selecione um dispositivo no inventario para ver:

- IP, MAC, fabricante e tipo provavel.
- Portas e servicos encontrados.
- Evidencias usadas na identificacao.
- Acoes para HTTP, HTTPS, RDP, SSH ou Telnet quando aplicaveis.
- Diagnosticos DNS, ping/TCP, Windows, web e captura passiva.
- Parecer local do Ollama, quando disponivel.

## IPs candidatos a livres

Apos concluir uma varredura, use o botao com o icone de pesquisa de arquivo para abrir **IPs candidatos a livres**.

O painel:

- Separa os enderecos por sub-rede.
- Exclui o endereco da rede e o broadcast.
- Exclui todos os IPs presentes no inventario.
- Permite copiar a lista de candidatos.

> Um IP que nao respondeu nao esta necessariamente livre. O equipamento pode estar desligado, com firewall ou fora do alcance dos testes. Antes de configurar um IP fixo, confira a faixa dinamica e as reservas do servidor DHCP e valide novamente o endereco.

## Relatorios

Na area de topologia existem duas exportacoes:

- **JSON:** preserva os dados completos para auditoria, integracao ou analise tecnica.
- **HTML:** gera uma versao direta para leitura humana, com icone/tipo, IP, portas, prioridade e acao recomendada sem repetir o equipamento em varias secoes.

O relatorio e gerado no navegador e salvo na pasta de downloads do usuario.

## Configuracao do `.env`

| Variavel | Padrao | Descricao |
| --- | --- | --- |
| `PORT` | `3005` | Porta inicial do servidor web |
| `ALLOW_LAN_ACCESS` | `false` | Quando `true`, permite acesso de outras maquinas da rede |
| `API_TOKEN` | vazio | Token com pelo menos 24 caracteres, obrigatorio quando o acesso pela rede esta ativo |
| `OLLAMA_URL` | `http://localhost:11434` | Endereco local do Ollama |
| `OLLAMA_MODEL` | `qwen2.5:3b` | Modelo usado nos pareceres |
| `OLLAMA_NUM_CTX` | `2048` | Tamanho do contexto do modelo |
| `OLLAMA_NUM_THREAD` | `4` | Threads usadas pelo Ollama |
| `OLLAMA_KEEP_ALIVE` | `0s` | Tempo que o modelo permanece carregado apos responder |
| `DISABLE_LIVE_SCAN` | `false` | Quando `true`, bloqueia varreduras reais pelo servidor |
| `MAX_SCAN_ADDRESSES` | `4096` | Quantidade maxima de enderecos por varredura |
| `MAX_SCAN_TARGETS` | `16` | Quantidade maxima de blocos separados por virgula/espaco |
| `MAX_CAPTURE_SECONDS` | `20` | Duracao maxima da captura passiva |
| `APP_URL` | `MY_APP_URL` | URL publica opcional |

O limite padrao de 4096 enderecos permite ate uma rede `/20`. Para um `/16`, divida a execucao em blocos menores ou aumente `MAX_SCAN_ADDRESSES` somente depois de avaliar o impacto na rede.

## Como confirmar se as ferramentas foram reconhecidas

Use estes comandos no PowerShell:

```powershell
nmap --version
tshark --version
ollama --version
```

Dentro do RuneScan, abra o painel de ferramentas. Ele informa quais componentes foram encontrados e quais ficaram indisponiveis.

O sistema tambem procura automaticamente:

```text
C:\Program Files\Nmap\nmap.exe
C:\Program Files\Wireshark\tshark.exe
tools\nirsoft\WNetWatcher.exe
tools\nirsoft\DNSDataView.exe
tools\nirsoft\PingInfoView.exe
```

## Problemas comuns

### Nenhum dispositivo apareceu

- Confirme se o computador esta conectado a rede correta.
- Verifique o alvo informado.
- Tente executar o PowerShell como administrador.
- Confira se o firewall permite ICMP, ARP ou as portas testadas.
- Ative o Nmap para melhorar a descoberta.

### Nmap ou TShark aparece como indisponivel

- Feche e abra novamente o PowerShell apos instalar.
- Teste `nmap --version` ou `tshark --version`.
- Confirme se a ferramenta foi instalada no caminho padrao.

### NirSoft nao retorna dados

- Confirme os executaveis em `tools/nirsoft`.
- Abra o WNetWatcher manualmente e pressione `F9` para escolher o adaptador e o intervalo corretos.
- Feche o WNetWatcher antes de iniciar outra varredura pelo RuneScan.

### O parecer por IA falhou

```powershell
ollama list
ollama serve
```

Confirme tambem se `OLLAMA_MODEL` no `.env` corresponde a um modelo instalado.

### O navegador mostra resultado antigo

Use o botao de lixeira para limpar o inventario salvo localmente e execute uma nova varredura.

## Validacao e build

Verificar o TypeScript:

```powershell
npm run lint
```

Gerar a versao de producao:

```powershell
npm run build
```

Iniciar a versao gerada:

```powershell
npm start
```

Os arquivos gerados ficam em `dist/`.

## Limitacoes atuais

- O foco atual e IPv4 e Windows.
- Um host pode estar ativo mesmo sem responder aos testes.
- Fabricante e tipo do equipamento podem ficar desconhecidos.
- A topologia exibida e inferida e nao representa necessariamente o cabeamento fisico.
- VLANs reais ainda nao sao confirmadas por SNMP ou CLI.
- SNMP e SSH aparecem como integracoes planejadas, mas ainda nao estao implementados.
- O nivel de prioridade e uma regra de triagem, nao uma avaliacao completa de vulnerabilidades.

## Seguranca

O servidor escuta em `127.0.0.1` por padrao e nao aceita conexoes de outras maquinas. O acesso pela rede precisa ser ativado explicitamente com `ALLOW_LAN_ACCESS=true`; nesse modo, um `API_TOKEN` forte e obrigatorio e todas as APIs ficam protegidas por uma sessao HTTP-only temporaria.

Nao publique o RuneScan diretamente na internet. Para uso compartilhado ou corporativo, mantenha tambem o firewall restrito a rede autorizada. Limite de requisicoes sera tratado em uma etapa posterior.
