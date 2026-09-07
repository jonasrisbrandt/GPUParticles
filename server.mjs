import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve(import.meta.dirname);
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json'};
const port = Number(process.env.PORT || 5174);
http.createServer(async (req, res) => {
  try {
    const path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    res.setHeader('Content-Type', types[extname(path)] || (path === root ? types['.html'] : 'application/octet-stream'));
    res.setHeader('Cache-Control', 'no-cache');
    res.end(await readFile(path === root ? resolve(root, 'index.html') : path));
  } catch { res.writeHead(404).end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`AETHER → http://127.0.0.1:${port}`));
