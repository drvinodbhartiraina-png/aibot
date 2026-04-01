const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('./config');

const knowledgePath = path.join(__dirname, 'data', 'knowledge.json');
const treatmentsPath = path.join(__dirname, 'data', 'treatments.json');
const drRainaPath = path.join(__dirname, 'data', 'dr-raina.json');

const defaultKnowledge = {
  version: 1,
  intents: [
    {
      id: 'greeting',
      triggers: ['hello', 'hi', 'hey'],
      answer: "Hello! Welcome to Dr. Vinod Raina's Safe Hands. How can I help you today?"
    },
    {
      id: 'booking_request',
      triggers: ['appointment', 'book', 'schedule'],
      answer: "I'd be happy to help you book an appointment! {{booking_followup}}"
    }
  ],
  fallback:
    "That's interesting! Based on what you've said, I think I can help you better if you tell me more specifically what you need - whether it's booking an appointment, learning about our services, or clinic information."
};

let knowledgeCache = null;
let knowledgeMtimeMs = 0;

let treatmentsCache = null;
let treatmentsMtimeMs = 0;

let drRainaCache = null;
let drRainaMtimeMs = 0;

const defaultDrRaina = {
  version: 1,
  clinicName: "Dr. Vinod Raina's Safe Hands",
  doctorName: 'Dr. Vinod Raina',
  welcomeMessage: "Welcome to Dr. Vinod Raina's Safe Hands. How can I help you today?",
  farewellMessage: "Thank you for contacting Dr. Vinod Raina's Safe Hands! Have a wonderful day and take care!",
  supportPhone: '9876543210',
  tagline: 'Best sexologist in Delhi and across India',
  address: 'E34 Ekta Apartments, New Delhi 110017, India',
  clinicHours: {
    mondayToSaturday: '9:30 AM to 7:30 PM',
    sunday: '11 AM to 5 PM',
    timezone: 'Asia/Kolkata'
  },
  aboutDoctorVinodRaina: {
    achievments: 'Over 100,000 successful treatments, 99% patient satisfaction rate, 100% privacy guaranteed',
    certifications:
      'Board Certified in Sexology, Member of the American College of Sexologists, Member of the International Society of Sexual Medicine',
    awards: 'Best Sexologist in Delhi, India, Best Sexologist in Asia, Best Sexologist in the World',
    publications:
      'Over 100 publications in peer-reviewed journals, Over 1000 presentations at international conferences',
    education: 'Doctor of Medicine in Sexology, specializes in Sexual Medicine and Sexology, Md in Medicine',
    experience:
      'Over 26 years of experience in sexology, Over 100,000 successful treatments, 99% patient satisfaction rate, 100% privacy guaranteed',
    specializations: 'Sexual Dysfunction, Sexual Pain, Sexual Health, Sexual Behavior, Sexual Medicine, etc.',
    patient_testimonials: 'Over 1000 patient testimonials, 99% patient satisfaction rate, 100% privacy guaranteed',
    patient_feedback: 'Over 1000 patient feedback, 99% patient satisfaction rate, 100% privacy guaranteed',
    patient_reviews: 'Over 1000 patient reviews, 99% patient satisfaction rate, 100% privacy guaranteed',
    patient_stories: 'Over 1000 patient stories, 99% patient satisfaction rate, 100% privacy guaranteed'
  }
};

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function loadKnowledgeBase() {
  try {
    const stat = fs.statSync(knowledgePath);
    if (!knowledgeCache || stat.mtimeMs !== knowledgeMtimeMs) {
      const raw = fs.readFileSync(knowledgePath, 'utf8');
      knowledgeCache = JSON.parse(raw);
      knowledgeMtimeMs = stat.mtimeMs;
    }
  } catch (e) {
    knowledgeCache = defaultKnowledge;
  }
  return knowledgeCache;
}

function loadTreatmentsBase() {
  try {
    const stat = fs.statSync(treatmentsPath);
    if (!treatmentsCache || stat.mtimeMs !== treatmentsMtimeMs) {
      const raw = fs.readFileSync(treatmentsPath, 'utf8');
      treatmentsCache = JSON.parse(raw);
      treatmentsMtimeMs = stat.mtimeMs;
    }
  } catch (e) {
    treatmentsCache = { version: 1, conditions: [] };
  }
  return treatmentsCache;
}

function loadDrRainaBase() {
  try {
    const stat = fs.statSync(drRainaPath);
    if (!drRainaCache || stat.mtimeMs !== drRainaMtimeMs) {
      const raw = fs.readFileSync(drRainaPath, 'utf8');
      drRainaCache = JSON.parse(raw);
      drRainaMtimeMs = stat.mtimeMs;
    }
  } catch (e) {
    drRainaCache = defaultDrRaina;
  }
  return drRainaCache;
}

function renderTemplate(template, vars) {
  return String(template).replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const val = vars[key];
    return val === undefined || val === null ? match : String(val);
  });
}

function titleCase(s) {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function computeIntentScore(intent, lowerText) {
  let score = 0;
  const triggers = Array.isArray(intent.triggers) ? intent.triggers : [];

  for (const trig of triggers) {
    const t = String(trig || '').toLowerCase().trim();
    if (!t) continue;

    // Phrase match (more specific)
    if (t.includes(' ')) {
      if (lowerText.includes(t)) score += Math.min(12, Math.floor(t.length / 3));
      continue;
    }

    // Whole word match first
    const wordRe = new RegExp(`\\b${escapeRegex(t)}\\b`, 'i');
    if (wordRe.test(lowerText)) score += 6;
    else if (lowerText.includes(t)) score += 1; // loose substring
  }

  return score;
}

class Conversation {
  constructor(ws, wss) {
    this.ws = ws;
    this.wss = wss;
    this.state = 'initial';
    this.patientDetails = {};
    this.conversationHistory = [];
    this.booking = {
      active: false,
      preferredDateTime: '',
      notes: ''
    };

    this.ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        if (data && data.type === 'user_text' && typeof data.text === 'string') {
          this.handleResponse(data.text);
          return;
        }
      } catch (e) {
        // ignore non-JSON frames (e.g., old audio streaming client)
      }
    });

    this.ws.on('close', () => {
      console.log('Conversation WebSocket closed.');
    });
  }

  buildClinicHoursFromDrRaina() {
    const dr = loadDrRainaBase() || {};
    const hours = dr.clinicHours || {};
    const mToSat = hours.mondayToSaturday || '9:30 AM to 7:30 PM';
    const sunday = hours.sunday || '11 AM to 5 PM';
    const address = dr.address || 'E34 Ekta Apartments, New Delhi 110017, India';

    return `Our clinic is open Monday to Saturday from ${mToSat} and on Sundays the clinic is from ${sunday}. Would you like to schedule an appointment? Our clinic is at ${address}`;
  }

  buildServiceClosingFromDrRaina(text) {
    const dr = loadDrRainaBase() || {};
    const supportPhone = dr.supportPhone ? String(dr.supportPhone) : '9876543210';
    const extra = `If u want to contact customer support call ${supportPhone}.`;
    return `${text || ''} ${extra}`.trim();
  }

  updatePatientDetailsFromText(text) {
    const lower = String(text || '').toLowerCase();

    // Name
    const nameMatch =
      lower.match(/\b(?:my name is|i am|i'm|name is)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+){0,2})\b/) ||
      lower.match(/\b([a-zA-Z]+)\s+is\s+my\s+name\b/);
    if (nameMatch && nameMatch[1]) {
      this.patientDetails.name = titleCase(nameMatch[1]);
    }

    // Phone number (very lightweight; keeps digits + leading + if present)
    const phoneMatch = lower.match(/(\+?\d[\d\s-]{7,}\d)/);
    if (phoneMatch && phoneMatch[1]) {
      const cleaned = phoneMatch[1].replace(/[^\d+]/g, '');
      if (cleaned) this.patientDetails.mobileno = cleaned;
    }

    // Service / treatment keywords
    const serviceMatch = lower.match(/\b(?:service|treatment)\b\s*(?:is|:)?\s*([a-zA-Z][a-zA-Z\s-]{3,40})/);
    if (serviceMatch && serviceMatch[1]) {
      this.patientDetails.treatment = serviceMatch[1].trim();
    } else {
      // e.g. "for diabetes"
      const forMatch = lower.match(/\bfor\b\s*([a-zA-Z][a-zA-Z\s-]{3,40})/);
      if (forMatch && forMatch[1] && !this.patientDetails.treatment) {
        this.patientDetails.treatment = forMatch[1].trim();
      }
    }

    // Broader treatment inference (e.g. "I need nightfall treatment", "ED", "premature ejaculation")
    if (!this.patientDetails.treatment) {
      const inferred = this.inferTreatmentFromText(text);
      if (inferred) this.patientDetails.treatment = inferred;
    }

    // Preferred date/time (lightweight)
    const dtMatch =
      lower.match(/\b(?:on|for)\s+((?:\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)|(?:today|tomorrow)|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))(?:\s+at\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?))?/i) ||
      lower.match(/\b([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm))\b/i);
    if (dtMatch) {
      const dayPart = dtMatch[1] ? dtMatch[1].trim() : '';
      const timePart = dtMatch[2] ? dtMatch[2].trim() : (dtMatch[0] ? dtMatch[0].trim() : '');
      const combined = `${dayPart} ${timePart}`.trim();
      if (combined) this.booking.preferredDateTime = combined;
    }

    // Notes (during booking, keep a short summary)
    const noteCue = lower.match(/\b(?:problem is|issue is|my problem|i have|i am suffering from)\b(.+)$/i);
    if (noteCue && noteCue[1]) {
      const n = noteCue[1].trim();
      if (n.length >= 6) this.booking.notes = n;
    } else if (this.booking.active) {
      const t = String(text || '').trim();
      if (t.length >= 10) this.booking.notes = t;
    }
  }

  inferTreatmentFromText(text) {
    const t = String(text || '').toLowerCase();

    // Prefer structured conditions if present
    const cond = this.detectConditionFromText(text);
    if (cond?.name) return cond.name;

    // Common clinic service keywords (from your services list)
    const serviceKeywords = [
      'nightfall',
      'night fall',
      'masturbation',
      'dhat',
      'premature ejaculation',
      'erectile dysfunction',
      'sexual weakness',
      'std',
      'sti',
      'infertility',
      'low libido',
      'anxiety'
    ];

    for (const k of serviceKeywords) {
      if (t.includes(k)) {
        if (k === 'night fall') return 'NightFall Treatment';
        if (k === 'nightfall') return 'NightFall Treatment';
        if (k === 'masturbation') return 'Masturbation Treatment';
        if (k === 'dhat') return 'Dhat';
        if (k === 'std' || k === 'sti') return 'Sexually Transmitted Diseases';
        if (k === 'infertility') return 'Infertility';
        if (k === 'low libido') return 'Low Libido Treatment';
        if (k === 'anxiety') return 'Anxiety Disorders';
        return titleCase(k);
      }
    }

    return '';
  }

  isBookingIntent(lowerText, bestIntent) {
    if (bestIntent?.id === 'booking_request') return true;
    return /\b(book|booking|appointment|schedule|consultation)\b/.test(lowerText);
  }

  async handleBookingTurn(userText) {
    this.booking.active = true;

    const name = (this.patientDetails.name || '').trim();
    const mobileno = (this.patientDetails.mobileno || '').trim();
    const treatment = (this.patientDetails.treatment || '').trim();
    const preferredDateTime = (this.booking.preferredDateTime || '').trim();
    const notes = (this.booking.notes || '').trim();

    if (!name) return 'Sure — what is your full name?';
    if (!mobileno) return `Thanks ${name}. Please share your phone number (with country code if possible).`;
    if (!treatment) {
      return `Thanks ${name}. What treatment or concern would you like help with (for example: ED, premature ejaculation, nightfall, STI/STD, infertility)?`;
    }
    if (!preferredDateTime) return `Got it. What day and time would you prefer for the appointment?`;
    if (!notes || notes.length < 6) return `Thanks. Briefly describe the problem in 1–2 lines so the doctor can prepare.`;

    const message = `Preferred appointment: ${preferredDateTime}\nNotes: ${notes}`;

    try {
      if (!config.bookingFormUrl) {
        return `I can take your details, but booking is not configured yet (missing BOOKING_FORM_URL).`;
      }

      await axios.post(
        config.bookingFormUrl,
        { name, mobileno, treatment, message },
        { timeout: 15000 }
      );

      this.booking.active = false;
      return `Done — I’ve submitted your booking request for **${treatment}**. Our team will contact you on **${mobileno}** to confirm the slot (${preferredDateTime}). Anything else I can help with?`;
    } catch (e) {
      return `I collected everything, but the booking submission failed right now. Would you like to try again?`;
    }
  }

  detectConditionFromText(text) {
    const t = String(text || '').toLowerCase();
    const base = loadTreatmentsBase();
    const conditions = Array.isArray(base.conditions) ? base.conditions : [];

    let best = null;
    let bestScore = 0;

    for (const c of conditions) {
      const aliases = [c.name, ...(Array.isArray(c.aliases) ? c.aliases : [])]
        .map((x) => String(x || '').toLowerCase().trim())
        .filter(Boolean);

      let score = 0;
      for (const a of aliases) {
        if (!a) continue;
        if (a.length <= 3) {
          // short alias like "ed", "pe" must match whole word
          const re = new RegExp(`\\b${escapeRegex(a)}\\b`, 'i');
          if (re.test(t)) score += 4;
        } else if (t.includes(a)) {
          score += Math.min(10, Math.floor(a.length / 4) + 2);
        }
      }

      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }

    return bestScore > 0 ? best : null;
  }

  buildConditionEducationResponse(condition) {
    const name = this.patientDetails.name || '';
    const header = name ? `Thanks ${name}.` : '';
    const what = condition.what_it_is ? `**What it is:** ${condition.what_it_is}` : '';

    const severity = Array.isArray(condition.how_severe_can_it_be) ? condition.how_severe_can_it_be : [];
    const sevLine = severity.length ? `**How severe can it be:** ${severity.slice(0, 3).join(' ')}` : '';

    const redFlags = Array.isArray(condition.red_flags) ? condition.red_flags : [];
    const redFlagLine = redFlags.length
      ? `**When to seek urgent medical help:** ${redFlags.slice(0, 2).join('; ')}.`
      : '';

    const tx = Array.isArray(condition.suggested_treatments) ? condition.suggested_treatments : [];
    const txLine = tx.length ? `**Common treatment/next steps:** ${tx.slice(0, 3).join('; ')}.` : '';

    const safe = `I can share general information, but I can’t diagnose over chat. If you want, I can help you book a doctor consultation.`;

    return [header, `You mentioned **${condition.name}**.`, what, sevLine, txLine, redFlagLine, safe]
      .filter(Boolean)
      .join(' ');
  }

  buildTreatmentSuggestionFromProblemText(text) {
    const condition = this.detectConditionFromText(text);
    if (!condition) return null;
    return this.buildConditionEducationResponse(condition);
  }

  buildDoctorInfoResponse(text) {
    const lower = String(text || '').toLowerCase();
    const mentionsDoctor = this.isDoctorTopic(text);
    if (!mentionsDoctor) return null;

    const dr = loadDrRainaBase() || {};
    const about = dr.aboutDoctorVinodRaina || {};
    const clinicName = dr.clinicName || "Dr. Vinod Raina's Safe Hands";
    const tagline = dr.tagline || '';

    const phoneList = Array.isArray(dr.supportPhone) ? dr.supportPhone : (dr.supportPhone ? [dr.supportPhone] : []);
    const phones = phoneList.filter(Boolean).join(', ');

    const parts = [];
    parts.push(`Dr. Vinod Raina is the lead sexologist at **${clinicName}**.`);
    if (tagline) parts.push(tagline);
    if (about.experience) parts.push(about.experience);
    if (about.specializations) parts.push(`Key specializations: ${about.specializations}.`);
    if (about.certifications) parts.push(about.certifications);
    if (about.awards) parts.push(about.awards);
    if (about.education) parts.push(`Education: ${about.education}.`);

    if (phones) {
      parts.push(`For a confidential consultation, you can call us on ${phones}.`);
    }

    parts.push('If you like, I can help you book an appointment with him now.');

    return parts.filter(Boolean).join(' ');
  }

  isDoctorTopic(text) {
    const lower = String(text || '').toLowerCase();
    return (
      /\bdoctor\b/.test(lower) ||
      /\bdoc\b/.test(lower) ||
      /\bdr\.?\b/.test(lower) ||
      /\bdr\s+[a-z]+\b/.test(lower) ||
      /\bsexologist\b/.test(lower) ||
      /\bwho is the (best )?doctor\b/.test(lower) ||
      /\bwhich doctor\b/.test(lower) ||
      /\babout (the )?doctor\b/.test(lower) ||
      /\bdr\.?\s*raina\b/.test(lower) ||
      /\bdr\.?\s*vinod\b/.test(lower) ||
      /\bvinod raina\b/.test(lower)
    );
  }

  async handleResponse(text) {
    console.log(`User said: ${text}`);

    this.updatePatientDetailsFromText(text);

    // Add to conversation history
    this.conversationHistory.push({ type: 'user', text, timestamp: Date.now() });

    const response = await this.generateResponse(text);
    await this.say(response);

    this.conversationHistory.push({ type: 'ai', text: response, timestamp: Date.now() });
  }

  async generateResponse(text) {
    const knowledge = loadKnowledgeBase();
    const lowerText = String(text || '').toLowerCase();

    const apiKey = process.env.GOOGLE_API_KEY;

    // Local deterministic draft (fast + safe), then we rewrite it via LLM when available.
    const conditionHit = this.detectConditionFromText(text);
    const educationCue =
      /\b(what is|what's|meaning|define|explain|tell me about)\b/.test(lowerText) ||
      /\b(severe|severity|danger|serious|worried|how bad)\b/.test(lowerText) ||
      /\b(i have|suffering from|problem|issue|symptom|can't|cannot)\b/.test(lowerText);
    const doctorTopic = this.isDoctorTopic(text);

    let localResponse = '';

    const intents = Array.isArray(knowledge.intents) ? knowledge.intents : [];
    let bestIntent = null;
    let bestScore = -1;

    for (const intent of intents) {
      const score = computeIntentScore(intent, lowerText);
      if (score > bestScore) {
        bestScore = score;
        bestIntent = intent;
      }
    }

    // Hard rule: if user asks about any doctor, always answer about Dr. Vinod Raina.
    if (doctorTopic) {
      localResponse = this.buildDoctorInfoResponse(text);
    }
    // Booking flow: collect details and submit booking automatically
    else if (this.booking.active || this.isBookingIntent(lowerText, bestIntent)) {
      localResponse = await this.handleBookingTurn(text);
    } else if (conditionHit && educationCue) {
      localResponse = this.buildConditionEducationResponse(conditionHit);
    } else if (!bestIntent || bestScore <= 0) {
      const doctorInfo = this.buildDoctorInfoResponse(text);
      const suggestion = this.buildTreatmentSuggestionFromProblemText(text);
      localResponse = doctorInfo || suggestion || knowledge.fallback || defaultKnowledge.fallback;
    } else {
      const name = this.patientDetails.name || '';
      const treatment = this.patientDetails.treatment || '';

      if (bestIntent.id === 'clinic_hours') {
        localResponse = this.buildClinicHoursFromDrRaina();
      } else if (bestIntent.id === 'thanks') {
        localResponse = this.buildServiceClosingFromDrRaina(`You're very welcome! Is there anything else I can help you with today?`);
      } else if (bestIntent.id === 'goodbye') {
        localResponse = this.buildServiceClosingFromDrRaina(`Thank you for contacting Dr. Vinod Raina's Safe Hands! Have a wonderful day and take care!`);
      } else if (bestIntent.id === 'greeting') {
        const dr = loadDrRainaBase() || {};
        localResponse = dr?.welcomeMessage || renderTemplate(bestIntent.answer, { name });
      } else if (bestIntent.id === 'services_info') {
        const concise = this.summarizeServicesFromAnswer(text, bestIntent.answer);
        let followup = '';
        if (treatment) followup = `Got it. Would you like to book an appointment for ${treatment}?`;
        else followup = `Which concern should we focus on? If you tell me what you're dealing with, I can help you book an appointment.`;

        localResponse = name ? `Thanks ${name}. ${concise} ${followup}` : `${concise} ${followup}`;
      } else {
        // Default templated response
        let booking_followup = '';
        if (!name && !treatment) {
          booking_followup = 'Could you please tell me your name and what type of service you need?';
        } else if (!name && treatment) {
          booking_followup = `Could you please tell me your name for the {{treatment}} you mentioned?`;
        } else if (name && !treatment) {
          booking_followup = `Thanks ${name}! What type of service are you looking for?`;
        } else {
          booking_followup = `Great ${name}. I can help you with {{treatment}}. What day/time works best for you?`;
        }

        localResponse = renderTemplate(bestIntent.answer, {
          name,
          treatment,
          mobileno: this.patientDetails.mobileno || '',
          booking_followup: renderTemplate(booking_followup, { treatment })
        });
      }
    }

    // "Constantly uses API key": when available, rewrite every localResponse through Gemini.
    if (apiKey && typeof localResponse === 'string' && localResponse.trim()) {
      const smart = await this.generateSmartLLMReply(text, {
        apiKey,
        bestIntent,
        bestScore,
        localResponse,
        conditionHit,
        educationCue,
        bookingActive: Boolean(this.booking.active)
      });
      return smart || localResponse;
    }

    return (localResponse && localResponse.trim())
      ? localResponse
      : (knowledge.fallback || defaultKnowledge.fallback);
  }

  async generateSmartLLMReply(
    userText,
    { apiKey, bestIntent, bestScore, localResponse, conditionHit, educationCue, bookingActive }
  ) {
    try {
      if (!apiKey) return null;

      const knowledge = loadKnowledgeBase();
      const treatments = loadTreatmentsBase();
      const drRaina = loadDrRainaBase();

      // Keep context short and grounded.
      const lastTurns = this.conversationHistory.slice(-10).map((m) => ({
        role: m.type === 'user' ? 'user' : 'assistant',
        text: m.text
      }));

      // Provide concise clinic facts and condition education as "grounding"
      const grounding = {
        dr_raina: {
          clinicName: drRaina?.clinicName || "Dr. Vinod Raina's Safe Hands",
          doctorName: drRaina?.doctorName || 'Dr. Vinod Raina',
          supportPhone: drRaina?.supportPhone || '9876543210',
          address: drRaina?.address || '',
          clinicHours: drRaina?.clinicHours || {},
          tagline: drRaina?.tagline || 'Best sexologist in Delhi and across India'
        },
        clinic_intents: (knowledge.intents || []).map((i) => ({ id: i.id, triggers: i.triggers, answer: i.answer })),
        conditions: (treatments.conditions || []).map((c) => ({
          id: c.id,
          name: c.name,
          aliases: c.aliases,
          what_it_is: c.what_it_is,
          how_severe_can_it_be: c.how_severe_can_it_be,
          red_flags: c.red_flags,
          suggested_treatments: c.suggested_treatments,
          questions_to_ask: c.questions_to_ask
        })),
        patient_details: this.patientDetails
      };

      const system = [
        `You are a helpful clinic voice assistant for ${drRaina?.clinicName || "Dr. Vinod Raina's Safe Hands"}.`,
        `Doctor: ${drRaina?.doctorName || 'Dr. Vinod Raina'}.`,
        `Tagline: ${drRaina?.tagline || 'Best sexologist in Delhi and across India'}.`,
        `You must be concise (2-5 sentences).`,
        `If the user mentions any doctor (doctor/dr/doc/sexologist or any doctor name), always talk about ${drRaina?.doctorName || 'Dr. Vinod Raina'} only.`,
        `You will be given: (1) localResponse (a safe, deterministic draft), and (2) JSON grounding with clinic/condition info.`,
        `Rewrite localResponse to sound more natural and empathetic, while staying faithful to the meaning.`,
        `Do NOT invent facts not in the grounding.`,
        `Medical safety: provide general info only; do not diagnose.`,
        `If the user mentions urgent red flags, include a brief safety line about seeking urgent medical help.`,
        `If booking is active, do NOT remove any required questions already present in localResponse (name/phone/date/time/notes). Keep any digits (phone/time) intact.`,
        `Return ONLY the final message text (no JSON, no extra commentary).`
      ].join(' ');

      const prompt = {
        system,
        meta: {
          bestIntent: bestIntent?.id || null,
          bestScore: bestScore || 0,
          educationCue: Boolean(educationCue),
          bookingActive: Boolean(bookingActive)
        },
        grounding,
        conversation: lastTurns,
        user: userText,
        localResponse: String(localResponse || ''),
        conditionHit: conditionHit?.id || null
      };

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;

      // Retry once on transient failures so the assistant feels responsive.
      const attempts = 2;
      let text = '';
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          const resp = await axios.post(
            url,
            {
              contents: [
                { role: 'user', parts: [{ text: JSON.stringify(prompt) }] }
              ],
              generationConfig: {
                temperature: 0.35,
                maxOutputTokens: 220
              }
            },
            { timeout: 12000 }
          );

          text =
            resp?.data?.candidates?.[0]?.content?.parts
              ?.map((p) => p.text)
              .filter(Boolean)
              .join(' ')
              ?.trim() || '';

          if (text) break;
        } catch (e) {
          // try again
        }
      }

      return text || null;
    } catch (e) {
      return null;
    }
  }

  summarizeServicesFromAnswer(userText, servicesAnswer) {
    const answer = String(servicesAnswer || '');
    const lowerUser = String(userText || '').toLowerCase();

    // Extract the "services list" portion from the long answer.
    const marker = 'including:';
    const idx = answer.toLowerCase().indexOf(marker);

    const closingMarker = 'our experienced team';
    const closingIdx = answer.toLowerCase().indexOf(closingMarker);

    const listSection = idx >= 0
      ? (closingIdx > idx ? answer.slice(idx + marker.length, closingIdx) : answer.slice(idx + marker.length))
      : answer;

    const rawItems = listSection
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

    // Clean items: drop empty headings and lines with too many sentence markers.
    const items = rawItems
      .map((s) => s.replace(/^[-*•]\s*/, '').trim())
      .filter((s) => s.length >= 3);

    const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
    const userNorm = normalize(lowerUser);

    // Score each item by overlap with user text.
    const scored = items.map((item) => {
      const itemNorm = normalize(item);
      let score = 0;

      // Exact phrase-ish matches for common symptoms/treatments
      if (itemNorm && userNorm) {
        if (userNorm.includes(itemNorm)) score += 10;
        // Token overlap
        const userTokens = new Set(userNorm.split(/\s+/).filter((t) => t.length >= 4));
        const itemTokens = itemNorm.split(/\s+/).filter((t) => t.length >= 4);
        for (const t of itemTokens) {
          if (userTokens.has(t)) score += 1;
        }
      }

      // Also treat short high-signal keywords as boosters
      const boosters = ['ed', 'erectile', 'premature', 'ejaculation', 'nightfall', 'dh', 'dhat', 'hiv', 'std', 'sti', 'infertility', 'low libido', 'anxiety'];
      for (const b of boosters) {
        if (lowerUser.includes(b) && itemNorm.includes(b.split(' ')[0])) score += 2;
      }

      return { item, score };
    });

    scored.sort((a, b) => b.score - a.score);

    const topScored = scored.filter((x) => x.score > 0).slice(0, 4);
    if (topScored.length >= 2) {
      return `We can help with concerns such as ${topScored.map((x) => x.item).join(', ')}.`;
    }

    // Fallback: summarize with the first few items (but still short).
    const fallbackItems = items.slice(0, 4);
    return `We can help with concerns such as ${fallbackItems.join(', ')}.`;
  }

  async start() {
    console.log('Starting conversation flow...');
    const dr = loadDrRainaBase();
    await this.say(dr?.welcomeMessage || "Welcome to Dr. Vinod Raina's Safe Hands. How can I help you today?");
  }

  async say(text) {
    console.log(`Agent: ${text}`);

    try {
      if (this.ws.readyState === 1) {
        this.ws.send(
          JSON.stringify({
            type: 'ai_text',
            text: text
          })
        );
      }
    } catch (err) {
      console.error('Error sending response:', err.message);
    }
  }

  async confirmBooking() {
    await this.say(
      'I can help you book an appointment! Could you please tell me your name and what type of service you need?'
    );
  }

  async submitBooking() {
    await this.say(
      "Thank you! I've noted your appointment request. Our team will contact you shortly to confirm the details. Is there anything else I can help you with?"
    );
  }

  async sayGoodbye() {
    const dr = loadDrRainaBase();
    const msg = dr?.farewellMessage || "Thank you for contacting Dr. Vinod Raina's Safe Hands! Have a wonderful day and take care!";
    const supportPhone = dr?.supportPhone ? String(dr.supportPhone) : '';
    await this.say(supportPhone ? `${msg} If u want to contact customer support call ${supportPhone}.` : msg);
    if (this.ws.close) this.ws.close();
  }
}

module.exports = Conversation;
