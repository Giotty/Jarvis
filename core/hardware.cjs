const si = require('systeminformation');
const { execFile } = require('node:child_process');
const run = (exe, args, signal) =>
  new Promise((resolve, reject) =>
    execFile(
      exe,
      args,
      { windowsHide: true, timeout: 10000, maxBuffer: 128000, signal },
      (e, out) => (e ? reject(e) : resolve(out.trim())),
    ),
  );
const identity = (name) =>
  String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
async function inspectHardware(component = 'gpu', signal) {
  const [graphics, cpu, memory, cim, smi] = await Promise.allSettled([
    si.graphics(),
    si.cpu(),
    si.mem(),
    process.platform === 'win32'
      ? run(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion,VideoProcessor | ConvertTo-Json -Compress',
          ],
          signal,
        )
      : Promise.resolve('[]'),
    run(
      'nvidia-smi',
      ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader,nounits'],
      signal,
    ),
  ]);
  signal?.throwIfAborted();
  const value = (r, fallback) => (r.status === 'fulfilled' ? r.value : fallback);
  const controllers = value(graphics, { controllers: [] }).controllers.map((g) => ({
    name: g.model,
    vendor: g.vendor,
    vramMiB: g.vram,
    driver: g.driverVersion,
    integrated: !!g.builtin,
    evidence: ['systeminformation/Windows graphics'],
  }));
  let windows = [];
  try {
    windows = [JSON.parse(value(cim, '[]'))].flat();
  } catch {}
  for (const g of controllers) {
    if (windows.some((w) => identity(w.Name) === identity(g.name)))
      g.evidence.push('Win32_VideoController/CIM');
    const line = value(smi, '')
      .split('\n')
      .map((row) => row.split(',').map((s) => s.trim()))
      .find((row) => identity(row[0]) === identity(g.name));
    if (line) {
      g.vramMiB = Number(line[1]);
      g.driver = line[2];
      g.evidence.push('nvidia-smi');
    }
    g.verified = g.evidence.length >= 2;
  }
  const primary =
    controllers.find((g) => /nvidia/i.test(g.vendor + ' ' + g.name) && !g.integrated) ||
    controllers.find((g) => !g.integrated) ||
    controllers[0];
  const result = {
    component,
    graphics: controllers,
    primaryGpu: primary,
    observedAt: new Date().toISOString(),
  };
  if (component === 'cpu' || component === 'all') {
    const c = value(cpu, {});
    result.cpu = {
      name: [c.manufacturer, c.brand].filter(Boolean).join(' '),
      cores: c.physicalCores,
      threads: c.cores,
      evidence: 'Windows/systeminformation',
    };
  }
  if (component === 'memory' || component === 'all')
    result.memory = { totalBytes: value(memory, {}).total, evidence: 'Windows/systeminformation' };
  const verified =
    component === 'gpu'
      ? !!primary?.verified
      : component === 'cpu'
        ? !!result.cpu?.name && result.cpu.cores > 0
        : component === 'memory'
          ? result.memory?.totalBytes > 0
          : !!primary?.verified && !!result.cpu?.name && result.memory?.totalBytes > 0;
  return {
    success: verified,
    verified,
    ...result,
    message: primary?.verified
      ? 'Hardware identity cross-checked against independent local system tools.'
      : 'Hardware could not be independently verified; do not guess its identity.',
  };
}
module.exports = { inspectHardware, identity };
