// Saddle Brook Constituent Chatbot - deployable backend (Render)
// Answers come first from a verified local index (data/index.json,
// data/meetings.json). Questions the index does not cover are sent to the
// Meta Model API only when MODEL_API_KEY is set, and only with context from
// the approved trusted sources list (data/trusted-sources.json). Otherwise
// they return the Town Hall main number fallback. No personal information is
// collected or stored.

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL_API_KEY = process.env.MODEL_API_KEY || '';
const MODEL_ID = process.env.MODEL_ID || 'muse-wonder-1.0';

const loadJson = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'data', name), 'utf8'));
const index = loadJson('index.json');
const meetingsData = loadJson('meetings.json');
const trustedSources = loadJson('trusted-sources.json');

const HELP_DESK = index.helpDeskPhone;

app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------

function stripAccents(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalize(s) {
  return stripAccents(String(s || '').toLowerCase()).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function detectLang(question, requested) {
  if (requested === 'es') return 'es';
  const q = String(question || '');
  const n = ' ' + normalize(q) + ' ';
  const esHints = [' quien ', ' cuando ', ' donde ', ' como ', ' acta ', ' alcalde ', ' reunion ', ' concejo ', ' basura ', ' biblioteca ', ' multa ', ' permiso ', ' impuesto ', ' discapacitado', ' estacionamiento ', ' piscina ', ' parque ', ' farola ', ' luz ', ' hay ', ' calle ', ' carro ', ' vehiculo ', ' velocidad ', ' propiedad ', ' hierba ', ' pasto ', ' inundacion ', ' sotano ', ' abandonado ', ' vecinos ', ' necesito ', ' reportar ', ' quiero ', ' autos ', ' exceso ', ' agua '];
  const hintCount = esHints.filter((h) => n.includes(h)).length;
  if (/[¿¡áéíóúñ]/i.test(q) || hintCount >= 2) return 'es';
  if (requested === 'en') return 'en';
  return hintCount >= 1 ? 'es' : 'en';
}

const EMERGENCY = [
  'fire', 'smoke', 'burning', 'robbery', 'robbed', 'break in', 'breaking in', 'gun', 'shooting',
  'heart attack', 'chest pain', 'not breathing', 'unconscious', 'overdose', 'choking', 'bleeding',
  'car accident with injuries', 'emergency', 'fuego', 'incendio', 'humo', 'robo', 'atraco', 'disparo',
  'emergencia', 'no respira', 'inconsciente', 'sangrando', 'ataque al corazon'
];

function isEmergency(qn) {
  // "non-emergency" questions (e.g. asking for the police non-emergency
  // number) are not emergencies; the hyphen normalizes to a space, which
  // would otherwise trip the bare "emergency" keyword.
  if (qn.includes(' non emergency ')) return false;
  // Fire-service questions (fire code, fire department, inspections) are
  // not emergencies either; only the bare emergency words are.
  if (qn.includes(' fire code ') || qn.includes(' fire department ') || qn.includes(' fire prevention ') ||
      qn.includes(' fire inspection ') || qn.includes(' fire official ') || qn.includes(' codigo de incendios ')) return false;
  return EMERGENCY.some((w) => qn.includes(normalize(w)));
}

// Services Saddle Brook does not provide; never let a generic keyword match
// (for example "license") route these to a township office.
const NOT_TOWNSHIP = [
  "driver's license", 'drivers license', 'driver license', 'renew my license plate registration',
  'licencia de conducir', 'car registration renewal', 'vehicle registration renewal', 'passport'
];

const MEETING_HINTS = [
  'meeting', 'council meeting', 'township council', 'town council',
  'next meeting', 'reunion', 'concejo municipal', 'proxima reunion'
];

function matchTopic(qn) {
  let best = null;
  let bestScore = 0;
  for (const topic of index.topics) {
    let score = 0;
    for (const lang of ['en', 'es']) {
      for (const kw of topic.keywords[lang] || []) {
        const nkw = normalize(kw);
        // Whole-word / whole-phrase matching only: the question is space-padded
        // (' ' + normalize(q) + ' '), so padding the keyword the same way means
        // short keywords like "park" can no longer match inside "parking"
        // (which used to send parking questions to Parks & Recreation).
        if (nkw && qn.includes(' ' + nkw + ' ')) score += nkw.split(' ').length + 1;
      }
    }
    if (score > bestScore) { bestScore = score; best = topic; }
  }
  return bestScore > 0 ? best : null;
}

// Current date/time in America/New_York as a comparable number (YYYYMMDDHHmm)
function etNowKey() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date());
  const p = {};
  for (const part of parts) p[part.type] = part.value;
  return Number(`${p.year}${p.month}${p.day}${p.hour}${p.minute}`);
}

function meetingKey(m) {
  const [y, mo, d] = m.date.split('-').map(Number);
  const hh = String(m.hour).padStart(2, '0');
  const mm = String(m.minute).padStart(2, '0');
  return Number(`${y}${String(mo).padStart(2, '0')}${String(d).padStart(2, '0')}${hh}${mm}`);
}

const EN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ES_DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const ES_MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function formatMeetingDate(m, lang) {
  const [y, mo, d] = m.date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  if (lang === 'es') return `${ES_DAYS[dow]}, ${d} de ${ES_MONTHS[mo - 1]} de ${y}`;
  return `${EN_DAYS[dow]}, ${EN_MONTHS[mo - 1]} ${d}, ${y}`;
}

function nextMeetings() {
  const now = etNowKey();
  return meetingsData.meetings.filter((m) => meetingKey(m) > now).slice(0, 3);
}

function meetingAnswer(lang) {
  const upcoming = nextMeetings();
  const contact = [
    { label: lang === 'es' ? 'Oficina del Secretario Municipal' : 'Township Clerk', value: meetingsData.clerkPhone, href: `tel:+1${meetingsData.clerkPhone.replace(/-/g, '')}` },
    { label: lang === 'es' ? 'Página oficial de Reuniones' : 'Official Meetings page', value: meetingsData.source }
  ];
  if (!upcoming.length) {
    return {
      kind: 'answer',
      lead: lang === 'es'
        ? 'No hay otra reunión de la Concejo Municipal publicada en el calendario de 2026.'
        : 'There is no further Township Council meeting published on the 2026 schedule.',
      details: [lang === 'es'
        ? 'La Oficina del Secretario Municipal puede confirmar el calendario de 2027 cuando se publique.'
        : 'The Township Clerk can confirm the 2027 schedule when it is posted.'],
      contact,
      source: meetingsData.source, sourceLabel: meetingsData.sourceLabel
    };
  }
  const [next, ...following] = upcoming;
  const nextDate = formatMeetingDate(next, lang);
  const details = [];
  if (!next.agenda) {
    details.push(lang === 'es'
      ? 'Todavía no se ha publicado la agenda de esta reunión. Las agendas se publican en la página de Reuniones cuando están listas.'
      : 'No agenda has been posted for this meeting yet. Agendas are published on the Meetings page when they are ready.');
  }
  if (following.length) {
    const list = following.map((m) => `${formatMeetingDate(m, lang)}, ${m.timeLabel}`).join('; ');
    details.push(lang === 'es' ? `Las reuniones siguientes son: ${list}.` : `The meetings after that are: ${list}.`);
  }
  details.push(lang === 'es'
    ? 'Todas las reuniones de este calendario se verificaron en la página oficial de Reuniones el 21 de noviembre de 2026.'
    : 'Every meeting on this schedule was verified on the official Meetings page on November 21, 2026.');
  return {
    kind: 'answer',
    lead: lang === 'es'
      ? `La próxima reunión del Concejo Municipal es el ${nextDate} a las ${next.timeLabel} en ${next.location}.`
      : `The next Township Council meeting is ${nextDate} at ${next.timeLabel} at ${next.location}${next.type ? ` (${next.type} Meeting)` : ''}.`,
    details, contact,
    source: meetingsData.source, sourceLabel: meetingsData.sourceLabel
  };
}

function fallbackAnswer(lang, reason) {
  return {
    kind: 'fallback',
    reason: reason || 'not-covered',
    lead: lang === 'es'
      ? 'No tengo una respuesta verificada para eso en las fuentes oficiales del municipio, así que no quiero adivinar.'
      : 'I do not have a verified answer for that in the official township sources, so I do not want to guess.',
    details: [lang === 'es'
      ? 'El número principal del Ayuntamiento puede dirigir su pregunta a la oficina correcta. Este chat no recopila información personal.'
      : 'Town Hall can route your question to the right office. This chat does not collect personal information.'],
    contact: [
      { label: lang === 'es' ? 'Número principal del Ayuntamiento' : 'Town Hall main number', value: HELP_DESK, href: `tel:+1${HELP_DESK.replace(/-/g, '')}` },
      { label: lang === 'es' ? 'Ayuntamiento, número principal' : 'Town Hall main number', value: index.townHall.mainPhone, href: `tel:+1${index.townHall.mainPhone.replace(/-/g, '')}` }
    ],
    source: null, sourceLabel: null
  };
}

function emergencyAnswer(lang) {
  return {
    kind: 'emergency',
    lead: lang === 'es'
      ? 'Esto suena como una emergencia. Llame al 911 ahora mismo.'
      : 'This sounds like an emergency. Call 911 right now.',
    details: [lang === 'es'
      ? 'Este chat no puede enviar ayuda. Para asuntos de policía que no sean emergencias, llame al Ayuntamiento para que lo comuniquen con el departamento correspondiente.'
      : 'This chat cannot dispatch help. For non-emergency police matters, call Town Hall and they will connect you to the right department.'],
    contact: [
      { label: lang === 'es' ? 'Emergencias' : 'Emergency', value: '911', href: 'tel:911' },
      { label: lang === 'es' ? 'Ayuntamiento, número principal' : 'Town Hall main number', value: index.townHall.mainPhone, href: `tel:+1${index.townHall.mainPhone.replace(/-/g, '')}` }
    ],
    source: null, sourceLabel: null
  };
}

// ---------- optional model path (trusted sources only) ----------

function approvedDomains() {
  const domains = [];
  for (const tier of trustedSources.tiers) {
    for (const s of tier.sources) if (s.approved) domains.push(s.domain);
  }
  return domains;
}

function buildModelContext() {
  const facts = index.topics.map((t) => {
    const a = t.en;
    return `TOPIC: ${t.id}\nSOURCE: ${t.source}\n${a.lead} ${a.details.join(' ')}`;
  });
  const m = nextMeetings()[0];
  if (m) {
    facts.push(`TOPIC: next-council-meeting\nSOURCE: ${meetingsData.source}\nThe next Township Council meeting is ${formatMeetingDate(m, 'en')} at ${m.timeLabel} at ${m.location}. Township Clerk: ${meetingsData.clerkPhone}.`);
  }
  return facts.join('\n\n');
}

async function askModel(question, lang) {
  const fallbackText = lang === 'es'
    ? `No tengo una respuesta verificada para eso. Llame al Ayuntamiento al ${HELP_DESK}.`
    : `I do not have a verified answer for that. Please call Town Hall at ${HELP_DESK}.`;
  const prompt = [
    'You are the constituent chatbot for the Township of Saddle Brook, New Jersey.',
    'Answer ONLY from the township facts provided below. Do not use outside knowledge.',
    'The only approved source domains are: ' + approvedDomains().join(', ') + '.',
    'Open with one natural sentence that directly answers the question. Then give brief supporting details.',
    'End by naming the source page from the facts you used.',
    `Answer in ${lang === 'es' ? 'Spanish' : 'English'}, the language of the question.`,
    `If the facts below do not cover the question, reply with exactly this text and nothing else: ${fallbackText}`,
    'Never ask for or repeat personal information.',
    '',
    'TOWNSHIP FACTS:',
    buildModelContext(),
    '',
    'QUESTION: ' + question
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch('https://api.meta.ai/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MODEL_API_KEY}` },
      body: JSON.stringify({ model: MODEL_ID, input: prompt, max_output_tokens: 500 })
    });
    if (!res.ok) return null;
    const payload = await res.json();
    let text = '';
    if (typeof payload.output_text === 'string') text = payload.output_text;
    if (!text && Array.isArray(payload.output)) {
      for (const item of payload.output) {
        for (const block of item.content || []) {
          if (typeof block.text === 'string') text += block.text;
        }
      }
    }
    text = text.trim();
    if (!text) return null;
    if (text === fallbackText) return fallbackAnswer(lang, 'model-insufficient');
    return {
      kind: 'model',
      lead: text.split('\n')[0],
      details: text.split('\n').slice(1).map((s) => s.trim()).filter(Boolean),
      contact: [
        { label: lang === 'es' ? 'Número principal del Ayuntamiento' : 'Town Hall main number', value: HELP_DESK, href: `tel:+1${HELP_DESK.replace(/-/g, '')}` }
      ],
      source: null, sourceLabel: null
    };
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- routes ----------

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'saddle-brook-chatbot',
    modelConfigured: Boolean(MODEL_API_KEY),
    model: MODEL_API_KEY ? MODEL_ID : null,
    topics: index.topics.length,
    meetings: meetingsData.meetings.length,
    indexLastChecked: index.lastChecked
  });
});

app.get('/api/trusted-sources', (req, res) => {
  res.json(trustedSources);
});

app.post('/api/ask', async (req, res) => {
  const question = String((req.body && req.body.question) || '').slice(0, 1000);
  const lang = detectLang(question, req.body && req.body.lang);
  if (!question.trim()) {
    return res.status(400).json({ error: 'question is required' });
  }
  const qn = ' ' + normalize(question) + ' ';

  if (isEmergency(qn)) return res.json({ lang, ...emergencyAnswer(lang) });

  if (NOT_TOWNSHIP.some((w) => qn.includes(normalize(w)))) {
    return res.json({ lang, ...fallbackAnswer(lang, 'not-a-township-service') });
  }

  if (MEETING_HINTS.some((h) => qn.includes(normalize(h)))) {
    return res.json({ lang, ...meetingAnswer(lang) });
  }

  const topic = matchTopic(qn);
  if (topic) {
    const a = topic[lang] || topic.en;
    return res.json({
      lang, kind: 'answer',
      lead: a.lead, details: a.details, contact: a.contact,
      source: topic.source, sourceLabel: topic.sourceLabel
    });
  }

  if (MODEL_API_KEY) {
    const modelResult = await askModel(question, lang);
    if (modelResult) return res.json({ lang, ...modelResult });
  }

  return res.json({ lang, ...fallbackAnswer(lang, MODEL_API_KEY ? 'model-unavailable' : 'no-model-key') });
});

app.listen(PORT, () => {
  console.log(`Saddle Brook chatbot listening on port ${PORT}; model configured: ${Boolean(MODEL_API_KEY)}`);
});
