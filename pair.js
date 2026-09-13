import express from 'express';
import fs from 'fs-extra';
import path from 'path';
import sharp from 'sharp';
import mongoose from 'mongoose';
import moment from 'moment-timezone';
import https from 'https';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

import {
  default as makeWASocket,
  useMultiFileAuthState,
  delay,
  Browsers,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  generateWAMessageFromContent,
  proto
} from '@whiskeysockets/baileys';

export const router = express.Router();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const insecureAgent = new https.Agent({ rejectUnauthorized: false });

const config = {
  AUTO_RECORDING: 'false',
  AUTO_TYPING: 'false',
  AUTO_REACT: 'false',
  READ_CMD: 'false',
  API_MAIN_URL: process.env.API_MAIN_URL || 'https://api-siteh-22e22e4cb068.herokuapp.com',
  API_MAIN_URL2: process.env.API_MAIN_URL2 || 'https://api.laksidu.site',
  API_KEY: process.env.API_KEY || '',
  BOT_IMAGE: process.env.BOT_IMAGE || 'https://files.catbox.moe/4z8x2j.jpg',
  BOT_FOOTER: process.env.BOT_FOOTER || 'Zᴇꜱʀ ✘ 〽️ᴏᴠɪᴇ Bᴏᴛ ᴠ1.1',
  MGROUP_LINK: process.env.MGROUP_LINK || 'https://chat.whatsapp.com/JpFSNrnqtnQIqdM0WlNds1',
  MOVIE_FOOTER: process.env.MOVIE_FOOTER || '⏤͟͟͞͞★❮ ZESR 〽️OVIE ❯★',
  MOVIE_CAPTION: process.env.MOVIE_CAPTION || 'ZESR MOVIE',
  PREFIX: process.env.PREFIX || '.',
  OWNER_NUMBERS: (process.env.OWNER_NUMBERS || '947XXXXXXXX').split(',').map(x => x.replace(/\D/g, '')).filter(Boolean),
  BOT_NAME: process.env.BOT_NAME || 'ZESR-MD',
  AIR_FOOTER: process.env.AIR_FOOTER || 'ZESR BOT v2.0.0',
  MODE: process.env.MODE || 'public',
  MAX_RETRIES: 3
};

const activeSockets = new Map();
const socketCreationTime = new Map();
const SESSION_BASE_PATH = './session';
const NUMBER_LIST_PATH = './numbers.json';

const SessionSchema = new mongoose.Schema({
  number: { type: String, unique: true, required: true },
  creds: { type: Object, required: true },
  config: { type: Object },
  updatedAt: { type: Date, default: Date.now }
});
const Session = mongoose.models.Session || mongoose.model('Session', SessionSchema);

async function connectMongoDB() {
  try {
    if (!process.env.MONGO_URI) return console.log('⚠️ MONGO_URI missing');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB Connected');
  } catch (e) {
    console.error('MongoDB error:', e.message);
  }
}
connectMongoDB();
fs.ensureDirSync(SESSION_BASE_PATH);

const formatMessage = (title, content, footer) => `*${title}*\n\n${content}\n\n> *${footer}*`;
const getSriLankaTimestamp = () => moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss');

async function loadUserConfig(number) {
  try {
    const doc = await Session.findOne({ number }, 'config');
    return { ...config, ...(doc?.config || {}) };
  } catch {
    return { ...config };
  }
}

async function updateUserConfig(number, newConfig) {
  await Session.findOneAndUpdate(
    { number },
    { config: newConfig, updatedAt: new Date() },
    { upsert: true }
  );
}

async function saveSession(number, creds) {
  try {
    await Session.findOneAndUpdate(
      { number },
      { creds, updatedAt: new Date() },
      { upsert: true }
    );
    let numbers = [];
    if (fs.existsSync(NUMBER_LIST_PATH)) {
      try { numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8')); } catch {}
    }
    if (!numbers.includes(number)) {
      numbers.push(number);
      fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
    }
  } catch (e) {
    console.error('saveSession:', e.message);
  }
}

async function restoreSession(number) {
  try {
    const session = await Session.findOne({ number });
    if (!session?.creds?.me?.id) return null;
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${number}`);
    fs.ensureDirSync(sessionPath);
    fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(session.creds, null, 2));
    return session.creds;
  } catch {
    return null;
  }
}

async function deleteSession(number) {
  try {
    await Session.deleteOne({ number });
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${number}`);
    if (fs.existsSync(sessionPath)) fs.removeSync(sessionPath);
    if (fs.existsSync(NUMBER_LIST_PATH)) {
      let numbers = [];
      try { numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8')); } catch {}
      numbers = numbers.filter(n => n !== number);
      fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
    }
  } catch (e) {
    console.error('deleteSession:', e.message);
  }
}

function getIncomingText(msg) {
  if (msg.message?.conversation) return msg.message.conversation.trim();
  if (msg.message?.extendedTextMessage?.text) return msg.message.extendedTextMessage.text.trim();
  if (msg.message?.buttonsResponseMessage?.selectedButtonId) return msg.message.buttonsResponseMessage.selectedButtonId.trim();
  if (msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId) return msg.message.listResponseMessage.singleSelectReply.selectedRowId.trim();
  const paramsJson = msg.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
  if (paramsJson) {
    try {
      const p = JSON.parse(paramsJson);
      return String(p.id || p.button_id || p.selectedId || '').trim();
    } catch {}
  }
  return '';
}

async function sendNativeButtons(socket, jid, quoted, { title, body, footer, buttons }) {
  const m = generateWAMessageFromContent(jid, {
    viewOnceMessage: {
      message: {
        messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
        interactiveMessage: proto.Message.InteractiveMessage.create({
          body: proto.Message.InteractiveMessage.Body.create({ text: body }),
          footer: proto.Message.InteractiveMessage.Footer.create({ text: footer }),
          header: proto.Message.InteractiveMessage.Header.create({ title, hasMediaAttachment: false }),
          nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
            buttons: buttons.map(b => ({
              name: 'quick_reply',
              buttonParamsJson: JSON.stringify({ display_text: b.text, id: b.id })
            }))
          })
        })
      }
    }
  }, { userJid: socket.user.id, quoted });

  await socket.relayMessage(jid, m.message, { messageId: m.key.id });
}

async function setupCommandHandlers(socket, number) {
  let sessionConfig = await loadUserConfig(number);
  activeSockets.set(number, { socket, config: sessionConfig });

  socket.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg?.message) return;
    const text = getIncomingText(msg);
    if (!text) return;

    const sender = msg.key.remoteJid;
    if (!sender) return;

    const rawSender = msg.key.fromMe
      ? socket.user.id.split(':')[0]
      : String(msg.key.participant || msg.key.remoteJid || '').split('@')[0];
    const senderNumber = rawSender.replace(/\D/g, '');
    const botNumber = String(socket.user?.id || '').split(':')[0].replace(/\D/g, '');
    const isOwner = msg.key.fromMe || senderNumber === botNumber || config.OWNER_NUMBERS.includes(senderNumber);
    const isGroup = sender.endsWith('@g.us');
    const prefix = sessionConfig.PREFIX || config.PREFIX || '.';
    const isCmd = text.startsWith(prefix);

    if (!isOwner && sessionConfig.MODE === 'private') return;
    if (!isOwner && isGroup && sessionConfig.MODE === 'inbox') return;
    if (!isOwner && !isGroup && sessionConfig.MODE === 'groups') return;
    if (!isCmd) return;

    if (sessionConfig.READ_CMD === 'true') {
      try { await socket.readMessages([msg.key]); } catch {}
    }

    const parts = text.slice(prefix.length).trim().split(/\s+/);
    const command = (parts[0] || '').toLowerCase();
    const args = parts.slice(1);
    const reply = async (t) => socket.sendMessage(sender, { text: t }, { quoted: msg });

    try {
      switch (command) {
        case 'button':
        case 'buttons': {
          await sendNativeButtons(socket, sender, msg, {
            title: 'ZESR MOVIE BOT',
            body: `╭━━━〔 🖤 ZESR MOVIE BOT 〕━━━╮\n\n👋 Hello ${msg.pushName || 'User'}\n\nChoose an option below.\n\n╰━━━━━━━━━━━━━━━━━━━━╯`,
            footer: sessionConfig.BOT_FOOTER || config.BOT_FOOTER,
            buttons: [
              { text: '🎬 Search Movie', id: `${prefix}cinesubz spider` },
              { text: '📋 Menu', id: `${prefix}menu` },
              { text: '⚡ Alive', id: `${prefix}alive` }
            ]
          });
          break;
        }

        case 'cinesubz': {
          if (!args.length) {
            await reply(`❌ Movie name එක දෙන්න.\nExample: ${prefix}cinesubz spider`);
            break;
          }

          const query = args.join(' ');
          const searchRes = await axios.get(
            `${config.API_MAIN_URL}/cinesubz/search?query=${encodeURIComponent(query)}&api_key=${encodeURIComponent(config.API_KEY)}`,
            { httpsAgent: insecureAgent, timeout: 30000 }
          );
          const data = searchRes.data;
          if (!data?.status || !Array.isArray(data.results) || !data.results.length) {
            await reply('❌ No results found.');
            break;
          }

          const results = data.results.filter(x => x?.title && x?.link).slice(0, 25);
          let listText = `🎬 *SEARCH: ${query}*\n\n🔢 Reply with a number\n\n`;
          results.forEach((x, i) => { listText += `*${i + 1}. ${x.title}*\n`; });
          listText += `\n> ${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`;

          const sent = await socket.sendMessage(sender, {
            image: { url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE },
            caption: listText
          }, { quoted: msg });

          const listId = sent.key.id;
          const selectHandler = async ({ messages: ms }) => {
            const m = ms[0];
            if (!m?.message || m.key.remoteJid !== sender) return;
            const stanza = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
            if (stanza !== listId) return;
            const choice = parseInt(getIncomingText(m), 10) - 1;
            if (Number.isNaN(choice) || choice < 0 || choice >= results.length) {
              await socket.sendMessage(sender, { text: `❌ 1-${results.length} අතර number එකක් reply කරන්න.` }, { quoted: m });
              return;
            }

            socket.ev.off('messages.upsert', selectHandler);
            const selected = results[choice];
            await socket.sendMessage(sender, { text: '📽️ Fetching details...' }, { quoted: m });

            const detailsRes = await axios.get(
              `${config.API_MAIN_URL}/cinesubz/details?url=${encodeURIComponent(selected.link)}&api_key=${encodeURIComponent(config.API_KEY)}`,
              { httpsAgent: insecureAgent, timeout: 30000 }
            );
            const movie = detailsRes.data?.data;
            if (!detailsRes.data?.status || !movie) {
              await socket.sendMessage(sender, { text: '❌ Details unavailable.' }, { quoted: m });
              return;
            }

            const downloads = (movie.downloads || []).filter(d => d?.quality && d?.url);
            if (!downloads.length) {
              await socket.sendMessage(sender, { text: '❌ Download options unavailable.' }, { quoted: m });
              return;
            }

            const desc = movie.description ? movie.description.slice(0, 300) + (movie.description.length > 300 ? '...' : '') : 'N/A';
            const info = await socket.sendMessage(sender, {
              image: { url: movie.poster || sessionConfig.BOT_IMAGE || config.BOT_IMAGE },
              caption: formatMessage(
                `☘️ ${movie.title || selected.title}`,
                `▫️🥇 IMDb ➟ ${movie.imdb_rating || 'N/A'}\n▫️⏳ Duration ➟ ${movie.runtime || 'N/A'}\n▫️📅 Year ➟ ${movie.year || 'N/A'}\n▫️🎬 Director ➟ ${movie.director || 'N/A'}\n▫️🌎 Country ➟ ${movie.country || 'N/A'}\n▫️📖 Story ➟ ${desc}\n▫️🔗 Join ➟ ${sessionConfig.MGROUP_LINK || config.MGROUP_LINK}`,
                sessionConfig.MOVIE_FOOTER || config.MOVIE_FOOTER
              )
            }, { quoted: m });

            await delay(1200);
            let qText = '*⬇️ DOWNLOAD OPTIONS*\n_Reply with a number_\n\n';
            downloads.forEach((d, i) => { qText += `*${i + 1}. ${d.quality}*\n`; });
            const qMsg = await socket.sendMessage(sender, { text: qText }, { quoted: info });
            const qId = qMsg.key.id;

            const downloadHandler = async ({ messages: dms }) => {
              const dm = dms[0];
              if (!dm?.message || dm.key.remoteJid !== sender) return;
              const stanza2 = dm.message?.extendedTextMessage?.contextInfo?.stanzaId;
              if (stanza2 !== qId) return;
              const idx = parseInt(getIncomingText(dm), 10) - 1;
              if (Number.isNaN(idx) || idx < 0 || idx >= downloads.length) {
                await socket.sendMessage(sender, { text: `❌ 1-${downloads.length} අතර number එකක් reply කරන්න.` }, { quoted: dm });
                return;
              }

              socket.ev.off('messages.upsert', downloadHandler);
              const chosen = downloads[idx];
              await socket.sendMessage(sender, { text: `⏳ Getting ${chosen.quality} link...` }, { quoted: dm });

              const dlRes = await axios.get(
                `${config.API_MAIN_URL2}/movie/cinesubz?url=${encodeURIComponent(chosen.url)}&api_key=${encodeURIComponent(config.API_KEY)}`,
                { httpsAgent: insecureAgent, timeout: 45000 }
              );
              const links = dlRes.data?.data?.download;
              if (!dlRes.data?.status || !Array.isArray(links)) {
                await socket.sendMessage(sender, { text: '❌ Download link unavailable.' }, { quoted: dm });
                return;
              }

              const direct = links.filter(x => x?.url && String(x.name || '').toLowerCase() !== 'telegram');
              const preferred = direct.find(x => String(x.name || '').toLowerCase() === 'unknown') || direct[0];
              if (!preferred) {
                await socket.sendMessage(sender, { text: '❌ Direct link unavailable.' }, { quoted: dm });
                return;
              }

              let thumbBuffer;
              try {
                const poster = movie.poster || sessionConfig.BOT_IMAGE || config.BOT_IMAGE;
                const img = await axios.get(poster, { responseType: 'arraybuffer', timeout: 30000 });
                thumbBuffer = await sharp(Buffer.from(img.data))
                  .resize(320, 320, { fit: 'cover', position: 'center' })
                  .jpeg({ quality: 80 })
                  .toBuffer();
              } catch (e) {
                console.log('Thumbnail error:', e.message);
              }

              const cleanQuality = String(chosen.quality || '').replace(/\s*\([^)]*(MB|GB|KB|B)\)/gi, '').trim();
              const rawTitle = dlRes.data?.data?.title || `${movie.title || selected.title} ${cleanQuality}`;
              const safeTitle = rawTitle.replace(/[\\/:*?"<>|]/g, '').trim();

              await socket.sendMessage(sender, {
                document: { url: preferred.url },
                mimetype: 'video/mp4',
                fileName: safeTitle.toLowerCase().endsWith('.mp4') ? safeTitle : `${safeTitle}.mp4`,
                jpegThumbnail: thumbBuffer,
                caption: formatMessage(
                  `☘️ ${movie.title || selected.title}`,
                  `\`❚█${sessionConfig.MOVIE_CAPTION || config.MOVIE_CAPTION}█❚\`\n\n\`❪${cleanQuality || chosen.quality}❫\``,
                  sessionConfig.MOVIE_FOOTER || config.MOVIE_FOOTER
                )
              }, { quoted: dm });
              await socket.sendMessage(sender, { react: { text: '✅', key: dm.key } });
            };
            socket.ev.on('messages.upsert', downloadHandler);
            setTimeout(() => socket.ev.off('messages.upsert', downloadHandler), 120000);
          };

          socket.ev.on('messages.upsert', selectHandler);
          setTimeout(() => socket.ev.off('messages.upsert', selectHandler), 120000);
          break;
        }

        case 'menu':
        case 'alive': {
          const sl = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Colombo' }));
          const menu = `*🌟 Hey ❟ ${msg.pushName || 'User'}*\n\n*╭─「 ZESR COMMAND PANEL 」*\n┃ 🧩 Time : ${sl.toLocaleTimeString()}\n┃ 🦊 Date : ${sl.getFullYear()}/${sl.getMonth() + 1}/${sl.getDate()}\n┃ 🤖 Bot : ${sessionConfig.BOT_NAME || config.BOT_NAME}\n*╰────────●●►*\n\n🎥 ${prefix}cinesubz <movie>\n🖤 ${prefix}button\n⚙️ ${prefix}setting\n\n> ${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`;
          await socket.sendMessage(sender, {
            image: { url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE },
            caption: menu
          }, { quoted: msg });
          break;
        }

        case 'set':
        case 'setting': {
          if (!isOwner) {
            await reply('❌ Only the bot owner can use this command.');
            break;
          }
          if (!args.length) {
            await reply(`⚙️ *CONFIG*\n\nUsage: ${prefix}set KEY:VALUE\n\nKeys: PREFIX, AUTO_RECORDING, AUTO_TYPING, AUTO_REACT, READ_CMD, BOT_NAME, BOT_IMAGE, BOT_FOOTER, MOVIE_FOOTER, MOVIE_CAPTION, MGROUP_LINK, MODE`);
            break;
          }
          const valid = ['PREFIX','AUTO_RECORDING','AUTO_TYPING','AUTO_REACT','READ_CMD','BOT_NAME','BOT_IMAGE','BOT_FOOTER','MOVIE_FOOTER','MOVIE_CAPTION','MGROUP_LINK','MODE'];
          const updates = {};
          for (const pair of args.join(' ').split(',')) {
            const [k0, ...v0] = pair.split(':');
            if (!k0 || !v0.length) continue;
            const k = k0.trim().toUpperCase();
            if (!valid.includes(k)) continue;
            updates[k] = v0.join(':').trim();
          }
          sessionConfig = { ...sessionConfig, ...updates };
          await updateUserConfig(number, sessionConfig);
          activeSockets.set(number, { socket, config: sessionConfig });
          await reply(`✅ Config updated\n\n${Object.entries(updates).map(([k,v]) => `${k}: ${v}`).join('\n')}`);
          break;
        }
      }
    } catch (e) {
      console.error('Command error:', e);
      await socket.sendMessage(sender, { text: `❌ ERROR\n${e.message}` }, { quoted: msg });
    }
  });
}

async function setupMessageHandlers(socket) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg?.message || msg.key.remoteJid === 'status@broadcast') return;
    const botNumber = jidNormalizedUser(socket.user.id).split('@')[0].replace(/\D/g, '');
    const cfg = activeSockets.get(botNumber)?.config || config;
    if (cfg.AUTO_TYPING === 'true') {
      try { await socket.sendPresenceUpdate('composing', msg.key.remoteJid); } catch {}
    }
    if (cfg.AUTO_RECORDING === 'true') {
      try { await socket.sendPresenceUpdate('recording', msg.key.remoteJid); } catch {}
    }
    if (cfg.AUTO_REACT === 'true' && !msg.message.reactionMessage && !msg.key.fromMe) {
      const list = ['❤','💕','🖤','💚','😊','🎬','✨'];
      try { await socket.sendMessage(msg.key.remoteJid, { react: { text: list[Math.floor(Math.random()*list.length)], key: msg.key } }); } catch {}
    }
  });
}

function setupAutoRestart(socket, number) {
  let tries = 0;
  socket.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    const code = lastDisconnect?.error?.output?.statusCode;
    if (connection === 'open') tries = 0;
    if (connection === 'close' && code !== 401 && tries < 10) {
      tries++;
      await delay(Math.min(5000 * tries, 30000));
      activeSockets.delete(number);
      socketCreationTime.delete(number);
      const mockRes = { headersSent: false, send: () => {}, status() { return this; } };
      try { await EmpirePair(number, mockRes); } catch {}
    }
  });
}

async function EmpirePair(number, res) {
  const sanitizedNumber = String(number).replace(/\D/g, '');
  if (sanitizedNumber.length < 8) return !res.headersSent && res.status(400).send({ error: 'Invalid number' });

  const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);
  await restoreSession(sanitizedNumber);
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  try {
    const { version } = await fetchLatestBaileysVersion();
    const socket = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      version,
      browser: Browsers.macOS('Safari')
    });

    socketCreationTime.set(sanitizedNumber, Date.now());
    await setupCommandHandlers(socket, sanitizedNumber);
    await setupMessageHandlers(socket);
    setupAutoRestart(socket, sanitizedNumber);

    if (!state.creds.registered) {
      let retries = config.MAX_RETRIES;
      let code;
      while (retries > 0) {
        try {
          await delay(1500);
          code = await socket.requestPairingCode(sanitizedNumber);
          break;
        } catch (e) {
          retries--;
          if (!retries) throw e;
          await delay(2000);
        }
      }
      if (!res.headersSent) res.send({ code });
    }

    socket.ev.on('creds.update', async () => {
      try {
        await saveCreds();
        const p = path.join(sessionPath, 'creds.json');
        if (fs.existsSync(p)) await saveSession(sanitizedNumber, JSON.parse(await fs.readFile(p, 'utf8')));
      } catch {}
    });

    socket.ev.on('connection.update', async ({ connection }) => {
      if (connection !== 'open') return;
      const currentConfig = await loadUserConfig(sanitizedNumber);
      activeSockets.set(sanitizedNumber, { socket, config: currentConfig });
      try {
        await socket.sendPresenceUpdate('unavailable');
        const userJid = jidNormalizedUser(socket.user.id);
        await socket.sendMessage(userJid, {
          image: { url: currentConfig.BOT_IMAGE || config.BOT_IMAGE },
          caption: formatMessage('✨ Bot Activated!', `📱 Number: ${sanitizedNumber}\n🕒 Time: ${getSriLankaTimestamp()}\n🟢 Status: Online`, currentConfig.BOT_FOOTER || config.BOT_FOOTER)
        });
      } catch (e) {
        console.log('Welcome msg error:', e.message);
      }
    });
  } catch (e) {
    console.error('Pairing error:', e);
    if (!res.headersSent) res.status(503).send({ error: 'Service Unavailable' });
  }
}

async function autoReconnectOnStartup() {
  try {
    let numbers = [];
    if (fs.existsSync(NUMBER_LIST_PATH)) {
      try { numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8')); } catch {}
    }
    if (mongoose.connection.readyState === 1) {
      const sessions = await Session.find({}, 'number').lean();
      numbers = [...new Set([...numbers, ...sessions.map(s => s.number)])];
    }
    for (const number of numbers) {
      if (activeSockets.has(number)) continue;
      const mockRes = { headersSent: false, send: () => {}, status() { return this; } };
      try { await EmpirePair(number, mockRes); } catch {}
      await delay(1000);
    }
  } catch (e) {
    console.error('Auto reconnect:', e.message);
  }
}
setTimeout(autoReconnectOnStartup, 5000);

router.get('/', async (req, res) => {
  const number = String(req.query.number || '').replace(/\D/g, '');
  if (!number) return res.status(400).send({ error: 'Number parameter is required' });

  if (activeSockets.has(number)) {
    const entry = activeSockets.get(number);
    try { await entry?.socket?.logout(); } catch {}
    try { entry?.socket?.end?.(); } catch {}
    try { entry?.socket?.ws?.close(); } catch {}
    activeSockets.delete(number);
    socketCreationTime.delete(number);
    await deleteSession(number);
  }

  await EmpirePair(number, res);
});

process.on('exit', () => {
  activeSockets.forEach(entry => {
    try { entry?.socket?.ws?.close(); } catch {}
  });
});
process.on('uncaughtException', err => console.error('Uncaught exception:', err));
process.on('unhandledRejection', err => console.error('Unhandled rejection:', err));

export default router;
