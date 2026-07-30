import express from "express";
import type { Express, Request } from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { Ollama } from "ollama";
import dotenv from "dotenv";
import {
  buildRdpProfile,
  discoverPools,
  getDefaultCidr,
  getDefaultScope,
  getLocalNetworkContext,
  getToolCapabilities,
  runDnsLookup,
  runPassiveCapture,
  runPingDiagnostics,
  runWebFingerprint,
  runWindowsDiagnostics,
  scanNetwork,
} from "./src/server/discovery";
import { getScanPolicy, isAbortError, validateCaptureDuration, validateScanTarget } from "./src/server/scan-policy";
import { ScanBusyError, ScanManager, type ManagedScan } from "./src/server/scan-manager";
import { AccessController, getAccessPolicy } from "./src/server/access-policy";
import { ScanAuditLogger } from "./src/server/audit-log";
import { createRateLimitMiddleware, FixedWindowRateLimiter, getRequestLimitPolicy } from "./src/server/rate-limit";

dotenv.config();

const ollama = new Ollama({ host: process.env.OLLAMA_URL || "http://localhost:11434" });
const ollamaModel = process.env.OLLAMA_MODEL || "qwen2.5:3b";
const ollamaOptions = {
  num_ctx: Number(process.env.OLLAMA_NUM_CTX || 2048),
  num_thread: Number(process.env.OLLAMA_NUM_THREAD || 4),
  temperature: 0.2,
};
const ollamaKeepAlive = process.env.OLLAMA_KEEP_ALIVE || "0s";

const scanManager = new ScanManager();

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  const accessPolicy = getAccessPolicy();
  const accessController = new AccessController(accessPolicy);
  const requestLimits = getRequestLimitPolicy();
  const generalRateLimit = createRateLimitMiddleware(
    new FixedWindowRateLimiter(requestLimits.general),
    "API",
    (requestPath) => requestPath === "/scan/cancel",
  );
  const authRateLimit = createRateLimitMiddleware(new FixedWindowRateLimiter(requestLimits.auth), "autenticacao");
  const heavyRateLimit = createRateLimitMiddleware(new FixedWindowRateLimiter(requestLimits.heavy), "operacoes pesadas");
  const auditLogger = new ScanAuditLogger();

  app.use(express.json({ limit: "256kb" }));
  app.use("/api", generalRateLimit);

  app.get("/api/access", (req, res) => {
    res.json({
      lanEnabled: accessPolicy.lanEnabled,
      authRequired: accessPolicy.authRequired,
      authenticated: accessController.isAuthorized(req.headers.cookie),
    });
  });

  app.post("/api/auth", authRateLimit, (req, res) => {
    const sessionId = accessController.createSession(req.body?.token);
    if (!sessionId) {
      res.status(401).json({ error: "Token invalido." });
      return;
    }
    if (accessPolicy.authRequired) {
      res.setHeader("Set-Cookie", accessController.buildSessionCookie(sessionId));
    }
    res.json({ authenticated: true });
  });

  app.use("/api", (req, res, next) => {
    if (accessController.isAuthorized(req.headers.cookie)) {
      next();
      return;
    }
    res.status(401).json({ error: "Autenticacao necessaria para acessar o RuneScan pela rede." });
  });

  app.get("/api/config", async (_req, res) => {
    res.json({
      defaultCidr: getDefaultCidr(),
      defaultScope: getDefaultScope(),
      liveScanEnabled: process.env.DISABLE_LIVE_SCAN !== "true",
      tools: await getToolCapabilities(),
      localContext: await getLocalNetworkContext(),
      scanPolicy: getScanPolicy(),
      requestLimits,
      activeScan: scanManager.snapshot(),
    });
  });

  app.get("/api/tools", async (_req, res) => {
    res.json({
      tools: await getToolCapabilities(),
      localContext: await getLocalNetworkContext(),
    });
  });

  app.get("/api/diagnostics/dns", async (req, res) => {
    try {
      const target = String(req.query.target || "");
      if (!target) {
        res.status(400).json({ error: "Informe target." });
        return;
      }
      res.json(await runDnsLookup(target));
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Falha no diagnostico DNS." });
    }
  });

  app.get("/api/diagnostics/ping", async (req, res) => {
    try {
      const target = String(req.query.target || "");
      if (!target) {
        res.status(400).json({ error: "Informe target." });
        return;
      }
      const ports = String(req.query.ports || "")
        .split(",")
        .map((port) => Number(port.trim()))
        .filter((port) => Number.isFinite(port) && port > 0 && port <= 65535);
      res.json(await runPingDiagnostics(target, ports));
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Falha no diagnostico de ping." });
    }
  });

  app.get("/api/diagnostics/windows", async (req, res) => {
    try {
      const target = String(req.query.target || "");
      if (!target) {
        res.status(400).json({ error: "Informe target." });
        return;
      }
      const ports = String(req.query.ports || "")
        .split(",")
        .map((port) => Number(port.trim()))
        .filter((port) => Number.isFinite(port) && port > 0 && port <= 65535);
      res.json(await runWindowsDiagnostics(target, ports));
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Falha no diagnostico Windows." });
    }
  });

  app.get("/api/diagnostics/passive", heavyRateLimit, async (req, res) => {
    try {
      const target = String(req.query.target || "");
      if (!target) {
        res.status(400).json({ error: "Informe target." });
        return;
      }
      const seconds = validateCaptureDuration(req.query.seconds || 10);
      res.json(await runPassiveCapture(target, seconds));
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Falha na captura passiva." });
    }
  });

  app.get("/api/diagnostics/web", async (req, res) => {
    try {
      const target = String(req.query.target || "");
      if (!target) {
        res.status(400).json({ error: "Informe target." });
        return;
      }
      const ports = String(req.query.ports || "")
        .split(",")
        .map((port) => Number(port.trim()))
        .filter((port) => Number.isFinite(port) && port > 0 && port <= 65535);
      res.json(await runWebFingerprint(target, ports));
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Falha no fingerprint web." });
    }
  });

  app.get("/api/diagnostics/pools", async (req, res) => {
    try {
      const target = String(req.query.target || getDefaultScope());
      res.json(await discoverPools(target));
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Falha ao descobrir pools." });
    }
  });

  app.get("/api/rdp", (req, res) => {
    const target = String(req.query.target || "");
    const name = String(req.query.name || target || "host").replace(/[^a-z0-9_.-]+/gi, "_");
    if (!target) {
      res.status(400).send("Informe target.");
      return;
    }

    res.setHeader("Content-Type", "application/x-rdp");
    res.setHeader("Content-Disposition", `attachment; filename="${name}.rdp"`);
    res.send(buildRdpProfile(target));
  });

  app.get("/api/scan", heavyRateLimit, async (req, res) => {
    if (process.env.DISABLE_LIVE_SCAN === "true") {
      res.status(403).json({ error: "Varredura live desativada por DISABLE_LIVE_SCAN=true." });
      return;
    }

    const target = String(req.query.target || getDefaultCidr());
    try {
      validateScanTarget(target);
      const scan = scanManager.begin(target);
      const auditStartedAt = Date.now();
      const requester = getRequester(req);
      void auditLogger.write({ event: "started", scanId: scan.id, target, transport: "json", ...requester });
      res.on("close", () => {
        if (!res.writableEnded) scan.controller.abort();
      });
      const useNmap = String(req.query.useNmap || "true") === "true";
      const useNirsoft = String(req.query.useNirsoft || "true") === "true";
      const useWebFingerprint = String(req.query.useWebFingerprint || "true") === "true";
      try {
        const result = await scanNetwork({ target, useNmap, useNirsoft, useWebFingerprint, signal: scan.controller.signal });
        void auditLogger.write({
          event: "completed",
          scanId: scan.id,
          target,
          transport: "json",
          durationMs: Date.now() - auditStartedAt,
          ...requester,
        });
        res.json(result);
      } catch (error) {
        void auditLogger.write({
          event: isAbortError(error) ? "cancelled" : "failed",
          scanId: scan.id,
          target,
          transport: "json",
          durationMs: Date.now() - auditStartedAt,
          message: error instanceof Error ? error.message : "Falha desconhecida.",
          ...requester,
        });
        throw error;
      } finally {
        scanManager.finish(scan.id);
      }
    } catch (error) {
      if (isAbortError(error)) {
        if (!res.headersSent) res.status(499).json({ error: "Varredura cancelada." });
        return;
      }
      const busy = error instanceof ScanBusyError;
      res.status(busy ? 409 : 400).json({
        error: error instanceof Error ? error.message : "Falha ao executar varredura.",
      });
    }
  });

  app.post("/api/scan/cancel", (req, res) => {
    const active = scanManager.current();
    if (!active || active.controller.signal.aborted) {
      res.status(404).json({ error: "Nenhuma varredura ativa para cancelar." });
      return;
    }
    const cancelled = scanManager.cancel();
    if (cancelled) {
      void auditLogger.write({
        event: "cancel_requested",
        scanId: cancelled.id,
        target: cancelled.target,
        transport: "control",
        ...getRequester(req),
      });
    }
    res.status(202).json({ message: "Cancelamento solicitado.", scan: cancelled });
  });

  app.get("/api/scan/stream", heavyRateLimit, async (req, res) => {
    if (process.env.DISABLE_LIVE_SCAN === "true") {
      res.status(403).json({ error: "Varredura live desativada por DISABLE_LIVE_SCAN=true." });
      return;
    }

    const target = String(req.query.target || getDefaultCidr());
    let scan: ManagedScan;
    try {
      validateScanTarget(target);
      scan = scanManager.begin(target);
    } catch (error) {
      const busy = error instanceof ScanBusyError;
      res.status(busy ? 409 : 400).json({ error: error instanceof Error ? error.message : "Alvo invalido." });
      return;
    }
    const auditStartedAt = Date.now();
    const requester = getRequester(req);
    void auditLogger.write({ event: "started", scanId: scan.id, target, transport: "stream", ...requester });

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const send = (event: string, data: unknown) => {
      if (res.destroyed || res.writableEnded) return;
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const heartbeat = setInterval(() => {
      send("heartbeat", { timestamp: new Date().toISOString() });
    }, 15000);

    res.on("close", () => {
      clearInterval(heartbeat);
      if (!res.writableEnded) scan.controller.abort();
    });

    try {
      const useNmap = String(req.query.useNmap || "true") === "true";
      const useNirsoft = String(req.query.useNirsoft || "true") === "true";
      const useWebFingerprint = String(req.query.useWebFingerprint || "true") === "true";
      send("progress", { type: "stage", stage: "queued", message: "Varredura recebida pelo servidor.", timestamp: new Date().toISOString(), scanId: scan.id });
      const result = await scanNetwork({
        target,
        useNmap,
        useNirsoft,
        useWebFingerprint,
        signal: scan.controller.signal,
        onProgress: (event) => send("progress", event),
      });
      void auditLogger.write({
        event: "completed",
        scanId: scan.id,
        target,
        transport: "stream",
        durationMs: Date.now() - auditStartedAt,
        ...requester,
      });
      send("done", result);
    } catch (error) {
      void auditLogger.write({
        event: isAbortError(error) ? "cancelled" : "failed",
        scanId: scan.id,
        target,
        transport: "stream",
        durationMs: Date.now() - auditStartedAt,
        message: error instanceof Error ? error.message : "Falha desconhecida.",
        ...requester,
      });
      send(isAbortError(error) ? "cancelled" : "error", {
        message: isAbortError(error) ? "Varredura cancelada." : error instanceof Error ? error.message : "Falha ao executar varredura.",
        timestamp: new Date().toISOString(),
      });
    } finally {
      clearInterval(heartbeat);
      scanManager.finish(scan.id);
      res.end();
    }
  });

  app.post("/api/ai/analyze-device", heavyRateLimit, async (req, res) => {
    const { device } = req.body;
    try {
      const response = await ollama.generate({
        model: ollamaModel,
        prompt: `Voce e um analista de rede. Faca um parecer APENAS do host selecionado usando exclusivamente os dados JSON fornecidos. Nao invente fabricante, sistema, funcao, vulnerabilidade, credencial, CVE ou topologia que nao esteja nos dados. Porta aberta isolada e evidencia de exposicao, nao prova de vulnerabilidade. Nao recomende bloqueio sem antes sugerir a validacao do servico e de sua necessidade. Se algo for desconhecido, diga "nao confirmado". Responda em Portugues do Brasil, em ate 5 bullets curtos, com: identificacao observada, evidencias, riscos observados e proximos testes manuais sugeridos. Dados: ${JSON.stringify(device)}`,
        options: { ...ollamaOptions, num_predict: 320 },
        keep_alive: ollamaKeepAlive,
      });
      res.json({ analysis: response.response });
    } catch (error) {
      console.error("Ollama Error:", error);
      res.status(500).json({ error: "Erro na analise local. Confira se o Ollama esta rodando e se o modelo existe." });
    }
  });

  app.post("/api/ai/analyze-network", heavyRateLimit, async (req, res) => {
    const { result } = req.body;
    try {
      const compact = {
        target: result?.target,
        summary: result?.summary,
        vlans: result?.vlans,
        highRiskDevices: (result?.devices || [])
          .filter((device: { riskLevel?: string; status?: string }) => device.riskLevel === "high" && device.status === "online")
          .slice(0, 15)
          .map((device: { ip: string; name: string; type: string; openPorts?: number[]; evidence?: string[] }) => ({
            ip: device.ip,
            name: device.name,
            type: device.type,
            openPorts: device.openPorts,
            evidence: (device.evidence || []).slice(0, 4).map((item) => item.slice(0, 300)),
          })),
        collectors: result?.collectors,
      };
      const response = await ollama.generate({
        model: ollamaModel,
        prompt: `Voce e um analista de rede. Faca um parecer GERAL usando exclusivamente este resumo JSON. Nao invente VLAN confirmada, fabricante, exploracao, CVE ou topologia fisica sem evidencia. Porta aberta isolada e evidencia de exposicao, nao prova de vulnerabilidade. Nao recomende bloqueio sem antes sugerir a validacao do servico e de sua necessidade. Se algo for inferido, chame de inferido. Responda em Portugues do Brasil, objetivo, com no maximo 8 bullets: escopo, pools/sub-redes observados, riscos principais, lacunas de descoberta e proximos passos tecnicos. Dados: ${JSON.stringify(compact)}`,
        options: { ...ollamaOptions, num_predict: 500 },
        keep_alive: ollamaKeepAlive,
      });
      res.json({ analysis: response.response });
    } catch (error) {
      console.error("Ollama Error:", error);
      res.status(500).json({ error: "Erro na analise geral. Confira se o Ollama esta rodando e se o modelo existe." });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        watch: {
          ignored: [
            "**/WNetWatcher.cfg",
            "**/WNetWatcher*.cfg",
            "**/wnetwatcher-*.csv",
            "**/scan-*.json",
            "**/*.log",
          ],
        },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  await listenWithFallback(app, PORT, accessPolicy.host);
}

startServer();

function listenWithFallback(
  app: Express,
  preferredPort: number,
  host: "127.0.0.1" | "0.0.0.0",
  attempts = 10,
) {
  return new Promise<void>((resolve, reject) => {
    const tryPort = (port: number, remaining: number) => {
      const server = app.listen(port, host, () => {
        const displayHost = host === "127.0.0.1" ? "localhost" : host;
        console.log(`RuneScan Network running at http://${displayHost}:${port}`);
        if (host === "0.0.0.0") {
          console.log("Acesso pela rede ativado; autenticacao por token obrigatoria.");
        }
        if (port !== preferredPort) {
          console.log(`Porta ${preferredPort} ja estava em uso; usando ${port}.`);
        }
        resolve();
      });

      server.once("error", (error: NodeJS.ErrnoException) => {
        server.close();
        if (error.code === "EADDRINUSE" && remaining > 0) {
          console.warn(`Porta ${port} em uso, tentando ${port + 1}...`);
          tryPort(port + 1, remaining - 1);
          return;
        }
        reject(error);
      });
    };

    tryPort(preferredPort, attempts);
  });
}

function getRequester(req: Request) {
  return {
    sourceIp: req.ip || req.socket.remoteAddress || "unknown",
    userAgent: req.get("user-agent"),
  };
}
