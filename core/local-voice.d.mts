export function chooseMaleLocalVoice<
  T extends { name: string; lang: string; localService: boolean },
>(voices: T[]): T | null;
