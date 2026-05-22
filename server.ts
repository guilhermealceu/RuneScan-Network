import express from "express";
import type { Express } from "express";
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

dotenv.config();

const ollama = new Ollama({ host: process.env.OLLAMA_URL || "http://localhost:11434" });

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  app.use(express.json());

  app.get("/api/config", async (_req, res) => {
    res.json({
      defaultCidr: getDefaultCidr(),
      defaultScope: getDefaultScope(),
      liveScanEnabled: process.env.DISABLE_LIVE_SCAN !== "true",
      tools: await getToolCapabilities(),
      localContext: getLocalNetworkContext(),
    });
  });

  app.get("/api/tools", async (_req, res) => {
    res.json({
      tools: await getToolCapabilities(),
      localContext: getLocalNetworkContext(),
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

  app.get("/api/diagnostics/passive", async (req, res) => {
    try {
      const target = String(req.query.target || "");
      if (!target) {
        res.status(400).json({ error: "Informe target." });
        return;
      }
      res.json(await runPassiveCapture(target, Number(req.query.seconds || 10)));
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

  app.get("/api/scan", async (req, res) => {
    if (process.env.DISABLE_LIVE_SCAN === "true") {
      res.status(403).json({ error: "Varredura live desativada por DISABLE_LIVE_SCAN=true." });
      return;
    }

    try {
      const target = String(req.query.target || getDefaultCidr());
      const useNmap = String(req.query.useNmap || "true") === "true";
      const useNirsoft = String(req.query.useNirsoft || "false") === "true";
      const useWebFingerprint = String(req.query.useWebFingerprint || "false") === "true";
      res.json(await scanNetwork({ target, useNmap, useNirsoft, useWebFingerprint }));
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Falha ao executar varredura.",
      });
    }
  });

  app.get("/api/scan/stream", async (req, res) => {
    if (process.env.DISABLE_LIVE_SCAN === "true") {
      res.status(403).json({ error: "Varredura live desativada por DISABLE_LIVE_SCAN=true." });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const heartbeat = setInterval(() => {
      send("heartbeat", { timestamp: new Date().toISOString() });
    }, 15000);

    req.on("close", () => {
      clearInterval(heartbeat);
    });

    try {
      const target = String(req.query.target || getDefaultCidr());
      const useNmap = String(req.query.useNmap || "true") === "true";
      const useNirsoft = String(req.query.useNirsoft || "false") === "true";
      const useWebFingerprint = String(req.query.useWebFingerprint || "false") === "true";
      send("progress", { type: "stage", stage: "queued", message: "Varredura recebida pelo servidor.", timestamp: new Date().toISOString() });
      const result = await scanNetwork({
        target,
        useNmap,
        useNirsoft,
        useWebFingerprint,
        onProgress: (event) => send("progress", event),
      });
      send("done", result);
    } catch (error) {
      send("error", {
        message: error instanceof Error ? error.message : "Falha ao executar varredura.",
        timestamp: new Date().toISOString(),
      });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  });

  app.post("/api/ai/analyze-device", async (req, res) => {
    const { device } = req.body;
    try {
      const response = await ollama.generate({
        model: process.env.OLLAMA_MODEL || "llama3",
        prompt: `Voce e um analista de rede. Faca um parecer APENAS do host selecionado usando exclusivamente os dados JSON fornecidos. Nao invente fabricante, sistema, funcao, vulnerabilidade, credencial, CVE ou topologia que nao esteja nos dados. Se algo for desconhecido, diga "nao confirmado". Responda em Portugues do Brasil, em ate 5 bullets curtos, com: identificacao observada, evidencias, riscos observados e proximos testes manuais sugeridos. Dados: ${JSON.stringify(device)}`,
      });
      res.json({ analysis: response.response });
    } catch (error) {
      console.error("Ollama Error:", error);
      res.status(500).json({ error: "Erro na analise local. Confira se o Ollama esta rodando e se o modelo existe." });
    }
  });

  app.post("/api/ai/analyze-network", async (req, res) => {
    const { result } = req.body;
    try {
      const compact = {
        target: result?.target,
        summary: result?.summary,
        vlans: result?.vlans,
        highRiskDevices: (result?.devices || [])
          .filter((device: { riskLevel?: string; status?: string }) => device.riskLevel === "high" && device.status === "online")
          .slice(0, 25)
          .map((device: { ip: string; name: string; type: string; openPorts?: number[]; evidence?: string[] }) => ({
            ip: device.ip,
            name: device.name,
            type: device.type,
            openPorts: device.openPorts,
            evidence: device.evidence,
          })),
        collectors: result?.collectors,
      };
      const response = await ollama.generate({
        model: process.env.OLLAMA_MODEL || "llama3",
        prompt: `Voce e um analista de rede. Faca um parecer GERAL usando exclusivamente este resumo JSON. Nao invente VLAN confirmada, fabricante, exploracao, CVE ou topologia fisica sem evidencia. Se algo for inferido, chame de inferido. Responda em Portugues do Brasil, objetivo, com no maximo 8 bullets: escopo, pools/sub-redes observados, riscos principais, lacunas de descoberta e proximos passos tecnicos. Dados: ${JSON.stringify(compact)}`,
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

  await listenWithFallback(app, PORT);
}

startServer();

function listenWithFallback(app: Express, preferredPort: number, attempts = 10) {
  return new Promise<void>((resolve, reject) => {
    const tryPort = (port: number, remaining: number) => {
      const server = app.listen(port, "0.0.0.0", () => {
        console.log(`RuneScan Network running at http://0.0.0.0:${port}`);
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
