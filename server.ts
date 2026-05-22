import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { Ollama } from "ollama";
import dotenv from "dotenv";
import { exec } from "child_process";
import fs from "fs";
import { parseStringPromise } from "xml2js";

dotenv.config();

const ollama = new Ollama({ host: process.env.OLLAMA_URL || "http://localhost:11434" });

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3005;

  app.use(express.json());

  // Função para executar scan real via Nmap ou NirSoft
  const runActiveScan = (): Promise<any[]> => {
    return new Promise((resolve) => {
      const tempDir = path.join(process.cwd(), "temp");
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
      
      const tempNmapFile = path.join(tempDir, "scan_nmap.xml");
      
      // Tenta Nmap (Mais profissional)
      // Nota: Em Windows, certifique-se que o nmap está no PATH
      // Vamos tentar scanear a rede local típica ou a que o usuário estiver
      console.log("Tentando Nmap...");
      exec(`nmap -sV --top-ports 20 192.168.1.0/24 10.0.0.0/24 -oX "${tempNmapFile}"`, async (error) => {
        if (!error && fs.existsSync(tempNmapFile)) {
          try {
            console.log("Processando output do Nmap...");
            const xmlData = fs.readFileSync(tempNmapFile, 'utf8');
            const result = await parseStringPromise(xmlData);
            
            if (result.nmaprun && result.nmaprun.host) {
              const devices = result.nmaprun.host.map((host: any, index: number) => {
                const addresses = host.address || [];
                const ip = (addresses.find((a: any) => a.$.addrtype === 'ipv4') || {}).$.addr || "0.0.0.0";
                const mac = (addresses.find((a: any) => a.$.addrtype === 'mac') || {}).$.addr || "";
                const vendor = (addresses.find((a: any) => a.$.addrtype === 'mac') || {}).$.vendor || "Unknown Vendor";
                
                const hostnames = host.hostnames && host.hostnames[0].hostname ? host.hostnames[0].hostname.map((h: any) => h.$.name) : [];
                const name = hostnames[0] || `Host-${ip.split('.').pop()}`;

                const ports = host.ports && host.ports[0].port ? host.ports[0].port.map((p: any) => parseInt(p.$.portid)) : [];
                
                const osMatch = host.os && host.os[0].osmatch ? host.os[0].osmatch[0].$.name : "Desconhecido";

                return {
                  id: `nmap-${index}`,
                  name,
                  ip,
                  mac,
                  vendor,
                  type: guessType(name, vendor),
                  vlan: "VLAN Detectada",
                  status: 'online',
                  details: `Nmap Scan: ${osMatch}`,
                  openPorts: ports,
                  os: osMatch,
                  lastSeen: new Date().toISOString()
                };
              });
              return resolve(devices);
            }
          } catch (e) {
            console.error("Erro no parse do Nmap XML:", e);
          }
        }

        // Fallback: WNetWatcher (que tínhamos antes)
        const wnetPath = path.join(process.cwd(), "wnetwatcher.exe");
        const tempFile = path.join(tempDir, "scan_result.xml");

        if (fs.existsSync(wnetPath)) {
          console.log("Nmap falhou ou não existe. Tentando WNetWatcher...");
          exec(`"${wnetPath}" /sxml "${tempFile}"`, async (error) => {
            if (error) return resolve([]);
            try {
              const xmlData = fs.readFileSync(tempFile, 'utf8');
              const result = await parseStringPromise(xmlData);
              const devices = result.devices_list.item.map((item: any, index: number) => ({
                id: `wnet-${index}`,
                name: item.device_name[0] || "Desconhecido",
                ip: item.ip_address[0],
                mac: item.mac_address[0],
                vendor: item.adapter_company[0],
                type: guessType(item.device_name[0], item.adapter_company[0]),
                vlan: "VLAN Local (Auto)",
                status: 'online',
                details: item.user_text[0] || "",
                lastSeen: new Date().toISOString()
              }));
              resolve(devices);
            } catch (e) {
              resolve([]);
            }
          });
        } else {
          resolve([]);
        }
      });
    });
  };

  const guessType = (name: string, vendor: string): string => {
    const n = (name || "").toLowerCase();
    const v = (vendor || "").toLowerCase();
    if (n.includes("router") || n.includes("gateway")) return "router";
    if (n.includes("switch")) return "switch";
    if (n.includes("ap") || n.includes("wireless") || v.includes("ubiquiti") || v.includes("tp-link")) return "ap";
    if (n.includes("server") || v.includes("vmware") || v.includes("microsoft")) return "server";
    if (n.includes("pc") || n.includes("ws") || v.includes("dell") || v.includes("hp")) return "workstation";
    if (v.includes("hikvision") || n.includes("cam")) return "camera";
    return "iot";
  };

  // Endpoint de Varredura
  app.get("/api/scan", async (req, res) => {
    try {
      const realDevices = await runActiveScan();
      
      if (realDevices.length === 0) {
        return res.status(404).json({ 
          error: "Nenhum dispositivo encontrado. Verifique se o Nmap está no PATH ou se o WNetWatcher.exe está na pasta do projeto.",
          mode: "LIVE_PROD"
        });
      }

      res.json({
        timestamp: new Date().toISOString(),
        devices: realDevices,
        summary: {
          total: realDevices.length,
          online: realDevices.filter(d => d.status === 'online').length,
          vlans: [...new Set(realDevices.map(d => d.vlan))].length,
          mode: "LIVE_PROD"
        }
      });
    } catch (error) {
      res.status(500).json({ error: "Erro crítico durante a varredura de rede." });
    }
  });

  // Endpoint IA Local (Ollama)
  app.post("/api/ai/analyze-device", async (req, res) => {
    const { device } = req.body;
    try {
      const response = await ollama.generate({
        model: "llama3",
        prompt: `Analise este dispositivo de rede: ${JSON.stringify(device)}. Como administrador de TI, identifique riscos latentes ou melhorias de arquitetura. Responda em Português de forma profissional e direta.`,
      });
      res.json({ analysis: response.response });
    } catch (error) {
      console.error('Ollama Error:', error);
      res.status(500).json({ error: "Ollama offline ou modelo não carregado." });
    }
  });

  // Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`NetScan Real-Time Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
