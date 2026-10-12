import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
const root=resolve(process.argv[2]||'.');
const types={'.html':'text/html','.css':'text/css','.js':'application/javascript'};
createServer(async(req,res)=>{try{let url=decodeURIComponent(new URL(req.url,'http://localhost').pathname);let file=resolve(root,'.'+(url==='/'?'/index.html':url));if(!file.startsWith(root+sep)){res.writeHead(403);res.end();return}const bytes=await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream'});res.end(bytes)}catch{res.writeHead(404);res.end('Not found')}}).listen(Number(process.env.PORT||5173),'127.0.0.1',()=>console.log('Boo Studio: http://localhost:'+ (process.env.PORT||5173)));
