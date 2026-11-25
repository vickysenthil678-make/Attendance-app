const { exec } = require('child_process');
const http = require('http');
const qrcode = require('qrcode-terminal');

let ready = false;
const expoPort = Number(process.env.EXPO_PORT || 8081);
const metroUrl = `http://localhost:${expoPort}`;
const statusUrl = `${metroUrl}/status`;

function checkExpo() {
  if (ready) return;
  const req = http.get(statusUrl, (res) => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => {
      if (ready || res.statusCode !== 200 || body.trim() !== 'packager-status:running') {
        setTimeout(checkExpo, 800);
        return;
      }

      ready = true;
      const lanAddress = process.env.EXPO_LAN_HOST || 'localhost';
      const expoUrl = `exp://${lanAddress}:${expoPort}`;
      console.log('\n[expo] Metro is ready. Scan this QR code with Expo Go:\n');
      qrcode.generate(expoUrl, { small: true });
      console.log(`\n[expo] Expo Go URL: ${expoUrl}\n`);
      console.log(`[preview] Automatically opening ${metroUrl} in browser...\n`);
      const startCmd = process.platform === 'win32' ? `start ${metroUrl}` : process.platform === 'darwin' ? `open ${metroUrl}` : `xdg-open ${metroUrl}`;
      exec(startCmd);
    });
  });
  req.on('error', () => {
    setTimeout(checkExpo, 800);
  });
}

setTimeout(checkExpo, 1000);
