import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const mime = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
]);

createServer((request, response) => {
  const requested = request.url === "/" ? "/index.html" : request.url;
  const relative = normalize(decodeURIComponent(requested.split("?")[0])).replace(/^[/\\]+/, "");
  const path = join(root, relative);

  if (!path.startsWith(root) || !existsSync(path) || !statSync(path).isFile()) {
    response.writeHead(404).end("Not found");
    return;
  }

  response.writeHead(200, { "content-type": mime.get(extname(path)) ?? "application/octet-stream" });
  createReadStream(path).pipe(response);
}).listen(8080, "127.0.0.1", () => {
  console.log("Sinclair QL Emulator: http://localhost:8080");
});

