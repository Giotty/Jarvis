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
    if (!process.argv.includes('--smoke-3d-only')) {
      if (process.argv.includes('--smoke-greeting') || process.argv.includes('--smoke-voice')) {
        const greeting = process.argv.includes('--smoke-greeting')
          ? await win.webContents.executeJavaScript(`(async()=>{
        const api=window.jarvis,replies=[];const unsubscribe=api.on(e=>{if(e.type==='reply')replies.push(e.data)});
        try {await api.command('Hey Jarvis');await api.command('Hello again, how are you?');}
        finally{unsubscribe()}
        return {replies};
      })()`)
          : { replies: [] };
        if (
          process.argv.includes('--smoke-greeting') &&
          (host.agent.active?.status !== 'completed' ||
            greeting.replies.length !== 2 ||
            greeting.replies.some((text) => /unavailable|too long|try again/i.test(text)))
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
      // Reproduce the owner's X click with real pointer input, then deliver late
      // playback/research updates. The same session must stay dismissed.
      const target = await win.webContents.executeJavaScript(`(() => {
      const r=document.querySelector('button[aria-label="Hide research workspace"]').getBoundingClientRect();
      return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
    })()`);
      win.webContents.sendInputEvent({ type: 'mouseMove', ...target });
      win.webContents.sendInputEvent({
        type: 'mouseDown',
        button: 'left',
        clickCount: 1,
        ...target,
      });
      win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...target });
      await new Promise((r) => setTimeout(r, 650));
      host.workspace.publish();
      await new Promise((r) => setTimeout(r, 650));
      const closeChecks = await win.webContents.executeJavaScript(`(async()=>{
      const s=(await window.jarvis.snapshot()).data;
      return {closed:!document.querySelector('.spatial-workspace'),undimmed:!document.querySelector('.briefing-open'),
        retained:!!s.workspace,paused:s.workspace.playback.state==='paused'};
    })()`);
      await click('button[aria-label="Open radial settings"]');
      closeChecks.hudAccessible = await win.webContents.executeJavaScript(
        "!!document.querySelector('.orbit-node')",
      );
      await win.webContents.executeJavaScript(
        "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='BRIEFING').click()",
      );
      await new Promise((r) => setTimeout(r, 650));
      closeChecks.reopened = await win.webContents.executeJavaScript(
        "!!document.querySelector('.spatial-workspace')",
      );
      for (const [name, valid] of Object.entries(closeChecks))
        if (!valid) throw Error('Presentation close check failed: ' + name);
      fs.writeFileSync(
        path.join(directory, 'presentation-close-checks.json'),
        JSON.stringify(closeChecks, null, 2),
      );
      // Synthetic reservations use this isolated profile only, never the owner's ledger.
      await click('button[aria-label="Hide research workspace"]');
      await win.webContents.executeJavaScript(
        `(async()=>{const c=(await window.jarvis.snapshot()).data.config;const result=await window.jarvis.settings({...c,provider:'gemini',cloudEnabled:true,geminiModel:'gemini-3.8-flash',geminiDailyCap:100,tts:false,microphone:false});if(!result.ok)throw Error(result.error)})()`,
      );
      host.ai.geminiBudget.data.used = 79;
      host.ai.geminiBudget.data.warned = false;
      host.ai.geminiBudget.take();
      await new Promise((r) => setTimeout(r, 250));
      const budgetChecks = await win.webContents.executeJavaScript(
        `({warning:document.querySelector('.gemini-budget')?.textContent.includes('80 / 100 today')&&document.querySelector('.gemini-budget')?.textContent.includes('80% WARNING'),model:document.querySelector('.provider-readout')?.textContent.includes('gemini-3.8-flash')})`,
      );
      host.ai.geminiBudget.data.used = 100;
      host.ai.geminiBudget.notify();
      await new Promise((r) => setTimeout(r, 250));
      budgetChecks.capped = await win.webContents.executeJavaScript(
        `document.querySelector('.gemini-budget')?.textContent.includes('100 / 100 today')&&document.querySelector('.gemini-budget')?.textContent.includes('OLLAMA FALLBACK')`,
      );
      await win.webContents.executeJavaScript(
        `(async()=>{const c=(await window.jarvis.snapshot()).data.config;await window.jarvis.settings({...c,geminiDailyCap:125})})()`,
      );
      await new Promise((r) => setTimeout(r, 250));
      budgetChecks.edit = await win.webContents.executeJavaScript(
        `document.querySelector('.gemini-budget')?.textContent.includes('100 / 125 today')&&!document.querySelector('.gemini-budget')?.textContent.includes('BUDGET REACHED')`,
      );
      host.emit('google-grounding', {
        answer: 'Synthetic sourced integration fixture.',
        sources: [],
        allowedLinks: ['https://www.google.com/search?q=fixture'],
        searchHtml:
          '<style>.search{color:black}</style><div class="search"><a href="https://www.google.com/search?q=fixture">Google Search fixture</a></div>',
      });
      await new Promise((r) => setTimeout(r, 250));
      await win.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('GOOGLE RESEARCH SOURCES')).click()`,
      );
      await new Promise((r) => setTimeout(r, 250));
      budgetChecks.grounding = await win.webContents.executeJavaScript(
        `!!document.querySelector('iframe[title="Google Search suggestions"]') && document.querySelector('iframe').getAttribute('sandbox')==='allow-popups'`,
      );
      await click('button[aria-label="Close Google research"]');
      for (const [name, valid] of Object.entries(budgetChecks))
        if (!valid) throw Error('Gemini runtime check failed: ' + name);
      fs.writeFileSync(
        path.join(directory, 'gemini-budget-checks.json'),
        JSON.stringify(budgetChecks, null, 2),
      );
      fs.writeFileSync(
        path.join(directory, 'gemini-budget.png'),
        (await win.webContents.capturePage()).toPNG(),
      );
    }
    if (process.argv.includes('--smoke-3d')) {
      await win.webContents.executeJavaScript(
        "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))",
      );
      if (!host.blender.status().available) throw Error('Blender unavailable in packaged smoke');
      const result = await host.blender.run({
        title: 'Real Blender smoke mesh',
        operations: [
          { op: 'create_primitive', kind: 'cylinder', name: 'Part', radius: 0.038, depth: 0.025 },
          { op: 'bevel', object: 'Part', amount: 0.002, segments: 3, apply: true },
          {
            op: 'create_material',
            name: 'Metal',
            color: [0.03, 0.4, 0.5, 1],
            metallic: 0.7,
            roughness: 0.3,
          },
          { op: 'assign_material', object: 'Part', material: 'Metal' },
          { op: 'add_light', name: 'Key', location: [0.2, -0.1, 0.2], energy: 12, size: 0.15 },
          { op: 'set_camera', location: [0.11, -0.12, 0.13], target: [0, 0, 0] },
          { op: 'render', width: 256, height: 256 },
          { op: 'export', format: 'GLB' },
          { op: 'export', format: 'STL' },
        ],
      });
      const preview = host.blender.asset(result.exports.find((e) => e.format === 'GLB').assetId);
      if (
        !result.verified ||
        !preview.base64 ||
        !result.scene.objects.find((o) => o.name === 'Part').manifold
      )
        throw Error('Real Blender mesh/export check failed');
      await new Promise((r) => setTimeout(r, 600));
      await win.webContents.executeJavaScript(
        "(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='BRIEFING');if(b&&!document.querySelector('.spatial-workspace'))b.click();})()",
      );
      for (let i = 0; i < 40; i++) {
        const ready = await win.webContents.executeJavaScript(
          "!!document.querySelector('.model-canvas canvas') && document.body.innerText.includes('DRAG TO ORBIT')",
        );
        if (ready) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      const canvas = await win.webContents.executeJavaScript(
        "(()=>{const c=document.querySelector('.model-canvas canvas');if(!c)throw Error('Real GLB did not render');const r=c.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),width:c.width,height:c.height}})()",
      );
      if (canvas.width < 20 || canvas.height < 20) throw Error('3D preview has no drawable size');
      win.webContents.sendInputEvent({
        type: 'mouseDown',
        button: 'left',
        clickCount: 1,
        x: canvas.x,
        y: canvas.y,
      });
      win.webContents.sendInputEvent({ type: 'mouseMove', x: canvas.x + 20, y: canvas.y + 10 });
      win.webContents.sendInputEvent({
        type: 'mouseUp',
        button: 'left',
        clickCount: 1,
        x: canvas.x + 20,
        y: canvas.y + 10,
      });
      await win.webContents.executeJavaScript(
        "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='RESET VIEW').click()",
      );
      const entry = host.workspace.save({}).entry;
      const restore = host.workspace.library.read(entry.id).workspace;
      if (!restore.modules.some((m) => m.panels.some((p) => p.projectId === result.projectId)))
        throw Error('3D library persistence failed');
      const cancellation = new AbortController(),
        before = host.blender.manifest(result.projectId).revision;
      const pending = host.blender.run(
        { projectId: result.projectId, operations: [{ op: 'render', width: 1600, height: 1600 }] },
        cancellation.signal,
      );
      setTimeout(() => cancellation.abort(), 300);
      let cancelled = false;
      try {
        await pending;
      } catch {
        cancelled = cancellation.signal.aborted;
      }
      if (!cancelled || host.blender.manifest(result.projectId).revision !== before)
        throw Error('3D cancellation promoted incomplete work');
      // Failed staging folders must not break lookup of previously saved assets.
      host.blender.asset(result.exports.find((e) => e.format === 'GLB').assetId);
      const layouts = [];
      for (const [width, height] of [
        [1366, 768],
        [1920, 1080],
        [2560, 1440],
      ]) {
        win.setContentSize(width, height);
        await new Promise((r) => setTimeout(r, 500));
        const layout = await win.webContents.executeJavaScript(
          "(()=>{const c=document.querySelector('.model-canvas canvas'),g=c?.getContext('webgl2');let modelPixels=0;if(g&&!g.isContextLost()){const p=new Uint8Array(c.width*c.height*4);g.readPixels(0,0,c.width,c.height,g.RGBA,g.UNSIGNED_BYTE,p);for(let i=0;i<p.length;i+=4)if(p[i+3]>0&&(p[i]>35||p[i+1]>45||p[i+2]>55))modelPixels++}return{width:innerWidth,height:innerHeight,noScroll:document.documentElement.scrollHeight===innerHeight&&document.documentElement.scrollWidth===innerWidth,preview:!!c,modelPixels}})()",
        );
        if (!layout.noScroll || !layout.preview || layout.modelPixels < 50)
          throw Error('3D responsive layout or visible mesh rendering failed');
        layouts.push(layout);
        fs.writeFileSync(
          path.join(directory, '3d-' + width + '.png'),
          (await win.webContents.capturePage()).toPNG(),
        );
      }
      fs.writeFileSync(
        path.join(directory, '3d-checks.json'),
        JSON.stringify(
          {
            verified: true,
            projectId: result.projectId,
            exports: result.exports.map((e) => e.format),
            manifold: true,
            canvas,
            library: true,
            cancelled,
            layouts,
          },
          null,
          2,
        ),
      );
    }
  }
}
module.exports = { smoke };
