import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(process.argv[2]||'.');
const files={'/':['index.html','text/html'],'/index.html':['index.html','text/html'],'/style.css':['style.css','text/css'],'/main.js':['main.js','application/javascript']};
createServer(async(req,res)=>{try{
 const path=new URL(req.url,'http://localhost').pathname;
 if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return}
 if(path==='/api/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({service:'boo-studio-ui',integration:false}));return}
 const file=files[path];if(!file){res.writeHead(404);res.end('Not found');return}
 const bytes=await readFile(resolve(root,file[0]));res.writeHead(200,{'Content-Type':file[1],'Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:bytes);
}catch{res.writeHead(404);res.end('Not found')}}).listen(Number(process.env.PORT||5173),process.env.HOST||'127.0.0.1',()=>console.log('Boo Studio UI server ready'));
