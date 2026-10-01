const crypto=require('node:crypto');
class Safety{
 constructor(){this.pending=new Map();this.stopped=false}
 require(action,risk,context){const id=crypto.randomUUID();const request={id,action:structuredClone(action),risk,context,expires:Date.now()+60000};this.pending.set(id,request);return request}
 consume(id,approved){const p=this.pending.get(id);this.pending.delete(id);if(!p||p.expires<Date.now()||!approved||this.stopped)throw Error('Confirmation denied, expired, or stopped.');return p.action}
 stop(){this.stopped=true;this.pending.clear()}
 resume(){this.stopped=false}
}
module.exports={Safety};
