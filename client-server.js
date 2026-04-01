const express = require('express');
const path = require('path');
const WebSocket = require('ws');

const app = express();
const port = 3002;

// Serve static files with cache-busting
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res, path) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// Explicitly route root to live interface
app.get('/', (req, res) => {
  console.log('Serving live interface...');
  res.sendFile(path.join(__dirname, 'public', 'index-live.html'));
});

// Fallback route for any other requests
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index-live.html'));
});

const server = app.listen(port, () => {
  console.log(`Client interface server running at http://localhost:${port}`);
});

// WebSocket proxy to connect to main server
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('Client connected to test interface');
  
  // Connect to main server WebSocket
  const mainWs = new WebSocket('ws://localhost:3001');
  
  mainWs.on('open', () => {
    console.log('Connected to main AI server');
  });
  
  mainWs.on('message', (data) => {
    // Forward messages from main server to client
    // Handle both binary audio data and JSON messages
    if (Buffer.isBuffer(data)) {
      ws.send(data);
    } else {
      ws.send(data);
    }
  });
  
  mainWs.on('close', () => {
    console.log('Disconnected from main AI server');
    ws.close();
  });
  
  mainWs.on('error', (error) => {
    console.error('Main server WebSocket error:', error);
  });
  
  // Forward messages from client to main server
  ws.on('message', (data) => {
    mainWs.send(data);
  });
  
  ws.on('close', () => {
    console.log('Client disconnected');
    mainWs.close();
  });
});
