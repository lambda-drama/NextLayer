// proxyOptions.ts
import fs from "fs";
import path from "path";
import { ProxyOptions } from "vite"; // for type-checking Vite proxy options
import { IncomingMessage } from "http";

// Step 1: Read common_site_config.json to get webserver_port
let webserver_port = 8000;
try {
  const configPath = path.resolve(__dirname, "../../../sites/common_site_config.json");
  const common_site_config: { webserver_port?: number } = JSON.parse(
    fs.readFileSync(configPath, "utf-8")
  );
  webserver_port = common_site_config.webserver_port || 8000;
} catch (err) {
  console.warn("⚠️ Could not read common_site_config.json. Falling back to port 8000.");
}

// Step 2: Set up the dynamic proxy
const proxyOptions: Record<string, ProxyOptions> = {
  "^/(app|api|assets|files|private)": {
    target: `http://127.0.0.1:${webserver_port}`,
    changeOrigin: true,
    secure: false,
    ws: true,
    router: (req: IncomingMessage) => {
      const hostHeader = req.headers.host;
      if (!hostHeader) return `http://127.0.0.1:${webserver_port}`;
      const site_name = hostHeader.split(":")[0];
      const dynamicTarget = `http://${site_name}:${webserver_port}`;
      console.log(`[Vite Proxy] ${req.url} → ${dynamicTarget}`);
      return dynamicTarget;
    },
  },
};

export default proxyOptions;
