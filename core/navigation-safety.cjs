// Only the host's observed UI control can make a click automatic. Model text
// cannot change risk. Submission, destructive and privileged controls stay gated.
function ordinaryNavigation(control, window) {
  const label = control.label || '';
  if (
    ![
      'ButtonControl',
      'HyperlinkControl',
      'TabItemControl',
      'ListItemControl',
      'MenuItemControl',
      'EditControl',
      'ComboBoxControl',
    ].includes(control.kind) ||
    !label.trim()
  )
    return false;
  if (
    /^(?:powershell|pwsh|cmd|wt|windowsterminal|regedit|mmc|consent)\.exe$/i.test(
      window.application || '',
    )
  )
    return false;
  if (
    /\b(?:send|submit|post|publish|buy|purchase|pay|checkout|delete|remove|uninstall|install|shutdown|restart|reset|format|administrator|admin|security|password|permission|confirm|authorize|allow|login|log in|sign in|connecter|envoyer|supprimer|acheter|payer|installer|redémarrer|autoriser|confirmer)\b/i.test(
      label,
    )
  )
    return false;
  return true;
}
module.exports = { ordinaryNavigation };
