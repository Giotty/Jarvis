const {spawn} = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const vite = spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js')],{cwd:root,stdio:'inherit'});
let desktop;
async function start(){
 for(let i=0;i<60;i++){
  try{const r=await fetch('http://127.0.0.1:5173'); if(r.ok){desktop=spawn(require('electron'),['.'],{cwd:root,stdio:'inherit',env:{...process.env,JARVIS_DEV:'1'}});desktop.on('exit',()=>{vite.kill();process.exit()});return}}catch{}
  await new Promise(r=>setTimeout(r,500));
 } vite.kill();process.exit(1);
}
process.on('SIGINT',()=>{desktop?.kill();vite.kill();process.exit()});start();
