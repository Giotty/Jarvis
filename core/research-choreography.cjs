const zones = {
  PRIMARY_LEFT: { x: 0.01, y: 0.13, width: 0.32, height: 0.74 },
  PRIMARY_RIGHT: { x: 0.67, y: 0.13, width: 0.32, height: 0.74 },
  TOP_LEFT: { x: 0.01, y: 0, width: 0.19, height: 0.26 },
  TOP_RIGHT: { x: 0.8, y: 0, width: 0.19, height: 0.26 },
  BOTTOM_LEFT: { x: 0.01, y: 0.74, width: 0.19, height: 0.26 },
  BOTTOM_RIGHT: { x: 0.8, y: 0.74, width: 0.19, height: 0.26 },
  STACK_LEFT: { x: 0.01, y: 0.36, width: 0.18, height: 0.2 },
  STACK_RIGHT: { x: 0.81, y: 0.36, width: 0.18, height: 0.2 },
  PARKING_EDGE: { x: 0.22, y: 0.82, width: 0.16, height: 0.18 },
};
const overlaps = (a, b) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
function arrange(workspace, focusId, related = [], locks = new Map()) {
  workspace.desiredFocus = focusId;
  workspace.relatedObjectIds = related;
  const target = workspace.modules.find((m) => m.id === focusId && m.state !== 'closed');
  if (!target) return;
  related = [
    ...new Set([
      ...related,
      ...workspace.modules
        .filter((m) => target.groupId && m.groupId === target.groupId && m.id !== target.id)
        .map((m) => m.id),
    ]),
  ];
  if (locks.size) {
    workspace.pendingFocus = focusId;
    let index = 0;
    for (const m of workspace.modules) {
      if (locks.has(m.id) || m.pinned || m.userPositioned || m.state === 'closed') continue;
      if (m.id === focusId || m.state === 'ready') {
        m.visualRole = 'STACKED';
        m.layout = {
          ...zones.STACK_RIGHT,
          x: 0.79 + (index % 4) * 0.012,
          y: 0.29 + (index % 8) * 0.06,
        };
        m.zIndex = 30 - index++;
      }
    }
    return;
  }
  delete workspace.pendingFocus;
  const fixed = workspace.modules.filter(
    (m) => (m.pinned || m.userPositioned) && m.state !== 'closed',
  );
  const occupied = fixed.map((m) => m.layout);
  const focusZone =
    workspace.responseMode === 'VISUAL_ASSIST'
      ? { x: 0.72, y: 0.24, width: 0.27, height: 0.5 }
      : [zones.PRIMARY_RIGHT, zones.PRIMARY_LEFT].find(
          (z) => !occupied.some((l) => overlaps(z, l)),
        ) || zones.PRIMARY_RIGHT;
  let slot = 0;
  let contextZones = [
    zones.TOP_LEFT,
    zones.BOTTOM_LEFT,
    zones.TOP_RIGHT,
    zones.BOTTOM_RIGHT,
    zones.STACK_LEFT,
    zones.STACK_RIGHT,
    zones.PARKING_EDGE,
  ];
  if (
    workspace.responseMode === 'FULL_WORKSPACE' &&
    workspace.modules.filter((m) => m.state !== 'closed').length >= 7
  ) {
    // Dense research has enough objects to collide in the peripheral stacks.
    // Reserve the dominant primary column and tile the remaining cards with gaps.
    const startX = focusZone.x > 0.5 ? 0.01 : 0.35;
    contextZones = Array.from({ length: 9 }, (_, i) => ({
      x: startX + (i % 3) * 0.213,
      y: 0.01 + Math.floor(i / 3) * 0.33,
      width: 0.202,
      height: 0.31,
    }));
  }
  for (const m of workspace.modules) {
    if (m.state === 'closed') continue;
    const desiredRole =
      m.id === focusId
        ? 'PRIMARY'
        : related.includes(m.id)
          ? 'SECONDARY'
          : m.visualRole === 'PARKED'
            ? 'PARKED'
            : m.completed || m.state === 'docked'
              ? 'CONTEXT'
              : 'STACKED';
    if (m.pinned || m.userPositioned) {
      if (desiredRole !== 'STACKED') m.visualRole = desiredRole;
      continue;
    }
    m.visualRole = desiredRole;
    if (desiredRole === 'PARKED') continue;
    if (m.id === focusId) {
      m.layout = { ...focusZone };
      m.zIndex = 50;
      continue;
    }
    const available = contextZones.filter(
      (z) => !overlaps(z, focusZone) && !occupied.some((l) => overlaps(z, l)),
    );
    const zone = available[0] || zones.PARKING_EDGE;
    const layer = available.length ? 0 : 1;
    m.layout = {
      ...zone,
      x: Math.min(1 - zone.width, zone.x + layer * 0.014),
      y: Math.min(1 - zone.height, zone.y + layer * 0.065),
    };
    if (desiredRole === 'SECONDARY' && !layer && workspace.modules.length < 7) {
      const medium = {
        ...m.layout,
        width: Math.min(0.25, m.layout.width + 0.04),
        height: Math.min(0.38, m.layout.height + 0.1),
      };
      medium.x = Math.min(medium.x, 1 - medium.width);
      medium.y = Math.min(medium.y, 1 - medium.height);
      if (!overlaps(medium, focusZone) && !occupied.some((l) => overlaps(medium, l)))
        m.layout = medium;
    }
    m.zIndex = 25 - slot;
    if (layer || m.groupCollapsed) m.visualRole = 'STACKED';
    occupied.push(m.layout);
    slot++;
  }
  for (const m of fixed) m.zIndex = Math.max(m.zIndex || 35, m.id === focusId ? 50 : 35);
}
module.exports = { zones, arrange, overlaps };
