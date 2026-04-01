const { v4: uuidv4 } = require('uuid');

function isObject(x) {
  return x && typeof x === 'object' && !Array.isArray(x);
}

function toIntOr(defaultValue, value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : defaultValue;
}

class VoiceStreamSession {
  constructor(ws, req) {
    this.ws = ws;
    this.req = req;
    this.streamSid = null;
    this.callSid = null;
    this.accountSid = null;
    this.sequenceNumber = 0;
    this.outChunk = 0;
    this.startedAt = Date.now();
    this.inboundChunks = 0;
    this.lastInboundTimestampMs = 0;
    this.customParameters = {};
  }

  start() {
    this.ws.on('message', (raw) => this.handleMessage(raw));
    this.ws.on('close', () => this.handleClose());
    this.ws.on('error', (err) => {
      console.error('[voice-stream] socket error:', err.message);
    });
  }

  handleClose() {
    const elapsed = Date.now() - this.startedAt;
    console.log(
      `[voice-stream] closed streamSid=${this.streamSid || 'n/a'} callSid=${this.callSid || 'n/a'} chunks=${this.inboundChunks} elapsedMs=${elapsed}`
    );
  }

  sendEvent(obj) {
    if (this.ws.readyState !== 1) return;
    const payload = JSON.stringify(obj);
    this.ws.send(payload);
  }

  nextSequenceNumber() {
    this.sequenceNumber += 1;
    return String(this.sequenceNumber);
  }

  sendMark(name) {
    if (!this.streamSid) return;
    this.sendEvent({
      event: 'mark',
      sequenceNumber: this.nextSequenceNumber(),
      streamSid: this.streamSid,
      mark: { name: String(name || `mark-${Date.now()}`) }
    });
  }

  sendClear() {
    if (!this.streamSid) return;
    this.sendEvent({
      event: 'clear',
      sequenceNumber: this.nextSequenceNumber(),
      streamSid: this.streamSid
    });
  }

  // Use this hook to send AI TTS audio (mulaw/8000 base64) back to the voice platform.
  sendBotAudioBase64(base64Payload, markName) {
    if (!this.streamSid || !base64Payload) return;
    this.outChunk += 1;
    this.sendEvent({
      event: 'media',
      sequenceNumber: this.nextSequenceNumber(),
      streamSid: this.streamSid,
      media: {
        chunk: this.outChunk,
        payload: String(base64Payload)
      }
    });
    if (markName) this.sendMark(markName);
  }

  handleConnected(msg) {
    if (msg.event !== 'connected') return;
    console.log('[voice-stream] connected handshake received');
  }

  handleStart(msg) {
    if (!isObject(msg.start)) return;
    this.streamSid = msg.start.streamSid || msg.streamSid || `MZ_${uuidv4()}`;
    this.callSid = msg.start.callSid || null;
    this.accountSid = msg.start.accountSid || null;
    this.customParameters = isObject(msg.start.customParameters) ? msg.start.customParameters : {};

    const format = isObject(msg.start.mediaFormat) ? msg.start.mediaFormat : {};
    const encoding = String(format.encoding || '').toLowerCase();
    const sampleRate = toIntOr(0, format.sampleRate);

    if (encoding && encoding !== 'audio/x-mulaw') {
      console.warn(`[voice-stream] unexpected encoding="${encoding}" (expected audio/x-mulaw)`);
    }
    if (sampleRate && sampleRate !== 8000) {
      console.warn(`[voice-stream] unexpected sampleRate=${sampleRate} (expected 8000)`);
    }

    console.log(
      `[voice-stream] start streamSid=${this.streamSid} callSid=${this.callSid || 'n/a'} from=${msg.start.from || 'n/a'} to=${msg.start.to || 'n/a'}`
    );
  }

  handleMedia(msg) {
    if (!isObject(msg.media)) return;
    const payload = String(msg.media.payload || '');
    if (!payload) return;

    this.inboundChunks += 1;
    this.lastInboundTimestampMs = toIntOr(this.lastInboundTimestampMs, msg.media.timestamp);

    // Integration-ready hook:
    // 1) decode payload from base64 mulaw/8000
    // 2) feed to STT/LLM/TTS pipeline
    // 3) call this.sendBotAudioBase64(ttsBase64, 'ai-response-X')
  }

  handleStop(msg) {
    const reason = msg?.stop?.reason || 'unknown';
    console.log(`[voice-stream] stop streamSid=${this.streamSid || 'n/a'} reason="${reason}"`);
  }

  handleDtmf(msg) {
    const digit = msg?.dtmf?.digit;
    if (!digit) return;
    console.log(`[voice-stream] dtmf digit=${digit} streamSid=${this.streamSid || 'n/a'}`);
  }

  handleMark(msg) {
    const name = msg?.mark?.name;
    if (!name) return;
    console.log(`[voice-stream] mark ack name="${name}" streamSid=${this.streamSid || 'n/a'}`);
  }

  handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch (e) {
      return;
    }
    if (!isObject(msg) || !msg.event) return;

    switch (msg.event) {
      case 'connected':
        this.handleConnected(msg);
        break;
      case 'start':
        this.handleStart(msg);
        break;
      case 'media':
        this.handleMedia(msg);
        break;
      case 'dtmf':
        this.handleDtmf(msg);
        break;
      case 'mark':
        this.handleMark(msg);
        break;
      case 'stop':
        this.handleStop(msg);
        break;
      default:
        console.warn(`[voice-stream] unknown event "${msg.event}"`);
        break;
    }
  }
}

module.exports = VoiceStreamSession;

