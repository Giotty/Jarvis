const si = require('systeminformation');
async function telemetry() {
  const results = await Promise.allSettled([
    si.currentLoad(),
    si.mem(),
    si.graphics(),
    si.fsSize(),
    si.networkStats(),
    si.battery(),
    si.cpuTemperature(),
    si.processes(),
    si.disksIO(),
  ]);
  const get = (i, f) => (results[i].status === 'fulfilled' ? (results[i].value ?? f) : f);
  const cpu = get(0, {}),
    ram = get(1, {}),
    gpu = get(2, { controllers: [] }).controllers[0],
    disks = get(3, []),
    net = get(4, []),
    battery = get(5, {}),
    temp = get(6, {}),
    procs = get(7, { list: [] }),
    io = get(8, {});
  return {
    cpu: cpu.currentLoad ?? null,
    ram: ram.total ? (100 * ram.active) / ram.total : null,
    ramUsed: ram.active ?? 0,
    ramTotal: ram.total ?? 0,
    gpu: gpu?.utilizationGpu ?? null,
    gpuName: gpu?.model ?? 'Unavailable',
    vram: gpu?.memoryUsed ?? null,
    vramTotal: gpu?.vram ?? null,
    disk: disks[0]?.use ?? null,
    diskRead: io.rIO_sec ?? null,
    diskWrite: io.wIO_sec ?? null,
    upload: net.reduce((s, n) => s + (n.tx_sec || 0), 0),
    download: net.reduce((s, n) => s + (n.rx_sec || 0), 0),
    battery: battery.hasBattery ? battery.percent : null,
    temperature: temp.main ?? null,
    processCount: procs.all ?? procs.list.length,
    processes: procs.list
      .sort((a, b) => b.mem - a.mem)
      .slice(0, 8)
      .map((p) => ({ name: p.name, pid: p.pid, ram: p.memRss, cpu: p.cpu })),
    time: Date.now(),
  };
}
module.exports = { telemetry };
