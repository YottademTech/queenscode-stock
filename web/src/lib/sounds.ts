// Short tones for the camera, made with Web Audio so no sound files are needed. A phone only lets
// a page make sound after a tap, so unlockSounds() is called from the tap that opens the camera.
// An iPhone with its ring switch on silent stays silent; the screen always shows the same thing.

let audio: AudioContext | null = null;

export function unlockSounds() {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    // No sound on this phone; the camera works without it.
  }
}

function tone(frequency: number, startsIn: number, seconds: number) {
  if (!audio || audio.state !== 'running') return;
  const oscillator = audio.createOscillator();
  const volume = audio.createGain();
  const start = audio.currentTime + startsIn;
  oscillator.frequency.value = frequency;
  // A quick fade in and out, so the tone does not click.
  volume.gain.setValueAtTime(0, start);
  volume.gain.linearRampToValueAtTime(0.25, start + 0.01);
  volume.gain.linearRampToValueAtTime(0, start + seconds);
  oscillator.connect(volume).connect(audio.destination);
  oscillator.start(start);
  oscillator.stop(start + seconds + 0.02);
}

function buzz(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Not every phone can vibrate from a page.
  }
}

/** One beep: a photo was taken. */
export function playSnap() {
  tone(1047, 0, 0.09);
  buzz(30);
}

/** Two rising tones: the count has arrived. */
export function playCounted() {
  tone(784, 0, 0.1);
  tone(1175, 0.12, 0.16);
  buzz([40, 60, 40]);
}
