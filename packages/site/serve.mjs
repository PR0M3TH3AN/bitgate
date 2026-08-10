#!/usr/bin/env node
/** Serve the built site locally for review. */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "dist");
const port = Number(process.env.PORT ?? 4174);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  let path = normalize(decodeURIComponent(url.pathname));
  if (path.endsWith("/")) path += "index.html";

  try {
    const body = await readFile(join(root, path));
    response.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("Not found");
  }
}).listen(port, () => console.log(`BitGate site → http://localhost:${port}`));
