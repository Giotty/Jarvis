// Only the host's observed UI control can make a click automatic. Model text
// cannot change risk. Submission, destructive and privileged controls stay gated.
function ordinaryNavigation(control, window) {
  if (control.contextUnavailable) return false;
  const label = [control.label, control.actionLabel].filter(Boolean).join(' ');
  if (
    ![
      'ButtonControl',
      'HyperlinkControl',
      'TabItemControl',
      'ListItemControl',
      'MenuItemControl',
      'EditControl',
      'ComboBoxControl',
      'TreeItemControl',
      'SplitButtonControl',
      'CustomControl',
      'TextControl',
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
    /\b(?:send|submit|post|publish|buy|purchase|pay|checkout|delete|erase|wipe|remove|uninstall|install|shutdown|restart|reset|format|administrator|admin|security|firewall|defender|antivirus|protection|bitlocker|uac|secure boot|password|permission|confirm|authorize|allow|login|log in|sign in|connecter|envoyer|supprimer|acheter|payer|installer|redémarrer|autoriser|confirmer)\b/i.test(
      label,
    )
  )
    return false;
  return true;
}
module.exports = { ordinaryNavigation };
