const interactive = new Set([
  'ButtonControl',
  'HyperlinkControl',
  'TabItemControl',
  'ListItemControl',
  'MenuItemControl',
  'TreeItemControl',
  'RadioButtonControl',
  'CheckBoxControl',
  'SplitButtonControl',
  'EditControl',
  'ComboBoxControl',
  'CustomControl',
]);
function normalizeLabel(value = '') {
  return String(value)
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/&/g, '')
    .replace(/[\u200b-\u200f\u202a-\u202e]/g, '')
    .replace(/\s*\([^)]*(?:ctrl|alt|shift|[0-9])[^)]*\)\s*$/i, '')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function selectorLabel(value) {
  return normalizeLabel(value)
    .replace(/^(?:the )?/, '')
    .replace(/\s+(?:button|tab|link|menu item|control)$/, '')
    .trim();
}
function sameTarget(a, b) {
  const contains = (r, p) =>
    r && p.x >= r.x && p.y >= r.y && p.x < r.x + r.width && p.y < r.y + r.height;
  return (
    (Math.abs(a.x - b.x) <= 4 && Math.abs(a.y - b.y) <= 4) ||
    (contains(a.bounds, b) && contains(b.bounds, a))
  );
}
// Match actual observed labels, never infer coordinates. Distinct equally good
// targets stay ambiguous; nested text/button duplicates represent one target.
function findControl(label, controls = []) {
  const query = selectorLabel(label);
  if (!query) return null;
  const ranked = controls
    .filter((c) => Number.isFinite(c.x) && Number.isFinite(c.y) && c.label?.trim())
    .map((control) => {
      const name = normalizeLabel(control.label);
      const score =
        name === normalizeLabel(label)
          ? 4
          : selectorLabel(control.label) === query
            ? 3
            : name.split(' ').length <= query.split(' ').length + 2 &&
                ` ${name} `.includes(` ${query} `)
              ? 1
              : 0;
      return { control, score };
    })
    .filter((c) => c.score);
  if (!ranked.length) return null;
  const best = Math.max(...ranked.map((c) => c.score));
  const matches = ranked
    .filter((c) => c.score === best)
    .map((c) => c.control)
    .sort((a, b) => Number(interactive.has(b.kind)) - Number(interactive.has(a.kind)));
  if (!matches.every((c) => sameTarget(matches[0], c))) return null;
  return { ...matches[0], confidence: 1, source: 'Windows UI Automation' };
}
function actionSignature(tool, args) {
  const normalized = { ...args };
  if (['navigate_ui', 'click_visible_target', 'locate_ui_element'].includes(tool))
    normalized.label = selectorLabel(args.label);
  return tool + JSON.stringify(normalized);
}
module.exports = { findControl, normalizeLabel, selectorLabel, actionSignature };
