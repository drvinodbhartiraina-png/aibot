# External TLS / WSS setup

Use this when your voice platform requires a secure URL like:
`wss://voice.menshealthindelhi.com:4000/DrRainas/ws/smartflo`

## 1) Enable TLS in app

Set these env vars in `.env`:

```env
TLS_ENABLED=true
SSL_KEY_PATH=C:\path\to\privkey.pem
SSL_CERT_PATH=C:\path\to\fullchain.pem
# optional:
# SSL_CA_PATH=C:\path\to\chain.pem
```

Then restart:

```bash
npm run dev
```

The app serves HTTPS/WSS directly on `PORT` and supports:

- `/voice-stream`
- `/DrRainas/ws/smartflo`

## Recommended: External TLS via Caddy (automatic Let's Encrypt)

This is the simplest production setup.

1. Point a domain to your server IP:
   - Create DNS `A` record: `voice.yourdomain.com -> 202.173.124.29`
2. Open inbound firewall/NAT:
   - TCP `80` and `443` must be reachable from the public internet.
3. Keep Node running in HTTP mode:
   - `TLS_ENABLED=false`
   - `PORT=4000`
4. Edit `Caddyfile`:
   - Replace `voice.yourdomain.com` with your domain
   - Replace `email you@example.com` with your email
5. Start Caddy with Docker:

```bash
docker compose -f docker-compose.tls.yml up -d
```

6. Use this as your Smartflo endpoint:
   - `wss://voice.yourdomain.com/DrRainas/ws/smartflo`

## 2) Certificate requirement (important)

For production integrations, use a trusted CA certificate that matches your host.

- Best practice: use a DNS hostname (example: `voice.yourdomain.com`) and issue cert via Let's Encrypt.
- IP-only `wss://<ip>:port` is often rejected by TLS verification on platforms.

## 3) Open firewall / router

Allow inbound TCP on your app port (default `4000`) from the vendor IP ranges.

## 4) Quick test

From another machine:

- HTTPS health: `https://<host>:4000/`
- WSS endpoint: `wss://<host>:4000/DrRainas/ws/smartflo`

If handshake fails, verify:

- cert/key paths are correct
- certificate CN/SAN matches the host
- firewall/NAT is open

