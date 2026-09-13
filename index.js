import express from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __path = path.dirname(__filename);

const PORT = process.env.PORT || 8000;

// Pair / Bot Router
import { router as code } from './pair.js';

// Increase max listeners
EventEmitter.defaultMaxListeners = 500;

// Body parser
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Static files
// public/style.css
// public/app.js
// public/images/...
app.use(express.static(path.join(__path, 'public')));

// Pairing API
app.use('/code', code);

// Pair Page
app.get('/pair', (req, res) => {
    res.sendFile(path.join(__path, 'pair.html'));
});

// Main Website
app.get('/', (req, res) => {
    res.sendFile(path.join(__path, 'main.html'));
});

// Health Check
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'online',
        bot: 'ZESR MOVIE BOT',
        time: new Date().toISOString()
    });
});

// Start Server
app.listen(PORT, () => {
    console.log(`
███████╗███████╗███████╗██████╗
╚══███╔╝██╔════╝██╔════╝██╔══██╗
  ███╔╝ █████╗  ███████╗██████╔╝
 ███╔╝  ██╔══╝  ╚════██║██╔══██╗
███████╗███████╗███████║██║  ██║
╚══════╝╚══════╝╚══════╝╚═╝  ╚═╝

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💚 ZESR MOVIE BOT
🤖 BOT STATUS : STARTED
🌐 PORT       : ${PORT}
🔗 LOCAL URL  : http://localhost:${PORT}
🔐 PAIR PAGE  : http://localhost:${PORT}/pair
❤️ HEALTH     : http://localhost:${PORT}/health
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
});

export default app;
