let token = null;
export async function connect() {
  const r = await fetch('/api/session');
  const data = await r.json();
  token = data.token;
  return data;
}
export async function api(route, data) {
  const response = await fetch(route, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'x-soundr-session': token },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const value = await response.json();
  if (!response.ok || value.ok === false) {
    const error = new Error(value.error?.message || 'Soundr could not complete this operation.');
    error.code = value.error?.code;
    error.details = value.error?.details;
    throw error;
  }
  return value;
}
export async function upload(project, file, kind, options = {}) {
  const meta = {
    kind,
    name: file.name,
    expectedRevision: project.revision,
    requestId: 'ui-import-' + crypto.randomUUID(),
    ...options,
  };
  const response = await fetch('/api/import/' + project.id, {
    method: 'POST',
    headers: {
      'x-soundr-session': token,
      'Content-Type': 'application/octet-stream',
      'x-upload-meta': encodeURIComponent(JSON.stringify(meta)),
    },
    body: file,
  });
  const value = await response.json();
  if (!response.ok || value.ok === false) {
    const error = new Error(value.error?.message || 'Import failed.');
    error.code = value.error?.code;
    throw error;
  }
  return value;
}
export const requestId = () => 'ui-' + crypto.randomUUID();
export const sampleToFrame = (sample, fps) =>
  Math.round((sample * fps.numerator) / (48000 * fps.denominator));
export const frameToSample = (frame, fps) =>
  Math.round((frame * 48000 * fps.denominator) / fps.numerator);
export function timecode(sample, fps, origin = '01:00:00:00') {
  const nominal = Math.round(fps.numerator / fps.denominator),
    parts = origin.split(':').map(Number);
  let f =
    (parts[0] * 3600 + parts[1] * 60 + parts[2]) * nominal + parts[3] + sampleToFrame(sample, fps);
  const frame = f % nominal;
  f = Math.floor(f / nominal);
  return [Math.floor(f / 3600), Math.floor(f / 60) % 60, f % 60, frame]
    .map((x) => String(x).padStart(2, '0'))
    .join(':');
}
export const rateLabel = (rate) =>
  rate.denominator === 1
    ? rate.numerator + ' fps'
    : rate.numerator + '/' + rate.denominator + ' fps';
export const el = (tag, className = '', text = '') => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
export function button(text, fn, className = '') {
  const b = el('button', className, text);
  b.type = 'button';
  b.addEventListener('click', fn);
  return b;
}
export function field(label, value, { type = 'number', step = 'any', min = null } = {}) {
  const wrap = el('label', '', label),
    input = el('input');
  input.type = type;
  input.value = value;
  input.step = step;
  if (min !== null) input.min = min;
  wrap.append(input);
  return { wrap, input };
}
