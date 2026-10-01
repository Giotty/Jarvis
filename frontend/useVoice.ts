import { useCallback, useEffect, useRef, useState } from 'react';
import { Config, unwrap } from './types';
export function useVoice(
  config: Config | null,
  command: (text: string) => void,
  report: (text: string) => void,
  setState: (state: string) => void,
) {
  const armedUntil = useRef(0);
  const generation = useRef(0),
    starting = useRef(false),
    processing = useRef(false);
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    repeatTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    enabled = useRef(false),
    current = useRef(config),
    send = useRef(command),
    log = useRef(report),
    state = useRef(setState);
  const [listening, setListening] = useState(false),
    [transcribing, setTranscribing] = useState(false),
    [level, setLevel] = useState(0),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const audio = useRef<AudioContext | null>(null),
    raf = useRef(0);
  current.current = config;
  send.current = command;
  log.current = report;
  state.current = setState;
  const release = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    audio.current?.close();
    audio.current = null;
    cancelAnimationFrame(raf.current);
    setLevel(0);
  }, []);
  const stop = useCallback(() => {
    if (recorder.current?.state === 'recording') {
      processing.current = true;
      setTranscribing(true);
      recorder.current.stop();
    }
    if (stopTimer.current) clearTimeout(stopTimer.current);
  }, []);
  const cancel = useCallback(() => {
    generation.current++;
    enabled.current = false;
    armedUntil.current = 0;
    if (repeatTimer.current) clearTimeout(repeatTimer.current);
    stop();
    setListening(false);
  }, [stop]);
  const start = useCallback(async () => {
    const c = current.current;
    if (!c) return;
    if (!c?.microphone || !window.jarvis) {
      log.current('Enable microphone privacy in Settings first.');
      return;
    }
    if (recorder.current?.state === 'recording' || starting.current || processing.current) return;
    starting.current = true;
    const token = generation.current;
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: c.microphoneId ? { deviceId: { exact: c.microphoneId } } : true,
      });
      if (token !== generation.current || !current.current?.microphone) {
        release();
        return;
      }
      setDevices(
        (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput'),
      );
      audio.current = new AudioContext();
      const source = audio.current.createMediaStreamSource(stream.current),
        analyzer = audio.current.createAnalyser();
      analyzer.fftSize = 256;
      source.connect(analyzer);
      const data = new Uint8Array(analyzer.frequencyBinCount);
      const sample = () => {
        analyzer.getByteFrequencyData(data);
        setLevel(data.reduce((s, v) => s + v, 0) / data.length / 255);
        raf.current = requestAnimationFrame(sample);
      };
      sample();
      const chunks: BlobPart[] = [];
      const r = new MediaRecorder(stream.current);
      recorder.current = r;
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = async () => {
        processing.current = true;
        release();
        setListening(false);
        try {
          if (token !== generation.current || !current.current?.microphone) return;
          setTranscribing(true);
          state.current('TRANSCRIBING');
          const blob = new Blob(chunks, { type: r.mimeType });
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let binary = '';
          for (const b of bytes) binary += String.fromCharCode(b);
          const result = await unwrap(window.jarvis!.transcribe(btoa(binary)));
          if (token !== generation.current || !current.current?.microphone) return;
          const text = result.text.trim();
          if (text) {
            if (enabled.current) {
              const word = current.current!.wakeWord;
              const index = text.toLowerCase().indexOf(word.toLowerCase());
              if (index >= 0) {
                const rest = text.slice(index + word.length).replace(/^[\s,.:]+/, '');
                if (rest) send.current(rest);
                else {
                  armedUntil.current = Date.now() + 20000;
                  log.current('Yes? I’m listening for your next command.');
                }
              } else if (armedUntil.current > Date.now()) {
                armedUntil.current = 0;
                send.current(text);
              }
            } else send.current(text);
          }
        } catch (e) {
          if (token === generation.current) {
            log.current(String(e));
            enabled.current = false;
          }
        } finally {
          processing.current = false;
          setTranscribing(false);
          if (enabled.current && token === generation.current)
            repeatTimer.current = setTimeout(() => void start(), 1500);
        }
      };
      r.start();
      setListening(true);
      state.current('LISTENING');
      stopTimer.current = setTimeout(stop, enabled.current ? 5000 : 20000);
    } catch (e) {
      release();
      log.current(`Microphone unavailable: ${String(e)}`);
      enabled.current = false;
    } finally {
      starting.current = false;
    }
  }, [release, stop]);
  useEffect(() => {
    enabled.current = Boolean(config?.wakeEnabled && config.microphone);
    if (enabled.current) void start();
    else {
      if (repeatTimer.current) clearTimeout(repeatTimer.current);
      cancel();
    }
    return () => {
      enabled.current = false;
      if (repeatTimer.current) clearTimeout(repeatTimer.current);
      cancel();
    };
  }, [config?.wakeEnabled, config?.microphone, start, cancel]);
  useEffect(
    () => () => {
      enabled.current = false;
      cancel();
      release();
    },
    [cancel, release],
  );
  return {
    listening,
    transcribing,
    level,
    devices,
    start,
    stop,
    cancel,
    toggle: () => (listening ? stop() : void start()),
  };
}
