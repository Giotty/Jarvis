function ordinal(text = '') {
  const match =
    /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|[1-9](?:st|nd|rd|th))\b/i.exec(
      text,
    );
  if (!match) return null;
  const words = [
    'first',
    'second',
    'third',
    'fourth',
    'fifth',
    'sixth',
    'seventh',
    'eighth',
    'ninth',
    'tenth',
  ];
  return /^\d/.test(match[1]) ? parseInt(match[1], 10) : words.indexOf(match[1].toLowerCase()) + 1;
}
function resolveOrdinal(text, controls, anchor) {
  const position = ordinal(text);
  if (!position) return anchor;
  const bounds = anchor.bounds;
  if (!bounds) return anchor;
  const peers = controls.filter(
    (control) =>
      control.kind === anchor.kind &&
      control.bounds &&
      Math.abs(control.bounds.width - bounds.width) <= Math.max(3, bounds.width * 0.1) &&
      Math.abs(control.bounds.height - bounds.height) <= Math.max(3, bounds.height * 0.1) &&
      !(
        /\b(?:profile|account)\b/i.test(text) &&
        /\b(?:add|new|ajouter|nouveau)\b/i.test(control.label)
      ),
  );
  peers.sort((a, b) =>
    Math.abs(a.y - b.y) < Math.min(a.bounds.height, b.bounds.height) * 0.25 ? a.x - b.x : a.y - b.y,
  );
  if (!peers[position - 1])
    throw Error('Not enough matching visible controls for that position. Observe again.');
  return peers[position - 1];
}
module.exports = { ordinal, resolveOrdinal };
