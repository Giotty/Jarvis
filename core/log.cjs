const fs=require('node:fs');const path=require('node:path');
class Audit{
 constructor(dir){this.file=path.join(dir,'logs','audit.log');this.items=[];fs.mkdirSync(path.dirname(this.file),{recursive:true})}
 write(event,details={}){
  // Deliberately omit commands, text, clipboard, file names, and model content.
  const entry={time:new Date().toISOString(),event,tool:details.tool,risk:details.risk,status:details.status};
  this.items.unshift(entry);this.items=this.items.slice(0,300);
  if(fs.existsSync(this.file)&&fs.statSync(this.file).size>1024*1024){const old=this.file+'.1';if(fs.existsSync(old))fs.unlinkSync(old);fs.renameSync(this.file,old)}
  fs.appendFileSync(this.file,JSON.stringify(entry)+'\n');return entry;
 }
}
module.exports={Audit};
