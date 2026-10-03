export function chooseMaleLocalVoice(voices) {
  const local = voices.filter((v) => v.localService && /^en(?:-|$)/i.test(v.lang));
  for (const name of ['George', 'Ryan', 'Daniel', 'David', 'Mark', 'Guy', 'James', 'Richard']) {
    const voice = local.find((v) => new RegExp(`\\b${name}\\b`, 'i').test(v.name));
    if (voice) return voice;
  }
  return null;
}
