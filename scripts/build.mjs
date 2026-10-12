import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist', {recursive:true});
for (const file of ['index.html','style.css','main.js','builder.js']) await copyFile(file, `dist/${file}`);
console.log('Built Boo Studio to dist/');
