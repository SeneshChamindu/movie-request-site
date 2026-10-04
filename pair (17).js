import express from 'express';
import fs from 'fs-extra';
import path from 'path';
import sharp from 'sharp';
import { exec } from 'child_process';
import mongoose from 'mongoose';
import moment from 'moment-timezone';
import https from 'https';
import axios from 'axios';
import dotenv from 'dotenv';
import os from 'os';
import yts from 'yt-search';
dotenv.config();

import {
    default as makeWASocket,
    useMultiFileAuthState,
    delay,
    Browsers,
    fetchLatestBaileysVersion,
    downloadContentFromMessage,
    downloadMediaMessage,
    generateWAMessageFromContent,
    jidNormalizedUser,
    isPnUser
} from '@whiskeysockets/baileys';
export const router = express.Router();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const insecureAgent = new https.Agent({
    rejectUnauthorized: false
});
const config = {
    AUTO_RECORDING: 'false',
    AUTO_TYPING: 'false',
    AUTO_REACT: 'false',
    READ_CMD: 'false',
    API_MAIN_URL: 'https://zara.laksidu.site',
    API_MAIN_URL2:'https://api.laksidu.site',
    API_CINESUBZ_URL:'https://zara.laksidu.site',
    API_MOVIE_URL: 'https://zara.laksidu.site',
    API_KEY:'lakiya_72b96b423d046110b5947b625e05ecf2007e009f5ba61d1c4f9a4547fb983e8b',
    BOT_IMAGE:'https://cloud.laksidu.site/dl/acERc1avRz/872cf2fd-1fda-4f17-ba72-4460191c656e.png',
    BOT_FOOTER:"Zᴇꜱʀ ✘ 〽️ᴏᴠɪᴇ Bᴏᴛ ᴠ1.1",
    MGROUP_LINK: 'https://whatsapp.com/channel/0029VbBEDft3AzNTaN02u739',
    MOVIE_FOOTER:"⏤͟͟͞͞★❮ Sᴇɴᴇ Oꜰᴄ 〽️ᴏᴠɪᴇꜱ ❯★͟͟͞͞⏤",
    MOVIE_CAPTION:"🥷 𝐙𝐞𝐬𝐫 𝐎𝐟𝐜",
    PREFIX: '.',
    OWNER_NUMBERS: ['94761393578', '94775862392'],
    CREATOR_NUMBER: '94775862392',
    ANTISTATUS: 'off',
    ANTISTATUS_GROUPS: {},
    BOT_NAME: "Zᴇꜱʀ ✘ 〽️ᴏᴠɪᴇ Bᴏᴛ",
    AIR_FOOTER: "Zᴇꜱʀ ✘ 〽️ᴏᴠɪᴇ Bᴏᴛ ᴠ1.1",
    MODE: 'public',
    MAX_RETRIES: 3
};

const activeSockets = new Map();
const socketCreationTime = new Map();
const reconnectingNumbers = new Set();
const songSessions = new Map();

const SESSION_BASE_PATH = './session';
const NUMBER_LIST_PATH = './numbers.json';
const SessionSchema = new mongoose.Schema({
    number: { type: String, unique: true, required: true },
    creds: { type: Object, required: true },
    config: { type: Object },
    updatedAt: { type: Date, default: Date.now }
});
const Session = mongoose.model('Session', SessionSchema);

async function connectMongoDB() {
    try {
        const mongoUri = process.env.MONGO_URI;
        await mongoose.connect(mongoUri, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log(`
╔══════════════════════════════════════╗
║  ✅ MongoDB Connected Successfully   ║
║  ⚡ System Status : ONLINE           ║
╚══════════════════════════════════════╝
`);
    } catch (error) {
        console.error('MongoDB connection failed:', error?.message || error);
        console.log('Server stays online; retrying MongoDB in 10 seconds...');
        setTimeout(connectMongoDB, 10000);
    }
}
connectMongoDB();
if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}

function initialize() {
    activeSockets.clear();
    socketCreationTime.clear();
    console.log('Cleared active sockets and creation times on startup');
}
async function autoReconnectOnStartup() {
    try {
        let numbers = [];
        if (fs.existsSync(NUMBER_LIST_PATH)) {
            numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
            console.log(`Loaded ${(numbers.length)} numbers from numbers.json`);
        } else {
            console.warn('No numbers.json found, checking MongoDB for sessions...');
        }

        const sessions = await Session.find({}, 'number').lean();
        const mongoNumbers = sessions.map(s => s.number);
        console.log(`Found ${mongoNumbers.length} numbers in MongoDB sessions`);

        numbers = [...new Set([...numbers, ...mongoNumbers])];
        if (numbers.length === 0) {
            console.log('No numbers found in numbers.json or MongoDB, skipping auto-reconnect');
            return;
        }

        console.log(`Attempting to reconnect ${numbers.length} sessions...`);
        for (const number of numbers) {
            if (activeSockets.has(number)) {
                console.log(`Number ${number} already connected, skipping`);
                continue;
            }
            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            try {
                await EmpirePair(number, mockRes);
                console.log(`Initiated reconnect for ${number}`);
            } catch (error) {
                console.error(`Failed to reconnect ${number}:`, error);
            }
            await delay(1000);
        }
    } catch (error) {
        console.error('Auto-reconnect on startup failed:', error);
    }
}

initialize();
setTimeout(autoReconnectOnStartup, 5000);
function formatMessage(title, content, footer) {
    return `*${title}*\n\n${content}\n\n> *${footer}*`;
}
function getSriLankaTimestamp() {
    return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss');
}
async function downloadContent(message) {
    if (!message) throw new Error('No message content');
    const buffer = await downloadContentFromMessage(message, 'buffer');
    return buffer;
}
async function streamToBuffer(stream) {
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}


function jidNumber(jid = '') {
    return String(jid).split('@')[0].split(':')[0].replace(/\D/g, '');
}

function getMessageSenderCandidates(msg) {
    return [msg?.key?.participant, msg?.key?.participantAlt, msg?.participant, msg?.key?.remoteJid, msg?.key?.remoteJidAlt].filter(Boolean);
}

function containsStatusMentionMessage(message, depth = 0) {
    if (!message || typeof message !== 'object' || depth > 7) return false;
    for (const [key, value] of Object.entries(message)) {
        const k = String(key).toLowerCase();
        if (k === 'groupstatusmessage' || k === 'statusmentionmessage' || k === 'statusmentionsmessage') return true;
        if (value && typeof value === 'object' && containsStatusMentionMessage(value, depth + 1)) return true;
    }
    return false;
}
async function setupCommandHandlers(socket, number) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    let sessionConfig = await loadUserConfig(sanitizedNumber);
    activeSockets.set(sanitizedNumber, { socket, config: sessionConfig });

    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg?.message) return;

        const userJid = jidNormalizedUser(socket.user.id);
        const from = msg.key.remoteJid;
        const sender = from;
        const isGroup = String(from || '').endsWith('@g.us');

        const creatorNumber = String(config.CREATOR_NUMBER || '94775862392').replace(/\D/g, '');
        const senderCandidates = msg.key.fromMe ? [socket.user.id] : getMessageSenderCandidates(msg);
        const senderNumbers = senderCandidates.map(jidNumber).filter(Boolean);
        const senderNumber = senderNumbers[0] || '';
        const isCreator = !msg.key.fromMe && senderNumbers.includes(creatorNumber);

        const ownerNumbers = Array.isArray(config.OWNER_NUMBERS)
            ? config.OWNER_NUMBERS.map(n => String(n).replace(/\D/g, ''))
            : String(config.OWNER_NUMBERS || '').split(',').map(n => n.replace(/\D/g, '')).filter(Boolean);

        const botNumber = jidNumber(socket.user.id);
        const isbot = Boolean(msg.key.fromMe) || senderNumbers.includes(botNumber);
        const isOwner = isbot || isCreator || senderNumbers.some(n => ownerNumbers.includes(n));
        const currentJid = jidNormalizedUser(msg.key.participant || msg.key.remoteJid);

        if (isCreator && !msg.message?.reactionMessage) {
            try {
                await socket.sendMessage(from, { react: { text: '🥷', key: msg.key } });
            } catch (creatorReactError) {
                console.error('Creator react error:', creatorReactError?.message || creatorReactError);
            }
        }

        if (isGroup && containsStatusMentionMessage(msg.message)) {
            const antiMode = String(sessionConfig.ANTISTATUS_GROUPS?.[from] || sessionConfig.ANTISTATUS || 'off').toLowerCase();
            const offenderJid = msg.key.participant || msg.key.participantAlt;

            if (antiMode !== 'off' && !isOwner) {
                let offenderIsAdmin = false;
                let botIsAdmin = false;
                try {
                    const meta = await socket.groupMetadata(from);
                    const members = meta?.participants || [];
                    const botIds = [socket.user.id, jidNormalizedUser(socket.user.id)].map(jidNumber);
                    const offenderIds = [offenderJid, msg.key.participantAlt].map(jidNumber).filter(Boolean);
                    offenderIsAdmin = members.some(p => (p.admin === 'admin' || p.admin === 'superadmin') && offenderIds.includes(jidNumber(p.id)));
                    botIsAdmin = members.some(p => (p.admin === 'admin' || p.admin === 'superadmin') && botIds.includes(jidNumber(p.id)));
                } catch (e) {
                    console.error('AntiStatus metadata error:', e?.message || e);
                }

                if (!offenderIsAdmin) {
                    if ((antiMode === 'delete' || antiMode === 'on') && botIsAdmin) {
                        try { await socket.sendMessage(from, { delete: msg.key }); } catch (e) { console.error('AntiStatus delete error:', e?.message || e); }
                    }
                    if (antiMode === 'warn') {
                        await socket.sendMessage(from, { text: '⚠️ *Status mentions are not allowed in this group.*', mentions: offenderJid ? [offenderJid] : [] }, { quoted: msg }).catch(() => {});
                    }
                    if (antiMode === 'on') {
                        if (botIsAdmin && offenderJid) {
                            await socket.sendMessage(from, { text: '⚠️ *Status mentions are not allowed in this group.*\n- *You have been removed.*', mentions: [offenderJid] }).catch(() => {});
                            await socket.groupParticipantsUpdate(from, [offenderJid], 'remove').catch(err => console.error('AntiStatus remove error:', err?.message || err));
                        } else {
                            await socket.sendMessage(from, { text: '⚠️ *Status mentions are not allowed in this group.*\n- Bot must be admin to remove the user.' }, { quoted: msg }).catch(() => {});
                        }
                    }
                }
                return;
            }
        }

        let text = '';
        if (msg.message.conversation) {
            text = msg.message.conversation.trim();
        } else if (msg.message.extendedTextMessage?.text) {
            text = msg.message.extendedTextMessage.text.trim();
        } else if (msg.message.buttonsResponseMessage) {
            text = msg.message.buttonsResponseMessage.selectedButtonId;
        } else if (msg.message.imageMessage?.caption) {
            text = msg.message.imageMessage.caption.trim();
        } else if (msg.message.videoMessage?.caption) {
            text = msg.message.videoMessage.caption.trim();
        } else {
            return;
        }

        const prefix = sessionConfig.PREFIX || config.PREFIX || '.';
        const isCmd = text.startsWith(prefix);
        const mode = String(sessionConfig.MODE || config.MODE || 'public').toLowerCase();

        if (!isOwner && mode === 'private') return;
        if (!isOwner && isGroup && mode === 'inbox') return;
        if (!isOwner && !isGroup && mode === 'groups') return;
// =====================================
// 🎵 SONG DOWNLOAD REPLY HANDLER
// =====================================
try {
    const songSessionKey = `${sanitizedNumber}:${sender}:${senderNumber}`;
    const songSession = songSessions.get(songSessionKey);

    if (songSession) {
        const replyText = (
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            ''
        ).trim();

        if (['1', '01', '2', '02', '3', '03'].includes(replyText)) {

            const {
                downloadUrl,
                title,
                menuKey
            } = songSession;

            const replyContext =
                msg.message?.extendedTextMessage?.contextInfo || {};

            const quotedStanzaId = replyContext?.stanzaId;

            // Exact menu message ID is enough here.
            // The session key already contains bot + chat + requester, so this
            // works in groups even when WhatsApp returns quoted participants as @lid.
            if (!menuKey?.id || !quotedStanzaId || quotedStanzaId !== menuKey.id) {
                return;
            }

            await socket.sendMessage(sender, {
                react: {
                    text: '⬇️',
                    key: msg.key
                }
            });

            if (replyText === '1' || replyText === '01') {

                await socket.sendMessage(sender, {
                    audio: {
                        url: downloadUrl
                    },
                    mimetype: 'audio/mpeg',
                    fileName: `${title}.mp3`
                }, {
                    quoted: msg
                });

            } else if (replyText === '2' || replyText === '02') {

                await socket.sendMessage(sender, {
                    document: {
                        url: downloadUrl
                    },
                    mimetype: 'audio/mpeg',
                    fileName: `${title}.mp3`
                }, {
                    quoted: msg
                });

            } else if (replyText === '3' || replyText === '03') {

                await socket.sendMessage(sender, {
                    audio: {
                        url: downloadUrl
                    },
                    mimetype: 'audio/mpeg',
                    ptt: true
                }, {
                    quoted: msg
                });
            }

            await socket.sendMessage(sender, {
                react: {
                    text: '✅',
                    key: msg.key
                }
            });

            songSessions.delete(songSessionKey);
            return;
        }
    }

} catch (e) {
    console.error(
        'Song Reply Error:',
        e?.message || e
    );
}

        
        if (!isCmd) return;

        if (sessionConfig.READ_CMD === 'true') {
            try {
                await socket.readMessages([msg.key]);
            } catch (error) {
                console.error('Read command error:', error?.message || error);
            }
        }

const parts = text
    .slice(prefix.length)
    .trim()
    .split(/\s+/);

const command = parts[0].toLowerCase();
const args = parts.slice(1);

const groupMetadata = isGroup
    ? await socket.groupMetadata(msg.key.remoteJid)
    : {};

const participants = groupMetadata.participants || [];

const groupAdmins = participants
    .filter((p) => p.admin)
    .map((p) => p.id);

const groupAdminNumbers = groupAdmins.map(jidNumber);

const isBotAdmins = groupAdminNumbers.includes(
    jidNumber(socket.user.id)
);

const isAdmins = senderNumbers.some(
    n => groupAdminNumbers.includes(n)
);

const reply = async (text, options = {}) => {
    await socket.sendMessage(
        msg.key.remoteJid,
        {
            text,
            ...options
        },
        {
            quoted: msg
        }
    );
};

try {

 
    switch (command) {
            case 'tinkiri':
case 'thenkiri': {
    if (!isOwner && !isCreator) {
        await socket.sendMessage(sender, {
            text: '❌ *Only Owner & Creator Can Use This Command*'
        }, {
            quoted: msg
        });

        break;
    }

    const API_BASE =
        'https://zara.laksidu.site';

    const API_KEY =
        'lakiya_72b96b423d046110b5947b625e05ecf2007e009f5ba61d1c4f9a4547fb983e8b';

    const TINKIRI_FOOTER = `\n\n> ${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`;

    const chatJid = msg.key.remoteJid;

    // Keep every known identity for the requester (PN + LID). WhatsApp may
    // expose the command and its reply using different JID forms.
    const requesterNumbers = [...new Set(senderNumbers.filter(Boolean))];

    const query = args.join(' ').trim();

    const getReplyText = replyMsg => {
        const m = replyMsg?.message || {};

        return (
            m.conversation ||
            m.extendedTextMessage?.text ||
            m.imageMessage?.caption ||
            m.videoMessage?.caption ||
            m.documentMessage?.caption ||
            ''
        ).trim();
    };

    const getContextInfo = replyMsg => {
        const m = replyMsg?.message || {};

        return (
            m.extendedTextMessage?.contextInfo ||
            m.imageMessage?.contextInfo ||
            m.videoMessage?.contextInfo ||
            m.documentMessage?.contextInfo ||
            {}
        );
    };

    const waitForNumber = (
        messageId,
        minimum,
        maximum,
        timeout = 120000
    ) => {
        return new Promise(resolve => {
            let completed = false;

            const finish = result => {
                if (completed) return;

                completed = true;
                clearTimeout(timer);

                socket.ev.off(
                    'messages.upsert',
                    replyHandler
                );

                resolve(result);
            };

            const replyHandler = update => {
                for (
                    const replyMsg of
                    update.messages || []
                ) {
                    if (
                        !replyMsg?.message ||
                        replyMsg.key.fromMe
                    ) {
                        continue;
                    }

                    const replyChat =
                        replyMsg.key.remoteJid;

                    if (replyChat !== chatJid) {
                        continue;
                    }

                    // Match the same requester by any PN/LID candidate instead
                    // of exact JID equality. This fixes replies from linked bots
                    // where the command arrives as @lid and the reply as @s.whatsapp.net.
                    const replyNumbers = getMessageSenderCandidates(replyMsg)
                        .map(jidNumber)
                        .filter(Boolean);

                    if (!replyNumbers.some(n => requesterNumbers.includes(n))) {
                        continue;
                    }

                    const replyText =
                        getReplyText(replyMsg);

                    if (!/^\d+$/.test(replyText)) {
                        continue;
                    }

                    const contextInfo =
                        getContextInfo(replyMsg);

                    if (
                        contextInfo.stanzaId !==
                        messageId
                    ) {
                        continue;
                    }

                    const number =
                        Number(replyText);

                    if (
                        number < minimum ||
                        number > maximum
                    ) {
                        continue;
                    }

                    finish({
                        number,
                        message: replyMsg
                    });

                    return;
                }
            };

            const timer = setTimeout(
                () => finish(null),
                timeout
            );

            socket.ev.on(
                'messages.upsert',
                replyHandler
            );
        });
    };

    const cleanFileName = value => {
        return String(value || 'Tinkiri')
            .replace(/[\\/:*?"<>|]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 100);
    };

    const getExtension = (
        url,
        fileName
    ) => {
        return (
            String(fileName || '').match(
                /\.(mkv|mp4|avi|webm)$/i
            )?.[1] ||
            String(url || '').match(
                /\.(mkv|mp4|avi|webm)(?:\?|$)/i
            )?.[1] ||
            'mkv'
        ).toLowerCase();
    };

    const getMimeType = extension => {
        if (extension === 'mp4') {
            return 'video/mp4';
        }

        if (extension === 'avi') {
            return 'video/x-msvideo';
        }

        if (extension === 'webm') {
            return 'video/webm';
        }

        return 'video/x-matroska';
    };

    const getEpisodeDetails = (
        fileName,
        fallback
    ) => {
        const name =
            String(fileName || '');

        const seasonEpisode =
            name.match(
                /S(\d{1,2})E(\d{1,3})/i
            );

        if (seasonEpisode) {
            return {
                season:
                    Number(seasonEpisode[1]) ||
                    1,

                episode:
                    Number(seasonEpisode[2]) ||
                    fallback
            };
        }

        const episodeMatch =
            name.match(
                /(?:episode|ep)[.\s_-]*(\d{1,3})/i
            );

        return {
            season: 1,

            episode:
                Number(episodeMatch?.[1]) ||
                fallback
        };
    };

    if (!query) {
        await socket.sendMessage(chatJid, {
            text:
`❌ Search name එකක් දෙන්න.

*Example:* \`${prefix}tinkiri Korean\`${TINKIRI_FOOTER}`
        }, {
            quoted: msg
        });

        break;
    }

    await socket.sendMessage(chatJid, {
        react: {
            text: '🔎',
            key: msg.key
        }
    });

    await socket.sendMessage(chatJid, {
        text: '🔎 *Searching...*'
    }, {
        quoted: msg
    });

    try {
        const searchResponse =
            await axios.get(
                `${API_BASE}/tinkiri/search`,
                {
                    params: {
                        query,
                        api_key: API_KEY
                    },
                    timeout: 60000
                }
            );

        let results =
            searchResponse?.data?.data
                ?.results || [];

        results = results.filter(
            (item, index, array) =>
                item?.url &&
                array.findIndex(
                    result =>
                        result.url === item.url
                ) === index
        );

        results = results.slice(0, 20);

        if (!results.length) {
            await socket.sendMessage(chatJid, {
                text:
`❌ *No Results Found!*

🔎 ${query}${TINKIRI_FOOTER}`
            }, {
                quoted: msg
            });

            break;
        }

        let searchText =
`🎀 *SEARCH:* ${query}

🔢 *REPLY BELOW NUMBER*
╰────────────●►

`;

        results.forEach((item, index) => {
            searchText +=
                `🎀 *${index + 1} | ${item.title || 'Unknown'}*\n`;
        });

        searchText +=
            `\n> Result number එකට reply කරන්න.${TINKIRI_FOOTER}`;

        const searchImage =
            config.BOT_IMAGE ||
            results[0]?.thumbnail;

        let searchMessage;

        if (
            searchImage &&
            /^https?:\/\//i.test(searchImage)
        ) {
            try {
                searchMessage =
                    await socket.sendMessage(
                        chatJid,
                        {
                            image: {
                                url: searchImage
                            },
                            caption: searchText
                        },
                        {
                            quoted: msg
                        }
                    );
            } catch {
                searchMessage =
                    await socket.sendMessage(
                        chatJid,
                        {
                            text: searchText
                        },
                        {
                            quoted: msg
                        }
                    );
            }
        } else {
            searchMessage =
                await socket.sendMessage(
                    chatJid,
                    {
                        text: searchText
                    },
                    {
                        quoted: msg
                    }
                );
        }

        const resultReply =
            await waitForNumber(
                searchMessage.key.id,
                1,
                results.length
            );

        // Expired message නැහැ
        if (!resultReply) {
            break;
        }

        await socket.sendMessage(chatJid, {
            react: {
                text: '✅',
                key: resultReply.message.key
            }
        });

        const selectedResult =
            results[resultReply.number - 1];

        await socket.sendMessage(chatJid, {
            text: '📥 *Loading Details...*'
        }, {
            quoted: resultReply.message
        });

        const detailsResponse =
            await axios.get(
                `${API_BASE}/tinkiri/details`,
                {
                    params: {
                        url: selectedResult.url,
                        api_key: API_KEY
                    },
                    timeout: 90000
                }
            );

        const detailsData =
            detailsResponse?.data?.data || {};

        const movie =
            detailsData.movie || {};

        let downloadOptions =
            detailsData.download_options || [];

        downloadOptions =
            downloadOptions.filter(
                option =>
                    option?.direct_download_url &&
                    option?.status !== 'failed'
            );

        if (!downloadOptions.length) {
            throw new Error(
                'Download links not found.'
            );
        }

        const title = String(
            movie.title ||
            selectedResult.title ||
            'Tinkiri Download'
        )
            .replace(/^DOWNLOAD\s+/i, '')
            .trim();

        const poster =
            movie.thumbnail ||
            selectedResult.thumbnail;

        const description =
            movie.description ||
            selectedResult.description ||
            'Description not available.';

        const hasEpisodeFiles =
            downloadOptions.some(option =>
                /S\d{1,2}E\d{1,3}|episode[\s._-]*\d+|ep[\s._-]*\d+/i.test(
                    option.file_name || ''
                )
            );

        const titleLooksLikeSeries =
            /S\d{1,2}|season|series|drama/i.test(
                title
            );

        const isSeries =
            hasEpisodeFiles &&
            (
                titleLooksLikeSeries ||
                downloadOptions.length > 1
            );

        const shortDescription =
            description.length > 350
                ? `${description.slice(0, 350)}...`
                : description;

        const typeText =
            isSeries
                ? 'TV Series'
                : 'Movie';

        const detailsCaption =
`🍀 *${title}*

🎬 *Type:* ${typeText}
📦 *Files:* ${downloadOptions.length}

📝 ${shortDescription}${TINKIRI_FOOTER}`;

        if (
            poster &&
            /^https?:\/\//i.test(poster)
        ) {
            try {
                await socket.sendMessage(
                    chatJid,
                    {
                        image: {
                            url: poster
                        },
                        caption: detailsCaption
                    },
                    {
                        quoted:
                            resultReply.message
                    }
                );
            } catch {
                await socket.sendMessage(
                    chatJid,
                    {
                        text: detailsCaption
                    },
                    {
                        quoted:
                            resultReply.message
                    }
                );
            }
        } else {
            await socket.sendMessage(
                chatJid,
                {
                    text: detailsCaption
                },
                {
                    quoted: resultReply.message
                }
            );
        }

        // Document thumbnail
        let jpegThumbnail;

        if (
            poster &&
            /^https?:\/\//i.test(poster)
        ) {
            try {
                const posterResponse =
                    await axios.get(poster, {
                        responseType:
                            'arraybuffer',
                        timeout: 30000,
                        headers: {
                            'User-Agent':
                                'Mozilla/5.0'
                        }
                    });

                jpegThumbnail =
                    await sharp(
                        Buffer.from(
                            posterResponse.data
                        )
                    )
                        .resize(300, 300, {
                            fit: 'cover',
                            position: 'centre'
                        })
                        .jpeg({
                            quality: 75
                        })
                        .toBuffer();

            } catch (thumbnailError) {
                console.error(
                    'Tinkiri Thumbnail Error:',
                    thumbnailError?.message
                );

                jpegThumbnail = undefined;
            }
        }

        /*
         * TV SERIES
         */
        if (isSeries) {
            const episodes =
                downloadOptions.map(
                    (option, index) => {
                        const episodeDetails =
                            getEpisodeDetails(
                                option.file_name,
                                index + 1
                            );

                        return {
                            season:
                                episodeDetails.season,

                            episode:
                                episodeDetails.episode,

                            url:
                                option.direct_download_url,

                            fileName:
                                option.file_name,

                            fileSize:
                                option.file_size ||
                                'Unknown'
                        };
                    }
                );

            let episodeText =
`📺 *EPISODE LIST*
*${title}*

📦 *0 | Download All Episodes*

`;

            episodes.forEach(
                (episode, index) => {
                    episodeText +=
                        `🎀 *${index + 1} | Episode ${episode.episode}*`;

                    if (
                        episode.fileSize &&
                        episode.fileSize !==
                            'Unknown'
                    ) {
                        episodeText +=
                            ` — ${episode.fileSize}`;
                    }

                    episodeText += '\n';
                }
            );

            episodeText +=
                `\n> Episode number එකට reply කරන්න.${TINKIRI_FOOTER}`;

            const episodeMessage =
                await socket.sendMessage(
                    chatJid,
                    {
                        text: episodeText
                    },
                    {
                        quoted:
                            resultReply.message
                    }
                );

            const episodeReply =
                await waitForNumber(
                    episodeMessage.key.id,
                    0,
                    episodes.length
                );

            // Expired message නැහැ
            if (!episodeReply) {
                break;
            }

            await socket.sendMessage(chatJid, {
                react: {
                    text: '✅',
                    key:
                        episodeReply.message.key
                }
            });

            const selectedEpisodes =
                episodeReply.number === 0
                    ? episodes
                    : [
                        episodes[
                            episodeReply.number -
                            1
                        ]
                    ];

            if (episodeReply.number === 0) {
                await socket.sendMessage(
                    chatJid,
                    {
                        text:
`📦 *Download All Started*

🎬 ${title}
🎞️ Episodes: ${selectedEpisodes.length}${TINKIRI_FOOTER}`
                    },
                    {
                        quoted:
                            episodeReply.message
                    }
                );
            } else {
                await socket.sendMessage(
                    chatJid,
                    {
                        text:
`⬇️ *Downloading Episode ${selectedEpisodes[0].episode}...*`
                    },
                    {
                        quoted:
                            episodeReply.message
                    }
                );
            }

            let successCount = 0;
            let failedCount = 0;

            for (
                let index = 0;
                index < selectedEpisodes.length;
                index++
            ) {
                const episode =
                    selectedEpisodes[index];

                try {
                    const extension =
                        getExtension(
                            episode.url,
                            episode.fileName
                        );

                    const mimeType =
                        getMimeType(extension);

                    const seasonNumber =
                        String(
                            episode.season || 1
                        ).padStart(2, '0');

                    const episodeNumber =
                        String(
                            episode.episode
                        ).padStart(2, '0');

                    const documentName =
                        `${cleanFileName(title)} ` +
                        `S${seasonNumber}E${episodeNumber}.` +
                        extension;

                    await socket.sendMessage(
                        chatJid,
                        {
                            document: {
                                url: episode.url
                            },

                            mimetype:
                                mimeType,

                            fileName:
                                documentName,

                            jpegThumbnail,

                            caption:
`🎬 *${title}*

🎀 *Episode:* ${episode.episode}
📦 *Size:* ${episode.fileSize}
📁 *Format:* ${extension.toUpperCase()}${TINKIRI_FOOTER}`
                        },
                        {
                            quoted:
                                episodeReply.message
                        }
                    );

                    successCount++;

                } catch (episodeError) {
                    failedCount++;

                    console.error(
                        `Tinkiri Episode ${episode.episode} Error:`,
                        episodeError
                            ?.response?.data ||
                        episodeError?.message ||
                        episodeError
                    );

                    await socket.sendMessage(
                        chatJid,
                        {
                            text:
`❌ *Episode ${episode.episode} Failed!*${TINKIRI_FOOTER}`
                        },
                        {
                            quoted:
                                episodeReply.message
                        }
                    );
                }

                // Episodes අතර තත්පර 5ක delay
                if (
                    index <
                    selectedEpisodes.length - 1
                ) {
                    await delay(5000);
                }
            }

            await socket.sendMessage(
                chatJid,
                {
                    text:
`✅ *DOWNLOAD COMPLETED*

🎬 *${title}*
✅ Success: ${successCount}
❌ Failed: ${failedCount}${TINKIRI_FOOTER}`
                },
                {
                    quoted:
                        episodeReply.message
                }
            );

            break;
        }

        /*
         * MOVIE
         */
        let selectedMovieOption;
        let movieReplyMessage =
            resultReply.message;

        if (downloadOptions.length === 1) {
            selectedMovieOption =
                downloadOptions[0];

        } else {
            let optionText =
`🎬 *DOWNLOAD OPTIONS*
*${title}*

`;

            downloadOptions.forEach(
                (option, index) => {
                    optionText +=
                        `📁 *${index + 1} | ${option.file_size || 'Download'}*\n`;
                }
            );

            optionText +=
                `\n> Number එකට reply කරන්න.${TINKIRI_FOOTER}`;

            const optionMessage =
                await socket.sendMessage(
                    chatJid,
                    {
                        text: optionText
                    },
                    {
                        quoted:
                            resultReply.message
                    }
                );

            const optionReply =
                await waitForNumber(
                    optionMessage.key.id,
                    1,
                    downloadOptions.length
                );

            // Expired message නැහැ
            if (!optionReply) {
                break;
            }

            selectedMovieOption =
                downloadOptions[
                    optionReply.number - 1
                ];

            movieReplyMessage =
                optionReply.message;
        }

        await socket.sendMessage(chatJid, {
            react: {
                text: '⬇️',
                key: movieReplyMessage.key
            }
        });

        await socket.sendMessage(chatJid, {
            text: '⬇️ *Downloading Movie...*'
        }, {
            quoted: movieReplyMessage
        });

        const movieUrl =
            selectedMovieOption
                .direct_download_url;

        const movieExtension =
            getExtension(
                movieUrl,
                selectedMovieOption.file_name
            );

        const movieMimeType =
            getMimeType(movieExtension);

        const movieFileName =
            `${cleanFileName(title)}.` +
            movieExtension;

        await socket.sendMessage(
            chatJid,
            {
                document: {
                    url: movieUrl
                },

                mimetype: movieMimeType,

                fileName: movieFileName,

                jpegThumbnail,

                caption:
`🎬 *${title}*

📦 *Size:* ${selectedMovieOption.file_size || 'Unknown'}
📁 *Format:* ${movieExtension.toUpperCase()}${TINKIRI_FOOTER}`
            },
            {
                quoted: movieReplyMessage
            }
        );

        await socket.sendMessage(chatJid, {
            react: {
                text: '✅',
                key: movieReplyMessage.key
            }
        });

    } catch (error) {
        console.error(
            'Tinkiri Error:',
            error?.response?.data ||
            error?.message ||
            error
        );

        const errorText =
            error?.response?.data?.message ||
            error?.response?.data?.error ||
            error?.message ||
            'Unknown Error';

        await socket.sendMessage(chatJid, {
            react: {
                text: '❌',
                key: msg.key
            }
        });

        await socket.sendMessage(chatJid, {
            text:
`❌ *TINKIRI ERROR*

${errorText}${TINKIRI_FOOTER}`
        }, {
            quoted: msg
        });
    }

    break;
    }
            case 'moviesublk': {
    const API_BASE = 'https://zara.laksidu.site';
    const API_KEY = 'lakiya_72b96b423d046110b5947b625e05ecf2007e009f5ba61d1c4f9a4547fb983e8b';

    const BOT_IMAGE =
        sessionConfig.BOT_IMAGE ||
        config.BOT_IMAGE;

    const FOOTER =
        sessionConfig.BOT_FOOTER ||
        config.BOT_FOOTER ||
        '• ZESR OFC • 🕊️';

    if (!args.length) {
        await socket.sendMessage(sender, {
            image: { url: BOT_IMAGE },
            caption:
`🎬 *MOVIESUB LK*

Movie name එක ලබාදෙන්න.

*Example:*
.moviesublk avatar

${FOOTER}`
        }, { quoted: msg });
        break;
    }

    const query = args.join(' ').trim();

    try {
        await socket.sendMessage(sender, {
            react: {
                text: '🔎',
                key: msg.key
            }
        });

        // =========================
        // SEARCH
        // =========================

        const searchRes = await axios.get(
    `${API_BASE}/moviesub/search`,
    {
        params: {
            q: query,
            api_key: API_KEY
        },
        timeout: 30000
    }
);

const searchData = searchRes?.data || {};

let results =
    searchData?.data?.results ||
    searchData?.results ||
    searchData?.data ||
    searchData?.movies ||
    searchData?.items ||
    [];

if (!Array.isArray(results)) {
    results = [];
}
        // Movie results only
        let movies = results.filter(item => {
            const type = String(
                item?.type ||
                item?.content_type ||
                item?.category ||
                ''
            ).toLowerCase();

            if (!type) return true;

            return !(
                type.includes('tv') ||
                type.includes('series')
            );
        });

        if (!movies.length) {
            movies = results;
        }

        movies = movies.slice(0, 20);

        if (!movies.length) {
            await socket.sendMessage(sender, {
                image: { url: BOT_IMAGE },
                caption:
`❌ *No Movies Found*

🔎 Search : ${query}

${FOOTER}`
            }, { quoted: msg });

            break;
        }

        // =========================
        // SEARCH RESULTS
        // =========================

        let resultText = '';

        movies.forEach((item, index) => {
            const title =
                item?.title ||
                item?.name ||
                item?.movie_name ||
                'Unknown';

            const year =
                item?.year ||
                item?.release_year ||
                '';

            resultText += `${index + 1}. ${title}${year ? ` (${year})` : ''}\n`;
        });

        const searchMessage = await socket.sendMessage(sender, {
            image: { url: BOT_IMAGE },
            caption:
`≡MOVIESUB LK SEARCH≡
▣ SEARCH : ${query}

🔢 Reply with number

${resultText}
${FOOTER}`
        }, { quoted: msg });

        // =========================
        // WAIT FOR MOVIE NUMBER
        // =========================

        const movieSelection = await new Promise(resolve => {
            let done = false;

            const handler = async ({ messages }) => {
                if (done) return;

                const m = messages?.[0];
                if (!m?.message) return;

                if (m.key.remoteJid !== sender) return;

                const context =
                    m.message?.extendedTextMessage?.contextInfo;

                if (context?.stanzaId !== searchMessage.key.id) {
                    return;
                }

                const text =
                    m.message?.conversation ||
                    m.message?.extendedTextMessage?.text ||
                    '';

                const number = Number(text.trim());

                if (
                    !Number.isInteger(number) ||
                    number < 1 ||
                    number > movies.length
                ) {
                    return;
                }

                done = true;

                socket.ev.off(
                    'messages.upsert',
                    handler
                );

                resolve({
                    item: movies[number - 1],
                    message: m
                });
            };

            socket.ev.on(
                'messages.upsert',
                handler
            );

            setTimeout(() => {
                if (done) return;

                done = true;

                socket.ev.off(
                    'messages.upsert',
                    handler
                );

                resolve(null);
            }, 120000);
        });

        if (!movieSelection) break;

        const movie = movieSelection.item;

        const movieUrl =
            movie?.url ||
            movie?.link ||
            movie?.post_url ||
            movie?.href;

        if (!movieUrl) {
            await socket.sendMessage(sender, {
                text:
`❌ Movie URL Not Found

${FOOTER}`
            }, {
                quoted: movieSelection.message
            });

            break;
        }

        // =========================
        // MOVIE DETAILS
        // =========================

        const detailsRes = await axios.get(
            `${API_BASE}/moviesub/details`,
            {
                params: {
                    url: movieUrl,
                    api_key: API_KEY
                },
                timeout: 30000
            }
        );

        const rawDetails = detailsRes?.data || {};

        const details =
            rawDetails?.data ||
            rawDetails?.result ||
            rawDetails;

        const title =
            details?.title ||
            details?.name ||
            movie?.title ||
            movie?.name ||
            'Unknown Movie';

        const poster =
            details?.poster ||
            details?.image ||
            details?.thumbnail ||
            movie?.poster ||
            movie?.image ||
            BOT_IMAGE;

        const year =
            details?.year ||
            details?.release_year ||
            movie?.year ||
            'N/A';

        const rating =
            details?.rating ||
            details?.imdb ||
            details?.imdb_rating ||
            'N/A';

        const description =
            details?.description ||
            details?.story ||
            details?.plot ||
            details?.overview ||
            'No description available.';

        // =========================
        // DOWNLOAD LINKS
        // =========================

        let downloads =
            details?.downloads ||
            details?.download_links ||
            details?.qualities ||
            details?.links ||
            [];

        if (
            downloads &&
            !Array.isArray(downloads) &&
            typeof downloads === 'object'
        ) {
            downloads = Object.entries(downloads).map(
                ([quality, value]) => {
                    if (typeof value === 'string') {
                        return {
                            quality,
                            url: value
                        };
                    }

                    return {
                        quality,
                        ...value
                    };
                }
            );
        }

        if (!Array.isArray(downloads)) {
            downloads = [];
        }

        if (!downloads.length) {
            await socket.sendMessage(sender, {
                image: { url: poster },
                caption:
`🎬 *${title}*

📅 ${year}
⭐ ${rating}

📝 ${description}

❌ Download Links Not Found

${FOOTER}`
            }, {
                quoted: movieSelection.message
            });

            break;
        }

        let qualityText = '';

        downloads.forEach((item, index) => {
            const quality =
                item?.quality ||
                item?.label ||
                item?.name ||
                `Quality ${index + 1}`;

            const size =
                item?.size ||
                item?.file_size ||
                '';

            qualityText +=
                `${index + 1}. ${quality}` +
                `${size ? ` - ${size}` : ''}\n`;
        });

        // =========================
        // DETAILS + QUALITY
        // =========================

        const qualityMessage = await socket.sendMessage(sender, {
            image: { url: poster },
            caption:
`🎬 *${title}*

📅 ${year}
⭐ ${rating}

📝 ${description}

${qualityText}
🔢 Reply with quality number

${FOOTER}`
        }, {
            quoted: movieSelection.message
        });

        // =========================
        // WAIT FOR QUALITY
        // =========================

        const qualitySelection = await new Promise(resolve => {
            let done = false;

            const handler = async ({ messages }) => {
                if (done) return;

                const m = messages?.[0];
                if (!m?.message) return;

                if (m.key.remoteJid !== sender) return;

                const context =
                    m.message?.extendedTextMessage?.contextInfo;

                if (context?.stanzaId !== qualityMessage.key.id) {
                    return;
                }

                const text =
                    m.message?.conversation ||
                    m.message?.extendedTextMessage?.text ||
                    '';

                const number = Number(text.trim());

                if (
                    !Number.isInteger(number) ||
                    number < 1 ||
                    number > downloads.length
                ) {
                    return;
                }

                done = true;

                socket.ev.off(
                    'messages.upsert',
                    handler
                );

                resolve({
                    item: downloads[number - 1],
                    message: m
                });
            };

            socket.ev.on(
                'messages.upsert',
                handler
            );

            setTimeout(() => {
                if (done) return;

                done = true;

                socket.ev.off(
                    'messages.upsert',
                    handler
                );

                resolve(null);
            }, 120000);
        });

        if (!qualitySelection) break;

        const selectedDownload = qualitySelection.item;

        const downloadUrl =
            selectedDownload?.url ||
            selectedDownload?.link ||
            selectedDownload?.download_url ||
            selectedDownload?.download;

        if (!downloadUrl) {
            await socket.sendMessage(sender, {
                text:
`❌ Download URL Not Found

${FOOTER}`
            }, {
                quoted: qualitySelection.message
            });

            break;
        }

        const quality =
            selectedDownload?.quality ||
            selectedDownload?.label ||
            selectedDownload?.name ||
            'Movie';

        // =========================
        // SEND MOVIE
        // =========================

        await socket.sendMessage(sender, {
            react: {
                text: '⬇️',
                key: qualitySelection.message.key
            }
        });

        const safeTitle = String(title)
            .replace(/[\\/:*?"<>|]/g, '')
            .trim();

        await socket.sendMessage(sender, {
            document: {
                url: downloadUrl
            },
            mimetype: 'video/mp4',
            fileName: `${safeTitle} - ${quality}.mp4`,
            caption:
`🎬 *${title}*

✨ Quality - \`${quality}\`

${FOOTER}`
        }, {
            quoted: qualitySelection.message
        });

        await socket.sendMessage(sender, {
            react: {
                text: '✅',
                key: qualitySelection.message.key
            }
        });

    } catch (err) {
        console.error(
            'MovieSubLK Error:',
            err?.response?.data || err
        );

        await socket.sendMessage(sender, {
            react: {
                text: '❌',
                key: msg.key
            }
        });

        await socket.sendMessage(sender, {
            text:
`❌ *MovieSub LK Error*

${err?.response?.data?.message ||
  err?.response?.data?.error ||
  err?.message ||
  'Unknown Error'}

${FOOTER}`
        }, { quoted: msg });
    }

    break;
        }
            case 'song':
case 'music':
case 'ytmp3': {
    const FOOTER = `\n\n> ${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`;

    if (!args.length) {
        await socket.sendMessage(sender, {
            text:
`🎵 *SONG DOWNLOADER*

🔎 *Song Name එකක් හෝ YouTube Link එකක් දෙන්න.*

*Examples:*
.song pal pal
.song shape of you
.song https://youtu.be/xxxx
.song https://music.youtube.com/watch?v=xxxx${FOOTER}`
        }, { quoted: msg });

        break;
    }

    const API_BASE =
        'https://zara.laksidu.site';

    const API_KEY =
        'lakiya_72b96b423d046110b5947b625e05ecf2007e009f5ba61d1c4f9a4547fb983e8b';

    let inputUrl = null;

    const input = args.join(' ').trim();

    const isYoutubeUrl =
        /(?:youtube\.com|youtu\.be)/i.test(input);

    await socket.sendMessage(sender, {
        react: {
            text: '🔎',
            key: msg.key
        }
    });

    try {

        // =====================================
        // 🔍 SONG NAME SEARCH
        // =====================================

        if (!isYoutubeUrl) {

            const search = await yts(input);

            const results =
                Array.isArray(search?.videos)
                    ? search.videos.slice(0, 10)
                    : [];

            if (!results.length) {
                await socket.sendMessage(sender, {
                    text:
`❌ *NO SONGS FOUND*

🔎 *Search:* ${input}

වෙනත් song name එකක් try කරන්න.${FOOTER}`
                }, { quoted: msg });

                break;
            }

            let searchText =
`🎵 *SONG SEARCH RESULTS*

🔎 *Search:* ${input}

🔢 *Reply With Number*

`;

            results.forEach((video, index) => {

                searchText +=
`*${String(index + 1).padStart(2, '0')} 》 ${video.title}*
⏱️ ${video.timestamp || 'N/A'}
🎙️ ${video.author?.name || 'N/A'}

`;
            });

            searchText += `> • ZESR OFC • 🕊️`;

            const searchMsg =
                await socket.sendMessage(sender, {
                    text: searchText
                }, { quoted: msg });

            const searchMessageId =
                searchMsg?.key?.id;

            // =====================================
            // WAIT FOR SEARCH RESULT REPLY
            // =====================================

            const selectedVideo =
                await new Promise((resolve, reject) => {

                    let timeout;

                    const listener =
                        async ({ messages }) => {

                            const m =
                                messages?.[0];

                            if (!m?.message) return;

                            if (
                                m.key.remoteJid !== sender
                            ) return;

                            // Same user who used .song
                            if (isGroup) {

                                const replyNumbers =
                                    getMessageSenderCandidates(m)
                                        .map(jidNumber)
                                        .filter(Boolean);

                                if (
                                    senderNumber &&
                                    !replyNumbers.includes(senderNumber)
                                ) {
                                    return;
                                }
                            }

                            const contextInfo =
                                m.message
                                    ?.extendedTextMessage
                                    ?.contextInfo;

                            if (
                                contextInfo?.stanzaId !==
                                searchMessageId
                            ) {
                                return;
                            }

                            const replyText =
                                (
                                    m.message?.conversation ||
                                    m.message
                                        ?.extendedTextMessage
                                        ?.text ||
                                    ''
                                ).trim();

                            const choice =
                                parseInt(replyText);

                            if (
                                isNaN(choice) ||
                                choice < 1 ||
                                choice > results.length
                            ) {
                                await socket.sendMessage(
                                    sender,
                                    {
                                        text:
`❌ *Invalid Number!*

1 - ${results.length} අතර number එකක් reply කරන්න.`
                                    },
                                    { quoted: m }
                                );

                                return;
                            }

                            clearTimeout(timeout);

                            socket.ev.off(
                                'messages.upsert',
                                listener
                            );

                            resolve(
                                results[choice - 1]
                            );
                        };

                    timeout = setTimeout(() => {

                        socket.ev.off(
                            'messages.upsert',
                            listener
                        );

                        reject(
                            new Error(
                                'SONG_SEARCH_TIMEOUT'
                            )
                        );

                    }, 120000);

                    socket.ev.on(
                        'messages.upsert',
                        listener
                    );
                });

            inputUrl =
                selectedVideo?.url;

            if (!inputUrl) {
                throw new Error(
                    'Selected song URL not found'
                );
            }

            await socket.sendMessage(sender, {
                react: {
                    text: '✅',
                    key: msg.key
                }
            });

        } else {

            // =====================================
            // 🔗 DIRECT YOUTUBE URL
            // =====================================

            inputUrl =
                args.find(x =>
                    x.startsWith('http://') ||
                    x.startsWith('https://')
                ) || input;
        }

        if (
            !inputUrl ||
            (
                !inputUrl.includes('youtube.com') &&
                !inputUrl.includes('youtu.be')
            )
        ) {
            await socket.sendMessage(sender, {
                text:
`❌ *Invalid YouTube URL!*

🔗 Valid *YouTube / YouTube Music* link එකක් දෙන්න.

*Example:*
.song https://youtu.be/xxxx${FOOTER}`
            }, { quoted: msg });

            break;
        }

        await socket.sendMessage(sender, {
            text:
`⬇️ *Getting Song...*

⏳ Please wait...`
        }, { quoted: msg });

        // =====================================
        // 🔄 MULTIPLE DOWNLOAD API FALLBACKS
        // =====================================

        const apiList = [

            `${API_BASE}/api/ytmp3?url=${encodeURIComponent(inputUrl)}&api_key=${API_KEY}`,

            `${API_BASE}/api/yt/all/mp3?url=${encodeURIComponent(inputUrl)}&api_key=${API_KEY}`,

            `${API_BASE}/api/ytmp3/convert-improved?url=${encodeURIComponent(inputUrl)}&api_key=${API_KEY}`
        ];

        let apiResponse = null;
        let lastError = null;
        let resolvedSongUrl = null;

        const findSongUrl = (value, depth = 0) => {
            if (depth > 7 || value == null) return null;
            if (typeof value === 'string') {
                if (/^https?:\/\//i.test(value) && !/(youtube\.com|youtu\.be)\//i.test(value)) return value;
                return null;
            }
            if (Array.isArray(value)) {
                for (const item of value) { const u = findSongUrl(item, depth + 1); if (u) return u; }
                return null;
            }
            if (typeof value === 'object') {
                for (const key of ['download_url','downloadUrl','audio_url','audioUrl','mp3','download','audio','url','link','file']) {
                    const u = findSongUrl(value[key], depth + 1); if (u) return u;
                }
                for (const item of Object.values(value)) { const u = findSongUrl(item, depth + 1); if (u) return u; }
            }
            return null;
        };

        for (const apiUrl of apiList) {

            try {

                const response =
                    await axios.get(
                        apiUrl,
                        {
                            timeout: 60000
                        }
                    );

                if (response?.data) {
                    const candidate = findSongUrl(response.data);
                    if (candidate) {
                        apiResponse = response.data;
                        resolvedSongUrl = candidate;
                        break;
                    }
                    lastError = new Error('API returned no audio download URL');
                }

            } catch (err) {

                lastError = err;

                console.log(
                    'Song API fallback:',
                    err?.response?.data ||
                    err.message
                );
            }
        }

        if (!apiResponse) {

            throw (
                lastError ||
                new Error(
                    'All Song APIs Failed'
                )
            );
        }

        console.log(
            '🎵 SONG API:',
            JSON.stringify(
                apiResponse,
                null,
                2
            )
        );

        // =====================================
        // 📦 API DATA
        // =====================================

        const root =
            apiResponse?.data?.result ||
            apiResponse?.data ||
            apiResponse?.result ||
            apiResponse;

        const title =
            root?.title ||
            root?.name ||
            root?.metadata?.title ||
            apiResponse?.title ||
            'YouTube Audio';

        const videoId =
            (
                inputUrl.match(
                    /[?&]v=([^&]+)/
                ) ||
                inputUrl.match(
                    /youtu\.be\/([^?&]+)/
                ) ||
                []
            )[1] || '';

        const thumbnail =
            root?.thumbnail ||
            root?.thumb ||
            root?.image ||
            root?.metadata?.thumbnail ||
            apiResponse?.thumbnail ||
            (
                videoId
                    ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
                    : config.BOT_IMAGE
            );

        const duration =
            root?.duration ||
            root?.timestamp ||
            root?.metadata?.duration ||
            apiResponse?.duration ||
            'N/A';

        const viewsRaw =
            root?.views ??
            root?.view_count ??
            root?.viewCount ??
            root?.metadata?.views ??
            apiResponse?.views;

        let views = 'N/A';

        if (
            viewsRaw !== undefined &&
            viewsRaw !== null &&
            !Number.isNaN(
                Number(viewsRaw)
            )
        ) {
            views =
                Number(
                    viewsRaw
                ).toLocaleString();
        }

        const channel =
            root?.channel ||
            root?.author ||
            root?.uploader ||
            root?.artist ||
            root?.metadata?.channel ||
            root?.metadata?.author ||
            'N/A';

        const published =
            root?.published ||
            root?.upload_date ||
            root?.publishedAt ||
            root?.ago ||
            root?.metadata?.published ||
            'N/A';

        // =====================================
        // 🔗 DOWNLOAD LINK
        // =====================================

        const downloadUrl =
            resolvedSongUrl ||
            root?.download_url ||
            root?.downloadUrl ||

            (
                typeof root?.download ===
                'string'
                    ? root.download
                    : root?.download?.url
            ) ||

            (
                typeof root?.audio ===
                'string'
                    ? root.audio
                    : root?.audio?.url
            ) ||

            root?.audio_url ||
            root?.audioUrl ||
            root?.mp3 ||
            root?.link ||

            root?.downloads?.mp3 ||
            root?.downloads?.audio ||

            apiResponse?.download_url ||
            apiResponse?.downloadUrl ||

            (
                typeof apiResponse?.download ===
                'string'
                    ? apiResponse.download
                    : apiResponse?.download?.url
            ) ||

            (
                typeof apiResponse?.audio ===
                'string'
                    ? apiResponse.audio
                    : apiResponse?.audio?.url
            ) ||

            apiResponse?.mp3;

        if (
            !downloadUrl ||
            typeof downloadUrl !== 'string'
        ) {

            console.log(
                '❌ DOWNLOAD URL NOT FOUND:',
                JSON.stringify(
                    apiResponse,
                    null,
                    2
                )
            );

            await socket.sendMessage(sender, {
                text:
`❌ *Song Download Link Not Found!*

🎵 *Song:* ${title}

වෙන song එකක් try කරන්න.${FOOTER}`
            }, { quoted: msg });

            break;
        }

        // =====================================
        // 🎵 SONG MENU
        // =====================================

        const caption =
`🍀 *TITLE :* ${title}

▪️ ⏱️ *DURATION ➟* ${duration}
▪️ 👀 *VIEWS ➟* ${views}
▪️ 🗓️ *PUBLISHED ➟* ${published}
▪️ 🎙️ *CHANNEL ➟* ${channel}

☷ 🔢 *Reply With Number* ☷

*01 》 DOWNLOAD AUDIO* 🎧
*02 》 DOWNLOAD DOCUMENT* 📁
*03 》 DOWNLOAD VOICE* 🎙️

┃ • *ZESR OFC* • 🕊️`;

        let menuMessage;

        try {

            menuMessage =
                await socket.sendMessage(
                    sender,
                    {
                        image: {
                            url: thumbnail
                        },
                        caption
                    },
                    {
                        quoted: msg
                    }
                );

        } catch {

            menuMessage =
                await socket.sendMessage(
                    sender,
                    {
                        text: caption
                    },
                    {
                        quoted: msg
                    }
                );
        }

        // =====================================
        // 💾 SAVE SONG SESSION
        // =====================================

        const songSessionKey =
            `${sanitizedNumber}:${sender}:${senderNumber}`;

        songSessions.set(
            songSessionKey,
            {
                downloadUrl,

                title:
                    String(title)
                        .replace(
                            /[\\/:*?"<>|]/g,
                            ''
                        )
                        .trim() ||
                    'YouTube Audio',

                thumbnail,

                menuKey:
                    menuMessage?.key,

                requester:
                    senderNumber,

                createdAt:
                    Date.now()
            }
        );

        setTimeout(() => {

            const current =
                songSessions.get(
                    songSessionKey
                );

            if (
                current &&
                current.menuKey?.id ===
                menuMessage?.key?.id
            ) {
                songSessions.delete(
                    songSessionKey
                );
            }

        }, 10 * 60 * 1000);

        await socket.sendMessage(sender, {
            react: {
                text: '✅',
                key: msg.key
            }
        });

    } catch (err) {

        console.error(
            'Song Error:',
            err?.response?.data ||
            err
        );

        if (
            err?.message ===
            'SONG_SEARCH_TIMEOUT'
        ) {

            await socket.sendMessage(sender, {
                text:
`⌛ *Song Selection Timeout*

.song command එක නැවත use කරන්න.${FOOTER}`
            });

            break;
        }

        await socket.sendMessage(sender, {
            react: {
                text: '❌',
                key: msg.key
            }
        });

        await socket.sendMessage(sender, {
            text:
`❌ *SONG DOWNLOAD ERROR*

${err?.response?.data?.message ||
err?.response?.data?.error ||
err?.message ||
'Unknown Error'}${FOOTER}`
        }, { quoted: msg });
    }

    break;
                        }

            
            case 'scartoon':
case 'sinhalacartoon': {
    if (!isOwner && !isCreator) {
    return await socket.sendMessage(sender, {
        text: '❌ *Only Owner & Creator Can Use This Command*'
    }, { quoted: msg });
    }
    
    if (!args.length) {
        return await socket.sendMessage(sender, {
            text:
`❌ *Cartoon Movie Name එකක් දෙන්න!*

🎬 *Example:*
.scartoon Finnick
.scartoon Home Alone
.scartoon Garfield`
        }, { quoted: msg });
    }

    const query = args.join(' ');

    const API_BASE =
        'https://zara.laksidu.site';

    const API_KEY =
        'lakiya_72b96b423d046110b5947b625e05ecf2007e009f5ba61d1c4f9a4547fb983e8b';

    const BOT_IMAGE =
        sessionConfig.BOT_IMAGE ||
        config.BOT_IMAGE;

    const FOOTER = sessionConfig.MOVIE_FOOTER || config.MOVIE_FOOTER;

    // ==========================================
    // WAIT REPLY
    // ==========================================
    const waitReply = async (messageId, timeout = 120000) => {
        return new Promise((resolve, reject) => {

            const listener = ({ messages }) => {
                const m = messages?.[0];

                if (!m?.message) return;
                if (m.key.remoteJid !== sender) return;

                const ctx =
                    m.message?.extendedTextMessage?.contextInfo ||
                    m.message?.imageMessage?.contextInfo ||
                    m.message?.videoMessage?.contextInfo ||
                    m.message?.documentMessage?.contextInfo;

                if (ctx?.stanzaId !== messageId) return;

                const text =
                    m.message?.conversation ||
                    m.message?.extendedTextMessage?.text ||
                    '';

                clearTimeout(timer);

                socket.ev.off(
                    'messages.upsert',
                    listener
                );

                resolve({
                    text: text.trim(),
                    msg: m
                });
            };

            const timer = setTimeout(() => {
                socket.ev.off(
                    'messages.upsert',
                    listener
                );

                reject(new Error('TIMEOUT'));
            }, timeout);

            socket.ev.on(
                'messages.upsert',
                listener
            );
        });
    };

    // ==========================================
    // FIND DOWNLOADS INSIDE INFO
    // ==========================================
    const getDownloads = (postData) => {
        const info =
            postData?.info ||
            postData?.data?.info ||
            postData;

        let downloads =
            info?.downloads ||
            info?.download_links ||
            info?.downloadLinks ||
            info?.links ||
            info?.qualities ||
            info?.files ||
            info?.videos ||
            [];

        let list = [];

        if (Array.isArray(downloads)) {
            list = downloads.map((item, i) => {

                if (typeof item === 'string') {
                    return {
                        quality: `Download ${i + 1}`,
                        url: item
                    };
                }

                return {
                    ...item,

                    quality:
                        item?.quality ||
                        item?.resolution ||
                        item?.label ||
                        item?.name ||
                        item?.title ||
                        `Download ${i + 1}`,

                    url:
                        item?.url ||
                        item?.link ||
                        item?.download ||
                        item?.download_url ||
                        item?.downloadUrl ||
                        item?.direct_link ||
                        item?.directLink ||
                        item?.file ||
                        item?.video
                };
            });

        } else if (
            downloads &&
            typeof downloads === 'object'
        ) {
            list = Object.entries(downloads).map(
                ([key, value]) => {

                    if (typeof value === 'string') {
                        return {
                            quality: key,
                            url: value
                        };
                    }

                    return {
                        ...value,

                        quality:
                            value?.quality ||
                            value?.resolution ||
                            value?.label ||
                            value?.name ||
                            key,

                        url:
                            value?.url ||
                            value?.link ||
                            value?.download ||
                            value?.download_url ||
                            value?.downloadUrl ||
                            value?.direct_link ||
                            value?.directLink ||
                            value?.file ||
                            value?.video
                    };
                }
            );
        }

        // direct single link
        if (!list.length) {
            const direct =
                info?.download_url ||
                info?.downloadUrl ||
                info?.download ||
                info?.video_url ||
                info?.videoUrl ||
                info?.video ||
                info?.file_url ||
                info?.file ||
                info?.mp4;

            if (direct) {
                list.push({
                    quality:
                        info?.quality ||
                        info?.resolution ||
                        'FHD',
                    url: direct
                });
            }
        }

        return list.filter(
            x => x?.url && typeof x.url === 'string'
        );
    };

    try {

        await socket.sendMessage(sender, {
            react: {
                text: '🔎',
                key: msg.key
            }
        });

        // ==========================================
        // SEARCH
        // ==========================================
        const searchResponse = await axios.get(
            `${API_BASE}/sinhalacartoons/search`,
            {
                params: {
                    query,
                    api_key: API_KEY
                },
                timeout: 10000
            }
        );

        let results =
            searchResponse.data?.results ||
            searchResponse.data?.data ||
            searchResponse.data?.items ||
            searchResponse.data?.posts ||
            searchResponse.data?.result ||
            searchResponse.data;

        if (!Array.isArray(results)) {
            if (Array.isArray(results?.results)) {
                results = results.results;
            } else if (Array.isArray(results?.data)) {
                results = results.data;
            } else {
                results = [];
            }
        }

        if (!results.length) {
            return await socket.sendMessage(sender, {
                text:
`❌ *No Cartoon Movies Found*

🔎 *Search:* ${query}

> ${FOOTER}`
            }, { quoted: msg });
        }

        // TV series/filter type තිබ්බොත් අයින් කරනවා
        results = results.filter(item => {
            const type =
                String(
                    item?.type ||
                    item?.category ||
                    item?.post_type ||
                    ''
                ).toLowerCase();

            return !(
                type.includes('series') ||
                type.includes('tv')
            );
        });

        results = results.slice(0, 10);

        if (!results.length) {
            return await socket.sendMessage(sender, {
                text:
`❌ *Cartoon Movie Results Found නැහැ.*

> ${FOOTER}`
            }, { quoted: msg });
        }

        // ==========================================
        // SEARCH LIST
        // ==========================================
        let searchText =
`🎬 *SINHALA CARTOON MOVIE SEARCH*

🔎 *Search:* ${query}

🔢 *Reply below number to select movie*

`;

        results.forEach((item, i) => {

            const title =
                item?.title ||
                item?.name ||
                item?.post_title ||
                `Cartoon Movie ${i + 1}`;

            searchText +=
`🎞️ *${i + 1} ||》${title}*\n`;
        });

        searchText += `\n> ${FOOTER}`;

        let searchMsg;

        if (BOT_IMAGE) {
            searchMsg = await socket.sendMessage(
                sender,
                {
                    image: { url: BOT_IMAGE },
                    caption: searchText
                },
                { quoted: msg }
            );
        } else {
            searchMsg = await socket.sendMessage(
                sender,
                { text: searchText },
                { quoted: msg }
            );
        }

        // ==========================================
        // SELECT MOVIE
        // ==========================================
        const reply = await waitReply(
            searchMsg.key.id,
            120000
        );

        const number = parseInt(reply.text);

        if (
            isNaN(number) ||
            number < 1 ||
            number > results.length
        ) {
            return await socket.sendMessage(sender, {
                text: '❌ *Invalid Movie Number!*'
            }, { quoted: reply.msg });
        }

        const selected =
            results[number - 1];

        const postUrl =
            selected?.url ||
            selected?.link ||
            selected?.post_url ||
            selected?.permalink ||
            selected?.href;

        if (!postUrl) {
            return await socket.sendMessage(sender, {
                text: '❌ *Movie URL Not Found!*'
            }, { quoted: reply.msg });
        }

        await socket.sendMessage(sender, {
            text:
`⌛ *Getting movie details...*

🎬 ${selected?.title || selected?.name || ''}`
        }, { quoted: reply.msg });

        // ==========================================
        // POST API
        // ==========================================
        const postResponse = await axios.get(
            `${API_BASE}/sinhalacartoons/post`,
            {
                params: {
                    url: postUrl,
                    api_key: API_KEY
                },
                timeout: 15000
            }
        );

        const postData =
            postResponse.data?.data ||
            postResponse.data?.result ||
            postResponse.data;

        const info =
            postData?.info ||
            postData?.data?.info ||
            postData ||
            {};

        const title =
            info?.title ||
            postData?.title ||
            selected?.title ||
            selected?.name ||
            'Sinhala Cartoon Movie';

        const poster =
            info?.image ||
            info?.poster ||
            info?.thumbnail ||
            postData?.image ||
            postData?.poster ||
            selected?.image ||
            selected?.poster ||
            selected?.thumbnail;

        const rating =
            info?.rating ||
            info?.imdb ||
            info?.imdb_rating ||
            'N/A';

        const year =
            info?.year ||
            info?.release_year ||
            'N/A';

        const category =
            info?.category ||
            info?.genre ||
            'Cartoon Movies';

        const director =
            info?.director ||
            'N/A';

        const downloads =
            getDownloads(postData);

        if (!downloads.length) {
            console.log(
                'SC POST DATA:',
                JSON.stringify(postResponse.data, null, 2)
            );

            return await socket.sendMessage(sender, {
                text:
`❌ *Download Links Not Found*

🎬 ${title}

> ${FOOTER}`
            }, { quoted: reply.msg });
        }

        // ==========================================
        // MOVIE INFO
        // ==========================================
        let infoText =
`🎬 *${title}*

⭐ *RATING ➜* ${rating}
🥂 *CATEGORY ➜* ${category}
🎞️ *QUALITY ➜* ${downloads[0]?.quality || 'FHD'}
📅 *YEAR ➜* ${year}
👤 *DIRECTOR ➜* ${director}

> ${FOOTER}`;

        if (poster) {
            await socket.sendMessage(sender, {
                image: {
                    url: poster
                },
                caption: infoText
            }, { quoted: reply.msg });
        } else {
            await socket.sendMessage(sender, {
                text: infoText
            }, { quoted: reply.msg });
        }

        // ==========================================
        // DOWNLOAD OPTION
        // ==========================================
        let downloadText =
`⬇️🎬 *DOWNLOAD OPTION*

_Reply with number to get the video file_ 👇

┌────────────●➤
`;

        downloads.forEach((item, i) => {
            downloadText +=
`📂 *${i + 1} ||》📥 Download ${item.quality} - Cartoon Movie*\n`;
        });

        downloadText +=
`└────────────●➤

> ${FOOTER}`;

        const downloadMsg = await socket.sendMessage(
            sender,
            { text: downloadText },
            { quoted: reply.msg }
        );

        // ==========================================
        // SELECT DOWNLOAD
        // ==========================================
        const dlReply = await waitReply(
            downloadMsg.key.id,
            120000
        );

        const dlNumber =
            parseInt(dlReply.text);

        if (
            isNaN(dlNumber) ||
            dlNumber < 1 ||
            dlNumber > downloads.length
        ) {
            return await socket.sendMessage(sender, {
                text: '❌ *Invalid Download Number!*'
            }, { quoted: dlReply.msg });
        }

        const selectedDownload =
            downloads[dlNumber - 1];

        await socket.sendMessage(sender, {
            text:
`⌛ *Getting download link for ${title}...*`
        }, { quoted: dlReply.msg });

        const safeTitle =
            title.replace(/[\\/:*?"<>|]/g, '');

        // ==========================================
        // THUMB
        // ==========================================
        let thumbnail;

        if (poster) {
            try {
                const thumbRes = await axios.get(
                    poster,
                    {
                        responseType: 'arraybuffer',
                        timeout: 10000
                    }
                );

                thumbnail =
                    Buffer.from(thumbRes.data);

            } catch {}
        }

        // ==========================================
        // SEND DOCUMENT
        // ==========================================
        await socket.sendMessage(sender, {
            document: {
                url: selectedDownload.url
            },
            mimetype: 'video/mp4',
            fileName:
                `${safeTitle} - ${selectedDownload.quality}.mp4`,

            caption:
`🍀 *${title}*

🎬 *Cartoon Movie*
📺 *Quality:* ${selectedDownload.quality}

> ${FOOTER}`,

            ...(thumbnail
                ? { jpegThumbnail: thumbnail }
                : {})
        }, { quoted: dlReply.msg });

        await socket.sendMessage(sender, {
            react: {
                text: '✅',
                key: dlReply.msg.key
            }
        });

    } catch (error) {

        console.error(
            'SCARTOON ERROR:',
            error?.response?.data || error
        );

        await socket.sendMessage(sender, {
            text:
`❌ *SCARTOON ERROR*

${error?.response?.data?.message ||
error?.response?.data?.error ||
error?.message ||
'Unknown Error'}

> ${FOOTER}`
        }, { quoted: msg });
    }

    break;
        }

            
            case 'stv':
case 'cartoontv': {
    if (!isOwner && !isCreator) {
    return await socket.sendMessage(sender, {
        text: '❌ *Only Owner & Creator Can Use This Command*'
    }, { quoted: msg });
    }
    
    if (!args.length) {
        return await socket.sendMessage(sender, {
            text:
`❌ *කරුණාකර Cartoon / TV Series නම ලබාදෙන්න!*

📺 *Example:*
.stv Ben 10
.cartoontv Scooby Doo`
        }, { quoted: msg });
    }

    const query = args.join(' ');

    const API_BASE =
        'https://zara.laksidu.site';

    const API_KEY =
        'lakiya_72b96b423d046110b5947b625e05ecf2007e009f5ba61d1c4f9a4547fb983e8b';

    const BOT_IMAGE =
        sessionConfig.BOT_IMAGE ||
        config.BOT_IMAGE;

    const BOT_FOOTER =
        sessionConfig.BOT_FOOTER ||
        config.BOT_FOOTER ||
        'Zᴇꜱʀ ✘ 〽️ᴏᴠɪᴇ Bᴏᴛ';

    // ============================================
    // WAIT FOR REPLY
    // ============================================
    const waitReply = async (
        messageId,
        timeout = 120000
    ) => {
        return new Promise((resolve, reject) => {

            const listener = ({ messages }) => {

                const m = messages?.[0];

                if (!m?.message) return;

                if (
                    m.key.remoteJid !== sender
                ) return;

                const contextInfo =
                    m.message
                        ?.extendedTextMessage
                        ?.contextInfo ||

                    m.message
                        ?.imageMessage
                        ?.contextInfo ||

                    m.message
                        ?.videoMessage
                        ?.contextInfo ||

                    m.message
                        ?.documentMessage
                        ?.contextInfo;

                if (
                    contextInfo?.stanzaId !==
                    messageId
                ) return;

                const replyText =
                    m.message?.conversation ||

                    m.message
                        ?.extendedTextMessage
                        ?.text ||

                    m.message
                        ?.imageMessage
                        ?.caption ||

                    '';

                clearTimeout(timer);

                socket.ev.off(
                    'messages.upsert',
                    listener
                );

                resolve({
                    text: replyText.trim(),
                    msg: m
                });
            };

            const timer = setTimeout(() => {

                socket.ev.off(
                    'messages.upsert',
                    listener
                );

                reject(
                    new Error('TIMEOUT')
                );

            }, timeout);

            socket.ev.on(
                'messages.upsert',
                listener
            );
        });
    };

    // ============================================
    // NORMALIZE ARRAY
    // ============================================
    const normalizeArray = value => {

        if (Array.isArray(value)) {
            return value;
        }

        if (
            value &&
            typeof value === 'object'
        ) {
            return Object.entries(value).map(
                ([key, val]) => {

                    if (
                        typeof val === 'string'
                    ) {
                        return {
                            title: key,
                            name: key,
                            url: val
                        };
                    }

                    return {
                        title:
                            val?.title ||
                            val?.name ||
                            key,

                        ...val
                    };
                }
            );
        }

        return [];
    };

    // ============================================
    // GET QUALITY LINKS FROM EPISODE
    // NO SEPARATE DOWNLOAD API
    // ============================================
    const getQualities = episode => {

        let qualityData =
            episode?.qualities ||
            episode?.downloads ||
            episode?.download_links ||
            episode?.downloadLinks ||
            episode?.links ||
            episode?.videos ||
            episode?.files ||
            episode?.sources ||
            episode?.quality ||
            [];

        let qualities = [];

        // ----------------------------
        // ARRAY FORMAT
        // ----------------------------
        if (Array.isArray(qualityData)) {

            qualities = qualityData.map(
                (q, i) => {

                    if (
                        typeof q === 'string'
                    ) {
                        return {
                            quality:
                                `Quality ${i + 1}`,

                            url: q
                        };
                    }

                    return {
                        ...q,

                        quality:
                            q?.quality ||
                            q?.resolution ||
                            q?.label ||
                            q?.name ||
                            q?.title ||
                            `${i + 1}`,

                        url:
                            q?.url ||
                            q?.link ||
                            q?.download ||
                            q?.download_url ||
                            q?.downloadUrl ||
                            q?.direct_link ||
                            q?.directLink ||
                            q?.file ||
                            q?.video ||
                            q?.src
                    };
                }
            );

        }

        // ----------------------------
        // OBJECT FORMAT
        //
        // {
        //   "480p":"url",
        //   "720p":"url"
        // }
        // ----------------------------
        else if (
            qualityData &&
            typeof qualityData === 'object'
        ) {

            qualities =
                Object.entries(
                    qualityData
                ).map(([key, value]) => {

                    if (
                        typeof value ===
                        'string'
                    ) {
                        return {
                            quality: key,
                            url: value
                        };
                    }

                    return {
                        ...value,

                        quality:
                            value?.quality ||
                            value?.resolution ||
                            value?.label ||
                            value?.name ||
                            key,

                        url:
                            value?.url ||
                            value?.link ||
                            value?.download ||
                            value?.download_url ||
                            value?.downloadUrl ||
                            value?.direct_link ||
                            value?.directLink ||
                            value?.file ||
                            value?.video ||
                            value?.src
                    };
                });
        }

        // ----------------------------
        // DIRECT LINK IN EPISODE
        // ----------------------------
        if (!qualities.length) {

            const directUrl =
                episode?.download_url ||
                episode?.downloadUrl ||
                episode?.download ||
                episode?.video_url ||
                episode?.videoUrl ||
                episode?.video ||
                episode?.file_url ||
                episode?.file ||
                episode?.mp4 ||
                episode?.src;

            if (directUrl) {

                qualities.push({
                    quality:
                        episode?.quality ||
                        episode?.resolution ||
                        'Default',

                    url: directUrl
                });
            }
        }

        return qualities.filter(
            q =>
                q?.url &&
                typeof q.url === 'string'
        );
    };

    try {

        // ============================================
        // 1. SEARCH
        // ============================================
        await socket.sendMessage(
            sender,
            {
                react: {
                    text: '🔎',
                    key: msg.key
                }
            }
        );

        const searchResponse =
            await axios.get(
                `${API_BASE}/sinhalacartoons/search`,
                {
                    params: {
                        query,
                        api_key: API_KEY
                    }
                }
            );

        console.log(
            'SINHALACARTOONS SEARCH:',
            JSON.stringify(
                searchResponse.data,
                null,
                2
            )
        );

        let results =
            searchResponse.data?.results ||
            searchResponse.data?.data ||
            searchResponse.data?.items ||
            searchResponse.data?.posts ||
            searchResponse.data?.result ||
            searchResponse.data;

        if (
            results?.results &&
            Array.isArray(
                results.results
            )
        ) {
            results = results.results;
        }

        if (
            results?.items &&
            Array.isArray(
                results.items
            )
        ) {
            results = results.items;
        }

        results =
            normalizeArray(results);

        if (!results.length) {

            return await socket.sendMessage(
                sender,
                {
                    text:
`❌ *No Results Found*

🔎 Search: *${query}*

> ${BOT_FOOTER}`
                },
                { quoted: msg }
            );
        }

        results =
            results.slice(0, 20);

        let searchText =
`≛ *SINHALA CARTOONS SEARCH* ≛

📺 *TV SERIES SEARCH :* ${query}

┌────────────●➤
🔢 *Reply below number to select series*
└────────────●➤

`;

        results.forEach(
            (item, index) => {

                const title =
                    item?.title ||
                    item?.name ||
                    item?.post_title ||
                    item?.series_name ||
                    item?.series ||
                    `Result ${index + 1}`;

                searchText +=
`🧩 *${index + 1} ||》${title}*\n`;
            }
        );

        searchText +=
`
└────────────●➤
> ${BOT_FOOTER}`;

        let searchMsg;

        // ============================================
        // SEARCH MESSAGE = BOT IMAGE
        // ============================================
        if (BOT_IMAGE) {

            searchMsg =
                await socket.sendMessage(
                    sender,
                    {
                        image: {
                            url: BOT_IMAGE
                        },
                        caption: searchText
                    },
                    { quoted: msg }
                );

        } else {

            searchMsg =
                await socket.sendMessage(
                    sender,
                    {
                        text: searchText
                    },
                    { quoted: msg }
                );
        }

        // ============================================
        // SERIES SELECTION
        // ============================================
        let seriesReply;

        try {

            seriesReply =
                await waitReply(
                    searchMsg.key.id,
                    120000
                );

        } catch {

            return await socket.sendMessage(
                sender,
                {
                    text:
`⌛ *Search selection timeout!*

Command එක නැවත භාවිතා කරන්න.`
                }
            );
        }

        const seriesNumber =
            parseInt(
                seriesReply.text
            );

        if (
            isNaN(seriesNumber) ||
            seriesNumber < 1 ||
            seriesNumber >
            results.length
        ) {

            return await socket.sendMessage(
                sender,
                {
                    text:
                        '❌ *Invalid Series Number!*'
                },
                {
                    quoted:
                        seriesReply.msg
                }
            );
        }

        const selectedSeries =
            results[
                seriesNumber - 1
            ];

        const selectedTitle =
            selectedSeries?.title ||
            selectedSeries?.name ||
            selectedSeries?.post_title ||
            selectedSeries?.series_name ||
            'TV Series';

        const selectedUrl =
            selectedSeries?.url ||
            selectedSeries?.link ||
            selectedSeries?.post_url ||
            selectedSeries?.permalink ||
            selectedSeries?.href;

        if (!selectedUrl) {

            console.log(
                'SELECTED SERIES:',
                selectedSeries
            );

            return await socket.sendMessage(
                sender,
                {
                    text:
                        '❌ *Series URL Not Found!*'
                },
                {
                    quoted:
                        seriesReply.msg
                }
            );
        }

        await socket.sendMessage(
            sender,
            {
                text:
                    '📺 *Getting Series Details...*'
            },
            {
                quoted:
                    seriesReply.msg
            }
        );

        // ============================================
        // 2. POST API
        // ============================================
        let postData = {};

        try {

            const postResponse =
                await axios.get(
                    `${API_BASE}/sinhalacartoons/post`,
                    {
                        params: {
                            url: selectedUrl,
                            api_key:
                                API_KEY
                        }
                    }
                );

            console.log(
                'SINHALACARTOONS POST:',
                JSON.stringify(
                    postResponse.data,
                    null,
                    2
                )
            );

            postData =
                postResponse.data?.data ||
                postResponse.data?.result ||
                postResponse.data ||
                {};

        } catch (e) {

            console.log(
                'POST API ERROR:',
                e?.response?.data ||
                e.message
            );
        }

        // ============================================
        // SERIES URL
        // ============================================
        const seriesUrl =
            postData?.series_url ||
            postData?.seriesUrl ||
            postData?.series_link ||
            postData?.seriesLink ||
            postData?.url ||
            selectedUrl;

        // ============================================
        // 3. SERIES API
        // DOWNLOAD DATA ALSO COMES FROM HERE
        // ============================================
        const seriesResponse =
            await axios.get(
                `${API_BASE}/sinhalacartoons/series`,
                {
                    params: {
                        url: seriesUrl,
                        api_key: API_KEY
                    }
                }
            );

        console.log(
            'SINHALACARTOONS SERIES:',
            JSON.stringify(
                seriesResponse.data,
                null,
                2
            )
        );

        const seriesData =
            seriesResponse.data?.data ||
            seriesResponse.data?.result ||
            seriesResponse.data ||
            {};

        const finalTitle =
            seriesData?.title ||
            seriesData?.name ||
            postData?.title ||
            postData?.name ||
            selectedTitle;

        const poster =
            seriesData?.image ||
            seriesData?.poster ||
            seriesData?.thumbnail ||
            seriesData?.thumb ||
            postData?.image ||
            postData?.poster ||
            postData?.thumbnail ||
            selectedSeries?.image ||
            selectedSeries?.poster ||
            selectedSeries?.thumbnail;

        let episodes =
            seriesData?.episodes ||
            seriesData?.episode ||
            seriesData?.items ||
            seriesData?.downloads ||
            seriesData?.videos ||
            seriesData?.posts ||
            seriesData?.data?.episodes ||
            [];

        episodes =
            normalizeArray(
                episodes
            );

        if (!episodes.length) {

            console.log(
                'SERIES DATA:',
                JSON.stringify(
                    seriesData,
                    null,
                    2
                )
            );

            return await socket.sendMessage(
                sender,
                {
                    text:
`❌ *Episodes Not Found!*

Series API response එක console එකේ print කරලා තියෙනවා.`
                },
                {
                    quoted:
                        seriesReply.msg
                }
            );
        }

        // ============================================
        // EPISODE LIST
        // ============================================
        let episodeText =
`📺 *${finalTitle}*

🎬 *Total Episodes:* ${episodes.length}

_Reply with episode number to download_ 👇

┌────────────●➤
`;

        episodes.forEach(
            (episode, index) => {

                const episodeTitle =
                    episode?.title ||
                    episode?.name ||
                    episode?.episode_title ||
                    episode?.episode ||
                    `Episode ${String(
                        index + 1
                    ).padStart(2, '0')}`;

                episodeText +=
`📂 *${index + 1} ||》${episodeTitle}*\n`;
            }
        );

        episodeText +=
`
📂 *0 ||》Download All Episodes*

└────────────●➤
> ${BOT_FOOTER}`;

        let episodeMsg;

        if (poster) {

            episodeMsg =
                await socket.sendMessage(
                    sender,
                    {
                        image: {
                            url: poster
                        },
                        caption:
                            episodeText
                    },
                    {
                        quoted:
                            seriesReply.msg
                    }
                );

        } else {

            episodeMsg =
                await socket.sendMessage(
                    sender,
                    {
                        text:
                            episodeText
                    },
                    {
                        quoted:
                            seriesReply.msg
                    }
                );
        }

        // ============================================
        // EPISODE SELECT
        // ============================================
        let episodeReply;

        try {

            episodeReply =
                await waitReply(
                    episodeMsg.key.id,
                    180000
                );

        } catch {

            return await socket.sendMessage(
                sender,
                {
                    text:
                        '⌛ *Episode selection timeout!*'
                }
            );
        }

        const episodeNumber =
            parseInt(
                episodeReply.text
            );

        if (
            isNaN(episodeNumber) ||
            episodeNumber < 0 ||
            episodeNumber >
            episodes.length
        ) {

            return await socket.sendMessage(
                sender,
                {
                    text:
                        '❌ *Invalid Episode Number!*'
                },
                {
                    quoted:
                        episodeReply.msg
                }
            );
        }

        // ============================================
        // SEND EPISODE
        // forcedQuality = Download All වලදී
        // ============================================
        const sendEpisode =
            async (
                episode,
                index,
                forcedQuality = null
            ) => {

                const episodeTitle =
                    episode?.title ||
                    episode?.name ||
                    episode?.episode_title ||
                    episode?.episode ||
                    `Episode ${String(
                        index
                    ).padStart(2, '0')}`;

                console.log(
                    'SELECTED EPISODE:',
                    JSON.stringify(
                        episode,
                        null,
                        2
                    )
                );

                const qualities =
                    getQualities(
                        episode
                    );

                if (
                    !qualities.length
                ) {

                    console.log(
                        'NO DOWNLOAD LINKS:',
                        JSON.stringify(
                            episode,
                            null,
                            2
                        )
                    );

                    throw new Error(
                        `Download links not found for ${episodeTitle}`
                    );
                }

                let selectedQuality;

                // ==================================
                // DOWNLOAD ALL = SAME QUALITY
                // ==================================
                if (forcedQuality) {

                    selectedQuality =
                        qualities.find(
                            q =>
                                String(
                                    q.quality
                                )
                                    .toLowerCase()
                                    .includes(
                                        String(
                                            forcedQuality
                                        ).toLowerCase()
                                    )
                        );

                    // Exact quality නොතිබුණොත්
                    // පළමු quality එක
                    if (
                        !selectedQuality
                    ) {
                        selectedQuality =
                            qualities[0];
                    }
                }

                // ==================================
                // ONE QUALITY ONLY
                // ==================================
                else if (
                    qualities.length === 1
                ) {

                    selectedQuality =
                        qualities[0];

                }

                // ==================================
                // ASK QUALITY
                // ==================================
                else {

                    let qualityText =
`🎞️ *SELECT VIDEO QUALITY*

📺 *${finalTitle}*
🎬 *${episodeTitle}*

`;

                    qualities.forEach(
                        (q, i) => {

                            qualityText +=
`📥 *${i + 1} ||》${q.quality}*\n`;
                        }
                    );

                    qualityText +=
`
> ${BOT_FOOTER}`;

                    const qualityMsg =
                        await socket.sendMessage(
                            sender,
                            {
                                text:
                                    qualityText
                            },
                            {
                                quoted:
                                    episodeReply.msg
                            }
                        );

                    let qualityReply;

                    try {

                        qualityReply =
                            await waitReply(
                                qualityMsg.key.id,
                                120000
                            );

                    } catch {

                        throw new Error(
                            'Quality Selection Timeout'
                        );
                    }

                    const qualityNumber =
                        parseInt(
                            qualityReply.text
                        );

                    if (
                        isNaN(
                            qualityNumber
                        ) ||
                        qualityNumber <
                        1 ||
                        qualityNumber >
                        qualities.length
                    ) {

                        throw new Error(
                            'Invalid Quality Selection'
                        );
                    }

                    selectedQuality =
                        qualities[
                            qualityNumber -
                            1
                        ];
                }

                const downloadUrl =
                    selectedQuality?.url;

                if (!downloadUrl) {

                    throw new Error(
                        `Download URL not found for ${episodeTitle}`
                    );
                }

                console.log(
                    'FINAL DOWNLOAD URL:',
                    downloadUrl
                );

                await socket.sendMessage(
                    sender,
                    {
                        text:
`⬇️ *Downloading...*

📺 *${finalTitle}*
🎬 *${episodeTitle}*
📥 *${selectedQuality.quality}*`
                    },
                    {
                        quoted:
                            episodeReply.msg
                    }
                );

                const safeTitle =
                    `${finalTitle} - ${episodeTitle}`
                        .replace(
                            /[\\/:*?"<>|]/g,
                            ''
                        );

                // ==================================
                // THUMBNAIL
                // ==================================
                let thumbnail;

                if (poster) {
                    try {

                        const thumbResponse =
                            await axios.get(
                                poster,
                                {
                                    responseType:
                                        'arraybuffer'
                                }
                            );

                        thumbnail =
                            Buffer.from(
                                thumbResponse.data
                            );

                    } catch {}
                }

                // ==================================
                // SEND DOCUMENT
                // ==================================
                await socket.sendMessage(
                    sender,
                    {
                        document: {
                            url:
                                downloadUrl
                        },

                        mimetype:
                            'video/mp4',

                        fileName:
`${safeTitle} - ${selectedQuality.quality}.mp4`,

                        caption:
`🍀 *${finalTitle}*

🎬 *${episodeTitle}*
📺 *Quality:* ${selectedQuality.quality}

▣ 🕊️ *Z E S R* ▣

> ${BOT_FOOTER}`,

                        ...(thumbnail
                            ? {
                                jpegThumbnail:
                                    thumbnail
                            }
                            : {})
                    },
                    {
                        quoted:
                            episodeReply.msg
                    }
                );
            };

        // ============================================
        // SINGLE EPISODE
        // ============================================
        if (episodeNumber !== 0) {

            try {

                await sendEpisode(
                    episodes[
                        episodeNumber -
                        1
                    ],
                    episodeNumber
                );

                await socket.sendMessage(
                    sender,
                    {
                        react: {
                            text: '✅',
                            key:
                                episodeReply
                                    .msg.key
                        }
                    }
                );

            } catch (error) {

                console.error(
                    'EPISODE ERROR:',
                    error
                );

                await socket.sendMessage(
                    sender,
                    {
                        text:
`❌ *Download failed*

${error.message}`
                    },
                    {
                        quoted:
                            episodeReply.msg
                    }
                );
            }

            break;
        }

        // ============================================
        // DOWNLOAD ALL
        // ASK QUALITY ONCE
        // ============================================
        const firstEpisode =
            episodes[0];

        const firstQualities =
            getQualities(
                firstEpisode
            );

        if (
            !firstQualities.length
        ) {

            return await socket.sendMessage(
                sender,
                {
                    text:
`❌ *Quality links not found.*

First episode:
${JSON.stringify(
    firstEpisode,
    null,
    2
)}`
                },
                {
                    quoted:
                        episodeReply.msg
                }
            );
        }

        let allQuality;

        if (
            firstQualities.length === 1
        ) {

            allQuality =
                firstQualities[0]
                    .quality;

        } else {

            let allQualityText =
`🎞️ *SELECT QUALITY FOR ALL*

📺 *${finalTitle}*

`;

            firstQualities.forEach(
                (q, i) => {

                    allQualityText +=
`📥 *${i + 1} ||》${q.quality}*\n`;
                }
            );

            allQualityText +=
`
> ${BOT_FOOTER}`;

            const allQualityMsg =
                await socket.sendMessage(
                    sender,
                    {
                        text:
                            allQualityText
                    },
                    {
                        quoted:
                            episodeReply.msg
                    }
                );

            let allQualityReply;

            try {

                allQualityReply =
                    await waitReply(
                        allQualityMsg.key.id,
                        120000
                    );

            } catch {

                return await socket.sendMessage(
                    sender,
                    {
                        text:
                            '⌛ *Quality selection timeout!*'
                    }
                );
            }

            const allQualityNumber =
                parseInt(
                    allQualityReply.text
                );

            if (
                isNaN(
                    allQualityNumber
                ) ||
                allQualityNumber <
                1 ||
                allQualityNumber >
                firstQualities.length
            ) {

                return await socket.sendMessage(
                    sender,
                    {
                        text:
                            '❌ *Invalid Quality Number!*'
                    },
                    {
                        quoted:
                            allQualityReply.msg
                    }
                );
            }

            allQuality =
                firstQualities[
                    allQualityNumber -
                    1
                ].quality;
        }

        // ============================================
        // START ALL
        // ============================================
        await socket.sendMessage(
            sender,
            {
                text:
`📥 *DOWNLOAD ALL STARTED*

📺 *Series:* ${finalTitle}
🎬 *Episodes:* ${episodes.length}
📺 *Quality:* ${allQuality}

⏳ Please wait...`
            },
            {
                quoted:
                    episodeReply.msg
            }
        );

        let success = 0;
        let failed = 0;

        for (
            let i = 0;
            i < episodes.length;
            i++
        ) {

            try {

                await sendEpisode(
                    episodes[i],
                    i + 1,
                    allQuality
                );

                success++;

            } catch (error) {

                failed++;

                console.log(
                    `Episode ${i + 1} Error:`,
                    error.message
                );
            }

            // Delay
            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        3000
                    )
            );
        }

        // ============================================
        // COMPLETED
        // ============================================
        await socket.sendMessage(
            sender,
            {
                text:
`✅ *DOWNLOAD COMPLETED*

📺 *Series:* ${finalTitle}
🎬 *Total Episodes:* ${episodes.length}
📥 *Quality:* ${allQuality}

✅ *Success:* ${success}
❌ *Failed:* ${failed}

> ${BOT_FOOTER}`
            },
            {
                quoted:
                    episodeReply.msg
            }
        );

        break;

    } catch (error) {

        console.error(
            'SINHALACARTOONS ERROR:',
            error?.response?.data ||
            error
        );

        await socket.sendMessage(
            sender,
            {
                text:
`❌ *SINHALA CARTOONS ERROR*

${error?.response?.data?.message ||
error?.response?.data?.error ||
error?.message ||
'Unknown Error'}`
            },
            { quoted: msg }
        );

        break;
    }
}           
case 'tiktok':
case 'tt': {
    const FOOTER = `\n\n> ${config.BOT_FOOTER}`;

    if (!args.length) {
        await socket.sendMessage(sender, {
            image: { url: config.BOT_IMAGE },
            caption:
`╭─〔 🎵 𝗧𝗜𝗞𝗧𝗢𝗞 𝗗𝗟 〕
│
│ ⚠️ TikTok link එකක් දෙන්න
│
│ 📥 Example:
│ ${config.PREFIX}tt https://vt.tiktok.com/xxxx/
│
╰──────────────${FOOTER}`
        }, { quoted: msg });
        break;
    }

    const url = args[0].trim();

    if (!/https?:\/\/(?:www\.|vt\.|vm\.)?tiktok\.com\//i.test(url)) {
        await socket.sendMessage(sender, {
            image: { url: config.BOT_IMAGE },
            caption:
`╭─〔 ❌ 𝗜𝗡𝗩𝗔𝗟𝗜𝗗 𝗨𝗥𝗟 〕
│
│ TikTok link එකක් දෙන්න
│
│ ${config.PREFIX}tt https://vt.tiktok.com/xxxx/
│
╰──────────────${FOOTER}`
        }, { quoted: msg });
        break;
    }

    try {
        await socket.sendMessage(sender, {
            react: { text: '⏳', key: msg.key }
        });

        await socket.sendMessage(sender, {
            image: { url: config.BOT_IMAGE },
            caption:
`╭─〔 🎵 𝗧𝗜𝗞𝗧𝗢𝗞 𝗗𝗟 〕
│
│ ⚡ Fetching TikTok video...
│ ✨ Quality : 720p
│ 💧 Watermark : Removed
│
╰──────────────${FOOTER}`
        }, { quoted: msg });

        let videoUrl = null;
        let title = 'TikTok Video';
        let author = 'TikTok Creator';

        const pickData = (res) => res?.data?.data || res?.data?.result || res?.data || {};
        const pickVideo = (data) => {
            const direct =
                data?.no_watermark_hd ||
                data?.no_watermark ||
                data?.noWatermark ||
                data?.nowm_hd ||
                data?.nowm ||
                data?.hdplay ||
                data?.hdplay_url ||
                data?.play ||
                data?.play_url ||
                data?.video_url ||
                data?.videoUrl ||
                data?.download_url ||
                data?.downloadUrl ||
                data?.url ||
                data?.video;

            if (typeof direct === 'string' && direct.startsWith('http')) return direct;

            const downloads = data?.downloads;
            if (downloads && typeof downloads === 'object') {
                const nested =
                    downloads?.no_watermark_hd ||
                    downloads?.no_watermark ||
                    downloads?.nowm ||
                    downloads?.hd ||
                    downloads?.video ||
                    downloads?.url;
                if (typeof nested === 'string' && nested.startsWith('http')) return nested;
            }

            return null;
        };

        const updateMeta = (data) => {
            title = data?.title || data?.desc || data?.description || title;
            const rawAuthor =
                data?.author?.nickname ||
                data?.author?.username ||
                data?.author ||
                data?.username;

            if (typeof rawAuthor === 'string') author = rawAuthor;
        };

        // 1) 720p V2
        try {
            const res = await axios.get(
                `${config.API_CINESUBZ_URL}/tiktok/download/v2`,
                {
                    params: {
                        url,
                        quality: '720p',
                        api_key: config.API_KEY
                    },
                    timeout: 60000
                }
            );

            const data = pickData(res);
            videoUrl = pickVideo(data);
            updateMeta(data);
        } catch (e) {
            console.log('TikTok V2 failed:', e?.response?.data || e.message);
        }

        // 2) Normal download fallback
        if (!videoUrl) {
            const res = await axios.get(
                `${config.API_CINESUBZ_URL}/tiktok/download`,
                {
                    params: {
                        url,
                        api_key: config.API_KEY
                    },
                    timeout: 60000
                }
            );

            const data = pickData(res);
            videoUrl = pickVideo(data);
            updateMeta(data);
        }

        if (!videoUrl) {
            await socket.sendMessage(sender, {
                react: { text: '❌', key: msg.key }
            });

            await socket.sendMessage(sender, {
                image: { url: config.BOT_IMAGE },
                caption:
`╭─〔 ❌ 𝗧𝗜𝗞𝗧𝗢𝗞 𝗘𝗥𝗥𝗢𝗥 〕
│
│ Download link not found
│
╰──────────────${FOOTER}`
            }, { quoted: msg });
            break;
        }

        const caption =
`╭─〔 🎵 𝗧𝗜𝗞𝗧𝗢𝗞 𝗛𝗗 〕
│
│ ☘️ *${title}*
│
│ 👤 Creator : *${author}*
│ ✨ Quality : \`720p\`
│ 💧 Watermark : \`Removed\`
│
╰──────────────
> ${config.BOT_FOOTER}`;

        await socket.sendMessage(sender, {
            video: { url: videoUrl },
            mimetype: 'video/mp4',
            caption
        }, { quoted: msg });

        await socket.sendMessage(sender, {
            react: { text: '✅', key: msg.key }
        });

    } catch (err) {
        console.error('TikTok Error:', err?.response?.data || err);

        await socket.sendMessage(sender, {
            react: { text: '❌', key: msg.key }
        });

        await socket.sendMessage(sender, {
            image: { url: config.BOT_IMAGE },
            caption:
`╭─〔 ❌ 𝗧𝗜𝗞𝗧𝗢𝗞 𝗘𝗥𝗥𝗢𝗥 〕
│
│ ${err?.response?.data?.message ||
      err?.response?.data?.error ||
      err?.message ||
      'Unknown Error'}
│
╰──────────────${FOOTER}`
        }, { quoted: msg });
    }

    break;
}
        case 'cinesubz':
            if (!isOwner && !isCreator) {
    return await socket.sendMessage(sender, {
        text: '❌ *Only Owners Can Use This Command*'
    }, { quoted: msg });
            }
   
    const getEnglishTitle4 = (title) => {
        if (!title) return '';
        
        let cleaned = title;
        const sinhalaPatterns = [
            /සිංහල[\s]*උපසිරසි[\s]*සමඟ/g,
            /සිංහල[\s]*උපසිරසි/g,
            /උපසිරසි[\s]*සමඟ/g,
            /සමඟ[\s]*$/g,
            /සිංහල[\s]*Subtitles/g,
            /Sinhala[\s]*Subtitles/g,
            /සිංහල/g,
            /උපසිරසි/g,
            /Subtitles/g
        ];
        
        for (const pattern of sinhalaPatterns) {
            cleaned = cleaned.replace(pattern, '');
        }
        
        
        cleaned = cleaned.replace(/[\u0D80-\u0DFF]+/g, '');
        cleaned = cleaned.replace(/\([^)]*[\u0D80-\u0DFF][^)]*\)/g, '');
        cleaned = cleaned.replace(/\([\s]*[\u0D80-\u0DFF][^)]*\)/g, '');
        cleaned = cleaned.replace(/-\s*[\u0D80-\u0DFF][^-]*/g, '');
        cleaned = cleaned.replace(/\s+/g, ' ').trim();
        cleaned = cleaned.replace(/^[^a-zA-Z0-9]+/, '');
        cleaned = cleaned.replace(/[^a-zA-Z0-9\s\-\.]+$/, '');
        cleaned = cleaned.trim();
        
       
        if (!cleaned || cleaned.length < 2) {
            const match = title.match(/^([^(/\-]+)/);
            if (match) {
                cleaned = match[1].trim();
            } else {
                cleaned = title;
            }
        }
        
        return cleaned || title;
    };

    if (!args.length) {
        await socket.sendMessage(sender, {
            image: { url:  config.BOT_IMAGE},
            caption: formatMessage(
                '❌ ERROR',
                '*කරුණාකර චිත්‍රපටයේ නම ලබාදෙන්න! උදා: .cinesubz spider',
                `${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
            )
        }, { quoted: msg });
        break;
    }

    const cinezubQuery = args.join(' ');
  

   
    let cinesubzSelectionListener = null;
    let cinesubzDownloadListener = null;
    
    // Timeout variables
    let cinesubzSelectionTimeout = null;
    let cinesubzDownloadTimeout = null;
    
   
    let cinesubzMasterTimeout = null;

    
    const clearAllCinesubzListeners = () => {
        console.log('🧹 Clearing all Cinesubz listeners');
        
      
        if (cinesubzSelectionListener) {
            socket.ev.off('messages.upsert', cinesubzSelectionListener);
            cinesubzSelectionListener = null;
        }
        if (cinesubzSelectionTimeout) {
            clearTimeout(cinesubzSelectionTimeout);
            cinesubzSelectionTimeout = null;
        }
       
       
        if (cinesubzDownloadListener) {
            socket.ev.off('messages.upsert', cinesubzDownloadListener);
            cinesubzDownloadListener = null;
        }
        if (cinesubzDownloadTimeout) {
            clearTimeout(cinesubzDownloadTimeout);
            cinesubzDownloadTimeout = null;
        }
        
      
        if (cinesubzMasterTimeout) {
            clearTimeout(cinesubzMasterTimeout);
            cinesubzMasterTimeout = null;
        }
    };

    try {
        const searchResponse = await axios.get(`${config.API_MAIN_URL}/cinesubz/search?query=${encodeURIComponent(cinezubQuery)}&api_key=${config.API_KEY}`);
        const searchData = searchResponse.data;

        if (!searchData.status || !searchData.results || searchData.results.length === 0) {
            await socket.sendMessage(sender, {
                image: { url:config.BOT_IMAGE},
                caption: formatMessage(
                    '❌ NO RESULTS',
                    '*Cinesubz හි චිත්‍රපට හමුවෙන්නේ නැත! 😞*',
                    `${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
                )
            }, { quoted: msg });
            break;
        }

        const cinezubResults = searchData.results.slice(0, 40);
        let listText = `_❐ Search From cinesubz.lk_
❐ *𝗦𝗘𝗔𝗥𝗖𝗛 : _${cinezubQuery}_*
╭──────●➤
*🔢 ʀᴇᴘʟʏ ʙᴇʟᴏᴡ ɴᴜᴍʙᴇʀ*
╰──────────●➤
*╭──────●➤*\n`;

        cinezubResults.forEach((item, index) => {
            const type = item.link.includes('/tvshows/') ? '📺 TV Series' : '🎬 Movie';
            listText += `*🌸 ${index + 1} ║❯❯ ${item.title}*\n`;
        });

        listText += `╰──────────●➤\n> ${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`;
        
        const sentMsg = await socket.sendMessage(sender, {
            image: { url: config.BOT_IMAGE},
            caption: listText
        }, { quoted: msg });

        const messageID = sentMsg.key.id;

        
        cinesubzMasterTimeout = setTimeout(() => {
            clearAllCinesubzListeners();
            console.log('🧹 Cinesubz master timeout - All listeners cleared after 3 minutes');
        }, 180000);

       
        const handleSelection = async ({ messages: replyMessages }) => {
            const replyMek = replyMessages[0];
            if (!replyMek?.message) return;

            const messageType = replyMek.message.conversation || replyMek.message.extendedTextMessage?.text;
            const isReplyToSentMsg = replyMek.message.extendedTextMessage?.contextInfo?.stanzaId === messageID;

            if (isReplyToSentMsg && sender === replyMek.key.remoteJid) {
               
                if (cinesubzSelectionTimeout) {
                    clearTimeout(cinesubzSelectionTimeout);
                    cinesubzSelectionTimeout = null;
                }
                
               
                cinesubzSelectionTimeout = setTimeout(() => {
                    if (cinesubzSelectionListener) {
                        socket.ev.off('messages.upsert', cinesubzSelectionListener);
                        cinesubzSelectionListener = null;
                        console.log('🧹 Cinesubz selection listener timeout');
                    }
                    cinesubzSelectionTimeout = null;
                }, 120000);

                const choice = parseInt(messageType) - 1;
                if (isNaN(choice) || choice < 0 || choice >= cinezubResults.length) {
                    await socket.sendMessage(sender, {
                        image: { url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE},
                        caption: formatMessage(
                            '❌ INVALID SELECTION',
                            `*වැරදි අංකයක්! 1-${cinezubResults.length} අතර තෝරන්න! 😕*`,
                            `${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
                        )
                    }, { quoted: replyMek });
                    return;
                }

                const selectedItem = cinezubResults[choice];
                
                await socket.sendMessage(sender, { 
                    text: '📽️ 𝙁𝙚𝙩𝙘𝙝𝙞𝙣𝙜 𝙙𝙚𝙩𝙖𝙞𝙡𝙨...' 
                }, { quoted: replyMek });

                try {
                    const detailsResponse = await axios.get(`${config.API_MAIN_URL}/cinesubz/details?url=${encodeURIComponent(selectedItem.link)}&api_key=${config.API_KEY}`);
                    const detailsData = detailsResponse.data;

                    if (!detailsData.status || !detailsData.data) {
                        throw new Error('Failed to fetch details');
                    }

                    const movieInfo = detailsData.data;
                    
                    const validDownloads = movieInfo.downloads?.filter(dl => dl && dl.quality && dl.url) || [];
                    let allDownloadOptions = [...validDownloads];

                    if (allDownloadOptions.length === 0) {
                        await socket.sendMessage(sender, {
                            image: { url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE},
                            caption: formatMessage(
                                '❌ NO DOWNLOADS',
                                '*මෙම චිත්‍රපටය සඳහා බාගත කිරීමේ link නොමැත!*',
                                `${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
                            )
                        }, { quoted: replyMek });
                        return;
                    }
                    
                   const description = movieInfo.description?.substring(0, 300) + (movieInfo.description?.length > 300 ? '...' : '') || 'No description available.';
                    const imdbRating = movieInfo.imdb_rating ? `${movieInfo.imdb_rating}/10` : 'N/A';
                    const year = movieInfo.year || 'N/A';
                    const runtime = movieInfo.runtime || 'N/A';
                    const director = movieInfo.director || 'N/A';
                    const country = movieInfo.country || 'N/A';
                    const cast = movieInfo.cast || 'N/A';
                    
                    const detailsCaption = formatMessage(
                        `☘️ 𝗧ɪᴛʟᴇ  ➟  ${movieInfo.title}`,
                        `▫️🥇 *𝗜ᴍᴅʙ 𝗥ᴀᴛɪɴɢ ➟ ${imdbRating}*
▫️⏳ *𝗗ᴜʀᴀᴛɪᴏɴ ➟ ${runtime}*
▫️📅 *𝗥ᴇʟᴇᴀꜱᴇ 𝗬ᴇᴀʀ ➟ ${year}*
▫️🎬 *𝗗ɪʀᴇᴄᴛᴏʀ ➟ ${director}*
▫️🌎 *𝗖ᴏᴜɴᴛʀʏ ➟ ${country}*
▫️👥 *𝗖ᴀꜱᴛ ➟ ${cast}*
▫️📖 *Sᴛᴏʀʏ ➟ ${description}*
▫️🔗 *Jᴏɪɴ ➟ ${sessionConfig.MGROUP_LINK || config.MGROUP_LINK}*`,
                        `${sessionConfig.MOVIE_FOOTER || config.MOVIE_FOOTER}`
                    );

                    const infoMsg = await socket.sendMessage(sender, {
                        image: { url: movieInfo.poster || sessionConfig.BOT_IMAGE || config.BOT_IMAGE },
                        caption: detailsCaption
                    }, { quoted: replyMek });

                    await new Promise(resolve => setTimeout(resolve, 3000));

                   
                    const downloadOptionsText = `*⬇️🍀 𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗 𝗢𝗣𝗧𝗜𝗢𝗡𝗦*
_*Reply with a number to download 👇*_
╭──────●➤
${allDownloadOptions.map((dl, i) => {
    return `*📂 ${i + 1} ❭❭ 📥 ${dl.quality}*`;
}).join('\n')}
╰──────────●➤
${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`;

                    const downloadMsg = await socket.sendMessage(sender, {
                        text: downloadOptionsText
                    }, { quoted: infoMsg });

                    const infoMsgID = downloadMsg.key.id;

                   
                    const handleDownload = async ({ messages: downloadMessages }) => {
                        const downloadMek = downloadMessages[0];
                        if (!downloadMek?.message) return;

                        const downloadChoice = downloadMek.message.conversation || downloadMek.message.extendedTextMessage?.text;
                        const isReplyToInfoMsg = downloadMek.message.extendedTextMessage?.contextInfo?.stanzaId === infoMsgID;

                        if (isReplyToInfoMsg && sender === downloadMek.key.remoteJid) {
                            
                            if (cinesubzDownloadTimeout) {
                                clearTimeout(cinesubzDownloadTimeout);
                                cinesubzDownloadTimeout = null;
                            }
                            
                           
                            cinesubzDownloadTimeout = setTimeout(() => {
                                if (cinesubzDownloadListener) {
                                    socket.ev.off('messages.upsert', cinesubzDownloadListener);
                                    cinesubzDownloadListener = null;
                                    console.log('🧹 Cinesubz download listener timeout');
                                }
                                cinesubzDownloadTimeout = null;
                            }, 120000);

                            const choiceNum = parseInt(downloadChoice) - 1;
                            
                           
                            if (isNaN(choiceNum) || choiceNum < 0 || choiceNum >= allDownloadOptions.length) {
                                await socket.sendMessage(sender, {
                                    image: { url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE},
                                    caption: formatMessage(
                                        '❌ INVALID SELECTION',
                                        `*වැරදි අංකයක්! 1-${allDownloadOptions.length} අතර තෝරන්න!*`,
                                        `${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
                                    )
                                }, { quoted: downloadMek });
                                return;
                            }

                           
                            const selectedDownload = allDownloadOptions[choiceNum];
                            
                            await socket.sendMessage(sender, { 
                                text: `⏳ 𝙂𝙚𝙩𝙩𝙞𝙣𝙜 𝙙𝙤𝙬𝙣𝙡𝙤𝙖𝙙 𝙡𝙞𝙣𝙠 𝙛𝙤𝙧 ${selectedDownload.quality}...` 
                            }, { quoted: downloadMek });

                            try {
                                const downloadResponse = await axios.get(`${config.API_MAIN_URL2}/movie/cinesubz?url=${encodeURIComponent(selectedDownload.url)}&api_key=${config.API_KEY}`);
                                const downloadData = downloadResponse.data;

                                if (!downloadData.status || !downloadData.data?.download) {
                                    throw new Error('Failed to get download URL');
                                }

                                const downloadLinks = downloadData.data.download;
                                const nonTelegramLinks = downloadLinks.filter(link => 
                                    link.name && link.name.toLowerCase() !== 'telegram'
                                );
                                
                                if (nonTelegramLinks.length === 0) {
                                    throw new Error('No non-Telegram download links available');
                                }
                                
                                const preferredLink = nonTelegramLinks.find(link => link.name === 'unknown') || nonTelegramLinks[0];
                                
                                await socket.sendMessage(sender, { react: { text: '📥', key: downloadMek.key } });

                           
                                const thumbUrl = movieInfo.poster || sessionConfig.BOT_IMAGE || config.BOT_IMAGE;
                                let thumbBuffer;
                                try {
                                    const response = await axios.get(thumbUrl, { 
                                        responseType: 'arraybuffer',
                                        timeout: 30000
                                    });

                                    thumbBuffer = await sharp(Buffer.from(response.data))
                                        .resize(300, 300, { 
                                            fit: 'cover',
                                            position: 'center' 
                                        })
                                        .jpeg({ quality: 70 })
                                        .toBuffer();

                                } catch (e) {
                                    console.error('Thumbnail download/resize error:', e.message);
                                    thumbBuffer = undefined;
                                }

                                
                                let qualityDisplay = selectedDownload.quality || '';
                                qualityDisplay = qualityDisplay.replace(/\s*\([^)]*(MB|GB|KB|B|b)\)/gi, '');
                                qualityDisplay = qualityDisplay.replace(/\s*\d+(\.\d+)?\s*(MB|GB|KB|B|b)/gi, '');
                                qualityDisplay = qualityDisplay.replace(/[\(\)\[\]\{\}]/g, '');
                                qualityDisplay = qualityDisplay.replace(/\s+/g, ' ').trim();
                                qualityDisplay = qualityDisplay.replace(/[^a-zA-Z0-9p\s]/g, '');
                                qualityDisplay = qualityDisplay.trim();

                                await socket.sendMessage(sender, {
                                    document: { url: preferredLink.url },
                                    mimetype: 'video/mp4',
                                    fileName: downloadData.data.title || `${movieInfo.title} ${selectedDownload.quality}.mp4`,
                                    jpegThumbnail: thumbBuffer,
                                    caption: formatMessage(
                                        `☘️ ${movieInfo.title}`,
                                        `\`❚█${sessionConfig.MOVIE_CAPTION || config.MOVIE_CAPTION}█❚\`

\`❪${qualityDisplay}❫\``,
                                        `${sessionConfig.MOVIE_FOOTER || config.MOVIE_FOOTER}`
                                    )
                                }, { quoted: downloadMek });

                                await socket.sendMessage(sender, { react: { text: '✅', key: downloadMek.key } });

                               
                                clearAllCinesubzListeners();

                            } catch (downloadError) {
                                console.error('Download link error:', downloadError);
                                await socket.sendMessage(sender, {
                                    image: { url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE},
                                    caption: formatMessage(
                                        '❌ DOWNLOAD ERROR',
                                        `*Download link එක ලබාගැනීමේ දෝෂයක්.*\n${downloadError.message}`,
                                        `${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
                                    )
                                }, { quoted: downloadMek });
                            }
                        }
                    };

                    cinesubzDownloadListener = handleDownload;
                    socket.ev.on('messages.upsert', handleDownload);

                    cinesubzDownloadTimeout = setTimeout(() => {
                        if (cinesubzDownloadListener) {
                            socket.ev.off('messages.upsert', cinesubzDownloadListener);
                            cinesubzDownloadListener = null;
                            console.log('🧹 Cinesubz download listener timeout');
                        }
                        cinesubzDownloadTimeout = null;
                    }, 120000);

                } catch (detailsError) {
                    console.error('Details error:', detailsError);
                    await socket.sendMessage(sender, {
                        image: { url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE},
                        caption: formatMessage(
                            '❌ ERROR',
                            `*Details ලබාගැනීමේ දෝෂයක්*\n${detailsError.message}`,
                            `${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
                        )
                    }, { quoted: replyMek });
                }
            }
        };

        cinesubzSelectionListener = handleSelection;
        socket.ev.on('messages.upsert', handleSelection);

        cinesubzSelectionTimeout = setTimeout(() => {
            if (cinesubzSelectionListener) {
                socket.ev.off('messages.upsert', cinesubzSelectionListener);
                cinesubzSelectionListener = null;
                console.log('🧹 Cinesubz selection listener timeout');
            }
            cinesubzSelectionTimeout = null;
        }, 120000);

    } catch (error) {
        console.error('Cinezub command error:', error);
        
        clearAllCinesubzListeners();
        await socket.sendMessage(sender, {
            image: { url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE},
            caption: formatMessage(
                '❌ ERROR',
                `*දෝෂයක් ඇතිවුණා:* ${error.message || 'Unknown error'}`,
                `${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
            )
        }, { quoted: msg });
    }
    
    break;

    case 'sticker':
case 's': {
    try {
        const contextInfo =
            msg.message?.extendedTextMessage?.contextInfo ||
            msg.message?.imageMessage?.contextInfo;

        let quoted = contextInfo?.quotedMessage;

        if (!quoted) {
            return await socket.sendMessage(sender, {
                text: '❌ *Photo එකකට Reply කරලා `.sticker` / `.s` යවන්න.*'
            }, { quoted: msg });
        }

        // Ephemeral unwrap
        if (quoted.ephemeralMessage) {
            quoted = quoted.ephemeralMessage.message;
        }

        // View once unwrap
        if (quoted.viewOnceMessageV2) {
            quoted = quoted.viewOnceMessageV2.message;
        }

        if (quoted.viewOnceMessageV2Extension) {
            quoted = quoted.viewOnceMessageV2Extension.message;
        }

        if (!quoted.imageMessage) {
            return await socket.sendMessage(sender, {
                text: '❌ *Sticker එකක් හදන්න Photo එකකට Reply කරන්න.*'
            }, { quoted: msg });
        }

        await socket.sendMessage(sender, {
            react: {
                text: '🎨',
                key: msg.key
            }
        });

        const mediaBuffer = await downloadMediaMessage(
            {
                key: {
                    remoteJid: sender,
                    id: contextInfo?.stanzaId,
                    participant: contextInfo?.participant
                },
                message: quoted
            },
            'buffer',
            {},
            {
                logger: console,
                reuploadRequest: socket.updateMediaMessage
            }
        );

        if (!mediaBuffer || !mediaBuffer.length) {
            throw new Error('Image download failed');
        }

        const stickerBuffer = await sharp(mediaBuffer)
            .resize(512, 512, {
                fit: 'contain',
                background: {
                    r: 0,
                    g: 0,
                    b: 0,
                    alpha: 0
                }
            })
            .webp({
                quality: 90
            })
            .toBuffer();

        await socket.sendMessage(
            sender,
            {
                sticker: stickerBuffer
            },
            {
                quoted: msg
            }
        );

        await socket.sendMessage(sender, {
            react: {
                text: '✅',
                key: msg.key
            }
        });

    } catch (error) {
    console.error('Sticker command error:', error);

    await socket.sendMessage(sender, {
        react: {
            text: '❌',
            key: msg.key
        }
    });

    await socket.sendMessage(sender, {
        text:
`❌ *Sticker Error*

${error?.message || error}

> ${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
    }, { quoted: msg });
}
    break;
            }  
            case 'connectlist':
case 'connected':
case 'connections': {
    try {
        if (!isCreator) {
            return await socket.sendMessage(sender, {
                text: '❌ *Creator Only Command*'
            }, { quoted: msg });
        }

        const connectedBots = [];

        for (const [number, data] of activeSockets.entries()) {
            if (!data?.socket) continue;

            const user = data.socket.user;

            connectedBots.push({
                number,
                name: user?.name || 'Unknown',
                jid: user?.id
                    ? jidNormalizedUser(user.id)
                    : `${number}@s.whatsapp.net`,
                connectedAt: socketCreationTime.get(number) || null
            });
        }

        if (!connectedBots.length) {
            return await socket.sendMessage(sender, {
                text: `📱 *CONNECTED LIST*

❌ No active connected bots.

> ${sessionConfig?.BOT_FOOTER || config?.BOT_FOOTER || 'Zᴇꜱʀ ✘ 〽️ᴏᴠɪᴇ Bᴏᴛ ᴠ1.1'}`
            }, { quoted: msg });
        }

        const formatRuntime = (time) => {
            if (!time) return 'Unknown';

            const seconds = Math.floor((Date.now() - time) / 1000);
            const days = Math.floor(seconds / 86400);
            const hours = Math.floor((seconds % 86400) / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = seconds % 60;

            return `${days}d ${hours}h ${minutes}m ${secs}s`;
        };

        let text = `📱 *CONNECTED LIST*

🟢 *Active Bots:* ${connectedBots.length}

`;

        connectedBots.forEach((bot, index) => {
            text += `*${index + 1}. ${bot.name}*

📱 *Number:* +${bot.number}
🆔 *JID:* ${bot.jid}
🟢 *Status:* Online
⏱️ *Runtime:* ${formatRuntime(bot.connectedAt)}

`;
        });

        text += `> ${sessionConfig?.BOT_FOOTER || config?.BOT_FOOTER || 'Zᴇꜱʀ ✘ 〽️ᴏᴠɪᴇ Bᴏᴛ ᴠ1.1'}`;

        await socket.sendMessage(sender, {
            text
        }, { quoted: msg });

    } catch (error) {
        console.error('CONNECTLIST ERROR:', error);

        await socket.sendMessage(sender, {
            text: `❌ *Connect List Error*\n\n${error.message || error}`
        }, { quoted: msg });
    }

    break;
}
case 'save':
case 'savestatus': {
    try {
        if (!isOwner) {
            return await socket.sendMessage(sender, {
                text: '❌ *Owner Only Command*'
            }, { quoted: msg });
        }

        const contextInfo =
            msg.message?.extendedTextMessage?.contextInfo ||
            msg.message?.imageMessage?.contextInfo ||
            msg.message?.videoMessage?.contextInfo;

        let quoted = contextInfo?.quotedMessage;

        if (!quoted) {
            return await socket.sendMessage(sender, {
                text: '❌ *Status Photo / Video එකකට reply කරලා `.save` යවන්න.*'
            }, { quoted: msg });
        }

        if (quoted.ephemeralMessage) {
            quoted = quoted.ephemeralMessage.message;
        }

        if (quoted.viewOnceMessageV2) {
            quoted = quoted.viewOnceMessageV2.message;
        }

        if (quoted.viewOnceMessageV2Extension) {
            quoted = quoted.viewOnceMessageV2Extension.message;
        }

        const imageMsg = quoted.imageMessage;
        const videoMsg = quoted.videoMessage;

        if (!imageMsg && !videoMsg) {
            return await socket.sendMessage(sender, {
                text: '❌ *මේ Status එකේ Photo / Video එකක් නැහැ.*'
            }, { quoted: msg });
        }

        await socket.sendMessage(sender, {
            react: {
                text: '📥',
                key: msg.key
            }
        });

        if (imageMsg) {
            const stream = await downloadContentFromMessage(
                imageMsg,
                'image'
            );

            const chunks = [];

            for await (const chunk of stream) {
                chunks.push(chunk);
            }

            const buffer = Buffer.concat(chunks);

            await socket.sendMessage(sender, {
                image: buffer,
                caption:
`✅ *STATUS SAVED*

${imageMsg.caption || ''}

> ${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
            }, { quoted: msg });
        }

        if (videoMsg) {
            const stream = await downloadContentFromMessage(
                videoMsg,
                'video'
            );

            const chunks = [];

            for await (const chunk of stream) {
                chunks.push(chunk);
            }

            const buffer = Buffer.concat(chunks);

            await socket.sendMessage(sender, {
                video: buffer,
                mimetype: 'video/mp4',
                caption:
`✅ *STATUS SAVED*

${videoMsg.caption || ''}

> ${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
            }, { quoted: msg });
        }

        await socket.sendMessage(sender, {
            react: {
                text: '✅',
                key: msg.key
            }
        });

    } catch (error) {
        console.error('Status save error:', error);

        await socket.sendMessage(sender, {
            react: {
                text: '❌',
                key: msg.key
            }
        });

        await socket.sendMessage(sender, {
            text: `❌ *Status Save Error*\n\n${error?.message || error}`
        }, { quoted: msg });
    }

    break;
                }
            

case 'vnote':
case 'videonote': {
    try {
        if (!isOwner && !isCreator) {
            return await socket.sendMessage(sender, {
                text: '❌ *Only Authorized Users Can Use This Command*'
            }, { quoted: msg });
        }

        await socket.sendMessage(sender, {
            react: {
                text: '🎥',
                key: msg.key
            }
        });

        const contextInfo =
            msg.message?.extendedTextMessage?.contextInfo ||
            msg.message?.videoMessage?.contextInfo;

        let quoted = contextInfo?.quotedMessage;

        if (!quoted) {
            return await socket.sendMessage(sender, {
                text: '❌ *Video එකකට reply කරලා `.vnote` යවන්න.*'
            }, { quoted: msg });
        }

        // Ephemeral message unwrap
        if (quoted.ephemeralMessage) {
            quoted = quoted.ephemeralMessage.message;
        }

        // View Once unwrap
        if (quoted.viewOnceMessageV2) {
            quoted = quoted.viewOnceMessageV2.message;
        }

        if (quoted.viewOnceMessageV2Extension) {
            quoted = quoted.viewOnceMessageV2Extension.message;
        }

        const videoMessage = quoted.videoMessage;

        if (!videoMessage) {
            return await socket.sendMessage(sender, {
                text: '❌ *Video එකකට reply කරලා `.vnote` යවන්න.*'
            }, { quoted: msg });
        }

        const stream = await downloadContentFromMessage(
            videoMessage,
            'video'
        );

        let buffer = Buffer.from([]);

        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        // 🎥 WhatsApp Round Video Note
        await socket.sendMessage(sender, {
            video: buffer,
            mimetype: 'video/mp4',
            ptv: true
        }, { quoted: msg });

        await socket.sendMessage(sender, {
            react: {
                text: '✅',
                key: msg.key
            }
        });

    } catch (error) {
        console.error('VNOTE ERROR:', error);

        await socket.sendMessage(sender, {
            text:
`❌ *VNOTE ERROR*

${error.message}

> Zᴇꜱʀ ✘ 〽️ᴏᴠɪᴇ Bᴏᴛ`
        }, { quoted: msg });
    }

    break;
}        
        case 'sinhalasub':
    if (!args.length) {
        await socket.sendMessage(sender, {
             image: { url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE},
            caption: formatMessage(
                '❌ ERROR',
                '*කරුණාකර චිත්‍රපටයේ නම ලබාදෙන්න! උදා: .sinhalasub spider*',
                `${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
            )
        }, { quoted: msg });
        break;
    }

    const movieQuery55 = args.join(' ');
   
    await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 2000) + 2000));

 
    let sinhalasubSelectionListener = null;
    let sinhalasubDownloadListener = null;
    let sinhalasubSelectionTimeout = null;
    let sinhalasubDownloadTimeout = null;
    
 
    let sinhalasubMasterTimeout = null;
    const clearAllSinhalasubListeners = () => {
        console.log('🧹 Clearing all Sinhalasub listeners');
        
       
        if (sinhalasubSelectionListener) {
            socket.ev.off('messages.upsert', sinhalasubSelectionListener);
            sinhalasubSelectionListener = null;
        }
        if (sinhalasubSelectionTimeout) {
            clearTimeout(sinhalasubSelectionTimeout);
            sinhalasubSelectionTimeout = null;
        }
        
     
        if (sinhalasubDownloadListener) {
            socket.ev.off('messages.upsert', sinhalasubDownloadListener);
            sinhalasubDownloadListener = null;
        }
        if (sinhalasubDownloadTimeout) {
            clearTimeout(sinhalasubDownloadTimeout);
            sinhalasubDownloadTimeout = null;
        }
        
       
        if (sinhalasubMasterTimeout) {
            clearTimeout(sinhalasubMasterTimeout);
            sinhalasubMasterTimeout = null;
        }
    };

    try {
        const searchResponse = await axios.get(`${config.API_MAIN_URL}/sinhalasub/search?query=${encodeURIComponent(movieQuery55)}&api_key=${config.API_KEY}`);
        const searchData = searchResponse.data;

        if (!searchData.status || !searchData.data?.results || searchData.data.results.length === 0) {
            await socket.sendMessage(sender, {
                 image: { url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE},
                caption: formatMessage(
                    '❌ NO RESULTS',
                    '*චිත්‍රපට හමුවෙන්නේ නැත! 😞*',
                    `${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
                )
            }, { quoted: msg });
            break;
        }

        const movies = searchData.data.results.slice(0, 115);
        let listText = `🎀 *𝗦𝗘𝗔𝗥𝗖𝗛 : _${movieQuery55}_*
╭──────●➤
*🔢 ʀᴇᴘʟʏ ʙᴇʟᴏᴡ ɴᴜᴍʙᴇʀ*
╰──────────●➤
╭──────●➤\n`;

        movies.forEach((movie, index) => {
            listText += `*🧩 ${index + 1} ┃❭❭ ${movie.title}*\n`;
        });

        listText += `╰──────────●➤\n> ${sessionConfig.MOVIE_FOOTER || config.MOVIE_FOOTER}`;

        const sentMsg = await socket.sendMessage(sender, {
            image: { url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE},
            caption: listText
        }, { quoted: msg });

        const messageID = sentMsg.key.id;

      
        sinhalasubMasterTimeout = setTimeout(() => {
            clearAllSinhalasubListeners();
            console.log('🧹 Sinhalasub master timeout - All listeners cleared after 3 minutes');
        }, 180000);

       
        const handleSelection = async ({ messages: replyMessages }) => {
            const replyMek = replyMessages[0];
            if (!replyMek?.message) return;

            const messageType = replyMek.message.conversation || replyMek.message.extendedTextMessage?.text;
            const isReplyToSentMsg = replyMek.message.extendedTextMessage?.contextInfo?.stanzaId === messageID;

            if (isReplyToSentMsg && sender === replyMek.key.remoteJid) {
               
                if (sinhalasubSelectionTimeout) {
                    clearTimeout(sinhalasubSelectionTimeout);
                    sinhalasubSelectionTimeout = null;
                }
                
               
                sinhalasubSelectionTimeout = setTimeout(() => {
                    if (sinhalasubSelectionListener) {
                        socket.ev.off('messages.upsert', sinhalasubSelectionListener);
                        sinhalasubSelectionListener = null;
                        console.log('🧹 Sinhalasub selection listener timeout');
                    }
                    sinhalasubSelectionTimeout = null;
                }, 120000);

                const choice = parseInt(messageType) - 1;
                if (isNaN(choice) || choice < 0 || choice >= movies.length) {
                    await socket.sendMessage(sender, {
                         image: { url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE},
                        caption: formatMessage(
                            '❌ INVALID SELECTION',
                            `*වැරදි අංකයක්! 1-${movies.length} අතර තෝරන්න! 😕*`,
                            `${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
                        )
                    }, { quoted: replyMek });
                    return;
                }

                const selectedMovie = movies[choice];
                
                await socket.sendMessage(sender, { 
                    text: '📽️ 𝙁𝙚𝙩𝙘𝙝𝙞𝙣𝙜 𝙙𝙚𝙩𝙖𝙞𝙡𝙨...' 
                }, { quoted: replyMek });

                
                await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 2000) + 2000));

                try {
                    const infoResponse = await axios.get(`${config.API_MAIN_URL}/sinhalasub/info?url=${encodeURIComponent(selectedMovie.url)}&api_key=${config.API_KEY}`);
                    const infoData = infoResponse.data;

                    if (!infoData.status || !infoData.data) {
                        throw new Error('Failed to fetch movie details');
                    }

                    const movieInfo = infoData.data.movie;
                    const downloads = infoData.data.downloads || [];

                    
                    const videoDownloads = downloads.filter(d => d.server === 'pixeldrain');

                    if (videoDownloads.length === 0) {
                        await socket.sendMessage(sender, {
                             image: { url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE},
                            caption: formatMessage(
                                '❌ NO DOWNLOADS',
                                '*Pixeldrain බාගත කිරීම් නොමැත!*',
                                `${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
                            )
                        }, { quoted: replyMek });
                        return;
                    }

                    const castPreview = movieInfo.cast?.slice(0, 5).join(', ') + (movieInfo.cast?.length > 5 ? '...' : '');
                    
                    const detailsCaption = formatMessage(
                        `🍀 *𝗧ɪᴛʟᴇ : ${movieInfo.title}`,
                        `▫️📅 *𝗥ᴇʟᴇᴀꜱᴇ 𝗬ᴇᴀʀ ➟ ${movieInfo.year || 'N/A'}*
▫️🥇 *𝗜𝗺𝗱ʙ 𝗥ᴀᴛɪɴɢ ➟ ${movieInfo.rating || 'N/A'}/10*
▫️📊 *𝗤ᴜᴀʟɪᴛʏ ➟ ${movieInfo.quality || 'N/A'}*
▫️⏳ *𝗗ᴜʀᴀᴛɪᴏɴ ➟ ${movieInfo.runtime || 'N/A'}*
▫️🔠 *𝗟ᴀɴɢᴜᴀɢᴇ ➟ ${movieInfo.language || 'N/A'}*
▫️🎭 *𝗚ᴇɴʀᴇꜱ ➟ ${movieInfo.genres?.join(', ') || 'N/A'}*
▫️🙅 *𝗗ɪʀᴇᴄᴛᴏʀ ➟ ${movieInfo.director?.slice(0,2).join(', ') || 'N/A'}*
▫️👥 *𝗖ᴀꜱᴛ ➟ ${castPreview || 'N/A'}*
▫️👨‍💻 *𝗦ᴜʙᴛɪᴛʟᴇ ➟ ${movieInfo.subtitle?.author || 'Sinhala'} (${movieInfo.subtitle?.site || 'Baiscope'})*
▫️📖 *sᴛᴏʀʏ ➟ ${movieInfo.description?.substring(0, 150) || 'No description'}...*
▫️🔗 *Jᴏɪɴ ➟ ${sessionConfig.MGROUP_LINK || config.MGROUP_LINK}*`,
                        `${sessionConfig.MOVIE_FOOTER || config.MOVIE_FOOTER}`
                    );

                    const infoMsg = await socket.sendMessage(sender, {
                        image: { url: movieInfo.poster || selectedMovie.poster || sessionConfig.BOT_IMAGE || config.BOT_IMAGE },
                        caption: detailsCaption
                    }, { quoted: replyMek });

                    /
                    await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 2000) + 2000));

                    const downloadOptionsText = `*⬇️🎀 𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗 𝗢𝗣𝗧𝗜𝗢𝗡𝗦*
*Reply with number 👇*

${videoDownloads.map((d, i) => 
`*🔰 ${i + 1} ┃ 📥 ${d.quality || 'N/A'} • ${d.size || 'N/A'}*`
).join('\n')}

${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`;

                    const downloadMsg = await socket.sendMessage(sender, {
                        text: downloadOptionsText
                    }, { quoted: infoMsg });

                    const infoMsgID = downloadMsg.key.id;

                   
                    const handleDownload = async ({ messages: downloadMessages }) => {
                        const downloadMek = downloadMessages[0];
                        if (!downloadMek?.message) return;

                        const downloadChoice = downloadMek.message.conversation || downloadMek.message.extendedTextMessage?.text;
                        const isReplyToInfoMsg = downloadMek.message.extendedTextMessage?.contextInfo?.stanzaId === infoMsgID;

                        if (isReplyToInfoMsg && sender === downloadMek.key.remoteJid) {
                         
                            if (sinhalasubDownloadTimeout) {
                                clearTimeout(sinhalasubDownloadTimeout);
                                sinhalasubDownloadTimeout = null;
                            }
                            
                          
                            sinhalasubDownloadTimeout = setTimeout(() => {
                                if (sinhalasubDownloadListener) {
                                    socket.ev.off('messages.upsert', sinhalasubDownloadListener);
                                    sinhalasubDownloadListener = null;
                                    console.log('🧹 Sinhalasub download listener timeout');
                                }
                                sinhalasubDownloadTimeout = null;
                            }, 120000);

                            const choiceNum = parseInt(downloadChoice) - 1;
                            
                            if (isNaN(choiceNum) || choiceNum < 0 || choiceNum >= videoDownloads.length) {
                                await socket.sendMessage(sender, {
                                     image: { url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE},
                                    caption: formatMessage(
                                        '❌ INVALID SELECTION',
                                        `*වැරදි අංකයක්! 1-${videoDownloads.length} අතර තෝරන්න!*`,
                                        `${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
                                    )
                                }, { quoted: downloadMek });
                                return;
                            }

                            const selectedDownload = videoDownloads[choiceNum];
                            
                            await socket.sendMessage(sender, { 
                                text: `⏳ 𝙂𝙚𝙩𝙩𝙞𝙣𝙜 𝙙𝙤𝙬𝙣𝙡𝙤𝙖𝙙 𝙡𝙞𝙣𝙠...` 
                            }, { quoted: downloadMek });

                          
                            await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 2000) + 2000));

                            try {
                               
                                const downloadResponse = await axios.get(`${config.API_MAIN_URL}/sinhalasub/download2?url=${encodeURIComponent(selectedDownload.link_page)}&api_key=${config.API_KEY}`);
                                const downloadData = downloadResponse.data;

                                if (!downloadData.status || !downloadData.data?.download) {
                                    throw new Error('Failed to get download URL');
                                }

                                const finalDownloadUrl = downloadData.data.download;
                                const fileInfo = downloadData.data.file_info || {};
                                
                                
                                let fileName = fileInfo.name || `${movieInfo.title} [${selectedDownload.quality || 'Unknown'}].mp4`;
                                const mimeType = fileInfo.mimeType || 'video/mp4';
                                
                                console.log('Download URL:', finalDownloadUrl);
                                console.log('File Name:', fileName);
                                console.log('Mime Type:', mimeType);
                                
                                await socket.sendMessage(sender, { react: { text: '📥', key: downloadMek.key } });

                             
                                const thumbUrl = config.LOGO;
                                let thumbBuffer;
                                
                                try {
                                    const response = await axios.get(thumbUrl, { 
                                        responseType: 'arraybuffer',
                                        timeout: 15000
                                    });
                                    thumbBuffer = await sharp(Buffer.from(response.data))
                                        .resize(200, 200, { fit: 'cover' })
                                        .jpeg({ quality: 70 })
                                        .toBuffer();
                                } catch (e) {
                                    console.error('Thumbnail error:', e.message);
                                    thumbBuffer = undefined;
                                }

                               
                                let sizeText = 'N/A';
                                if (fileInfo.size) {
                                    const sizeInMB = fileInfo.size / 1024 / 1024;
                                    if (sizeInMB > 1024) {
                                        sizeText = (sizeInMB / 1024).toFixed(2) + ' GB';
                                    } else {
                                        sizeText = sizeInMB.toFixed(2) + ' MB';
                                    }
                                }

                               
                                await socket.sendMessage(sender, {
                                    document: { url: finalDownloadUrl },
                                    mimetype: mimeType,
                                    fileName: fileName,
                                    jpegThumbnail: thumbBuffer,
                                    caption: formatMessage(
                                        `🍀 ${movieInfo.title}`,
                                        `\`❚█${sessionConfig.MOVIE_CAPTION || config.MOVIE_CAPTION}█❚\`

\`❪${selectedDownload.quality || 'Unknown'}❫\``,
                                        `${sessionConfig.MOVIE_FOOTER || config.MOVIE_FOOTER}`
                                    )
                                }, { quoted: downloadMek });

                                await socket.sendMessage(sender, { react: { text: '✅', key: downloadMek.key } });
                                
                               
                                clearAllSinhalasubListeners();

                            } catch (downloadError) {
                                console.error('Download link error:', downloadError);
                                await socket.sendMessage(sender, {
                                     image: { url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE},
                                    caption: formatMessage(
                                        '❌ DOWNLOAD ERROR',
                                        `*Download link එක ලබාගැනීමේ දෝෂයක්.*\nError: ${downloadError.message}`,
                                        `${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
                                    )
                                }, { quoted: downloadMek });
                            }
                        }
                    };

                   
                    sinhalasubDownloadListener = handleDownload;
                    socket.ev.on('messages.upsert', handleDownload);

                   
                    sinhalasubDownloadTimeout = setTimeout(() => {
                        if (sinhalasubDownloadListener) {
                            socket.ev.off('messages.upsert', sinhalasubDownloadListener);
                            sinhalasubDownloadListener = null;
                            console.log('🧹 Sinhalasub download listener timeout - cleaned up');
                        }
                        sinhalasubDownloadTimeout = null;
                    }, 120000);

                } catch (infoError) {
                    console.error('Movie info error:', infoError);
                    await socket.sendMessage(sender, {
                         image: { url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE},
                        caption: formatMessage(
                            '❌ ERROR',
                            `*Movie details ලබාගැනීමේ දෝෂයක්:* ${infoError.message}`,
                            `${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
                        )
                    }, { quoted: replyMek });
                }
            }
        };

       
        sinhalasubSelectionListener = handleSelection;
        socket.ev.on('messages.upsert', handleSelection);

       
        sinhalasubSelectionTimeout = setTimeout(() => {
            if (sinhalasubSelectionListener) {
                socket.ev.off('messages.upsert', sinhalasubSelectionListener);
                sinhalasubSelectionListener = null;
                console.log('🧹 Sinhalasub selection listener timeout - cleaned up');
            }
            sinhalasubSelectionTimeout = null;
        }, 120000);

    } catch (error) {
        console.error('Movie command error:', error);
       
        clearAllSinhalasubListeners();
        await socket.sendMessage(sender, {
             image: { url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE},
            caption: formatMessage(
                '❌ ERROR',
                `*දෝෂයක් ඇතිවුණා:* ${error.message || 'Unknown error'}`,
                `${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
            )
        }, { quoted: msg });
    }
    break;
    }
      case 'sinhalasubtv':
case 'sstv': {
    if (!isOwner && !isCreator) {
        await socket.sendMessage(sender, {
            text: '❌ *Only Owner & Creator Can Use This Command*'
        }, { quoted: msg });
        break;
    }

    const q = args.join(' ').trim();

    const API_BASE = 'https://zara.laksidu.site';

    const API_KEY =
        config.API_KEY ||
        'lakiya_72b96b423d046110b5947b625e05ecf2007e009f5ba61d1c4f9a4547fb983e8b';

    const BOT_IMAGE =
        sessionConfig.BOT_IMAGE ||
        config.BOT_IMAGE;

    const FOOTER =
        `\n\n> ${sessionConfig.MOVIE_FOOTER || config.MOVIE_FOOTER}`;

    if (!q) {
        await socket.sendMessage(sender, {
            image: { url: BOT_IMAGE },
            caption:
`📺 *SINHALASUB TV*

Series name එකක් දෙන්න.

*Example:*
${prefix}sinhalasubtv supernatural${FOOTER}`
        }, { quoted: msg });

        break;
    }

    /*
    ==========================================
    REQUESTER CHECK
    ==========================================
    */

    const requesterCandidates = new Set(
        (
            typeof getMessageSenderCandidates === 'function'
                ? getMessageSenderCandidates(msg)
                : [
                    msg?.key?.participant,
                    msg?.key?.remoteJid
                ]
        )
            .map(x =>
                typeof jidNumber === 'function'
                    ? jidNumber(x)
                    : String(x || '').split('@')[0]
            )
            .filter(Boolean)
    );

    if (senderNumber) {
        requesterCandidates.add(
            String(senderNumber)
        );
    }

    const isRequesterReply = m => {
        if (!m?.key) return false;

        if (
            m.key.remoteJid !== sender
        ) {
            return false;
        }

        if (!isGroup) return true;

        const nums = (
            typeof getMessageSenderCandidates === 'function'
                ? getMessageSenderCandidates(m)
                : [m?.key?.participant]
        )
            .map(x =>
                typeof jidNumber === 'function'
                    ? jidNumber(x)
                    : String(x || '').split('@')[0]
            )
            .filter(Boolean);

        return nums.some(n =>
            requesterCandidates.has(
                String(n)
            )
        );
    };

    /*
    ==========================================
    MESSAGE HELPERS
    ==========================================
    */

    const msgText = m =>
        (
            m?.message?.conversation ||
            m?.message?.extendedTextMessage?.text ||
            ''
        ).trim();

    const quotedId = m =>
        m?.message
            ?.extendedTextMessage
            ?.contextInfo
            ?.stanzaId;

    /*
    ==========================================
    WAIT FOR REPLY
    ==========================================
    */

    const waitReply = (
        id,
        validator,
        timeout = 120000
    ) =>
        new Promise(resolve => {
            let finished = false;
            let timer = null;

            const finish = value => {
                if (finished) return;

                finished = true;

                if (timer) {
                    clearTimeout(timer);
                }

                socket.ev.off(
                    'messages.upsert',
                    listener
                );

                resolve(value);
            };

            const listener = ({
                messages = []
            }) => {
                for (const m of messages) {
                    if (!m?.message) continue;

                    if (
                        !isRequesterReply(m)
                    ) {
                        continue;
                    }

                    if (
                        quotedId(m) !== id
                    ) {
                        continue;
                    }

                    const text =
                        msgText(m);

                    const value =
                        validator(
                            text,
                            m
                        );

                    if (
                        value !== undefined &&
                        value !== null &&
                        value !== false
                    ) {
                        return finish({
                            value,
                            m
                        });
                    }
                }
            };

            timer = setTimeout(
                () => finish(null),
                timeout
            );

            socket.ev.on(
                'messages.upsert',
                listener
            );
        });

    /*
    ==========================================
    HELPERS
    ==========================================
    */

    const arr = x =>
        Array.isArray(x)
            ? x
            : [];

    const firstUrl = (
        x,
        depth = 0
    ) => {
        if (
            depth > 7 ||
            x == null
        ) {
            return null;
        }

        if (
            typeof x === 'string' &&
            /^https?:\/\//i.test(x)
        ) {
            return x;
        }

        if (Array.isArray(x)) {
            for (const v of x) {
                const u =
                    firstUrl(
                        v,
                        depth + 1
                    );

                if (u) return u;
            }

        } else if (
            typeof x === 'object'
        ) {
            for (
                const k of [
                    'direct_download_url',
                    'download_url',
                    'downloadUrl',
                    'url',
                    'link',
                    'link_page',
                    'download',
                    'file'
                ]
            ) {
                const u =
                    firstUrl(
                        x[k],
                        depth + 1
                    );

                if (u) return u;
            }

            for (
                const v of Object.values(x)
            ) {
                const u =
                    firstUrl(
                        v,
                        depth + 1
                    );

                if (u) return u;
            }
        }

        return null;
    };

    /*
    ==========================================
    COLLECT DOWNLOAD OBJECTS
    ==========================================
    */

    const collectObjects = (
        x,
        out = [],
        depth = 0
    ) => {
        if (
            depth > 7 ||
            x == null
        ) {
            return out;
        }

        if (Array.isArray(x)) {
            x.forEach(v =>
                collectObjects(
                    v,
                    out,
                    depth + 1
                )
            );

        } else if (
            typeof x === 'object'
        ) {
            const u =
                x.url ||
                x.link ||
                x.link_page ||
                x.download_url ||
                x.downloadUrl;

            if (
                u &&
                typeof u === 'string' &&
                /^https?:\/\//i.test(u)
            ) {
                out.push(x);
            }

            Object.values(x)
                .forEach(v =>
                    collectObjects(
                        v,
                        out,
                        depth + 1
                    )
                );
        }

        return out;
    };

    /*
    ==========================================
    QUALITY HELPERS
    ==========================================
    */

    const optionLabel = o =>
        [
            o?.server,
            o?.name,
            o?.label,
            o?.quality,
            o?.meta,
            o?.type,
            o?.size
        ]
            .filter(Boolean)
            .join(' - ');

    const qualityKey = o => {
        const t =
            optionLabel(o)
                .toLowerCase();

        if (t.includes('2160')) {
            return '2160p';
        }

        if (t.includes('1080')) {
            return '1080p';
        }

        if (t.includes('720')) {
            return '720p';
        }

        if (t.includes('480')) {
            return '480p';
        }

        if (t.includes('360')) {
            return '360p';
        }

        return String(
            o?.quality ||
            o?.meta ||
            o?.type ||
            'Auto'
        );
    };

    /*
    ==========================================
    SERVER PRIORITY
    ==========================================
    */

    const serverRank = o => {
        const t =
            optionLabel(o)
                .toLowerCase();

        if (
            /server[- _]?0?1|dlserver[- _]?0?1/
                .test(t)
        ) {
            return 1;
        }

        if (
            /server[- _]?0?2|dlserver[- _]?0?2/
                .test(t)
        ) {
            return 2;
        }

        return 9;
    };

    /*
    ==========================================
    GET EPISODE DOWNLOAD OPTIONS
    ==========================================
    */

    const fetchEpisodeOptions =
        async episodeUrl => {

            const r =
                await axios.get(
                    `${API_BASE}/sinhalasub/download`,
                    {
                        params: {
                            url: episodeUrl,
                            api_key: API_KEY
                        },

                        timeout: 60000
                    }
                );

            let options =
                collectObjects(
                    r.data
                );

            const seen =
                new Set();

            options =
                options.filter(o => {
                    const u =
                        o?.url ||
                        o?.link ||
                        o?.link_page ||
                        o?.download_url ||
                        o?.downloadUrl;

                    if (!u) {
                        return false;
                    }

                    if (
                        seen.has(u)
                    ) {
                        return false;
                    }

                    seen.add(u);

                    return true;
                });

            return options;
        };

    /*
    ==========================================
    RESOLVE FINAL DOWNLOAD URL
    ==========================================
    */

    const resolveFinal =
        async option => {

            const source =
                option?.link_page ||
                option?.url ||
                option?.link ||
                option?.download_url ||
                option?.downloadUrl;

            if (!source) {
                return null;
            }

            for (
                const ep of [
                    '/sinhalasub/download2',
                    '/sinhalasub/download'
                ]
            ) {
                try {
                    const r =
                        await axios.get(
                            API_BASE + ep,
                            {
                                params: {
                                    url: source,
                                    api_key:
                                        API_KEY
                                },

                                timeout:
                                    60000
                            }
                        );

                    let u =
                        firstUrl(
                            r.data
                        );

                    if (!u) {
                        continue;
                    }

                    /*
                    PIXELDRAIN
                    */

                    if (
                        /pixeldrain/i.test(u)
                    ) {
                        try {
                            const pr =
                                await axios.get(
                                    `${API_BASE}/api/pixeldrain/get-download-link`,
                                    {
                                        params: {
                                            url: u,
                                            api_key:
                                                API_KEY
                                        },

                                        timeout:
                                            60000
                                    }
                                );

                            u =
                                firstUrl(
                                    pr.data
                                ) || u;

                        } catch (e) {
                            console.log(
                                'SSTV Pixeldrain fallback:',
                                e?.response?.data ||
                                e?.message
                            );
                        }
                    }

                    return u;

                } catch (e) {
                    console.log(
                        'SSTV resolve fallback:',
                        e?.response?.data ||
                        e?.message
                    );
                }
            }

            return null;
        };

    /*
    ==========================================
    START
    ==========================================
    */

    try {
        await socket.sendMessage(
            sender,
            {
                react: {
                    text: '🔎',
                    key: msg.key
                }
            }
        );

        /*
        ======================================
        SEARCH
        ======================================
        */

        const sr =
            await axios.get(
                `${API_BASE}/sinhalasub/search`,
                {
                    params: {
                        query: q,
                        api_key:
                            API_KEY
                    },

                    timeout:
                        60000
                }
            );

        let results =
            sr.data?.data?.results ||
            sr.data?.results ||
            sr.data?.data ||
            [];

        if (
            !Array.isArray(results)
        ) {
            results = [];
        }

        results =
            results
                .filter(x =>
                    x?.url ||
                    x?.link
                )
                .slice(0, 25);

        if (!results.length) {
            throw new Error(
                'No TV Series Found'
            );
        }

        /*
        ======================================
        SEARCH LIST
        ======================================
        */

        let searchText =
`🎀 *𝗦𝗘𝗔𝗥𝗖𝗛 : _${q}_*

*🔢 ʀᴇᴘʟʏ ʙᴇʟᴏᴡ ɴᴜᴍʙᴇʀ*

`;

        results.forEach(
            (x, i) => {

                searchText +=
`*🧩 ${i + 1} ┃❭❭ ${x.title || x.name || 'TV Series'}*
`;
            }
        );

        searchText += FOOTER;

        /*
        SEARCH RESULT එකට BOT IMAGE
        */

        const searchMsg =
            await socket.sendMessage(
                sender,
                {
                    image: {
                        url: BOT_IMAGE
                    },

                    caption:
                        searchText
                },
                {
                    quoted: msg
                }
            ).catch(() =>
                socket.sendMessage(
                    sender,
                    {
                        text:
                            searchText
                    },
                    {
                        quoted: msg
                    }
                )
            );

        /*
        ======================================
        SELECT SERIES
        ======================================
        */

        const pick =
            await waitReply(
                searchMsg.key.id,

                t => {
                    if (
                        !/^\d+$/.test(t)
                    ) {
                        return null;
                    }

                    const n =
                        Number(t);

                    return (
                        n >= 1 &&
                        n <= results.length
                    )
                        ? n
                        : null;
                }
            );

        if (!pick) {
            break;
        }

        const item =
            results[
                pick.value - 1
            ];

        await socket.sendMessage(
            sender,
            {
                text:
                    '🎞️ *Fetching TV show details...*'
            },
            {
                quoted:
                    pick.m
            }
        );

        /*
        ======================================
        TV SHOW DETAILS
        ======================================
        */

        const tr =
            await axios.get(
                `${API_BASE}/sinhalasub/tvshow`,
                {
                    params: {
                        url:
                            item.url ||
                            item.link,

                        api_key:
                            API_KEY
                    },

                    timeout:
                        90000
                }
            );

        const root =
            tr.data?.data ||
            tr.data?.result ||
            tr.data ||
            {};

        const show =
            root.tvshow ||
            root.series ||
            root;

        const title =
            show.title ||
            item.title ||
            'SinhalaSub TV';

        const poster =
            show.poster ||
            show.image ||
            item.poster ||
            item.image ||
            BOT_IMAGE;

        /*
        ======================================
        SEASONS
        ======================================
        */

        let seasons =
            arr(
                show.seasons ||
                root.seasons
            );

        /*
        API එක seasons නොදී episodes direct
        දුන්නොත් Season 1 හදනවා.
        */

        if (!seasons.length) {
            const eps0 =
                arr(
                    show.episodes ||
                    root.episodes ||
                    root.items
                );

            if (eps0.length) {
                seasons = [{
                    season: 1,
                    episodes: eps0
                }];
            }
        }

        if (!seasons.length) {
            throw new Error(
                'Episodes not found'
            );
        }

        /*
        ======================================
        SEASON LIST
        ======================================
        */

        let seasonText =
`🍀 *TITLE : ${title}*

📀 *SELECT SEASON*

`;

        seasons.forEach(
            (s, i) => {

                const seasonNo =
                    s.season ||
                    s.number ||
                    i + 1;

                const count =
                    arr(
                        s.episodes ||
                        s.items
                    ).length;

                seasonText +=
`*${i + 1} 》 Season ${seasonNo}* — ${count} Episodes
`;
            }
        );

        seasonText += FOOTER;

        const seasonMsg =
            await socket.sendMessage(
                sender,
                {
                    image: {
                        url: poster
                    },

                    caption:
                        seasonText
                },
                {                    quoted: pick.m
                }
            ).catch(() =>
                socket.sendMessage(
                    sender,
                    {
                        text: seasonText
                    },
                    {
                        quoted: pick.m
                    }
                )
            );

        // =========================
        // SELECT SEASON
        // =========================

        const seasonPick =
            await waitReply(
                seasonMsg.key.id,
                t => {
                    if (!/^\d+$/.test(t)) {
                        return null;
                    }

                    const n = Number(t);

                    return (
                        n >= 1 &&
                        n <= seasons.length
                    ) ? n : null;
                }
            );

        if (!seasonPick) {
            break;
        }

        const season =
            seasons[seasonPick.value - 1];

        const episodes =
            arr(
                season.episodes ||
                season.items
            );

        if (!episodes.length) {
            throw new Error(
                'Episodes not found'
            );
        }

        const seasonNo =
            season.season ||
            season.number ||
            seasonPick.value;

        // =========================
        // EPISODE LIST
        // =========================

        let epText =
`📺 *${title}*
📀 *Season ${seasonNo}*
📊 *${episodes.length} Episodes*

`;

        episodes.forEach((e, i) => {
            const epNo =
                e.episode ||
                e.number ||
                i + 1;

            const epTitle =
                e.title ||
                e.name ||
                `Episode ${epNo}`;

            epText +=
`*${i + 1} 》 ${epTitle}*
`;
        });

        epText +=
`
*0 》 📥 Download All Episodes*

📥 *Episode number එකක්, range එකක් හෝ 0 reply කරන්න.*

*Examples:*
\`0\` - Download All
\`1\` - Episode 01
\`1-10\` - Episodes 01-10
${FOOTER}`;

        const epMsg =
            await socket.sendMessage(
                sender,
                {
                    text: epText
                },
                {
                    quoted: seasonPick.m
                }
            );

        // =========================
        // SELECT EPISODE / RANGE / ALL
        // =========================

        const rangePick =
            await waitReply(
                epMsg.key.id,
                t => {
                    t = t.trim();

                    // 0 = ALL EPISODES
                    if (t === '0') {
                        return {
                            start: 1,
                            end: episodes.length,
                            all: true
                        };
                    }

                    // Single episode / range
                    const m = t.match(
                        /^(\d+)(?:\s*-\s*(\d+))?$/
                    );

                    if (!m) {
                        return null;
                    }

                    let a = Number(m[1]);
                    let b = Number(
                        m[2] || m[1]
                    );

                    if (a > b) {
                        [a, b] = [b, a];
                    }

                    if (
                        a < 1 ||
                        b > episodes.length
                    ) {
                        return null;
                    }

                    return {
                        start: a,
                        end: b,
                        all: false
                    };
                },
                180000
            );

        if (!rangePick) {
            break;
        }

        const selectedEpisodes =
            episodes.slice(
                rangePick.value.start - 1,
                rangePick.value.end
            );

        const firstEp =
            selectedEpisodes[0];

        const firstEpUrl =
            firstEp?.url ||
            firstEp?.link ||
            firstEp?.download_url ||
            firstEp?.downloadUrl;

        if (!firstEpUrl) {
            throw new Error(
                'Episode URL not found'
            );
        }

        // =========================
        // GET QUALITY OPTIONS
        // =========================

        await socket.sendMessage(
            sender,
            {
                text: '⏳ *Fetching quality options...*'
            },
            {
                quoted: rangePick.m
            }
        );

        const firstOptions =
            await fetchEpisodeOptions(
                firstEpUrl
            );

        if (!firstOptions.length) {
            throw new Error(
                'Download options not found'
            );
        }

        const qualityMap =
            new Map();

        for (const o of firstOptions) {
            const k = qualityKey(o);

            if (!qualityMap.has(k)) {
                qualityMap.set(k, o);
            }
        }

        const qualities =
            [...qualityMap.keys()];

        // =========================
        // QUALITY LIST
        // =========================

        let qualityText =
`⬇️ *SELECT QUALITY*

📺 ${
    rangePick.value.all
        ? `All ${selectedEpisodes.length} Episodes`
        : rangePick.value.start === rangePick.value.end
            ? `Episode ${rangePick.value.start}`
            : `Episodes ${rangePick.value.start}-${rangePick.value.end}`
}

`;

        qualities.forEach((x, i) => {
            qualityText +=
`*${i + 1} 》 ${x}*
`;
        });

        qualityText +=
`
> DLServer-01 auto first • DLServer-02 fallback
${FOOTER}`;

        const qualityMsg =
            await socket.sendMessage(
                sender,
                {
                    text: qualityText
                },
                {
                    quoted: rangePick.m
                }
            );

        // =========================
        // SELECT QUALITY
        // =========================

        const qualityPick =
            await waitReply(
                qualityMsg.key.id,
                t => {
                    if (!/^\d+$/.test(t)) {
                        return null;
                    }

                    const n = Number(t);

                    return (
                        n >= 1 &&
                        n <= qualities.length
                    ) ? n : null;
                },
                180000
            );

        if (!qualityPick) {
            break;
        }

        const wantedQuality =
            qualities[
                qualityPick.value - 1
            ];

        await socket.sendMessage(
            sender,
            {
                text:
`📥 *Downloading ${
    rangePick.value.all
        ? `All ${selectedEpisodes.length} Episodes`
        : rangePick.value.start === rangePick.value.end
            ? `Episode ${rangePick.value.start}`
            : `Episodes ${rangePick.value.start}-${rangePick.value.end}`
}*

✨ Quality: *${wantedQuality}*

⏳ Please wait...`
            },
            {
                quoted: qualityPick.m
            }
        );

        await socket.sendMessage(
            sender,
            {
                react: {
                    text: '📥',
                    key: qualityPick.m.key
                }
            }
        );

        let ok = 0;
        let fail = 0;

        // =========================
        // DOWNLOAD EPISODES
        // =========================

        for (
            let i = 0;
            i < selectedEpisodes.length;
            i++
        ) {
            const e =
                selectedEpisodes[i];

            const actualIndex =
                rangePick.value.start + i;

            const displayNo =
                e.episode ||
                e.number ||
                actualIndex;

            try {
                const epUrl =
                    e.url ||
                    e.link ||
                    e.download_url ||
                    e.downloadUrl;

                if (!epUrl) {
                    throw new Error(
                        'Episode URL not found'
                    );
                }

                const options =
                    await fetchEpisodeOptions(
                        epUrl
                    );

                let matches =
                    options.filter(
                        o =>
                            qualityKey(o)
                                .toLowerCase() ===
                            wantedQuality
                                .toLowerCase()
                    );

                if (!matches.length) {
                    matches =
                        options.filter(
                            o =>
                                optionLabel(o)
                                    .toLowerCase()
                                    .includes(
                                        wantedQuality
                                            .toLowerCase()
                                            .replace('p', '')
                                    )
                        );
                }

                if (!matches.length) {
                    throw new Error(
                        `${wantedQuality} not found`
                    );
                }

                // Server 01 first
                matches.sort(
                    (a, b) =>
                        serverRank(a) -
                        serverRank(b)
                );

                let finalUrl = null;

                for (const opt of matches) {
                    finalUrl =
                        await resolveFinal(
                            opt
                        );

                    if (finalUrl) {
                        break;
                    }
                }

                if (!finalUrl) {
                    throw new Error(
                        'Final download link not found'
                    );
                }

                const safeTitle =
                    String(title)
                        .replace(
                            /[\\/:*?"<>|]/g,
                            ''
                        )
                        .trim()
                        .slice(0, 90) ||
                    'SinhalaSub TV';

                const epName =
                    String(
                        e.title ||
                        e.name ||
                        `Episode ${displayNo}`
                    )
                        .replace(
                            /[\\/:*?"<>|]/g,
                            ''
                        )
                        .trim()
                        .slice(0, 80);

                const seasonLabel =
                    String(seasonNo)
                        .padStart(2, '0');

                const episodeLabel =
                    String(displayNo)
                        .padStart(2, '0');

                // =========================
                // SEND EPISODE
                // =========================

                await socket.sendMessage(
                    sender,
                    {
                        document: {
                            url: finalUrl
                        },
                        mimetype: 'video/mp4',
                        fileName:
`${safeTitle} S${seasonLabel}E${episodeLabel} - ${epName}.mp4`,

                        caption:
`🍀 *${title}*

📺 *S${seasonLabel}E${episodeLabel} - ${epName}*
✨ *Quality -* \`${wantedQuality}\`

${sessionConfig.MOVIE_CAPTION || config.MOVIE_CAPTION}
${FOOTER}`
                    },
                    {
                        quoted: qualityPick.m
                    }
                );

                ok++;

            } catch (err) {
                fail++;

                console.error(
                    `SINHALASUBTV EP ${displayNo}:`,
                    err?.response?.data ||
                    err?.message ||
                    err
                );
            }

            // Delay between episodes
            if (
                i <
                selectedEpisodes.length - 1
            ) {
                await new Promise(
                    resolve =>
                        setTimeout(
                            resolve,
                            2500
                        )
                );
            }
        }

        // =========================
        // COMPLETED
        // =========================

        await socket.sendMessage(
            sender,
            {
                react: {
                    text: '✅',
                    key: qualityPick.m.key
                }
            }
        );

        await socket.sendMessage(
            sender,
            {
                text:
`✅ *DOWNLOAD COMPLETED*

📺 *${title}*
📀 Season: ${seasonNo}
🎬 ${
    rangePick.value.all
        ? `All Episodes (${selectedEpisodes.length})`
        : rangePick.value.start === rangePick.value.end
            ? `Episode ${rangePick.value.start}`
            : `Episodes ${rangePick.value.start}-${rangePick.value.end}`
}
✨ Quality: ${wantedQuality}

✅ Success: ${ok}
❌ Failed: ${fail}
${FOOTER}`
            },
            {
                quoted: qualityPick.m
            }
        );

    } catch (e) {
        console.error(
            'SINHALASUBTV ERROR:',
            e?.response?.data ||
            e?.message ||
            e
        );

        await socket.sendMessage(
            sender,
            {
                react: {
                    text: '❌',
                    key: msg.key
                }
            }
        );

        await socket.sendMessage(
            sender,
            {
                image: {
                    url:
                        sessionConfig.BOT_IMAGE ||
                        config.BOT_IMAGE
                },
                caption:
`❌ *SINHALASUBTV ERROR*

${
    e?.response?.data?.message ||
    e?.response?.data?.error ||
    e?.message ||
    'Unknown Error'
}

${FOOTER}`
            },
            {
                quoted: msg
            }
        );
    }

    break;
            }
                            

    case 'menu':{
    try {
        const pushName = msg.pushName || 'User';
        const date = new Date();
        const slstDate = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Colombo" }));
        const formattedDate = `${slstDate.getFullYear()}/${slstDate.getMonth() + 1}/${slstDate.getDate()}`;
        const formattedTime = slstDate.toLocaleTimeString();
        
        const hour = slstDate.getHours();
      
        const greetings = hour < 12 ? `Good Morning ✨` :
                          hour < 15 ? `Good Afternoon 🚀` :
                          hour < 18 ? `Good Evening! 🌟` : `Good Night 🌙`;
        const prefix = sessionConfig.PREFIX || config.PREFIX || '.';

        // Main Menu (Number reply removed)
        const mainMenuMsg = `*🌟 𝙃𝙚𝙮 ❟ ${pushName} ✨𝙃𝙤𝙬 𝙖𝙧𝙚 𝙮𝙤𝙪.*      
*╭─「 Cᴏᴍᴍᴀɴᴅꜱ Pᴀɴᴇʟ 」*
*┃ \`🐸 ${greetings}\`*
*┃ \`⏳ 𝚃𝚒𝚖𝚎\` : ${formattedTime}*
*┃ \`🦊 𝙳𝚊𝚝𝚎\` : ${formattedDate}*
*┃ \`👾 𝙱𝚘𝚝 𝙽𝚊𝚖𝚎:\` Zᴇꜱʀ-ᴍᴅ*
*┃ \`🐞 𝙿𝚕𝚊𝚝𝚏𝚘𝚛𝚖:\` Linux*
*╰────────●●►* 

╭─「 𝐌𝐎𝐕𝐈𝐄𝐒 & 𝐒𝐄𝐑𝐈𝐄𝐒 」
│ 🎥 ".cinesubz"
│ 📺 ".cinetv"
│ 🎞️ ".sinhalasub"
│ 📺 ".sinhalasubtv"
│ 🧸 ".scartoon"
│ 🍿 ".cartoontv"
│ 🍯 ".tinkiri"
*╰────────●●►*

╭─「 𝐌𝐄𝐃𝐈𝐀 𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃 」
│ 🎵 ".song"
│ 🎶 ".tiktok"
│ 🎵 ".Instagram"
│ 🎵 ".facebook"
*╰────────●●►*

╭─「 𝐌𝐄𝐃𝐈𝐀 𝐓𝐎𝐎𝐋𝐒 」
│ ⏩ ".forward"
│ 📹 ".vnote"
│ ✍️ ".rename"
│ 🤫 ".vv"
│ 💾 ".save"
│ 👤 ".getpp"
│ 🎨 ".sticker"
*╰────────●●►*

╭─「 𝐁𝐎𝐓 𝐒𝐘𝐒𝐓𝐄𝐌 」
│ 👑 ".owner"
│ 🤟 ".alive"
│ ⚙️ ".setting"
│ 🏓 ".ping"
│ 🆔 ".jid"
*╰────────●●►* 

╭─「 𝐆𝐑𝐎𝐔𝐏 𝐓𝐎𝐎𝐋𝐒 」
│ 🧩 ".ginfo"
*╰────────●●►*
> ${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`;

        await socket.sendMessage(sender, {
            image: { url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE},
            caption: mainMenuMsg
        }, { quoted: msg });
       

    } catch (e) {
        console.error(e);
    }
}
break; }

            case 'logout': {
    try {
        // 🥷 CREATOR ONLY
        if (!isCreator) {
            return await socket.sendMessage(sender, {
                text: '❌ *Only Bot Creator Can Use This Command*'
            }, { quoted: msg });
        }

        if (!args.length) {
            return await socket.sendMessage(sender, {
                text:
`❌ *LOGOUT USER*

📌 Usage:
.logout 947XXXXXXXX

> ${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
            }, { quoted: msg });
        }

        const targetNumber = String(args[0]).replace(/[^0-9]/g, '');

        if (targetNumber.length < 8) {
            return await socket.sendMessage(sender, {
                text: '❌ *Invalid phone number.*'
            }, { quoted: msg });
        }

        // Check whether session exists
        const sessionExists = await Session.findOne({ number: targetNumber }).lean();
        const active = activeSockets.get(targetNumber);

        if (!sessionExists && !active) {
            return await socket.sendMessage(sender, {
                text:
`❌ *USER NOT FOUND*

📱 Number: ${targetNumber}

> ${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
            }, { quoted: msg });
        }

        // Send message BEFORE logout
        await socket.sendMessage(sender, {
            react: {
                text: '✅',
                key: msg.key
            }
        });

        await socket.sendMessage(sender, {
            text:
`✅ *BOT USER REMOVED*

📱 Number: ${targetNumber}
🔌 Status: Logging Out
🗑️ Database: Removing
📁 Session: Removing

> ${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
        }, { quoted: msg });

        // Allow message to be sent first
        await delay(1000);

        // Logout active WhatsApp socket
        if (active?.socket) {
            try {
                await active.socket.logout();
            } catch (e) {
                console.log(`Logout error for ${targetNumber}:`, e?.message || e);
            }

            try {
                active.socket.end();
            } catch {}

            try {
                active.socket.ws?.close();
            } catch {}
        }

        // Remove from active memory
        activeSockets.delete(targetNumber);
        socketCreationTime.delete(targetNumber);

        // Remove MongoDB + local session + numbers.json
        await deleteSession(targetNumber);

        console.log(`✅ Logout completed for ${targetNumber}`);

    } catch (error) {
        console.error('LOGOUT COMMAND ERROR:', error);

        try {
            await socket.sendMessage(sender, {
                text:
`❌ *LOGOUT ERROR*

${error?.message || error}

> ${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
            }, { quoted: msg });
        } catch {}
    }

    break;
            }

case 'alive': {
    try {
        await socket.sendMessage(sender, {
            react: {
                text: '🤟',
                key: msg.key
            }
        });

        const userName = msg.pushName || 'User';
        const now = new Date();

        const time = now.toLocaleTimeString('en-US', {
            timeZone: 'Asia/Colombo',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });

        const date = now.toLocaleDateString('en-GB', {
            timeZone: 'Asia/Colombo',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });

        const hour = parseInt(
            new Intl.DateTimeFormat('en-US', {
                timeZone: 'Asia/Colombo',
                hour: '2-digit',
                hourCycle: 'h23'
            }).format(now)
        );

        let greeting = 'සුභ රාත්‍රියක් 🥱';

        if (hour >= 5 && hour < 12) {
            greeting = 'සුභ උදෑසනක් 🌅';
        } else if (hour >= 12 && hour < 16) {
            greeting = 'සුභ දහවලක් 🌞';
        } else if (hour >= 16 && hour < 19) {
            greeting = 'සුභ සන්ධ්‍යාවක් 🌆';
        }

        const aliveText = `
*Hey ${userName}* 👾
*┏━━━━━━━━━━━*
*┃ \`${greeting} ${userName}.\`*
*┃ \`🧩 𝚃𝚒𝚖𝚎\` : ${time}*
*┃ \`🦊 𝙳𝚊𝚝𝚎\` : ${date}*
*┗━━━━━━━━━━━*
👋 *ʜᴇʏ, ${userName}.*
*ɪ'ᴍ 🦅 Zesr ✘ 〽️ᴏᴠɪᴇ Bᴏᴛ*
🍿 Movies • Series • Entertainment
⚡ Fast • Simple • Smart
✨ *Created & Designed by* :
*Senesh Chamindu* 🗣️🥷

> *Zᴇꜱʀ ✘ 〽️ᴏᴠɪᴇ Bᴏᴛ ᴠ1.1*
`;

        await socket.sendMessage(sender, {
            image: {
    url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE
},
            caption: aliveText
        }, { quoted: msg });

    } catch (error) {
        console.error('Alive command error:', error);

        await socket.sendMessage(sender, {
            text: `❌ *Alive Error*\n${error.message}`
        }, { quoted: msg });
    }
}
break;

               
case 'ginfo':
case 'groupinfo': {
    try {
        // ==============================
        // GROUP ONLY
        // ==============================
        if (!sender.endsWith('@g.us')) {
            return await socket.sendMessage(sender, {
                text:
`❌ *GROUP ONLY COMMAND*

මෙම command එක group එකක් ඇතුළේ විතරයි භාවිතා කරන්න පුළුවන්.

> Zᴇꜱʀ ✘ 〽️ᴏᴠɪᴇ Bᴏᴛ`
            }, { quoted: msg });
        }

        // 🔎 React
        await socket.sendMessage(sender, {
            react: {
                text: '🔎',
                key: msg.key
            }
        });

        // ==============================
        // GET GROUP METADATA
        // ==============================
        const metadata = await socket.groupMetadata(sender);

        const groupName = metadata?.subject || 'Unknown Group';

        const description =
            metadata?.desc?.trim() ||
            'No group description';

        const participants = metadata?.participants || [];

        // ==============================
        // MEMBERS
        // ==============================
        const memberCount = participants.length;

        // ==============================
        // ADMINS
        // ==============================
        const admins = participants.filter(
            p => p.admin === 'admin' || p.admin === 'superadmin'
        );

        const adminCount = admins.length;

        // Admin JIDs for real WhatsApp mentions
        const adminJids = admins
            .map(p => p.id)
            .filter(Boolean);

        // Build visible admin list
        let adminList = 'No admins found';

        if (adminJids.length > 0) {
            adminList = adminJids
                .map((jid, index) => {
                    const id = jid
                        .split('@')[0]
                        .split(':')[0];

                    return `┃ ${index + 1}. @${id}`;
                })
                .join('\n');
        }

        // ==============================
        // CREATED DATE
        // ==============================
        let created = 'Not Available';

        if (metadata?.creation) {
            created = new Date(
                Number(metadata.creation) * 1000
            ).toLocaleDateString('en-GB', {
                timeZone: 'Asia/Colombo',
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });
        }

        // ==============================
        // GROUP DP
        // ==============================
        let groupDP = null;

        try {
            groupDP = await socket.profilePictureUrl(
                sender,
                'image'
            );
        } catch {
            groupDP = null;
        }

        // Prevent massive descriptions
        const cleanDescription =
            description.length > 500
                ? description.substring(0, 500) + '...'
                : description;

        // ==============================
        // MESSAGE FRAME
        // ==============================
        const caption =
`╭━━〔 👥 *GROUP INFO* 〕━━╮
┃
┃ 🏷️ *Group Name*
┃ ${groupName}
┃
┃ 👥 *Members*
┃ ${memberCount}
┃
┃ 👑 *Admins*
┃${adminList}
┃
┃ 📅 *Created*
┃ ${created}
┃
┃ 📝 *Description*
┃ ${cleanDescription}
┃
╰━━━━━━━━━━━━━━━━━━━━━━━━╯

> Zᴇꜱʀ ✘ 〽️ᴏᴠɪᴇ Bᴏᴛ`;

        // ==============================
        // SEND DP + INFO
        // ==============================
        if (groupDP) {
            await socket.sendMessage(sender, {
                image: {
                    url: groupDP
                },
                caption,
                mentions: adminJids
            }, { quoted: msg });

        } else {
            await socket.sendMessage(sender, {
                text: caption,
                mentions: adminJids
            }, { quoted: msg });
        }

        // ✅ React
        await socket.sendMessage(sender, {
            react: {
                text: '✅',
                key: msg.key
            }
        });

    } catch (error) {
        console.error('GINFO ERROR:', error);

        await socket.sendMessage(sender, {
            text:
`❌ *GROUP INFO ERROR*

Group information ලබාගන්න බැරි වුණා.

> Zᴇꜱʀ ✘ 〽️ᴏᴠɪᴇ Bᴏᴛ`
        }, { quoted: msg });
    }

    break;
                }


            
                   
                   
case 'getpp':
case 'dp': {
    try {
        // 🔎 React
        await socket.sendMessage(sender, {
            react: { text: '🔎', key: msg.key }
        });

        const contextInfo =
            msg.message?.extendedTextMessage?.contextInfo ||
            msg.message?.imageMessage?.contextInfo ||
            msg.message?.videoMessage?.contextInfo ||
            msg.message?.documentMessage?.contextInfo ||
            {};

        let targetJid = null;

        // =====================================
        // 1. REPLIED USER
        // =====================================
        if (contextInfo?.quotedMessage && contextInfo?.participant) {
            targetJid = contextInfo.participant;
        }

        // =====================================
        // 2. MENTIONED USER
        // =====================================
        if (
            !targetJid &&
            Array.isArray(contextInfo?.mentionedJid) &&
            contextInfo.mentionedJid.length > 0
        ) {
            targetJid = contextInfo.mentionedJid[0];
        }

        // =====================================
        // 3. NUMBER
        // .getdp 947XXXXXXXX
        // =====================================
        if (!targetJid) {
            let input = '';

            if (typeof text === 'string') {
                input = text;
            } else if (
                typeof args !== 'undefined' &&
                Array.isArray(args)
            ) {
                input = args.join(' ');
            }

            const number = input.replace(/\D/g, '');

            if (number) {
                targetJid = `${number}@s.whatsapp.net`;
            }
        }

        // =====================================
        // TARGET නැත්නම්
        // =====================================
        if (!targetJid) {
            return await socket.sendMessage(sender, {
                text:
`╭━━━〔 ❌ *GET DP* 〕━━━╮
┃
┃ 👤 *Mention User*
┃ \`.getdp @user\`
┃
┃ 📱 *Enter Number*
┃ \`.getdp 947XXXXXXXX\`
┃
┃ 💬 *Reply Message*
┃ Userගේ message එකකට reply
┃ කරලා \`.getdp\` යවන්න.
┃
╰━━━━━━━━━━━━━━━━━━━━╯

> Zᴇꜱʀ ✘ 〽️ᴏᴠɪᴇ Bᴏᴛ`
            }, { quoted: msg });
        }

        // Remove device ID if present
        targetJid = targetJid.replace(/:\d+@/, '@');

        // =====================================
        // GET PROFILE PICTURE
        // =====================================
        let profilePic = null;

        try {
            profilePic = await socket.profilePictureUrl(
                targetJid,
                'image'
            );
        } catch {
            profilePic = null;
        }

        // =====================================
        // GET BIO / ABOUT
        // =====================================
        let bio = '🔒 Hidden / Not Available';

        try {
            const statusData = await socket.fetchStatus(targetJid);

            if (
                statusData?.status &&
                statusData.status.trim()
            ) {
                bio = statusData.status.trim();
            }
        } catch {
            // Bio hidden / unavailable
        }

        // =====================================
        // PROFILE FRAME
        // =====================================
        const caption =
`╭━━〔 👤 *USER PROFILE* 〕━━━╮
┃
┃ 🖼️ *Profile Picture*
┃ ${profilePic ? '✅ Available' : '🔒 Hidden / Not Available'}
┃
┃ 💬 *About / Bio*
┃ ${bio}
┃
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯

> Zᴇꜱʀ ✘ 〽️ᴏᴠɪᴇ Bᴏᴛ`;

        // =====================================
        // SEND DP + BIO
        // =====================================
        if (profilePic) {
            await socket.sendMessage(sender, {
                image: { url: profilePic },
                caption: caption
            }, { quoted: msg });
        } else {
            await socket.sendMessage(sender, {
                text: caption
            }, { quoted: msg });
        }

        // ✅ Success React
        await socket.sendMessage(sender, {
            react: { text: '✅', key: msg.key }
        });

    } catch (error) {
        console.error('GETDP ERROR:', error);

        await socket.sendMessage(sender, {
            text:
`╭━━━〔 ❌ *GET DP ERROR* 〕━━━╮
┃
┃ Profile information
┃ ලබාගන්න බැරි වුණා.
┃
╰━━━━━━━━━━━━━━━━━━━━╯

> Zᴇꜱʀ ✘ 〽️ᴏᴠɪᴇ Bᴏᴛ`
        }, { quoted: msg });
    }

    break;
}

                   
        case 'rename': {
            if (!isOwner) {
    await socket.sendMessage(sender, {
        react: { text: '❌', key: msg.key }
    });

    return await socket.sendMessage(sender, {
        text: '❌ *Only the bot owner can use this command.*'
    }, { quoted: msg });
            }
    try {
        const contextInfo =
            msg.message?.extendedTextMessage?.contextInfo ||
            msg.message?.imageMessage?.contextInfo ||
            msg.message?.videoMessage?.contextInfo ||
            msg.message?.documentMessage?.contextInfo ||
            msg.message?.audioMessage?.contextInfo;

        const quotedMsg = contextInfo?.quotedMessage;

        if (!quotedMsg) {
            return await socket.sendMessage(sender, {
                text:
`⚠️ *Rename කරන්න File / Media එකකට Reply කරන්න.*

📝 *Usage:*
• \`.rename new_name.mp4\`
• \`.rename new_name.mkv\``
            }, { quoted: msg });
        }

        const rawInput = args.join(' ').trim();

        if (!rawInput) {
            return await socket.sendMessage(sender, {
                text: `⚠️ *අලුත් File Name එක ලබා දෙන්න!*\n\n📝 \`.rename new_name.mp4\``
            }, { quoted: msg });
        }

        // Filename | Optional Caption
        const [namePart, ...captionParts] = rawInput.split('|');

        const newNameInput = namePart.trim();
        const userCaption = captionParts.join('|').trim();

        if (!newNameInput) {
            return await socket.sendMessage(sender, {
                text: '❌ *වලංගු File Name එකක් ලබා දෙන්න.*'
            }, { quoted: msg });
        }

        // Detect replied media
        const docMsg =
            quotedMsg.documentMessage ||
            quotedMsg.documentWithCaptionMessage?.message?.documentMessage;

        const imgMsg = quotedMsg.imageMessage;
        const vidMsg = quotedMsg.videoMessage;
        const audMsg = quotedMsg.audioMessage;

        const mediaObj = docMsg || imgMsg || vidMsg || audMsg;

        if (!mediaObj) {
            return await socket.sendMessage(sender, {
                text: '❌ *Reply කළ Message එකේ File / Media එකක් හමු වුණේ නැහැ.*'
            }, { quoted: msg });
        }

        // Processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: '⚡',
                key: msg.key
            }
        });

        const originalFileName = mediaObj.fileName || '';
        const mime = mediaObj.mimetype || 'application/octet-stream';

        // Detect extension
        let extension = '';

        const originalExt = originalFileName.match(/\.[a-zA-Z0-9]+$/);

        if (originalExt) {
            extension = originalExt[0];
        } else {
            const mimeMap = {
                'application/pdf': '.pdf',
                'application/vnd.android.package-archive': '.apk',
                'application/zip': '.zip',
                'application/x-zip-compressed': '.zip',
                'application/x-rar-compressed': '.rar',
                'application/octet-stream': '.bin',

                'image/jpeg': '.jpg',
                'image/png': '.png',
                'image/webp': '.webp',

                'video/mp4': '.mp4',
                'video/x-matroska': '.mkv',

                'audio/mpeg': '.mp3',
                'audio/mp4': '.m4a',
                'audio/ogg': '.ogg',

                'text/plain': '.txt'
            };

            extension = mimeMap[mime] || '';
        }

        // Add original extension if user didn't provide one
        const hasExtension = /\.[a-zA-Z0-9]+$/.test(newNameInput);

        const finalFileName = hasExtension
            ? newNameInput
            : `${newNameInput}${extension}`;

        // Existing bot footer
        const BOT_FOOTER =
            sessionConfig?.BOT_FOOTER ||
            config?.BOT_FOOTER ||
            '';

        // Clean caption
        const footerText =
`${BOT_FOOTER ? `> ${BOT_FOOTER}\n` : ''}> ©️ 𝐂𝐫𝐞𝐚𝐭𝐞𝐝 𝐛𝐲 𝐒𝐞𝐧𝐞𝐬𝐡 𝐌𝐚𝐧𝐝𝐢𝐬 🪺`;

        const captionText = userCaption
            ? `${userCaption}\n\n${footerText}`
            : footerText;

        // ─────────────────────────────
        // FAST RELAY
        // ─────────────────────────────
        if (mediaObj.url && mediaObj.mediaKey) {
            const newMessageContent = {
                documentMessage: {
                    ...mediaObj,
                    fileName: finalFileName,
                    mimetype: mime,
                    caption: captionText
                }
            };

            const waMsg = generateWAMessageFromContent(
                sender,
                newMessageContent,
                {
                    userJid: socket.user.id,
                    quoted: msg
                }
            );

            await socket.relayMessage(
                sender,
                waMsg.message,
                {
                    messageId: waMsg.key.id
                }
            );

            await socket.sendMessage(sender, {
                react: {
                    text: '✅',
                    key: msg.key
                }
            });

            return;
        }

        // ─────────────────────────────
        // FALLBACK DOWNLOAD
        // ─────────────────────────────
        const mediaType = docMsg
            ? 'document'
            : imgMsg
                ? 'image'
                : vidMsg
                    ? 'video'
                    : 'audio';

        const stream = await downloadContentFromMessage(
            mediaObj,
            mediaType
        );

        const chunks = [];

        for await (const chunk of stream) {
            chunks.push(chunk);
        }

        const buffer = Buffer.concat(chunks);

        await socket.sendMessage(sender, {
            document: buffer,
            mimetype: mime,
            fileName: finalFileName,
            caption: captionText
        }, { quoted: msg });

        await socket.sendMessage(sender, {
            react: {
                text: '✅',
                key: msg.key
            }
        });

    } catch (err) {
        console.error('Rename command error:', err);

        await socket.sendMessage(sender, {
            react: {
                text: '❌',
                key: msg.key
            }
        });

        await socket.sendMessage(sender, {
            text: `❌ *Rename Error:* ${err?.message || 'Unknown Error'}`
        }, { quoted: msg });
    }

    break;
                    }
                    
                case 'set':
                case 'setting': {
                    if (!isOwner) {
                        return await socket.sendMessage(sender, {
                            text: "❌ *Only the bot owner can use this command.*"
                        }, { quoted: msg });
                    }

                    if (!args.length) {
                        let helpText = `🎀 *𝗦𝗬𝗦𝗧𝗘𝗠  𝗖𝗢𝗡𝗙𝗜𝗚𝗨𝗥𝗔𝗧𝗜𝗢𝗡  𝗣𝗔𝗡𝗘𝗟*\n\n` +
                            `📝 *𝖴𝗌𝖺𝗀𝖾 :* \`.set KEY:VALUE\`\n` +
                            `✨ *𝖤𝗑𝖺𝗆𝗉𝗅𝖾 :* \`.set MODE:public\`\n` +
                            `🫧 *𝖬𝗎𝗅𝗍𝗂 :* \`.set PREFIX:!\`\n\n` +
                            `🐞 *𝖠𝗏𝖺𝗂𝗅𝖺𝖻𝗅𝖾  \𝖲𝗒𝗌𝗍𝖾𝗆  𝖪𝖾𝗒𝗌 :*\n` +
                            `🐞 \`AUTO_RECORDING\`\n` +
                            `🐞 \`AUTO_TYPING\`\n` +
                            `🐞 \`PREFIX\`\n` +
                            `🐞 \`MODE\` (public/private)\n` +
                            `🐞 \`BOT_IMAGE\`\n` +
                            `🐞 \`MOVIE_FOOTER\`\n` +
                            `🐞 \`MOVIE_CAPTION\`\n` +
                            `🐞 \`BOT_NAME\`\n`;

                        return await socket.sendMessage(sender, {
                            image: { url: config.BOT_IMAGE || config.ERROR },
                            caption: formatMessage(
                                `𝗖𝗢𝗡𝗙𝗜𝗚  𝗠𝗔𝗡𝗔𝗚𝗘𝗥  ⚙️`,
                                helpText,
                                `${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
                            )
                        }, { quoted: msg });
                    }

                    const input = args.join(' ');
                    const updates = {};
                    const validKeys = [
                        'PREFIX', 'AUTO_RECORDING', 'AUTO_TYPING',
                        'BOT_NAME', 'MOVIE_FOOTER', 'MOVIE_CAPTION', 'MODE'
                    ];

                    const pairs = input.split(',');
                    let hasInvalidKey = false;
                    let invalidKeyName = '';

                    pairs.forEach(pair => {
                        let [key, ...valueParts] = pair.split(':');
                        if (!key || valueParts.length === 0) return;

                        key = key.trim().toUpperCase();
                        let value = valueParts.join(':').trim();

                        if (validKeys.includes(key)) {
                            if (value.toLowerCase() === 'true') {
                                updates[key] = 'true';
                            } else if (value.toLowerCase() === 'false') {
                                updates[key] = 'false';
                            } else {
                                updates[key] = value;
                            }
                        } else {
                            hasInvalidKey = true;
                            invalidKeyName = key;
                        }
                    });

                    if (hasInvalidKey) {
                        return await socket.sendMessage(sender, {
                            text: `Invalid system key: \`${invalidKeyName}\`\n\n> ${sessionConfig.AIR_FOOTER || config.AIR_FOOTER}`
                        }, { quoted: msg });
                    }

                    if (Object.keys(updates).length === 0) {
                        return await socket.sendMessage(sender, { text: "🎀 *𝗙𝗢𝗥𝗠𝗔𝗧  𝗘𝗥𝗥𝗢𝗥:* Please use `Key:Value` structure." });
                    }

                    try {
                        await socket.sendMessage(sender, { react: { text: "⚙️", key: msg.key } });

                        sessionConfig = { ...sessionConfig, ...updates };
                        await updateUserConfig(sanitizedNumber, sessionConfig);
                        activeSockets.set(sanitizedNumber, { socket, config: sessionConfig });

                        let updateSummary = Object.entries(updates).map(([k, v]) => {
                            let displayVal = Array.isArray(v) ? v.join(' ') : v;
                            return `🎀 *${k}* ──❯ \`${displayVal}\``;
                        }).join('\n');

                        const successMsg = `🎀 *𝗖𝗢𝗡𝗙𝗜𝗚𝗨𝗥𝗔𝗧𝗜𝗢𝗡  𝗨𝗣𝗗𝗔𝗧𝗘𝗗*\n\n` +
                            `${updateSummary}\n\n` +
                            `🫧 _System cloud changes applied successfully._`;

                        await socket.sendMessage(sender, {
                            image: { url: config.BOT_IMAGE },
                            caption: formatMessage(
                                `✅ 𝗨𝗣𝗗𝗔𝗧𝗘  𝗦𝗨𝗖𝗖𝗘𝗦𝗦  ✅`,
                                successMsg,
                                `${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
                            )
                        }, { quoted: msg });

                        await socket.sendMessage(sender, { react: { text: "✨", key: msg.key } });

                    } catch (error) {
                        console.error("Update Error:", error);
                        await socket.sendMessage(sender, { text: "🎀 " + error.message });
                    }
                }
                break;
                            case 'owner': {
    try {
        await socket.sendMessage(sender, {
            react: { text: '👑', key: msg.key }
        });

        // 1) Send owner video as WhatsApp Video Note
        const ownerVnote = await socket.sendMessage(sender, {
            video: {
                url: 'https://files.catbox.moe/a56o2x.mp4'
            },
            ptv: true
        }, { quoted: msg });

        // 2) Owner contact card
        const contactsArray = [
            {
                displayName: 'ᴍʀͥ.ꜱͣᴇͫɴᴇꜱʜ',
                vcard: `BEGIN:VCARD
VERSION:3.0
FN:ᴍʀͥ.ꜱͣᴇͫɴᴇꜱʜ
TEL;type=CELL;type=VOICE;waid=94761393578:+94761393578
END:VCARD`
            }
        ];

        await socket.sendMessage(sender, {
            contacts: {
                displayName: 'ᴍʀͥ.ꜱͣᴇͫɴᴇꜱʜ',
                contacts: contactsArray
            }
        }, { quoted: ownerVnote });

    } catch (error) {
        console.error('Owner command error:', error);

        await socket.sendMessage(sender, {
            text: '❌ *Error:* Unable to fetch owner details.'
        }, { quoted: msg });
    }
}
break;

  case 'ping': {
    try {
        await socket.sendMessage(sender, {
            react: { text: '⚡', key: msg.key }
        });

        const start = process.hrtime.bigint();

        await socket.sendMessage(sender, {
            text: '🏓 *Pong !*'
        });

        const end = process.hrtime.bigint();

        const responseTime =
            Number(end - start) / 1_000_000;

        await socket.sendMessage(sender, {
            text: `📍 *Ping:* ${responseTime.toFixed(3)}ms`
        });

        await socket.sendMessage(sender, {
            react: { text: '✅', key: msg.key }
        });

    } catch (error) {
        console.error('Ping command error:', error);

        await socket.sendMessage(sender, {
            react: { text: '❌', key: msg.key }
        });
    }
}
break;
case 'cinetv':{
            if (!isOwner && !isCreator) {
    return await socket.sendMessage(sender, {
        text: '❌ *Only Authorized Users Can Use This Command*'
    }, { quoted: msg });
            }
    if (!args.length) {
        await socket.sendMessage(sender, {
            image:  { url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE },
            caption: formatMessage(
                '❌ ERROR',
                '*කරුණාකර චිත්‍රපටයේ හෝ TV series එකේ නම ලබාදෙන්න! උදා: .cinetv spider*',
                `${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
            )
        }, { quoted: msg });
        break;
    }

    const cinezubQuerytv = args.join(' ');
    await socket.sendMessage(sender, { text: '📽️ 𝙎𝙚𝙖𝙧𝙘𝙝𝙞𝙣𝙜 𝙤𝙣 𝘾𝙞𝙣𝙚𝙨𝙪𝙗𝙯...' });

    try {
        const searchResponse = await axios.get(`${config.API_MOVIE_URL}/cinesubz/search?query=${encodeURIComponent(cinezubQuerytv)}&api_key=${config.API_KEY}`);
        const searchData = searchResponse.data;

        if (!searchData.status || !searchData.results || searchData.results.length === 0) {
            await socket.sendMessage(sender, {
                image:  { url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE },
                caption: formatMessage(
                    '❌ NO RESULTS',
                    '*Cinesubz හි චිත්‍රපට හමුවෙන්නේ නැත! 😞*',
                    `${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
                )
            }, { quoted: msg });
            break;
        }

        const cinezubResults = searchData.results.slice(0, 25);
       let listText = `☘️ *𝗧𝗩-𝗦𝗘𝗥𝗜𝗘𝗦 : _𝗦𝗘𝗔𝗥𝗖𝗛 𝗥𝗘𝗦𝗨𝗟𝗧𝗦_* 🔍
╭──────●➤
🔎 *𝗤𝘂𝗲𝗿𝘆 ➟* _${cinezubQuerytv}_
📊 *Status ➟* _Results Found_
╰──────────●➤
╭──────●➤
*🔢 ʀᴇᴘʟʏ ʙᴇʟᴏᴡ ɴᴜᴍʙᴇʀ*
╰──────────●➤
💡 *𝗥ᴇᴘʟʏ ᴡɪᴛʜ ᴀ 𝗡ᴜᴍʙᴇʀ 𝘁ᴏ 𝗦ᴇʟᴇᴄ𝘁*
*╭──────●➤*\n\n`;

        cinezubResults.forEach((item, index) => {
            const type = item.link.includes('/tvshows/') ? '📺 TV Series' : '🎬 Movie';
            listText += `*♦️ ${index + 1} ║❯❯ ${type} | ${item.title}*\n`;
        });

        listText += `╰──────────●➤\n> ${sessionConfig.MOVIE_FOOTER || config.MOVIE_FOOTER}`;
        
        const sentMsg = await socket.sendMessage(sender, {
            image:{ url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE },
            caption: listText
        }, { quoted: msg });

        const messageID = sentMsg.key.id;

        const handleSelection = async ({ messages: replyMessages }) => {
            const replyMek = replyMessages[0];
            if (!replyMek?.message) return;

            const messageType = replyMek.message.conversation || replyMek.message.extendedTextMessage?.text;
            const isReplyToSentMsg = replyMek.message.extendedTextMessage?.contextInfo?.stanzaId === messageID;

            if (isReplyToSentMsg && sender === replyMek.key.remoteJid) {
                const choice = parseInt(messageType) - 1;
                if (isNaN(choice) || choice < 0 || choice >= cinezubResults.length) {
                    await socket.sendMessage(sender, {
                        image:  { url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE },
                        caption: formatMessage(
                            '❌ INVALID SELECTION',
                            `*වැරදි අංකයක්! 1-${cinezubResults.length} අතර තෝරන්න! 😕*`,
                            `${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
                        )
                    }, { quoted: replyMek });
                    return;
                }

                const selectedItem = cinezubResults[choice];
                const isTvShow = selectedItem.link.includes('/tvshows/');
                
                if (isTvShow) {
                    // TV Show එකක් නම්
                    await socket.sendMessage(sender, { 
                        text: '📺 𝙁𝙚𝙩𝙘𝙝𝙞𝙣𝙜 𝙏𝙑 𝙨𝙚𝙧𝙞𝙚𝙨 𝙙𝙚𝙩𝙖𝙞𝙡𝙨...' 
                    }, { quoted: replyMek });

                    try {
                        const tvShowResponse = await axios.get(`${config.API_CINESUBZ_URL}/api/tvshow?url=${encodeURIComponent(selectedItem.link)}&api_key=${config.API_KEY}`);
                        const tvShowData = tvShowResponse.data;

                        if (!tvShowData.status || !tvShowData.data) {
                            throw new Error('Failed to fetch TV show details');
                        }

                        const tvInfo = tvShowData.data;
                        
                        // Send TV Show details separately
                        let tvDetailsText = 
    `☘️ *𝗧ɪᴛʟᴇ ➟* _${tvInfo.title}_
▫️🥇 *𝗜ᴍᴅʙ 𝗥ᴀᴛɪɴɢ ➟*  _${tvInfo.imdb_rating || 'N/A'}_
▫️📅 *𝗥ᴇʟᴇᴀꜱᴇ 𝗬ᴇᴀʀ ➟*_${tvInfo.year || 'N/A'}_
▫️📀 *𝗦ᴇᴀꜱᴏɴꜱ ➟* _${tvInfo.total_seasons || 'N/A'} Total_
▫️📊 *𝗘ᴘɪꜱᴏᴅᴇꜱ ➟* _${tvInfo.total_episodes || 'N/A'} Total_
*➟➟➟➟➟➟➟➟➟➟*
📖 *𝗦𝗧𝗢𝗥𝗬*_${tvInfo.description?.substring(0, 30) || 'No description available.'}..._`;

                        await socket.sendMessage(sender, {
                            image: { url: tvInfo.poster || sessionConfig.LAKIYA_IMAGE_PATH || config.LAKIYA_IMAGE_PATH },
                            caption: tvDetailsText
                        }, { quoted: replyMek });

                       
                     let seasonsText = 
    `☘️ *𝗧𝗩-𝗦𝗘𝗥𝗜𝗘𝗦 : _𝗦𝗘𝗔𝗦𝗢𝗡 𝗦𝗘𝗟𝗘𝗖𝗧𝗜𝗢𝗡_* 📺
*➟➟➟➟➟➟➟➟➟➟*
⬇️🍀 *𝗦𝗘𝗟𝗘𝗖𝗧 𝗬𝗢𝗨𝗥 𝗦𝗘𝗔𝗦𝗢𝗡*
*➟➟➟➟➟➟➟➟➟➟*
💡 *𝗥ᴇᴘʟʏ ᴡɪᴛʜ ᴀ 𝗡ᴜᴍʙᴇʀ 𝘁ᴏ 𝗦ᴇʟᴇᴄ𝘛*
*➟➟➟➟➟➟➟➟➟➟*\n\n`;

                        tvInfo.seasons?.forEach((season, idx) => {
                            seasonsText += `🕊️ *${idx + 1} ┃》📀 Season ${season.season} (${season.total_episodes} episodes)*\n`;
                        });

                        seasonsText += `\n> ${sessionConfig.MOVIE_FOOTER || config.MOVIE_FOOTER}`;

                        const seasonMsg = await socket.sendMessage(sender, {
                            text: seasonsText
                        }, { quoted: replyMek });

                        const seasonMsgID = seasonMsg.key.id;

                        const handleSeasonSelect = async ({ messages: seasonMessages }) => {
                            const seasonMek = seasonMessages[0];
                            if (!seasonMek?.message) return;

                            const seasonChoice = seasonMek.message.conversation || seasonMek.message.extendedTextMessage?.text;
                            const isReplyToSeasonMsg = seasonMek.message.extendedTextMessage?.contextInfo?.stanzaId === seasonMsgID;

                            if (isReplyToSeasonMsg && sender === seasonMek.key.remoteJid) {
                                const seasonNum = parseInt(seasonChoice) - 1;
                                
                                if (isNaN(seasonNum) || seasonNum < 0 || seasonNum >= tvInfo.seasons.length) {
                                    await socket.sendMessage(sender, {
                                        image:  { url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE },
                                        caption: formatMessage(
                                            '❌ INVALID SELECTION',
                                            `*වැරදි අංකයක්! 1-${tvInfo.seasons.length} අතර තෝරන්න!*`,
                                            `${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
                                        )
                                    }, { quoted: seasonMek });
                                    return;
                                }

                                const selectedSeason = tvInfo.seasons[seasonNum];
                                
                              
                              let episodesText =
    `☘️ *𝗧𝗩-𝗦𝗘𝗥𝗜𝗘𝗦 : _𝗘𝗣𝗜𝗦𝗢𝗗𝗘 𝗦𝗘𝗟𝗘𝗖𝗧𝗜𝗢𝗡_* 📺
╭──────●➤
☘️ *𝗧ɪᴛʟᴇ ➟* _${tvInfo.title}_
📀 *𝗦ᴇᴀꜱᴏɴ ➟* _Season ${selectedSeason.season}_
📊 *𝗧ᴏᴛᴀʟ ➟* _${selectedSeason.total_episodes} Episodes_
╰──────────●➤
╭──────●➤
*🔢 ʀᴇᴘʟʏ ʙᴇʟᴏᴡ ɴᴜᴍʙᴇʀ*
╰──────────●➤

🔸 *0 ❱❱ 📥 Download All Episodes*
   _(Total: ${selectedSeason.total_episodes})_\n\n`;

                                selectedSeason.episodes.forEach((ep, idx) => {
                                    episodesText += `*🔮${idx + 1} ║❯❯ 📺 Episode ${ep.episode}: ${ep.title}*\n`;
                                });

                                episodesText += `\n> ${sessionConfig.MOVIE_FOOTER || config.MOVIE_FOOTER}`;

                                const episodeMsg = await socket.sendMessage(sender, {
                                    text: episodesText
                                }, { quoted: seasonMek });

                                const episodeMsgID = episodeMsg.key.id;

                                const handleEpisodeSelect = async ({ messages: episodeMessages }) => {
                                    const episodeMek = episodeMessages[0];
                                    if (!episodeMek?.message) return;

                                    const episodeChoice = episodeMek.message.conversation || episodeMek.message.extendedTextMessage?.text;
                                    const isReplyToEpisodeMsg = episodeMek.message.extendedTextMessage?.contextInfo?.stanzaId === episodeMsgID;

                                    if (isReplyToEpisodeMsg && sender === episodeMek.key.remoteJid) {
                                        const choiceNum = parseInt(episodeChoice);
                                        
                                        if (isNaN(choiceNum) || choiceNum < 0 || choiceNum > selectedSeason.episodes.length) {
                                            await socket.sendMessage(sender, {
                                                image:  { url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE },
                                                caption: formatMessage(
                                                    '❌ INVALID SELECTION',
                                                    `*වැරදි අංකයක්! 0-${selectedSeason.episodes.length} අතර තෝරන්න!*`,
                                                    `${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
                                                )
                                            }, { quoted: episodeMek });
                                            return;
                                        }

                                        if (choiceNum === 0) {
                                        
                                            await socket.sendMessage(sender, { 
                                                text: `📥 𝙁𝙚𝙩𝙘𝙝𝙞𝙣𝙜 𝙙𝙤𝙬𝙣𝙡𝙤𝙖𝙙 𝙡𝙞𝙣𝙠𝙨 𝙛𝙤𝙧 𝙖𝙡𝙡 ${selectedSeason.total_episodes} 𝙚𝙥𝙞𝙨𝙤𝙙𝙚𝙨...` 
                                            }, { quoted: episodeMek });

                                            try {
                                               
                                                const firstEpisode = selectedSeason.episodes[0];
                                                const episodeResponse = await axios.get(`${config.API_CINESUBZ_URL}/api/episode?url=${encodeURIComponent(firstEpisode.url)}&api_key=${config.API_KEY}`);
                                                const episodeData = episodeResponse.data;

                                                if (!episodeData.status || !episodeData.data?.download_links?.length) {
                                                    throw new Error('Failed to get quality options');
                                                }

                                                const downloadLinks = episodeData.data.download_links;
                                                
                                               
                                                let qualityText = 
`☘️ *𝗧𝗩-𝗦𝗘𝗥𝗜𝗘𝗦 : _𝗦𝗘𝗟𝗘𝗖𝗧 𝗤𝗨𝗔𝗟𝗜𝗧𝗬_* 📺
╭──────●➤
📀 *𝗦ᴇᴀꜱᴏɴ ➟* _Season ${selectedSeason.season}_
📊 *𝗧ᴏᴛᴀʟ ➟* _${selectedSeason.total_episodes} Episodes_
╰──────────●➤
╭──────●➤
*🔢 ʀᴇᴘʟʏ ʙᴇʟᴏᴡ ɴᴜᴍʙᴇʀ*
╰──────────●➤\n\n`;

                                                downloadLinks.forEach((link, idx) => {
                                                    const quality = link.meta || link.type || `Quality ${idx + 1}`;
                                                    qualityText += `🔮 *${idx + 1} ║❯❯ 📥 ${quality}*\n`;
                                                });

                                                qualityText += `\n> ${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`;

                                                const qualityMsg = await socket.sendMessage(sender, {
                                                    text: qualityText
                                                }, { quoted: episodeMek });

                                                const qualityMsgID = qualityMsg.key.id;

                                                
                                                const handleQualitySelectForAll = async ({ messages: qualityMessages }) => {
                                                    const qualityMek = qualityMessages[0];
                                                    if (!qualityMek?.message) return;

                                                    const qualityChoice = qualityMek.message.conversation || qualityMek.message.extendedTextMessage?.text;
                                                    const isReplyToQualityMsg = qualityMek.message.extendedTextMessage?.contextInfo?.stanzaId === qualityMsgID;

                                                    if (isReplyToQualityMsg && sender === qualityMek.key.remoteJid) {
                                                        const qualityNum = parseInt(qualityChoice) - 1;
                                                        
                                                        if (isNaN(qualityNum) || qualityNum < 0 || qualityNum >= downloadLinks.length) {
                                                            await socket.sendMessage(sender, {
                                                                image:  { url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE },
                                                                caption: formatMessage(
                                                                    '❌ INVALID SELECTION',
                                                                    `*වැරදි අංකයක්! 1-${downloadLinks.length} අතර තෝරන්න!*`,
                                                                    `${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
                                                                )
                                                            }, { quoted: qualityMek });
                                                            return;
                                                        }

                                                        const selectedQuality = downloadLinks[qualityNum];
                                                        
                                                        await socket.sendMessage(sender, { 
                                                            text: `📥 𝘿𝙤𝙬𝙣𝙡𝙤𝙖𝙙𝙞𝙣𝙜 ${selectedSeason.total_episodes} 𝙚𝙥𝙞𝙨𝙤𝙙𝙚𝙨 𝙬𝙞𝙩𝙝 ${selectedQuality.meta || selectedQuality.type} 𝙦𝙪𝙖𝙡𝙞𝙩𝙮...\n\n⚠️ *This may take some time* ⚠️` 
                                                        }, { quoted: qualityMek });

                                                        
                                                        let successCount = 0;
                                                        let failCount = 0;

                                                        for (let i = 0; i < selectedSeason.episodes.length; i++) {
                                                            const episode = selectedSeason.episodes[i];
                                                            try {
                                                                await socket.sendMessage(sender, { 
                                                                    text: `📥 𝘿𝙤𝙬𝙣𝙡𝙤𝙖𝙙𝙞𝙣𝙜: S${selectedSeason.season}E${episode.episode} - ${episode.title}...` 
                                                                }, { quoted: qualityMek });

                                                                const episodeResponse = await axios.get(`${config.API_CINESUBZ_URL}/api/episode?url=${encodeURIComponent(episode.url)}&api_key=${config.API_KEY}`);
                                                                const episodeData = episodeResponse.data;

                                                                if (episodeData.status && episodeData.data?.download_links?.length) {
                                                                    const episodeDownloadLinks = episodeData.data.download_links;
                                                                    
                                                                   
                                                                    let targetLink = episodeDownloadLinks.find(link => 
                                                                        (link.meta || link.type) === (selectedQuality.meta || selectedQuality.type)
                                                                    );
                                                                    
                                                                    if (!targetLink) {
                                                                        targetLink = episodeDownloadLinks[0];
                                                                    }
                                                                    
                                                                    const darkShanResponse = await axios.get(`https://api.laksidu.site/movie/cinesubz?url=${encodeURIComponent(targetLink.url)}&api_key=${config.API_KEY}`);
                                                                    const darkShanData = darkShanResponse.data;

                                                                    if (darkShanData.status && darkShanData.data?.download) {
                                                                        const finalDownloadLinks = darkShanData.data.download;
                                                                        const finalNonTelegramLinks = finalDownloadLinks.filter(link => 
                                                                            link.name && link.name.toLowerCase() !== 'telegram'
                                                                        );
                                                                        const finalLink = finalNonTelegramLinks[0] || finalDownloadLinks[0];
                                                                        
                                                                        const thumbUrl = tvInfo.poster || sessionConfig.LAKIYA_IMAGE_PATH || config.LAKIYA_IMAGE_PATH;
                                                                        let thumbBuffer;
                                                                        
                                                                        try {
                                                                            const response = await axios.get(thumbUrl, { 
                                                                                responseType: 'arraybuffer',
                                                                                timeout: 30000
                                                                            });
                                                                            
                                                                            thumbBuffer = await sharp(Buffer.from(response.data))
                                                                                .resize(300, 300, { fit: 'cover', position: 'center' })
                                                                                .jpeg({ quality: 70 })
                                                                                .toBuffer();
                                                                        } catch (e) {
                                                                            thumbBuffer = undefined;
                                                                        }
                                                                        
                                                                        await socket.sendMessage(sender, {
                                                                            document: { url: finalLink.url },
                                                                            mimetype: 'video/mp4',
                                                                            fileName: `${tvInfo.title} S${selectedSeason.season}E${episode.episode} - ${episode.title}.mp4`,
                                                                            jpegThumbnail: thumbBuffer,
                                                                            caption: formatMessage(
                                                                                `☘️ ${tvInfo.title} - S${selectedSeason.season}E${episode.episode}`,
                                                                                `\`❚█═${sessionConfig.MOVIE_CAPTION || config.MOVIE_CAPTION}═█❚\`
                                                                                
\`📺 ${episode.title}\``,
                                                                                `${sessionConfig.MOVIE_FOOTER || config.MOVIE_FOOTER}`
                                                                            )
                                                                        }, { quoted: qualityMek });
                                                                        
                                                                        successCount++;
                                                                    } else {
                                                                        failCount++;
                                                                    }
                                                                } else {
                                                                    failCount++;
                                                                }
                                                                
                                                                await new Promise(resolve => setTimeout(resolve, 2000));
                                                                
                                                            } catch (epError) {
                                                                console.error(`Error downloading episode ${episode.episode}:`, epError);
                                                                failCount++;
                                                            }
                                                        }
                                                        
                                                        await socket.sendMessage(sender, { 
                                                            text: `✅ *Download Complete!*\n\n📊 *Summary:*\n✅ Success: ${successCount} episodes\n❌ Failed: ${failCount} episodes\n📀 Season: ${selectedSeason.season}\n🎬 Series: ${tvInfo.title}\n📥 Quality: ${selectedQuality.meta || selectedQuality.type}` 
                                                        }, { quoted: qualityMek });
                                                        
                                                        socket.ev.off('messages.upsert', handleQualitySelectForAll);
                                                        socket.ev.off('messages.upsert', handleEpisodeSelect);
                                                        socket.ev.off('messages.upsert', handleSeasonSelect);
                                                        socket.ev.off('messages.upsert', handleSelection);
                                                    }
                                                };

                                                socket.ev.on('messages.upsert', handleQualitySelectForAll);

                                            } catch (error) {
                                                console.error('Quality fetch error:', error);
                                                await socket.sendMessage(sender, {
                                                    image:  { url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE },
                                                    caption: formatMessage(
                                                        '❌ ERROR',
                                                        `*Quality options ලබාගැනීමේ දෝෂයක්*\n${error.message}`,
                                                        `${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
                                                    )
                                                }, { quoted: episodeMek });
                                            }
                                         

                                        } else {
                                           
                                            const selectedEpisode = selectedSeason.episodes[choiceNum - 1];
                                            
                                            await socket.sendMessage(sender, { 
                                                text: `📥 𝙁𝙚𝙩𝙘𝙝𝙞𝙣𝙜 𝙙𝙤𝙬𝙣𝙡𝙤𝙖𝙙 𝙡𝙞𝙣𝙠𝙨 𝙛𝙤𝙧 S${selectedSeason.season}E${selectedEpisode.episode}...` 
                                            }, { quoted: episodeMek });

                                            try {
                                                const episodeResponse = await axios.get(`${config.API_CINESUBZ_URL}/api/episode?url=${encodeURIComponent(selectedEpisode.url)}&api_key=${config.API_KEY}`);
                                                const episodeData = episodeResponse.data;

                                                if (!episodeData.status || !episodeData.data?.download_links?.length) {
                                                    throw new Error('Failed to get episode download links');
                                                }

                                                const episodeDownloadLinks = episodeData.data.download_links;
                                                
                                               
                                               let qualityText = 
    `☘️ *𝗧𝗩-𝗦𝗘𝗥𝗜𝗘𝗦 : _𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗 𝗢𝗣𝗧𝗜𝗢𝗡𝗦_* 📺
╭──────●➤
🎬 *𝗧ɪᴛʟᴇ ➟* _${tvInfo.title}_
📀 *𝗦ᴇᴀꜱᴏɴ ➟* _Season ${selectedSeason.season}_
📺 *𝗘ᴘɪꜱᴏᴅᴇ ➟* _${selectedEpisode.episode} : ${selectedEpisode.title}_
╰──────────●➤
╭──────●➤
*🔢 ʀᴇᴘʟʏ ʙᴇʟᴏᴡ ɴᴜᴍʙᴇʀ*
╰──────────●➤\n\n`;

                                                episodeDownloadLinks.forEach((link, idx) => {
                                                    const quality = link.meta || link.type || `Quality ${idx + 1}`;
                                                    qualityText += `🔮 *${idx + 1} ║❯❯ 📥 ${quality}*\n`;
                                                });

                                                qualityText += `\n${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`;

                                                const qualityMsg = await socket.sendMessage(sender, {
                                                    text: qualityText
                                                }, { quoted: episodeMek });

                                                const qualityMsgID = qualityMsg.key.id;

                                                const handleQualitySelect = async ({ messages: qualityMessages }) => {
                                                    const qualityMek = qualityMessages[0];
                                                    if (!qualityMek?.message) return;

                                                    const qualityChoice = qualityMek.message.conversation || qualityMek.message.extendedTextMessage?.text;
                                                    const isReplyToQualityMsg = qualityMek.message.extendedTextMessage?.contextInfo?.stanzaId === qualityMsgID;

                                                    if (isReplyToQualityMsg && sender === qualityMek.key.remoteJid) {
                                                        const qualityNum = parseInt(qualityChoice) - 1;
                                                        
                                                        if (isNaN(qualityNum) || qualityNum < 0 || qualityNum >= episodeDownloadLinks.length) {
                                                            await socket.sendMessage(sender, {
                                                                image:  { url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE },
                                                                caption: formatMessage(
                                                                    '❌ INVALID SELECTION',
                                                                    `*වැරදි අංකයක්! 1-${episodeDownloadLinks.length} අතර තෝරන්න!*`,
                                                                    `${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
                                                                )
                                                            }, { quoted: qualityMek });
                                                            return;
                                                        }

                                                        const selectedQuality = episodeDownloadLinks[qualityNum];
                                                        
                                                        await socket.sendMessage(sender, { 
                                                            text: `⏳ 𝙂𝙚𝙩𝙩𝙞𝙣𝙜 𝙙𝙤𝙬𝙣𝙡𝙤𝙖𝙙 𝙡𝙞𝙣𝙠 𝙛𝙤𝙧 ${selectedQuality.meta || selectedQuality.type}...` 
                                                        }, { quoted: qualityMek });

                                                        try {
                                                            const darkShanResponse = await axios.get(`https://api.laksidu.site/movie/cinesubz?url=${encodeURIComponent(selectedQuality.url)}&api_key=${config.API_KEY}`);
                                                            const darkShanData = darkShanResponse.data;

                                                            if (!darkShanData.status || !darkShanData.data?.download) {
                                                                throw new Error('Failed to get download URL from Dark Shan API');
                                                            }

                                                            const finalDownloadLinks = darkShanData.data.download;
                                                            
                                                            const finalNonTelegramLinks = finalDownloadLinks.filter(link => 
                                                                link.name && link.name.toLowerCase() !== 'telegram'
                                                            );
                                                            
                                                            if (finalNonTelegramLinks.length === 0) {
                                                                throw new Error('No non-Telegram download links available');
                                                            }
                                                            
                                                            const finalLink = finalNonTelegramLinks.find(link => link.name === 'unknown') || finalNonTelegramLinks[0];
                                                            
                                                            await socket.sendMessage(sender, { react: { text: '📥', key: qualityMek.key } });

                                                            const thumbUrl = tvInfo.poster || sessionConfig.LAKIYA_IMAGE_PATH || config.LAKIYA_IMAGE_PATH;
                                                            let thumbBuffer;

                                                            try {
                                                                const response = await axios.get(thumbUrl, { 
                                                                    responseType: 'arraybuffer',
                                                                    timeout: 30000
                                                                });

                                                                thumbBuffer = await sharp(Buffer.from(response.data))
                                                                    .resize(300, 300, { 
                                                                        fit: 'cover',
                                                                        position: 'center' 
                                                                    })
                                                                    .jpeg({ quality: 70 })
                                                                    .toBuffer();

                                                            } catch (e) {
                                                                console.error('Thumbnail download/resize error:', e.message);
                                                                thumbBuffer = undefined;
                                                            }

                                                            await socket.sendMessage(sender, {
                                                                document: { url: finalLink.url },
                                                                mimetype: 'video/mp4',
                                                                fileName: `${tvInfo.title} S${selectedSeason.season}E${selectedEpisode.episode} - ${selectedEpisode.title}.mp4`,
                                                                jpegThumbnail: thumbBuffer,
                                                         caption: `*☘️ ${tvInfo.title} - ${selectedSeason.season}*

\`[Episode-${selectedEpisode.episode}]\`

${sessionConfig.MOVIE_FOOTER || config.MOVIE_FOOTER}`
                                                            }, { quoted: qualityMek });

                                                            await socket.sendMessage(sender, { react: { text: '✅', key: qualityMek.key } });

                                                        } catch (downloadError) {
                                                            console.error('Download error:', downloadError);
                                                            await socket.sendMessage(sender, {
                                                                image:  { url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE },
                                                                caption: formatMessage(
                                                                    '❌ DOWNLOAD ERROR',
                                                                    `*Download link එක ලබාගැනීමේ දෝෂයක්.*\n${downloadError.message}`,
                                                                    `${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
                                                                )
                                                            }, { quoted: qualityMek });
                                                        } finally {
                                                            socket.ev.off('messages.upsert', handleQualitySelect);
                                                            socket.ev.off('messages.upsert', handleEpisodeSelect);
                                                            socket.ev.off('messages.upsert', handleSeasonSelect);
                                                            socket.ev.off('messages.upsert', handleSelection);
                                                        }
                                                    }
                                                };

                                                socket.ev.on('messages.upsert', handleQualitySelect);

                                            } catch (error) {
                                                console.error('Error fetching episode links:', error);
                                                await socket.sendMessage(sender, {
                                                    image:  { url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE },
                                                    caption: formatMessage(
                                                        '❌ ERROR',
                                                        `*Download links ලබාගැනීමේ දෝෂයක්*\n${error.message}`,
                                                        `${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
                                                    )
                                                }, { quoted: episodeMek });
                                                socket.ev.off('messages.upsert', handleEpisodeSelect);
                                                socket.ev.off('messages.upsert', handleSeasonSelect);
                                                socket.ev.off('messages.upsert', handleSelection);
                                            }
                                        }
                                    }
                                };

                                socket.ev.on('messages.upsert', handleEpisodeSelect);

                            }
                        };

                        socket.ev.on('messages.upsert', handleSeasonSelect);

                    } catch (tvShowError) {
                        console.error('TV Show error:', tvShowError);
                        await socket.sendMessage(sender, {
                            image:  { url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE },
                            caption: formatMessage(
                                '❌ ERROR',
                                `*TV series details ලබාගැනීමේ දෝෂයක්*\n${tvShowError.message}`,
                                `${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
                            )
                        }, { quoted: replyMek });
                        socket.ev.off('messages.upsert', handleSelection);
                    }
                    
                } else {
                   
                    await socket.sendMessage(sender, { 
                        text: '📽️ 𝙁𝙚𝙩𝙘𝙝𝙞𝙣𝙜 𝙙𝙚𝙩𝙖𝙞𝙡𝙨...' 
                    }, { quoted: replyMek });

                    try {
                        const detailsResponse = await axios.get(`${config.API_MOVIE_URL}/cinesubz/details?url=${encodeURIComponent(selectedItem.link)}&api_key=${config.API_KEY}`);
                        const detailsData = detailsResponse.data;

                        if (!detailsData.status || !detailsData.data) {
                            throw new Error('Failed to fetch details');
                        }

                        const movieInfo = detailsData.data;
                        
                        const validDownloads = movieInfo.downloads?.filter(dl => dl && dl.quality && dl.url) || [];
                        
                        if (validDownloads.length === 0) {
                            await socket.sendMessage(sender, {
                                image:  { url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE },
                                caption: formatMessage(
                                    '❌ NO DOWNLOADS',
                                    '*මෙම චිත්‍රපටය සඳහා බාගත කිරීමේ link නොමැත!*',
                                    `${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
                                )
                            }, { quoted: replyMek });
                            return;
                        }
                        
                        const description = movieInfo.description?.substring(0, 300) + (movieInfo.description?.length > 300 ? '...' : '') || 'No description available.';
                        
                        const imdbRating = movieInfo.imdb_rating ? `${movieInfo.imdb_rating}/10` : 'N/A';
                        const year = movieInfo.year || 'N/A';
                        const runtime = movieInfo.runtime || 'N/A';
                        const director = movieInfo.director || 'N/A';
                        const country = movieInfo.country || 'N/A';
                        const cast = movieInfo.cast || 'N/A';
                        
                       
                        const movieDetailsCaption = formatMessage(
                            `☘️ *𝗧ɪᴛʟᴇ ➟* _${movieInfo.title}_`,
                            `▫️🥇 *𝗜ᴍᴅʙ 𝗥ᴀᴛɪɴɢ ➟* _${imdbRating}_
▫️⏳ *𝗗ᴜʀᴀᴛɪᴏɴ ➟* _${runtime}_
▫️📅 *𝗥ᴇʟᴇᴀꜱᴇ 𝗬ᴇᴀʀ ➟* _${year}_
▫️🎬 *𝗗ɪʀᴇᴄᴛᴏʀ ➟* _${director}_
▫️🌎 *𝗖ᴏᴜɴᴛʀʏ ➟* _${country}_
▫️👥 *𝗖ᴀꜱᴛ ➟* _${cast}_
*➟➟➟➟➟➟➟➟➟➟*
*📖 𝗦𝗧𝗢𝗥𝗬 ➟*_${description}_`,
                            `${sessionConfig.MOVIE_FOOTER || config.MOVIE_FOOTER}`
                        );

                        await socket.sendMessage(sender, {
                            image: { url: movieInfo.poster || sessionConfig.LAKIYA_IMAGE_PATH || config.LAKIYA_IMAGE_PATH },
                            caption: movieDetailsCaption
                        }, { quoted: replyMek });

                        
                        const downloadOptionsCaption = formatMessage(
                            `⬇️🍀 *𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗 𝗢𝗣𝗧𝗜𝗢𝗡𝗦*`,
                            `${validDownloads.map((dl, i) => `▫️ *${(i + 1).toString().padStart(2, '0')} ❱❱ 📥 ${dl.quality}*`).join('\n')}\n

╭──────●➤
*🔢 ʀᴇᴘʟʏ ʙᴇʟᴏᴡ ɴᴜᴍʙᴇʀ*
╰──────────●➤`,
                            `${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
                        );

                        const downloadOptionsMsg = await socket.sendMessage(sender, {
                            text: downloadOptionsCaption
                        }, { quoted: replyMek });

                        const optionsMsgID = downloadOptionsMsg.key.id;

                        const handleDownload = async ({ messages: downloadMessages }) => {
                            const downloadMek = downloadMessages[0];
                            if (!downloadMek?.message) return;

                            const downloadChoice = downloadMek.message.conversation || downloadMek.message.extendedTextMessage?.text;
                            const isReplyToOptionsMsg = downloadMek.message.extendedTextMessage?.contextInfo?.stanzaId === optionsMsgID;

                            if (isReplyToOptionsMsg && sender === downloadMek.key.remoteJid) {
                                const choiceNum = parseInt(downloadChoice) - 1;
                                
                                if (isNaN(choiceNum) || choiceNum < 0 || choiceNum >= validDownloads.length) {
                                    await socket.sendMessage(sender, {
                                        image:  { url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE },
                                        caption: formatMessage(
                                            '❌ INVALID SELECTION',
                                            `*වැරදි අංකයක්! 1-${validDownloads.length} අතර තෝරන්න!*`,
                                            `${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
                                        )
                                    }, { quoted: downloadMek });
                                    return;
                                }

                                const selectedDownload = validDownloads[choiceNum];
                                
                                await socket.sendMessage(sender, { 
                                    text: `⏳ 𝙂𝙚𝙩𝙩𝙞𝙣𝙜 𝙙𝙤𝙬𝙣𝙡𝙤𝙖𝙙 𝙡𝙞𝙣𝙠 𝙛𝙤𝙧 ${selectedDownload.quality}...` 
                                }, { quoted: downloadMek });

                                try {
                                    const downloadResponse = await axios.get(`https://apis.laksidu/movie/cinesubz?url=${encodeURIComponent(selectedDownload.url)}&api_key=${config.API_KEY}`);
                                    const downloadData = downloadResponse.data;

                                    if (!downloadData.status || !downloadData.data?.download) {
                                        throw new Error('Failed to get download URL');
                                    }

                                    const downloadLinks = downloadData.data.download;
                                    
                                    const nonTelegramLinks = downloadLinks.filter(link => 
                                        link.name && link.name.toLowerCase() !== 'telegram'
                                    );
                                    
                                    if (nonTelegramLinks.length === 0) {
                                        throw new Error('No non-Telegram download links available');
                                    }
                                    
                                    const preferredLink = nonTelegramLinks.find(link => link.name === 'unknown') || nonTelegramLinks[0];
                                    
                                    await socket.sendMessage(sender, { react: { text: '📥', key: downloadMek.key } });

                                    const thumbUrl = movieInfo.poster || selectedDownload.poster || sessionConfig.LAKIYA_IMAGE_PATH || config.LAKIYA_IMAGE_PATH;
                                    let thumbBuffer;

                                    try {
                                        const response = await axios.get(thumbUrl, { 
                                            responseType: 'arraybuffer',
                                            timeout: 30000
                                        });

                                        thumbBuffer = await sharp(Buffer.from(response.data))
                                            .resize(300, 300, { 
                                                fit: 'cover',
                                                position: 'center' 
                                            })
                                            .jpeg({ quality: 70 })
                                            .toBuffer();

                                    } catch (e) {
                                        console.error('Thumbnail download/resize error:', e.message);
                                        thumbBuffer = undefined;
                                    }

                                    await socket.sendMessage(sender, {
                                        document: { url: preferredLink.url },
                                        mimetype: 'video/mp4',
                                        fileName: downloadData.data.title || `${movieInfo.title} ${selectedDownload.quality}.mp4`,
                                        jpegThumbnail: thumbBuffer,
                                        caption: formatMessage(
                                            `☘️ ${movieInfo.title}`,
                                            `\`❚█═${sessionConfig.MOVIE_CAPTION || config.MOVIE_CAPTION}═█❚\`
                                            
\`[WEB-DL-${selectedDownload.quality}]\``,
                                            `${sessionConfig.MOVIE_FOOTER || config.MOVIE_FOOTER}`
                                        )
                                    }, { quoted: downloadMek });

                                    await socket.sendMessage(sender, { react: { text: '✅', key: downloadMek.key } });

                                } catch (downloadError) {
                                    console.error('Download link error:', downloadError);
                                    await socket.sendMessage(sender, {
                                        image:  { url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE },
                                        caption: formatMessage(
                                            '❌ DOWNLOAD ERROR',
                                            `*Download link එක ලබාගැනීමේ දෝෂයක්.*\n${downloadError.message}`,
                                            `${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
                                        )
                                    }, { quoted: downloadMek });
                                } finally {
                                    socket.ev.off('messages.upsert', handleDownload);
                                    socket.ev.off('messages.upsert', handleSelection);
                                }
                            }
                        };

                        socket.ev.on('messages.upsert', handleDownload);

                    } catch (detailsError) {
                        console.error('Details error:', detailsError);
                        await socket.sendMessage(sender, {
                            image:  { url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE },
                            caption: formatMessage(
                                '❌ ERROR',
                                `*Details ලබාගැනීමේ දෝෂයක්*\n${detailsError.message}`,
                                `${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
                            )
                        }, { quoted: replyMek });
                        socket.ev.off('messages.upsert', handleSelection);
                    }
                }
            }
        };

        socket.ev.on('messages.upsert', handleSelection);

    } catch (error) {
        console.error('Cinezub command error:', error);
        await socket.sendMessage(sender, {
            image:  { url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE },
            caption: formatMessage(
                '❌ ERROR',
                `*දෝෂයක් ඇතිවුණා:* ${error.message || 'Unknown error'}`,
                `${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
            )
        }, { quoted: msg });
    }
    
    break;}
            case 'system':
case 'sys': {
    try {
        const start = Date.now();

        await socket.sendMessage(sender, {
            react: {
                text: '⚙️',
                key: msg.key
            }
        });

        const formatUptime = (seconds) => {
            const days = Math.floor(seconds / 86400);
            const hours = Math.floor((seconds % 86400) / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = Math.floor(seconds % 60);

            return `${days}d ${hours}h ${minutes}m ${secs}s`;
        };

        const formatDate = (date) => {
            return moment(date)
                .tz('Asia/Colombo')
                .format('MMM D, YYYY, hh:mm:ss A');
        };

        const formatBytes = (bytes) => {
            if (!bytes || bytes === 0) return '0 B';

            const units = ['B', 'KB', 'MB', 'GB', 'TB'];
            const i = Math.floor(Math.log(bytes) / Math.log(1024));

            return `${(
                bytes / Math.pow(1024, i)
            ).toFixed(2)} ${units[i]}`;
        };

        const totalRam = os.totalmem();
        const freeRam = os.freemem();
        const usedRam = totalRam - freeRam;

        const cpuData = os.cpus() || [];
        const cpu = cpuData[0] || {};

        const cores = cpuData.length;
        const cpuModel = cpu.model || 'Unknown';
        const cpuSpeed = cpu.speed
            ? `${(cpu.speed / 1000).toFixed(2)} GHz`
            : 'Unknown';

        const loadAverage = os.loadavg();

        // Approx CPU usage
        const calculateCpuUsage = () => {
            if (!cpuData.length) return '0.0';

            let idle = 0;
            let total = 0;

            cpuData.forEach(core => {
                for (const type in core.times) {
                    total += core.times[type];
                }

                idle += core.times.idle;
            });

            return (
                100 -
                (idle / total) * 100
            ).toFixed(1);
        };

        const cpuUsage = calculateCpuUsage();

        const processMemory = process.memoryUsage();

        const botRuntime = process.uptime();
        const systemRuntime = os.uptime();

        const startedAt =
            new Date(
                Date.now() -
                botRuntime * 1000
            );

        const latency = Date.now() - start;

        const platform = os.platform();
        const arch = os.arch();
        const hostname = os.hostname();

        const botName =
            sessionConfig?.BOT_NAME ||
            config?.BOT_NAME ||
            'ZESR MOVIE BOT';

        const footer =
            sessionConfig?.BOT_FOOTER ||
            config?.BOT_FOOTER ||
            'Zᴇꜱʀ ✘ 〽️ᴏᴠɪᴇ Bᴏᴛ ᴠ1.1';

        const text = `
╭─────────────────────●
│     ❖─ SYSTEM NODE ─❖
╰─────────────────────●

🚀 *OPERATIONAL STATUS*

▪️ ⏱️ *Bot Uptime:* ${formatUptime(botRuntime)}
▪️ 🖥️ *System Uptime:* ${formatUptime(systemRuntime)}
▪️ 📅 *System Started:* ${formatDate(startedAt)}
▪️ 📡 *Latency:* ${latency}ms
▪️ ⬆️ *Node Version:* ${process.version}
▪️ 🆔 *Process ID:* ${process.pid}

💻 *HARDWARE ANALYTICS*

▪️ 🧠 *CPU:* ${cpuModel}
▪️ 🔢 *Cores:* ${cores} Cores
▪️ ⚡ *Speed:* ${cpuSpeed}
▪️ 📊 *CPU Usage:* ${cpuUsage}%
▪️ 📈 *Load Average:* ${loadAverage
            .map(x => x.toFixed(2))
            .join(' / ')}

🧠 *MEMORY ANALYTICS*

▪️ 💾 *RAM Usage:* ${formatBytes(usedRam)} / ${formatBytes(totalRam)}
▪️ 🟢 *Free RAM:* ${formatBytes(freeRam)}
▪️ 🤖 *Bot RAM:* ${formatBytes(processMemory.rss)}
▪️ 📦 *Heap Used:* ${formatBytes(processMemory.heapUsed)}
▪️ 📚 *Heap Total:* ${formatBytes(processMemory.heapTotal)}

🖥️ *SERVER DETAILS*

▪️ 🤖 *Bot Name:* ${botName}
▪️ 💿 *Platform:* ${platform}
▪️ 🧩 *Architecture:* ${arch}
▪️ 🏷️ *Host:* ${hostname}

╰─────────────────────●

> ${footer}
`;

        await socket.sendMessage(
            sender,
            {
                text
            },
            {
                quoted: msg
            }
        );

    } catch (error) {
        console.error('SYSTEM CMD ERROR:', error);

        await socket.sendMessage(sender, {
            react: {
                text: '❌',
                key: msg.key
            }
        });

        await socket.sendMessage(
            sender,
            {
                text:
`❌ *SYSTEM ERROR*

${error.message || error}

> ${sessionConfig?.BOT_FOOTER || config?.BOT_FOOTER || 'ZESR MOVIE BOT'}`
            },
            {
                quoted: msg
            }
        );
    }

    break;
                        }

            
 case 'jid': {
    try {
        await socket.sendMessage(sender, {
            react: {
                text: '🆔',
                key: msg.key
            }
        });

        const contextInfo =
            msg.message?.extendedTextMessage?.contextInfo ||
            msg.message?.imageMessage?.contextInfo ||
            msg.message?.videoMessage?.contextInfo ||
            msg.message?.documentMessage?.contextInfo;

        let targetJid = null;
        let type = 'CHAT';

        // 1. Mentioned user
        if (contextInfo?.mentionedJid?.length) {
            targetJid = contextInfo.mentionedJid[0];
            type = 'MENTION';
        }

        // 2. Replied user
        else if (contextInfo?.quotedMessage && contextInfo?.participant) {
            targetJid = contextInfo.participant;
            type = 'REPLY';
        }

        // 3. Typed input
        else if (args?.length) {
            const input = args.join(' ').trim();

            // Group JID
            if (input.endsWith('@g.us')) {
                targetJid = input;
                type = 'GROUP';
            }

            // Newsletter / Channel JID
            else if (input.endsWith('@newsletter')) {
                targetJid = input;
                type = 'CHANNEL';
            }

            // LID
            else if (input.endsWith('@lid')) {
                targetJid = input;
                type = 'LID';
            }

            // Normal WhatsApp JID
            else if (input.includes('@s.whatsapp.net')) {
                targetJid = input;
                type = 'USER';
            }

            // Plain number
            else {
                const number = input.replace(/\D/g, '');

                if (number) {
                    targetJid = `${number}@s.whatsapp.net`;
                    type = 'NUMBER';
                }
            }
        }

        // 4. No input -> current chat JID
        if (!targetJid) {
            targetJid = sender;

            if (sender.endsWith('@g.us')) {
                type = 'GROUP';
            } else if (sender.endsWith('@newsletter')) {
                type = 'CHANNEL';
            } else if (sender.endsWith('@lid')) {
                type = 'LID';
            } else {
                type = 'USER';
            }
        }

        // Clean device suffix like :0 / :1 / :25
        if (targetJid.includes('@s.whatsapp.net')) {
            targetJid = jidNormalizedUser(targetJid);
        }

        targetJid = targetJid
            .replace(/:\d+@s\.whatsapp\.net$/, '@s.whatsapp.net')
            .replace(/:\d+@lid$/, '@lid');

        await socket.sendMessage(sender, {
            text:
`🆔 *JID INFO*

📌 *Type:* ${type}
🔗 *JID:* ${targetJid}

> ${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
        }, { quoted: msg });

    } catch (error) {
        console.error('JID Error:', error);

        await socket.sendMessage(sender, {
            text:
`❌ *JID ලබාගන්න බැරි වුණා.*

${error?.message || error}

> ${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
        }, { quoted: msg });
    }

    break;
}
case 'forward':
case 'fv': {
    if (!isOwner) {
        await socket.sendMessage(sender, {
            react: {
                text: '❌',
                key: msg.key
            }
        });

        return await socket.sendMessage(sender, {
            text: '❌ *Only the bot owner can use this command.*'
        }, { quoted: msg });
    }

    const DEFAULT_FOOTER =
        sessionConfig.BOT_FOOTER ||
        config.BOT_FOOTER ||
        'Zᴇꜱʀ ✘ 〽️ᴏᴠɪᴇ Bᴏᴛ';

    const from = sender;

    const quotedInfo =
        msg.message?.extendedTextMessage?.contextInfo ||
        msg.message?.imageMessage?.contextInfo ||
        msg.message?.videoMessage?.contextInfo ||
        msg.message?.documentMessage?.contextInfo ||
        msg.message?.audioMessage?.contextInfo;

    if (!quotedInfo?.quotedMessage) {
        return await socket.sendMessage(from, {
            text:
`❌ *Error: Reply to a image/file/message to forward!*

📝 *Format:*
.fv <targetJid1,targetJid2,targetJid3>

📌 *Examples:*
.fv 117978876096659@lid
.fv 120363408929003946@g.us,117978876096659@lid

> ${DEFAULT_FOOTER}`
        }, { quoted: msg });
    }

    const rawArgs = args.join(' ').trim();

    if (!rawArgs) {
        return await socket.sendMessage(from, {
            text:
`❌ *Please provide target JID(s)!*

📝 *Supported JIDs:*
@s.whatsapp.net
@lid
@g.us
@newsletter

📌 *Example:*
.fv 117978876096659@lid

> ${DEFAULT_FOOTER}`
        }, { quoted: msg });
    }

    const sleep = (ms) =>
        new Promise(resolve => setTimeout(resolve, ms));

    const removeForwardTag = (obj) => {
        if (!obj || typeof obj !== 'object') {
            return obj;
        }

        if (Array.isArray(obj)) {
            obj.forEach(removeForwardTag);
            return obj;
        }

        if (obj.contextInfo) {
            delete obj.contextInfo.isForwarded;
            delete obj.contextInfo.forwardingScore;
        }

        for (const key of Object.keys(obj)) {
            if (
                obj[key] &&
                typeof obj[key] === 'object'
            ) {
                removeForwardTag(obj[key]);
            }
        }

        return obj;
    };

    try {
        await socket.sendMessage(from, {
            react: {
                text: '📤',
                key: msg.key
            }
        });

        const parts = rawArgs.split('|');

        const targetPart =
            parts[0].trim();

        const customCaption =
            parts.length > 1
                ? parts.slice(1).join('|').trim()
                : null;

        const targets = [
            ...new Set(
                targetPart
                    .split(',')
                    .map(jid => jid.trim())
                    .filter(Boolean)
                    .map(jid => {
                        jid = jid.replace(
                            /:\d+@s\.whatsapp\.net$/,
                            '@s.whatsapp.net'
                        );

                        jid = jid.replace(
                            /:\d+@lid$/,
                            '@lid'
                        );

                        return jid;
                    })
                    .filter(jid =>
                        jid.endsWith('@g.us') ||
                        jid.endsWith('@s.whatsapp.net') ||
                        jid.endsWith('@lid') ||
                        jid.endsWith('@newsletter')
                    )
            )
        ];

        if (!targets.length) {
            throw new Error(
                'No valid target JIDs found'
            );
        }

        let quotedMsgObj =
            JSON.parse(
                JSON.stringify(
                    quotedInfo.quotedMessage
                )
            );

        quotedMsgObj =
            removeForwardTag(
                quotedMsgObj
            );

        if (
            quotedMsgObj.ephemeralMessage
                ?.message
        ) {
            quotedMsgObj =
                quotedMsgObj
                    .ephemeralMessage
                    .message;
        }

        const docMsg =
            quotedMsgObj.documentMessage ||
            quotedMsgObj
                .documentWithCaptionMessage
                ?.message
                ?.documentMessage;

        const imgMsg =
            quotedMsgObj.imageMessage;

        const vidMsg =
            quotedMsgObj.videoMessage;

        const audMsg =
            quotedMsgObj.audioMessage;

        const mediaObj =
            docMsg ||
            imgMsg ||
            vidMsg ||
            audMsg;

        let successful = 0;
        let failed = 0;
        const failedJids = [];

        for (
            let i = 0;
            i < targets.length;
            i++
        ) {
            const targetJid =
                targets[i];

            try {
                if (
                    customCaption &&
                    mediaObj
                ) {
                    const finalCaption =
                        `${customCaption}\n\n> ${DEFAULT_FOOTER}`;

                    let newMessageContent;

                    if (docMsg) {
                        newMessageContent = {
                            documentMessage: {
                                ...docMsg,
                                caption:
                                    finalCaption
                            }
                        };

                    } else if (imgMsg) {
                        newMessageContent = {
                            imageMessage: {
                                ...imgMsg,
                                caption:
                                    finalCaption
                            }
                        };

                    } else if (vidMsg) {
                        newMessageContent = {
                            videoMessage: {
                                ...vidMsg,
                                caption:
                                    finalCaption
                            }
                        };

                    } else {
                        newMessageContent = {
                            audioMessage: {
                                ...audMsg
                            }
                        };
                    }

                    removeForwardTag(
                        newMessageContent
                    );

                    const waMsg =
                        generateWAMessageFromContent(
                            targetJid,
                            newMessageContent,
                            {
                                userJid:
                                    socket.user.id
                            }
                        );

                    await socket.relayMessage(
                        targetJid,
                        waMsg.message,
                        {
                            messageId:
                                waMsg.key.id
                        }
                    );

                } else {
                    const cleanContent =
                        JSON.parse(
                            JSON.stringify(
                                quotedMsgObj
                            )
                        );

                    removeForwardTag(
                        cleanContent
                    );

                    const waMsg =
                        generateWAMessageFromContent(
                            targetJid,
                            cleanContent,
                            {
                                userJid:
                                    socket.user.id
                            }
                        );

                    await socket.relayMessage(
                        targetJid,
                        waMsg.message,
                        {
                            messageId:
                                waMsg.key.id
                        }
                    );
                }

                successful++;

            } catch (err) {
                failed++;
                failedJids.push(targetJid);

                console.error(
                    `Forward failed: ${targetJid}`,
                    err
                );
            }

            if (
                i <
                targets.length - 1
            ) {
                await sleep(5000);
            }
        }

        const total =
            targets.length;

        await socket.sendMessage(from, {
            react: {
                text:
                    successful > 0
                        ? '✅'
                        : '❌',
                key: msg.key
            }
        });

        let resultText =
`*${successful > 0 ? '✅' : '❌'} Forwarding Completed!*

▫ *Successful:* ${successful}
▫ *Failed:* ${failed}
▫ *Total Targets:* ${total}`;

        if (failedJids.length) {
            resultText +=
`\n\n⚠️ *Failed JIDs:*\n${failedJids.join('\n')}`;
        }

        resultText +=
`\n\n> ${DEFAULT_FOOTER}`;

        await socket.sendMessage(from, {
            text: resultText
        }, { quoted: msg });

    } catch (error) {
        console.error(
            'Forward command error:',
            error
        );

        await socket.sendMessage(from, {
            react: {
                text: '❌',
                key: msg.key
            }
        });

        await socket.sendMessage(from, {
            text:
`❌ *Forwarding Failed!*

_${error.message}_

> ${DEFAULT_FOOTER}`
        }, { quoted: msg });
    }

    break;
        }
/////////////Instagram///////////////



   case 'vv': {
    try {
        // 🔐 OWNER ONLY
        if (!isOwner) return;

        await socket.sendMessage(sender, {
            react: {
                text: '👀',
                key: msg.key
            }
        });

        const contextInfo =
            msg.message?.extendedTextMessage?.contextInfo ||
            msg.message?.imageMessage?.contextInfo ||
            msg.message?.videoMessage?.contextInfo;

        if (!contextInfo?.quotedMessage) {
            return await socket.sendMessage(sender, {
                text: '❌ *View Once photo/video එකකට reply කරලා `.vv`, 👀 හෝ 🤫 යවන්න.*'
            }, { quoted: msg });
        }

        let quoted = contextInfo.quotedMessage;

        // Ephemeral unwrap
        if (quoted.ephemeralMessage) {
            quoted = quoted.ephemeralMessage.message;
        }

        // View Once unwrap
        if (quoted.viewOnceMessageV2Extension) {
            quoted = quoted.viewOnceMessageV2Extension.message;
        }

        if (quoted.viewOnceMessageV2) {
            quoted = quoted.viewOnceMessageV2.message;
        }

        if (quoted.viewOnceMessage) {
            quoted = quoted.viewOnceMessage.message;
        }

        const image = quoted?.imageMessage;
        const video = quoted?.videoMessage;

        if (!image && !video) {
            return await socket.sendMessage(sender, {
                text: '❌ *මේක View Once photo/video එකක් නෙවෙයි.*'
            }, { quoted: msg });
        }

        const media = image || video;
        const type = image ? 'image' : 'video';

        const stream = await downloadContentFromMessage(media, type);

        let buffer = Buffer.from([]);

        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        if (!buffer.length) {
            throw new Error('Media download failed');
        }

        // =========================================
        // BOT CONNECTED NUMBER PRIVATE JID
        // =========================================
        let botPrivateJid = socket.user?.id;

        if (!botPrivateJid) {
            throw new Error('Bot private JID not found');
        }

        // Remove device suffix
        // 9477xxxxxxx:12@s.whatsapp.net
        // -> 9477xxxxxxx@s.whatsapp.net
        botPrivateJid = botPrivateJid.replace(/:\d+@/, '@');

        // If bot JID comes as LID, convert to PN JID
        if (
            botPrivateJid.endsWith('@lid') ||
            botPrivateJid.endsWith('@hosted.lid')
        ) {
            try {
                const pn = await socket.signalRepository
                    ?.lidMapping
                    ?.getPNForLID(botPrivateJid);

                if (pn) {
                    botPrivateJid = pn;
                }
            } catch (e) {
                console.log('Bot LID resolve error:', e.message);
            }
        }

        // =========================================
        // SEND VIEW ONCE MEDIA TO BOT PRIVATE CHAT
        // =========================================
        if (image) {
            await socket.sendMessage(botPrivateJid, {
                image: buffer,
                caption: image.caption || ''
            });
        } else {
            await socket.sendMessage(botPrivateJid, {
                video: buffer,
                caption: video.caption || '',
                mimetype: video.mimetype || 'video/mp4'
            });
        }

        // Success react
        await socket.sendMessage(sender, {
            react: {
                text: '✅',
                key: msg.key
            }
        });

   }  catch (error) {
        console.error('VV Error:', error);

        await socket.sendMessage(sender, {
            react: {
                text: '❌',
                key: msg.key
            }
        });
    }

    break;
            }
    }
      
            
      
    ////////////////////////////////////////////////////////////////////         
            } catch (error) {
            console.error('Command handler error:', error);
            await socket.sendMessage(sender, {
                text: `❌ ERROR\nAn error occurred: ${error.message}`,
            });
        }
    });
}
async function setupMessageHandlers(socket) {
    const messageHandler = async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

        const senderNumber = msg.key.participant ? msg.key.participant.split('@')[0] : msg.key.remoteJid.split('@')[0];
        const botNumber = jidNormalizedUser(socket.user.id).split('@')[0];
        const isReact = msg.message.reactionMessage;

        const sanitizedNumber = botNumber.replace(/[^0-9]/g, '');
        const sessionConfig = activeSockets.get(sanitizedNumber)?.config || config;

        if (sessionConfig.AUTO_TYPING === 'true') {
            try {
                await socket.sendPresenceUpdate('composing', msg.key.remoteJid);
            } catch (error) {
                
            }
        }

        if (sessionConfig.AUTO_RECORDING === 'true') {
            try {
                await socket.sendPresenceUpdate('recording', msg.key.remoteJid);
            } catch (error) {
               
            }
        }

        if (!isReact && senderNumber !== botNumber) {
            if (sessionConfig.AUTO_REACT === 'true') {
                const reactions = [
                    '❤', '💕', '😻', '🧡', '💛', '💚', '💙', '💜', '🖤', '❣', '💞', '💓', '💗',
                    '💖', '💘', '💝', '💟', '♥', '💌', '🙂', '🤗', '😌', '😉', '🤗', '😊',
                    '🎊', '🎉', '🎁', '🎈', '👋'
                ];
                const randomReaction = reactions[Math.floor(Math.random() * reactions.length)];

                await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 2000) + 1000));

                try {
                    await socket.sendMessage(msg.key.remoteJid, { react: { text: randomReaction, key: msg.key } });
                } catch (error) {
                    
                }
            }
        }
    };

    socket.ev.on('messages.upsert', messageHandler);
    return () => {
        socket.ev.off('messages.upsert', messageHandler);
       
    };
}

async function saveSession(number, creds) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        await Session.findOneAndUpdate(
            { number: sanitizedNumber },
            { creds, updatedAt: new Date() },
            { upsert: true }
        );
        const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);
        fs.ensureDirSync(sessionPath);
        fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(creds, null, 2));
        let numbers = [];
        if (fs.existsSync(NUMBER_LIST_PATH)) {
            numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
        }
        if (!numbers.includes(sanitizedNumber)) {
            numbers.push(sanitizedNumber);
            fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
        }
    } catch (error) {
      
    }
}

async function restoreSession(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const session = await Session.findOne({ number: sanitizedNumber });
        if (!session || !session.creds || !session.creds.me || !session.creds.me.id) {
            await deleteSession(sanitizedNumber);
            return null;
        }
        const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);
        fs.ensureDirSync(sessionPath);
        fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(session.creds, null, 2));
        return session.creds;
    } catch (error) {
        return null;
    }
}

async function deleteSession(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        await Session.deleteOne({ number: sanitizedNumber });
        const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);
        if (fs.existsSync(sessionPath)) {
            fs.removeSync(sessionPath);
        }
        if (fs.existsSync(NUMBER_LIST_PATH)) {
            let numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
            numbers = numbers.filter(n => n !== sanitizedNumber);
            fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
        }
    } catch (error) {
        
    }
}

async function loadUserConfig(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const configDoc = await Session.findOne({ number: sanitizedNumber }, 'config');
        return { ...config, ...configDoc?.config };
    } catch (error) {
        console.error(`Failed to load config for ${number}:`, error);
        return { ...config };
    }
}

async function updateUserConfig(number, newConfig) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        await Session.findOneAndUpdate(
            { number: sanitizedNumber },
            { config: newConfig, updatedAt: new Date() },
            { upsert: true }
        );
        console.log(`Updated config for ${sanitizedNumber}`);
    } catch (error) {
        console.error(`Failed to update config for ${sanitizedNumber}:`, error);
        throw error;
    }
} 
function setupAutoRestart(socket, number) {
    const sanitized = number.replace(/[^0-9]/g, '');

    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            reconnectingNumbers.delete(sanitized);
            console.log(`✅ Connection established for ${sanitized}`);
            return;
        }

        if (connection !== 'close') return;

        const statusCode =
            lastDisconnect?.error?.output?.statusCode ||
            lastDisconnect?.error?.statusCode ||
            lastDisconnect?.error?.data?.statusCode;

        // 401 means WhatsApp logged the device out. Reconnecting with the same
        // credentials will not help; a fresh pairing is required.
        if (statusCode === 401) {
            reconnectingNumbers.delete(sanitized);
            activeSockets.delete(sanitized);
            socketCreationTime.delete(sanitized);
            console.log(`❌ ${sanitized} logged out (401). Pair again.`);
            return;
        }

        // Prevent several connection.update events from starting parallel loops.
        if (reconnectingNumbers.has(sanitized)) return;
        reconnectingNumbers.add(sanitized);

        let attempt = 0;
        while (reconnectingNumbers.has(sanitized)) {
            attempt += 1;
            const waitMs = Math.min(5000 * attempt, 60000);
            console.log(`🔄 Reconnecting ${sanitized} in ${Math.round(waitMs / 1000)}s (attempt ${attempt})...`);

            await delay(waitMs);

            try {
                activeSockets.delete(sanitized);
                socketCreationTime.delete(sanitized);

                const mockRes = {
                    headersSent: false,
                    send: () => {},
                    status() { return this; }
                };

                await EmpirePair(sanitized, mockRes);
                // The new socket's 'open' event will clear reconnectingNumbers.
                // Give it time to connect before deciding whether to retry.
                await delay(15000);

                if (activeSockets.has(sanitized)) {
                    reconnectingNumbers.delete(sanitized);
                    console.log(`✅ Auto reconnect successful for ${sanitized}`);
                    break;
                }
            } catch (error) {
                console.error(`⚠️ Reconnect attempt ${attempt} failed for ${sanitized}:`, error?.message || error);
            }
        }
    });
}

async function EmpirePair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

    await restoreSession(sanitizedNumber);
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    try {
        const { version } = await fetchLatestBaileysVersion();
        const socket = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            version,
            browser: Browsers.macOS('Safari'),
        });

        socketCreationTime.set(sanitizedNumber, Date.now());
        setupCommandHandlers(socket, sanitizedNumber);
        setupAutoRestart(socket, sanitizedNumber);
        
        if (!socket.authState.creds.registered) {
            let retries = config.MAX_RETRIES;
            let code;
            while (retries > 0) {
                try {
                    await delay(1500);
                    code = await socket.requestPairingCode(sanitizedNumber);
                    break;
                } catch (error) {
                    retries--;
                    if (retries === 0) throw error;
                    await delay(2000 * (config.MAX_RETRIES - retries));
                }
            }
            if (!res.headersSent) res.send({ code });
        }
        socket.ev.on('creds.update', async () => {
            try {
                await saveCreds();
                const credsPath = path.join(sessionPath, 'creds.json');
                if (!fs.existsSync(credsPath)) return;
                const creds = JSON.parse(await fs.readFile(credsPath, 'utf8'));
                await saveSession(sanitizedNumber, creds);
            } catch (error) {
            }
        });
        socket.ev.on('connection.update', async (update) => {
            const { connection } = update;

            if (connection === 'open') {
                try {
                    await delay(3000);
                    await socket.sendPresenceUpdate('unavailable');
                    try {
                        const lidStore = socket.signalRepository.lidMapping;
                        const userJid = jidNormalizedUser(socket.user.id);

                        if (isPnUser(userJid)) {
                            const lid = await lidStore.getLIDForPN(userJid);
                            console.log(`✅ ${sanitizedNumber} → PN: ${userJid} → LID: ${lid}`);
                        }
                    } catch (lidError) {
                        console.log(`⚠️ LID mapping not available yet for ${sanitizedNumber}:`, lidError.message);
                    }

                    setInterval(() => {
                        socket.sendPresenceUpdate('unavailable').catch(() => {});
                    }, 30000);

                    const userJid = jidNormalizedUser(socket.user.id);
                    let sessionConfig = await loadUserConfig(sanitizedNumber);
                    activeSockets.set(sanitizedNumber, { socket, config: sessionConfig });

                    // Welcome Message
                    await socket.sendMessage(userJid, {
                        image: { url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE },
                        caption: formatMessage(
                            '✨ Bot Activated !',
                            `📱 *Number:* ${sanitizedNumber}
🕒 *Time:* ${getSriLankaTimestamp()}
🟢 *Status:* Online`,
                            'Simple & Clean 🐾                 ㅤㅤ    ㅤ © Zᴇꜱʀ ✘ 〽️ᴏᴠɪᴇ Bᴏᴛ ᴠ1.1'
                        )
                    });

                } catch (error) {
                    console.error(`Error in connection.open for ${sanitizedNumber}:`, error);
                    exec(`pm2 restart ${process.env.PM2_NAME || '{LAKIYA-{M𝙳-{F𝚁𝙴𝙴-{B𝙾𝚃-session'}`);
                }
            }
        });

    } catch (error) {
        console.error('Pairing/reconnect error:', error);
        socketCreationTime.delete(sanitizedNumber);
        if (!res.headersSent) res.status(503).send({ error: 'Service Unavailable' });
    }
}

router.get('/', async (req, res) => {
    const { number } = req.query;
    if (!number) {
        return res.status(400).send({ error: 'Number parameter is required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');

    if (activeSockets.has(sanitizedNumber)) {
        try {
            const oldSocket = activeSockets.get(sanitizedNumber);
            if (oldSocket && oldSocket.socket) {
                try {
                    await oldSocket.socket.logout();
                    oldSocket.socket.end();
                    oldSocket.socket.ws?.close();
                } catch (e) {
                    console.log('Socket close error:', e.message);
                }
            }
            activeSockets.delete(sanitizedNumber);
            socketCreationTime.delete(sanitizedNumber);
            await Session.deleteOne({ number: sanitizedNumber });
            const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);
            if (fs.existsSync(sessionPath)) {
                fs.removeSync(sessionPath);
            }
            if (fs.existsSync(NUMBER_LIST_PATH)) {
                let numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
                numbers = numbers.filter(n => n !== sanitizedNumber);
                fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
            }
            console.log(`✅ Old session removed for: ${sanitizedNumber} - Creating new pairing`);
        } catch (error) {
            console.error('Error removing old session:', error);
        }
    }

    await EmpirePair(number, res);
});

process.on('exit', () => {
    activeSockets.forEach((socket, number) => {
        socket.ws.close();
        activeSockets.delete(number);
        socketCreationTime.delete(number);
    });
    fs.emptyDirSync(SESSION_BASE_PATH);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    exec(`pm2 restart ${process.env.PM2_NAME || '{test-{md-{mini-{bot-session'}`);
});

export default router;
    
      
