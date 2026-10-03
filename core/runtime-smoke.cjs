const fs = require('node:fs');
const path = require('node:path');
async function smoke(win, directory, host) {
  // Smoke mode uses isolated user data. Never overwrite real account credentials.
  const checks = await win.webContents.executeJavaScript(`(async () => {
    const api = window.jarvis, plugins = await api.plugins(), snapshot = await api.snapshot();
    return { plugins: plugins.ok && plugins.data.length >= 10,
      schemas: plugins.ok && plugins.data.every(p => p.tools.every(t => t.inputSchema)),
      finiteBridge: !!api && typeof require === 'undefined',
      workspaceBridge: typeof api.workspaceControl === 'function' && typeof api.workspaceComplete === 'function' && typeof api.workspaceGesture === 'function' && typeof api.openResearchFolder === 'function',
      researchLibrary: (await api.researchLibrary()).ok,
      snapshot: snapshot.ok, reactor: !!document.querySelector('.reactor'),
      branding: document.body.innerText.includes('MAATOUK INDUSTRIES'),
      noScroll: document.documentElement.scrollHeight === innerHeight && document.documentElement.scrollWidth === innerWidth };
  })()`);
  for (const [name, valid] of Object.entries(checks))
    if (!valid) throw Error('Runtime smoke failed: ' + name);
  const click = async (selector) => {
    await win.webContents.executeJavaScript(
      `(() => {const button = document.querySelector(${JSON.stringify(selector)}); if (!button) throw Error('Missing HUD control'); button.click();})()`,
    );
    await new Promise((resolve) => setTimeout(resolve, 600));
  };
  await click('button[aria-label="Open radial settings"]');
  await click('.orbit-node');
  const providerUI = await win.webContents.executeJavaScript(
    `({primary:document.body.innerText.includes('Primary brain'),gemini:[...document.querySelectorAll('.control-deck option')].some(e => e.value === 'gemini')})`,
  );
  if (!providerUI.primary || !providerUI.gemini) throw Error('Provider controls unavailable');
  fs.writeFileSync(
    path.join(directory, 'providers.png'),
    (await win.webContents.capturePage()).toPNG(),
  );
  fs.writeFileSync(
    path.join(directory, 'agent-checks.json'),
    JSON.stringify({ ...checks, providerUI }, null, 2),
  );
  if (host) {
    if (process.argv.includes('--smoke-greeting')) {
      const greeting = await win.webContents.executeJavaScript(`(async()=>{
        const api=window.jarvis,replies=[];const unsubscribe=api.on(e=>{if(e.type==='reply')replies.push(e.data)});
        try {await api.command('Hey Jarvis');await api.command('Hello again, how are you?');}
        finally{unsubscribe()}
        return {replies};
      })()`);
      if (
        host.agent.active?.status !== 'completed' ||
        greeting.replies.length !== 2 ||
        greeting.replies.some((text) => /unavailable|too long|try again/i.test(text))
      )
        throw Error('Packaged greeting check failed');
      const voice = await win.webContents.executeJavaScript(`(async()=>{
        const api=window.jarvis, c=(await api.snapshot()).data.config;
        const saved=await api.settings({...c,tts:true,ttsEngine:'kokoro',kokoroVoice:'bm_daniel'});
        if(!saved.ok)throw Error(saved.error);
        const result=await api.synthesize('Good evening, sir. I am listening.');
        if(!result.ok)throw Error(result.error);
        return result.data;
      })()`);
      if (voice.engine !== 'kokoro' || voice.voice !== 'bm_daniel' || !voice.audio)
        throw Error('Packaged British male voice check failed');
      const audio = Buffer.from(voice.audio, 'base64');
      if (audio.toString('ascii', 0, 4) !== 'RIFF') throw Error('Invalid synthesized audio');
      fs.writeFileSync(path.join(directory, 'british-male.wav'), audio);
      fs.writeFileSync(
        path.join(directory, 'greeting-voice-checks.json'),
        JSON.stringify(
          { ...greeting, engine: voice.engine, voice: voice.voice, audioBytes: audio.length },
          null,
          2,
        ),
      );
      await win.webContents.executeJavaScript(
        `(async()=>{const c=(await window.jarvis.snapshot()).data.config;await window.jarvis.settings({...c,tts:false})})()`,
      );
    }
    // Only called from the existing isolated --smoke-test profile, never owner data.
    const [{ id }] = host.briefing.observe({
      tool: 'extract_page_text',
      result: {
        success: true,
        url: 'https://example.org/smoke-fixture',
        title: 'Explicit smoke fixture',
        text: 'Synthetic smoke values: 12 and 18.',
      },
    });
    host.briefing.present({
      title: 'ISOLATED WORKSPACE SMOKE FIXTURE',
      scenes: [
        {
          title: 'Overview',
          narration: 'Synthetic overview.',
          panels: [
            {
              type: 'text',
              title: 'Overview',
              body: 'Explicitly synthetic test content.',
              sourceIds: [id],
            },
          ],
        },
        {
          title: 'Results',
          narration: 'Synthetic results.',
          panels: [
            {
              type: 'bar',
              title: 'Results',
              sourceIds: [id],
              data: [
                { label: 'First', value: 12 },
                { label: 'Second', value: 18 },
              ],
            },
          ],
        },
      ],
    });
    const moduleId = host.workspace.current.modules[0].id,
      otherModuleId = host.workspace.current.modules[1].id;
    // Exit the settings overlay to test production workspace rendering.
    await win.webContents.executeJavaScript(
      "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))",
    );
    await new Promise((r) => setTimeout(r, 500));
    const workspaceChecks = await win.webContents.executeJavaScript(`(async()=>{
      const api=window.jarvis;let r=await api.workspaceControl({action:'compare',moduleId:${JSON.stringify(moduleId)},otherModuleId:${JSON.stringify(otherModuleId)}});const compared=r.ok;
      const saved=await api.saveResearch();if(!saved.ok)throw Error(saved.error);const key=saved.data.entry.id;
      const renamed=await api.renameResearch(key,'Renamed smoke fixture');const reopened=await api.openResearch(key);const paused=(await api.snapshot()).data.workspace.playback.state==='paused';
      const session=(await api.snapshot()).data.workspace.id, token=crypto.randomUUID();
      const grabbed=await api.workspaceGesture({sessionId:session,moduleId:${JSON.stringify(moduleId)},token,phase:'USER_GRABBED'});
      const held=(await api.snapshot()).data.workspace.modules.find(m=>m.id===${JSON.stringify(moduleId)}).userLocked;
      const released=await api.workspaceGesture({sessionId:session,moduleId:${JSON.stringify(moduleId)},token,phase:'RELEASE'});
      const folder=await api.createResearchFolder('Smoke folder');const moved=await api.moveResearch(key,folder.data.id);const folderOpen=await api.openResearchFolder(folder.data.id);
      const first=await api.requestResearchDelete(key);await api.confirmResearchDelete(first.data.id,false);const denied=(await api.researchLibrary()).data.some(e=>e.id===key);
      const second=await api.requestResearchDelete(key);await api.cancelTask();const stopped=!(await api.confirmResearchDelete(second.data.id,true)).ok;
      const third=await api.requestResearchDelete(key);const deleted=(await api.confirmResearchDelete(third.data.id,true)).ok;const singleUse=!(await api.confirmResearchDelete(third.data.id,true)).ok;
      return {rendered:!!document.querySelector('.spatial-workspace'),compared,saved:saved.ok,renamed:renamed.ok,reopened:reopened.ok,paused,grabbed:grabbed.ok&&held,released:released.ok,folder:folder.ok&&moved.ok&&folderOpen.ok,denied,stopped,deleted,singleUse};
    })()`);
    for (const [name, valid] of Object.entries(workspaceChecks))
      if (!valid) throw Error('Workspace smoke failed: ' + name);
    // IPC completion precedes React's paint; inspect the settled production frame.
    await new Promise((resolve) => setTimeout(resolve, 650));
    const finalFrame = await win.webContents.executeJavaScript(`(() => {
      const stage=document.querySelector('.spatial-stage').getBoundingClientRect();
      const files=[...document.querySelectorAll('.floating-file')];
      return {fileCount:files.length, noScroll:document.documentElement.scrollHeight===innerHeight&&document.documentElement.scrollWidth===innerWidth,
        bounded:files.every(e=>{const r=e.getBoundingClientRect();return r.left>=stage.left-1&&r.top>=stage.top-1&&r.right<=stage.right+1&&r.bottom<=stage.bottom+1}),
        files:files.map(e=>({id:e.dataset.moduleId,role:e.dataset.role,title:e.querySelector('h3').textContent}))};
    })()`);
    if (
      finalFrame.fileCount !== host.workspace.current.modules.length ||
      !finalFrame.bounded ||
      !finalFrame.noScroll
    )
      throw Error('Settled workspace frame failed bounds/count/scroll verification.');
    fs.writeFileSync(
      path.join(directory, 'workspace-checks.json'),
      JSON.stringify({ ...workspaceChecks, finalFrame }, null, 2),
    );
    fs.writeFileSync(
      path.join(directory, 'workspace.png'),
      (await win.webContents.capturePage()).toPNG(),
    );
  }
}
module.exports = { smoke };
