const { app, BrowserWindow, dialog } = require("electron");
const { fork } = require("node:child_process");
const path = require("node:path");

let backend;

function resourcePath(...parts) {
  const root = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..");
  return path.join(root, ...parts);
}

function startBackend() {
  const distPath = resourcePath("app-dist");
  const serverPath = path.join(distPath, "server.cjs");
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("O servidor local nao iniciou a tempo.")), 15000);
    backend = fork(serverPath, [], {
      cwd: distPath,
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: "38155",
        RUNESCAN_DIST_PATH: distPath,
        RUNESCAN_TOOLS_DIR: resourcePath("tools", "nirsoft"),
        ELECTRON_RUN_AS_NODE: "1",
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    backend.once("message", (message) => {
      if (message?.type !== "runescan-ready") return;
      clearTimeout(timeout);
      resolve(message.port);
    });
    backend.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    backend.stderr?.on("data", (chunk) => console.error(chunk.toString()));
  });
}

async function createWindow() {
  try {
    const port = await startBackend();
    const window = new BrowserWindow({
      width: 1440,
      height: 920,
      minWidth: 1040,
      minHeight: 700,
      autoHideMenuBar: true,
      title: "RuneScan Network",
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    await window.loadURL(`http://127.0.0.1:${port}`);
  } catch (error) {
    dialog.showErrorBox("RuneScan Network", error instanceof Error ? error.message : "Falha ao iniciar o aplicativo.");
    app.quit();
  }
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => backend?.kill());
