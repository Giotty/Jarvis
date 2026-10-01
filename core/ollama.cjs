class Ollama{
 constructor(config){this.config=config}
 async request(route,body){const r=await fetch(this.config().ollamaUrl+route,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(body?120000:5000)});if(!r.ok)throw Error(`Ollama returned ${r.status}. Check model availability.`);return r.json()}
 async models(){try{return {online:true,models:(await this.request('/api/tags')).models.map(m=>m.name)}}catch{return {online:false,models:[]}}}
 async chat(messages,tools,vision=false){const c=this.config();const model=vision?c.visionModel:c.model;if(!model)throw Error(`Select a ${vision?'vision':'chat'} model in Settings.`);return (await this.request('/api/chat',{model,messages,tools,stream:false,options:{temperature:c.temperature,num_ctx:c.context}})).message}
}
module.exports={Ollama};
