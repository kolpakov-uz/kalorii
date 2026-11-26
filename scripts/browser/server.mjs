import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url)),types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.webmanifest':'application/manifest+json'};
http.createServer(async(req,res)=>{
 try{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname),parts=name.split('/').filter(Boolean);
  if(parts.some(p=>p.startsWith('.'))||parts[0]==='worker'||parts[0]==='node_modules'||parts[0]==='scripts')throw Error('private');
  const file=path.resolve(root,'.'+(name==='/'?'/index.html':name)),type=types[path.extname(file)];
  if(!file.startsWith(root)||!type)throw Error('path');
  res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(await fs.readFile(file));
 }catch{res.writeHead(404);res.end('Not found')}
}).listen(4179,'127.0.0.1');
