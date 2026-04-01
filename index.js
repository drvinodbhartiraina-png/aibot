const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const axios = require('axios');
const config = require('./config');
const Conversation = require('./conversation');
const VoiceStreamSession = require('./voice-stream-session');
const WebSocket = require('ws');

// --- Express API Server ---
const app = express();
const port = process.env.PORT || 4000;
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());

const drRainaPath = path.join(__dirname, 'data', 'dr-raina.json');
const tlsEnabled = String(process.env.TLS_ENABLED || '').toLowerCase() === 'true';
const tlsKeyPath = process.env.SSL_KEY_PATH || '';
const tlsCertPath = process.env.SSL_CERT_PATH || '';
const tlsCaPath = process.env.SSL_CA_PATH || '';

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index-live.html'));
});

// GET /api/availability
app.get('/api/availability', (req, res) => {
  // For now, we'll return a static list of available slots.
  const availability = [
    { startTime: '2026-04-01T10:00:00Z', endTime: '2026-04-01T10:30:00Z' },
    { startTime: '2026-04-01T11:00:00Z', endTime: '2026-04-01T11:30:00Z' },
  ];
  res.json(availability);
});

// POST /api/appointments
app.post('/api/appointments', async (req, res) => {
  const { name, mobileno, treatment, message } = req.body;

  if (!name || !mobileno || !treatment || !message) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const response = await axios.post(config.bookingFormUrl, {
      name,
      mobileno,
      treatment,
      message,
    });

    console.log('Successfully submitted booking form:', response.data);
    res.status(201).json({ status: 'success', data: response.data });
  } catch (error) {
    console.error('Error submitting booking form:', error.message);
    res.status(500).json({ error: 'Failed to book appointment' });
  }
});

// POST /api/admin/dr-raina
// Admin endpoint to update `data/dr-raina.json` used by the assistant.
app.post('/api/admin/dr-raina', (req, res) => {
  try {
    const expectedToken = process.env.DR_ADMIN_TOKEN;
    if (expectedToken) {
      const provided = String(req.header('x-admin-token') || '');
      if (!provided || provided !== expectedToken) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    const data = req.body && req.body.data;
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Missing/invalid `data` object in request body.' });
    }

    // Allow partial updates, but keep a predictable shape.
    const next = {
      version: typeof data.version === 'number' ? data.version : 1,
      clinicName: typeof data.clinicName === 'string' ? data.clinicName : undefined,
      doctorName: typeof data.doctorName === 'string' ? data.doctorName : undefined,
      welcomeMessage: typeof data.welcomeMessage === 'string' ? data.welcomeMessage : undefined,
      farewellMessage: typeof data.farewellMessage === 'string' ? data.farewellMessage : undefined,
      supportPhone: typeof data.supportPhone === 'string' ? data.supportPhone : undefined,
      address: typeof data.address === 'string' ? data.address : undefined,
      clinicHours: typeof data.clinicHours === 'object' && data.clinicHours
        ? data.clinicHours
        : undefined
    };

    fs.writeFileSync(drRainaPath, JSON.stringify(next, null, 2), 'utf8');
    res.json({ status: 'ok' });
  } catch (e) {
    console.error('Failed to save dr-raina.json:', e.message);
    res.status(500).json({ error: 'Failed to save Dr. Vinod Raina data.' });
  }
});

function buildTlsOptionsOrThrow() {
  if (!tlsKeyPath || !tlsCertPath) {
    throw new Error('TLS_ENABLED=true requires SSL_KEY_PATH and SSL_CERT_PATH');
  }

  const options = {
    key: fs.readFileSync(path.resolve(tlsKeyPath), 'utf8'),
    cert: fs.readFileSync(path.resolve(tlsCertPath), 'utf8'),
  };

  if (tlsCaPath) {
    options.ca = fs.readFileSync(path.resolve(tlsCaPath), 'utf8');
  }

  return options;
}

// --- HTTP/HTTPS + WebSocket Server for Audio Streaming ---
const server = tlsEnabled
  ? https.createServer(buildTlsOptionsOrThrow(), app)
  : http.createServer(app);

server.listen(port, () => {
  const scheme = tlsEnabled ? 'https' : 'http';
  console.log(`Server listening at ${scheme}://localhost:${port}`);
  if (tlsEnabled) {
    console.log('TLS mode enabled for external WSS integrations.');
  }
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  const wsPath = (req?.url || '').split('?')[0];
  const normalizedPath = String(wsPath || '').trim();

  // Integration endpoint for the vendor's bi-directional voice streaming format.
  // Register your bot with one of:
  // - wss://<host>/voice-stream
  // - wss://<host>/DrRainas/ws/smartflo
  if (normalizedPath === '/voice-stream' || normalizedPath === '/DrRainas/ws/smartflo') {
    console.log('Voice streaming WebSocket connected.');
    const voiceSession = new VoiceStreamSession(ws, req);
    voiceSession.start();
    return;
  }

  console.log('WebSocket client connected.');
  const conversation = new Conversation(ws, wss);
  conversation.start();

  ws.on('close', () => {
    console.log('WebSocket client disconnected.');
  });
});

console.log('SIP/Drachtio mode disabled: using localhost voice chat UI');
