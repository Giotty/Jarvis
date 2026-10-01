import { useCallback, useEffect, useRef, useState } from 'react';
import { Config, unwrap } from './types';
import { SpeechCapture, wavBase64 } from './speechCapture';
type Job = {
  frames: Float32Array[];
  rate: number;
  turn: string;
  generation: number;
  partial: boolean;
  barrier: Promise<void>;
};
export function useVoice(
  config: Config | null,
  command: (text: string, turn: string) => Promise<void>,
  report: (text: string) => void,
  setState: (state: string) => void,
  interrupt: () => Promise<void>,
) {
  const current = useRef({ config, command, report, setState, interrupt });
  current.current = { config, command, report, setState, interrupt };
  const generation = useRef(0),
    starting = useRef(false),
    processing = useRef(false),
    autoWanted = useRef(false);
  const stream = useRef<MediaStream | null>(null),
    audio = useRef<AudioContext | null>(null);
  const capture = useRef<SpeechCapture | null>(null),
    node = useRef<AudioWorkletNode | null>(null);
  const jobs = useRef<Job[]>([]),
    turn = useRef(''),
    barrier = useRef(Promise.resolve()),
    armedUntil = useRef(0);
  const startRef = useRef<() => Promise<void>>(async () => {});
  const [listening, setListening] = useState(false),
    [transcribing, setTranscribing] = useState(false);
  const [level, setLevel] = useState(0),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const release = useCallback(() => {
    if (node.current) {
      node.current.port.onmessage = null;
      node.current.disconnect();
    }
    node.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    void audio.current?.close();
    audio.current = null;
    capture.current = null;
    setListening(false);
    setLevel(0);
  }, []);
  const cancel = useCallback(() => {
    generation.current++;
    autoWanted.current = false;
    jobs.current = [];
    turn.current = '';
    armedUntil.current = 0;
    release();
  }, [release]);
  const pump = useCallback(async () => {
    if (processing.current) return;
    processing.current = true;
    setTranscribing(true);
    try {
      while (jobs.current.length) {
        const job = jobs.current.shift()!;
        const valid = () =>
          job.generation === generation.current &&
          job.turn === turn.current &&
          current.current.config?.microphone;
        if (!valid() || !window.jarvis) continue;
        try {
          const result = await unwrap(window.jarvis.transcribe(wavBase64(job.frames, job.rate)));
          if (!valid()) continue;
          const text = result.text.trim();
          if (!text) continue;
          await job.barrier;
          if (!valid()) continue;
          const c = current.current.config!;
          if (job.partial) {
            if (c.conversationMode)
              await unwrap(window.jarvis.previewSpeech(text.slice(0, 1000), job.turn));
            continue;
          }
          if (c.wakeEnabled && !c.conversationMode) {
            const index = text.toLowerCase().indexOf(c.wakeWord.toLowerCase());
            if (index >= 0) {
              const rest = text.slice(index + c.wakeWord.length).replace(/^[\s,.:]+/, '');
              if (rest) void current.current.command(rest, job.turn);
              else {
                armedUntil.current = Date.now() + 20000;
                current.current.report('Yes? I’m listening.');
              }
            } else if (armedUntil.current > Date.now()) {
              armedUntil.current = 0;
              void current.current.command(text, job.turn);
            }
          } else void current.current.command(text, job.turn);
        } catch (error) {
          if (valid() && !job.partial) current.current.report(String(error));
        }
      }
    } finally {
      processing.current = false;
      setTranscribing(false);
    }
  }, []);
  const enqueue = useCallback(
    (frames: Float32Array[], partial: boolean) => {
      if (!audio.current || !turn.current) return;
      // Keep only the newest waiting turn; never replay stale commands later.
      if (partial && (processing.current || jobs.current.length)) return;
      if (!partial) jobs.current = [];
      jobs.current.push({
        frames,
        partial,
        rate: audio.current.sampleRate,
        turn: turn.current,
        generation: generation.current,
        barrier: barrier.current,
      });
      void pump();
    },
    [pump],
  );
  const stop = useCallback(() => {
    const frames = capture.current?.finish();
    if (frames) enqueue(frames, false);
    release();
  }, [enqueue, release]);
  const start = useCallback(async () => {
    const c = current.current.config;
    if (!c?.microphone || !window.jarvis) {
      current.current.report('Enable microphone privacy in Settings first.');
      return;
    }
    if (starting.current || stream.current) return;
    starting.current = true;
    const token = generation.current;
    let input: MediaStream | null = null,
      context: AudioContext | null = null;
    try {
      input = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(c.microphoneId ? { deviceId: { exact: c.microphoneId } } : {}),
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (token !== generation.current) {
        input.getTracks().forEach((t) => t.stop());
        return;
      }
      context = new AudioContext({ sampleRate: 16000 });
      await context.audioWorklet.addModule(new URL('audio-capture.js', document.baseURI).href);
      if (token !== generation.current) {
        input.getTracks().forEach((t) => t.stop());
        await context.close();
        return;
      }
      stream.current = input;
      audio.current = context;
      const detector = new SpeechCapture(context.sampleRate);
      capture.current = detector;
      const worklet = new AudioWorkletNode(context, 'jarvis-capture', {
        channelCount: 1,
        outputChannelCount: [1],
      });
      node.current = worklet;
      context.createMediaStreamSource(input).connect(worklet);
      worklet.connect(context.destination); // Emits silence, never mic loopback.
      let meter = 0;
      worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (token !== generation.current) return;
        const settings = current.current.config;
        const live = Boolean(settings?.conversationMode || settings?.wakeEnabled);
        const result = detector.push(event.data, live || Boolean(settings?.autoStopSpeech));
        meter += event.data.length / detector.rate;
        if (meter > 0.1) {
          setLevel(result.level);
          meter = 0;
        }
        if (result.onset) {
          turn.current = crypto.randomUUID();
          jobs.current = [];
          if (
            !settings?.wakeEnabled ||
            settings.conversationMode ||
            armedUntil.current > Date.now()
          )
            barrier.current = current.current
              .interrupt()
              .catch((error) => current.current.report(String(error)));
          else barrier.current = Promise.resolve();
          current.current.setState('LISTENING');
        }
        if (result.preview && settings?.conversationMode) enqueue(result.preview, true);
        if (result.final) {
          enqueue(result.final, false);
          if (!live) release();
        }
      };
      worklet.onprocessorerror = () => {
        cancel();
        current.current.report('Microphone capture stopped. Resume listening to reconnect.');
      };
      await context.resume();
      if (token !== generation.current) {
        input.getTracks().forEach((track) => track.stop());
        if (context.state !== 'closed') await context.close();
        return;
      }
      setListening(true);
      current.current.setState('LISTENING');
      setDevices(
        (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput'),
      );
    } catch (error) {
      input?.getTracks().forEach((t) => t.stop());
      if (context && context.state !== 'closed') void context.close();
      if (token === generation.current) {
        release();
        autoWanted.current = false;
        current.current.report(`Microphone unavailable: ${String(error)}`);
      }
    } finally {
      starting.current = false;
      if (token !== generation.current && autoWanted.current && !stream.current)
        void startRef.current();
    }
  }, [enqueue, release, cancel]);
  startRef.current = start;
  useEffect(() => {
    autoWanted.current = Boolean(
      config?.microphone && (config.conversationMode || config.wakeEnabled),
    );
    if (autoWanted.current) void start();
    return cancel;
  }, [
    config?.microphone,
    config?.microphoneId,
    config?.conversationMode,
    config?.wakeEnabled,
    start,
    cancel,
  ]);
  return {
    listening,
    transcribing,
    level,
    devices,
    start,
    stop,
    cancel,
    toggle: () =>
      listening
        ? current.current.config?.conversationMode || current.current.config?.wakeEnabled
          ? cancel()
          : stop()
        : void start(),
  };
}
