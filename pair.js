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
    makeWASocket,
    useMultiFileAuthState,
    delay,
    Browsers,
    fetchLatestBaileysVersion,
    downloadContentFromMessage,
    downloadMediaMessage,
    generateWAMessageFromContent,
    jidNormalizedUser,
    isPnUser,
    DisconnectReason
} from '@itsliaaa/baileys';
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
    creds: { type: Object, default: {} },
    // Full useMultiFileAuthState snapshot. On Heroku, saving only creds.json
    // is not enough because Signal/pre-key/session files are also required.
    authFiles: [{
        name: { type: String, required: true },
        data: { type: String, required: true }
    }],
    config: { type: Object },
    updatedAt: { type: Date, default: Date.now }
}, { minimize: false });
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
            try {
                const parsed = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
                numbers = Array.isArray(parsed) ? parsed : [];
            } catch (_) {
                numbers = [];
            }
            console.log(`Loaded ${numbers.length} numbers from numbers.json`);
        } else {
            console.warn('No numbers.json found, checking MongoDB for sessions...');
        }

        // Only reconnect sessions that contain the full auth snapshot. Legacy
        // creds-only records from the old build need one fresh pairing.
        const sessions = await Session.find({ 'authFiles.0': { $exists: true } }, 'number').lean();
        const mongoNumbers = sessions.map(s => s.number);
        console.log(`Found ${mongoNumbers.length} complete MongoDB sessions`);

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
                await EmpirePair(number, null, { pairing: false });
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

    // IMPORTANT: activeSockets must contain only sockets that actually reached
    // connection === 'open'. Marking a socket active here caused false reconnect
    // success and could make the pairing route log out a still-starting socket.
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
try {
    const IG_CHANNEL_INVITE =
        '0029VbBEDft3AzNTaN02u739';

    const SAVEAPI_KEY =
        'sk_live_L6bsg0POp56mAejEJizKOQV4OR0Epl2ysaUCKJob';

    const igRegex =
        /https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|reels|tv)\/[A-Za-z0-9_-]+(?:\/)?(?:\?[^\s]*)?/i;

    const igMatch =
        typeof text === 'string'
            ? text.match(igRegex)
            : null;

    // Creator ගෙන් Instagram link එකක් ආවොත් විතරයි
    if (isCreator && igMatch) {

        const igUrl =
            igMatch[0].trim();

        // =====================================
        // REACT
        // =====================================

        try {
            await socket.sendMessage(
                sender,
                {
                    react: {
                        text: '⏳',
                        key: msg.key
                    }
                }
            );
        } catch (_) {}


        // =====================================
        // GET CHANNEL JID
        // =====================================

        const channelMeta =
            await socket.newsletterMetadata(
                'invite',
                IG_CHANNEL_INVITE
            );

        const channelJid =
            channelMeta?.id;


        console.log(
            'IG CHANNEL JID:',
            channelJid
        );


        if (
            !channelJid ||
            !String(channelJid)
                .endsWith('@newsletter')
        ) {
            throw new Error(
                'WhatsApp Channel not found'
            );
        }


        // =====================================
        // SAVEAPI
        // =====================================

        const res = await axios.get(
            'https://api.saveapi.org/v1/download',
            {
                params: {
                    url: igUrl
                },

                headers: {
                    Authorization:
                        `Bearer ${SAVEAPI_KEY}`
                },

                timeout: 45000
            }
        );


        const apiData =
            res.data || {};


        console.log(
            'SAVEAPI IG RESPONSE:',
            JSON.stringify(
                apiData,
                null,
                2
            )
        );


        if (
            apiData.success === false
        ) {
            throw new Error(
                apiData?.error?.message ||
                apiData?.error?.code ||
                'SaveAPI error'
            );
        }


        // SaveAPI docs:
        // carousel => medias[]
        const medias =
            Array.isArray(
                apiData.medias
            )
                ? apiData.medias
                : [];


        console.log(
            'IG TOTAL MEDIA:',
            medias.length
        );


        // =====================================
        // PHOTOS ONLY
        // =====================================

        const imageMedias =
            medias.filter(item => {

                if (!item?.url) {
                    return false;
                }

                return (
                    String(
                        item.type || ''
                    )
                        .toLowerCase() ===
                    'image'
                );
            });


        console.log(
            'IG IMAGE COUNT:',
            imageMedias.length
        );


        if (!imageMedias.length) {

            console.log(
                'NO INSTAGRAM PHOTOS FOUND'
            );

            try {
                await socket.sendMessage(
                    sender,
                    {
                        react: {
                            text: '⚠️',
                            key: msg.key
                        }
                    }
                );
            } catch (_) {}

            return;
        }


        // =====================================
        // FETCH + CONVERT PHOTOS
        // =====================================

        const photos = [];


        for (
            let i = 0;
            i < imageMedias.length;
            i++
        ) {

            const item =
                imageMedias[i];

            try {

                const mediaUrl =
                    String(item.url)
                        .replace(
                            /&amp;/g,
                            '&'
                        )
                        .trim();


                console.log(
                    `FETCH IG PHOTO ${i + 1}/${imageMedias.length}`
                );


                const fileRes =
                    await axios.get(
                        mediaUrl,
                        {
                            responseType:
                                'arraybuffer',

                            timeout:
                                60000,

                            maxContentLength:
                                Infinity,

                            maxBodyLength:
                                Infinity,

                            headers: {
                                'User-Agent':
                                    'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/125 Mobile Safari/537.36',

                                'Accept':
                                    'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
                            }
                        }
                    );


                const originalBuffer =
                    Buffer.from(
                        fileRes.data
                    );


                console.log(
                    `IG PHOTO ${i + 1} ORIGINAL SIZE:`,
                    originalBuffer.length
                );


                if (
                    originalBuffer.length <
                    5000
                ) {
                    console.log(
                        `IG PHOTO ${i + 1} TOO SMALL`
                    );

                    continue;
                }


                // =================================
                // CONVERT EVERYTHING TO JPEG
                // =================================

                const jpegBuffer =
                    await sharp(
                        originalBuffer
                    )
                        .rotate()
                        .jpeg({
                            quality: 92,
                            mozjpeg: true
                        })
                        .toBuffer();


                console.log(
                    `IG PHOTO ${i + 1} JPEG SIZE:`,
                    jpegBuffer.length
                );


                photos.push(
                    jpegBuffer
                );


            } catch (photoErr) {

                console.error(
                    `IG PHOTO ${i + 1} FETCH/CONVERT ERROR:`,
                    photoErr?.response?.data ||
                    photoErr?.message ||
                    photoErr
                );
            }
        }


        // =====================================
        // NOTHING DOWNLOADED
        // =====================================

        if (!photos.length) {

            try {
                await socket.sendMessage(
                    sender,
                    {
                        react: {
                            text: '❌',
                            key: msg.key
                        }
                    }
                );
            } catch (_) {}

            console.log(
                'IG: ALL PHOTO DOWNLOADS FAILED'
            );

            return;
        }


        // =====================================
        // SEND PHOTOS TO CHANNEL
        //
        // IMPORTANT:
        // NO ALBUM MESSAGE
        // SEND EACH IMAGE DIRECTLY
        // =====================================

        let sentCount = 0;


        for (
            let i = 0;
            i < photos.length;
            i++
        ) {

            try {

                console.log(
                    `SENDING IG PHOTO ${i + 1}/${photos.length} -> ${channelJid}`
                );


                const sent =
                    await socket.sendMessage(
                        channelJid,
                        {
                            image:
                                photos[i]
                        }
                    );


                console.log(
                    `IG PHOTO ${i + 1} SENT:`,
                    sent?.key?.id ||
                    'OK'
                );


                sentCount++;


                // Newsletter spam/rate-limit
                // අඩු කරන්න delay එකක්
                await new Promise(
                    resolve =>
                        setTimeout(
                            resolve,
                            1200
                        )
                );


            } catch (sendErr) {

                console.error(
                    `IG CHANNEL PHOTO ${i + 1} SEND ERROR:`,
                    sendErr?.output?.payload ||
                    sendErr?.message ||
                    sendErr
                );
            }
        }


        // =====================================
        // IF ALL CHANNEL IMAGE SENDS FAILED
        // =====================================

        if (!sentCount) {

            throw new Error(
                'Photos downloaded successfully but WhatsApp Channel image sending failed'
            );
        }


        // =====================================
        // CREATE POST TITLE
        // =====================================

        let postText =
            apiData?.meta?.caption ||
            apiData?.meta?.title ||
            apiData?.meta?.author ||
            apiData?.caption ||
            'Wallpapers';


        postText =
            String(postText)

                // links remove
                .replace(
                    /https?:\/\/\S+/gi,
                    ''
                )

                // hashtags remove
                .replace(
                    /#\S+/g,
                    ''
                )

                // spaces clean
                .replace(
                    /\s+/g,
                    ' '
                )

                .trim();


        if (!postText) {
            postText =
                'Wallpapers';
        }


        if (
            postText.length > 70
        ) {

            postText =
                postText
                    .slice(
                        0,
                        67
                    )
                    .trim() +
                '...';
        }


        postText =
            postText
                .replace(
                    /\*/g,
                    ''
                )
                .replace(
                    /_/g,
                    ''
                )
                .replace(
                    /~/g,
                    ''
                );


        // =====================================
        // TEXT AFTER PHOTOS
        // =====================================

        await socket.sendMessage(
            channelJid,
            {
                text:
                    `🖼️ *${postText}* 👆`
            }
        );


        // =====================================
        // SUCCESS
        // =====================================

        try {

            await socket.sendMessage(
                sender,
                {
                    react: {
                        text: '✅',
                        key: msg.key
                    }
                }
            );

        } catch (_) {}


        console.log(
            `AUTO IG SUCCESS: ${sentCount}/${photos.length} photo(s) -> ${channelJid}`
        );


        return;
    }


} catch (err) {

    console.error(
        'AUTO INSTAGRAM ERROR:',
        err?.response?.data ||
        err?.output?.payload ||
        err?.message ||
        err
    );


    try {

        await socket.sendMessage(
            sender,
            {
                react: {
                    text: '❌',
                    key: msg.key
                }
            }
        );

    } catch (_) {}


    if (
        typeof isCreator !==
            'undefined' &&
        isCreator
    ) {

        try {

            await socket.sendMessage(
                sender,
                {
                    text:
`❌ *Instagram Auto Send Error*

${err?.response?.data?.error?.message ||
err?.response?.data?.message ||
err?.message ||
'Unknown Error'}`
                },
                {
                    quoted: msg
                }
            );

        } catch (_) {}
    }


    return;
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
            case 'sinhalasub': {
    // =====================================================
    // OWNER + CREATOR ONLY
    // =====================================================
    if (!isOwner && !isCreator) {
        return await socket.sendMessage(sender, {
            text: '❌ *Only Owner & Creator Can Use This Command*'
        }, { quoted: msg });
    }

    // =====================================================
    // API
    // =====================================================
    const API_BASE = 'https://zara.laksidu.site';
    const API_KEY = config.API_KEY;

    const BOT_IMAGE =
        sessionConfig.BOT_IMAGE ||
        config.BOT_IMAGE;

    const BOT_FOOTER =
        sessionConfig.BOT_FOOTER ||
        config.BOT_FOOTER;

    const MOVIE_FOOTER =
        sessionConfig.MOVIE_FOOTER ||
        config.MOVIE_FOOTER;

    // =====================================================
    // USAGE
    // =====================================================
    if (!args.length) {
        await socket.sendMessage(sender, {
            image: {
                url: BOT_IMAGE
            },

            caption: formatMessage(
                '❌ ERROR',

                `*කරුණාකර චිත්‍රපටයේ නම ලබාදෙන්න!*

*උදා:* \`.sinhalasub spider\``,

                BOT_FOOTER
            )
        }, {
            quoted: msg
        });

        break;
    }

    const movieQuery55 =
        args.join(' ').trim();

    // =====================================================
    // LISTENERS
    // =====================================================
    let sinhalasubSelectionListener = null;
    let sinhalasubDownloadListener = null;

    let sinhalasubSelectionTimeout = null;
    let sinhalasubDownloadTimeout = null;
    let sinhalasubMasterTimeout = null;

    // =====================================================
    // CLEANUP
    // =====================================================
    const clearAllSinhalasubListeners = () => {

        if (sinhalasubSelectionListener) {
            socket.ev.off(
                'messages.upsert',
                sinhalasubSelectionListener
            );

            sinhalasubSelectionListener = null;
        }

        if (sinhalasubDownloadListener) {
            socket.ev.off(
                'messages.upsert',
                sinhalasubDownloadListener
            );

            sinhalasubDownloadListener = null;
        }

        if (sinhalasubSelectionTimeout) {
            clearTimeout(
                sinhalasubSelectionTimeout
            );

            sinhalasubSelectionTimeout = null;
        }

        if (sinhalasubDownloadTimeout) {
            clearTimeout(
                sinhalasubDownloadTimeout
            );

            sinhalasubDownloadTimeout = null;
        }

        if (sinhalasubMasterTimeout) {
            clearTimeout(
                sinhalasubMasterTimeout
            );

            sinhalasubMasterTimeout = null;
        }
    };

    // =====================================================
    // ARRAY / STRING FORMATTER
    // =====================================================
    const cleanList = (
        value,
        limit = 4
    ) => {

        if (Array.isArray(value)) {
            const items =
                value
                    .filter(Boolean)
                    .slice(0, limit);

            return (
                items.join(', ') ||
                'N/A'
            );
        }

        return (
            String(
                value || ''
            ).trim() ||
            'N/A'
        );
    };

    try {
        // =================================================
        // SEARCH
        // =================================================
        const searchResponse =
            await axios.get(
                `${API_BASE}/sinhalasub/search`,
                {
                    params: {
                        query:
                            movieQuery55,

                        api_key:
                            API_KEY
                    },

                    timeout:
                        30000
                }
            );

        const searchData =
            searchResponse?.data || {};

        let movies =
            searchData?.data?.results ||
            searchData?.results ||
            [];

        if (
            !Array.isArray(movies)
        ) {
            movies = [];
        }

        if (
            !searchData?.status ||
            !movies.length
        ) {
            await socket.sendMessage(sender, {
                image: {
                    url: BOT_IMAGE
                },

                caption: formatMessage(
                    '❌ NO RESULTS',

                    '*චිත්‍රපට හමු වුණේ නැහැ! 😞*',

                    BOT_FOOTER
                )
            }, {
                quoted: msg
            });

            break;
        }

        movies =
            movies.slice(0, 115);

        // =================================================
        // SEARCH LIST
        // =================================================
        let listText =
`🎀 *𝗦𝗘𝗔𝗥𝗖𝗛 : _${movieQuery55}_*

╭──────●➤
*🔢 ʀᴇᴘʟʏ ʙᴇʟᴏᴡ ɴᴜᴍʙᴇʀ*
╰──────────●➤
╭──────●➤
`;

        movies.forEach(
            (movie, index) => {

                listText +=
`*🧩 ${index + 1} ┃❭❭ ${movie?.title || 'Unknown'}*
`;
            }
        );

        listText +=
`╰──────────●➤

> ${MOVIE_FOOTER}`;

        const sentMsg =
            await socket.sendMessage(
                sender,
                {
                    image: {
                        url: BOT_IMAGE
                    },

                    caption:
                        listText
                },
                {
                    quoted: msg
                }
            );

        const messageID =
            sentMsg.key.id;

        // =================================================
        // SILENT MASTER TIMEOUT
        // =================================================
        sinhalasubMasterTimeout =
            setTimeout(
                () => {
                    clearAllSinhalasubListeners();
                },
                180000
            );

        // =================================================
        // MOVIE SELECTION
        // =================================================
        const handleSelection =
            async ({
                messages:
                    replyMessages
            }) => {

                const replyMek =
                    replyMessages?.[0];

                if (
                    !replyMek?.message
                ) {
                    return;
                }

                if (
                    replyMek.key
                        .remoteJid !==
                    sender
                ) {
                    return;
                }

                const context =
                    replyMek.message
                        ?.extendedTextMessage
                        ?.contextInfo;

                const isReplyToSentMsg =
                    context?.stanzaId ===
                    messageID;

                if (
                    !isReplyToSentMsg
                ) {
                    return;
                }

                const messageType =
                    replyMek.message
                        ?.conversation ||
                    replyMek.message
                        ?.extendedTextMessage
                        ?.text ||
                    '';

                const choice =
                    parseInt(
                        messageType.trim(),
                        10
                    ) - 1;

                if (
                    Number.isNaN(choice) ||
                    choice < 0 ||
                    choice >= movies.length
                ) {
                    await socket.sendMessage(
                        sender,
                        {
                            text:
`❌ *INVALID SELECTION*

*1-${movies.length} අතර අංකයක් තෝරන්න.*`
                        },
                        {
                            quoted:
                                replyMek
                        }
                    );

                    return;
                }

                // Valid reply ලැබුණම search listener remove
                if (
                    sinhalasubSelectionListener
                ) {
                    socket.ev.off(
                        'messages.upsert',
                        sinhalasubSelectionListener
                    );

                    sinhalasubSelectionListener =
                        null;
                }

                if (
                    sinhalasubSelectionTimeout
                ) {
                    clearTimeout(
                        sinhalasubSelectionTimeout
                    );

                    sinhalasubSelectionTimeout =
                        null;
                }

                const selectedMovie =
                    movies[choice];

                const selectedMovieUrl =
                    selectedMovie?.url ||
                    selectedMovie?.link ||
                    selectedMovie?.href;

                if (!selectedMovieUrl) {
                    await socket.sendMessage(
                        sender,
                        {
                            text:
                                '❌ *Movie URL Not Found*'
                        },
                        {
                            quoted:
                                replyMek
                        }
                    );

                    clearAllSinhalasubListeners();

                    return;
                }

                await socket.sendMessage(
                    sender,
                    {
                        text:
                            '📽️ *Fetching movie details...*'
                    },
                    {
                        quoted:
                            replyMek
                    }
                );

                try {
                    // =====================================
                    // MOVIE INFO
                    // =====================================
                    const infoResponse =
                        await axios.get(
                            `${API_BASE}/sinhalasub/info`,
                            {
                                params: {
                                    url:
                                        selectedMovieUrl,

                                    api_key:
                                        API_KEY
                                },

                                timeout:
                                    30000
                            }
                        );

                    const infoData =
                        infoResponse?.data ||
                        {};

                    if (
                        !infoData?.status ||
                        !infoData?.data
                    ) {
                        throw new Error(
                            'Failed to fetch movie details'
                        );
                    }

                    const movieInfo =
                        infoData?.data
                            ?.movie ||
                        {};

                    let downloads =
                        infoData?.data
                            ?.downloads ||
                        [];

                    if (
                        !Array.isArray(
                            downloads
                        )
                    ) {
                        downloads = [];
                    }

                    // =====================================
                    // PIXELDRAIN ONLY
                    // =====================================
                    const videoDownloads =
                        downloads.filter(
                            d => {

                                const server =
                                    String(
                                        d?.server ||
                                        ''
                                    ).toLowerCase();

                                return (
                                    d &&
                                    server ===
                                        'pixeldrain' &&
                                    (
                                        d.link_page ||
                                        d.url
                                    )
                                );
                            }
                        );

                    if (
                        !videoDownloads.length
                    ) {
                        await socket.sendMessage(
                            sender,
                            {
                                image: {
                                    url:
                                        movieInfo
                                            ?.poster ||
                                        selectedMovie
                                            ?.poster ||
                                        BOT_IMAGE
                                },

                                caption:
                                    formatMessage(
                                        '❌ NO DOWNLOADS',

                                        '*Pixeldrain download links හමු වුණේ නැහැ!*',

                                        BOT_FOOTER
                                    )
                            },
                            {
                                quoted:
                                    replyMek
                            }
                        );

                        clearAllSinhalasubListeners();

                        return;
                    }

                    // =====================================
                    // CLEAN DETAILS
                    // =====================================
                    const title =
                        movieInfo?.title ||
                        selectedMovie
                            ?.title ||
                        'Unknown Movie';

                    const year =
                        movieInfo?.year ||
                        'N/A';

                    const ratingRaw =
                        movieInfo?.rating ||
                        movieInfo
                            ?.imdb_rating ||
                        'N/A';

                    const rating =
                        ratingRaw ===
                            'N/A'
                            ? 'N/A'
                            : String(
                                ratingRaw
                            ).includes('/10')
                                ? ratingRaw
                                : `${ratingRaw}/10`;

                    const runtime =
                        movieInfo?.runtime ||
                        'N/A';

                    const language =
                        cleanList(
                            movieInfo
                                ?.language,
                            3
                        );

                    const genres =
                        cleanList(
                            movieInfo
                                ?.genres,
                            4
                        );

                    const director =
                        cleanList(
                            movieInfo
                                ?.director,
                            2
                        );

                    const subtitle =
                        movieInfo
                            ?.subtitle
                            ?.author ||
                        'Sinhala';

                    let description =
                        String(
                            movieInfo
                                ?.description ||
                            ''
                        ).trim();

                    if (!description) {
                        description =
                            'No description available.';
                    }

                    if (
                        description.length >
                        220
                    ) {
                        description =
                            description
                                .substring(
                                    0,
                                    220
                                )
                                .trim() +
                            '...';
                    }

                    // =====================================
                    // CLEAN DETAILS CARD
                    // =====================================
                    const detailsCaption =
                        formatMessage(
                            `🎬 ${title}`,

`📅 *Year:* ${year}
⭐ *IMDb:* ${rating}
⏳ *Runtime:* ${runtime}
🔊 *Language:* ${language}
🎭 *Genres:* ${genres}
🎬 *Director:* ${director}
📝 *Subtitle:* ${subtitle}

📖 *Story:*
${description}

🔗 ${sessionConfig.MGROUP_LINK || config.MGROUP_LINK}`,

                            MOVIE_FOOTER
                        );

                    const infoMsg =
                        await socket.sendMessage(
                            sender,
                            {
                                image: {
                                    url:
                                        movieInfo
                                            ?.poster ||
                                        selectedMovie
                                            ?.poster ||
                                        BOT_IMAGE
                                },

                                caption:
                                    detailsCaption
                            },
                            {
                                quoted:
                                    replyMek
                            }
                        );

                    // =====================================
                    // DOWNLOAD OPTIONS
                    // =====================================
                    const downloadOptionsText =
`⬇️ *DOWNLOAD OPTIONS*

${videoDownloads.map(
    (d, i) =>
        `*${i + 1}.* 📥 ${d?.quality || 'Unknown'}${d?.size ? ` • ${d.size}` : ''}`
).join('\n')}

🔢 *Reply with number*

> ${BOT_FOOTER}`;

                    const downloadMsg =
                        await socket.sendMessage(
                            sender,
                            {
                                text:
                                    downloadOptionsText
                            },
                            {
                                quoted:
                                    infoMsg
                            }
                        );

                    const infoMsgID =
                        downloadMsg
                            .key.id;

                    /// =====================================
// DOWNLOAD SELECTION
// =====================================
const handleDownload = async ({
    messages: downloadMessages
}) => {

    const downloadMek =
        downloadMessages?.[0];

    if (!downloadMek?.message) {
        return;
    }

    if (
        downloadMek.key.remoteJid !==
        sender
    ) {
        return;
    }

    const downloadContext =
        downloadMek.message
            ?.extendedTextMessage
            ?.contextInfo;

    const isReplyToInfoMsg =
        downloadContext?.stanzaId ===
        infoMsgID;

    if (!isReplyToInfoMsg) {
        return;
    }

    const downloadChoice =
        downloadMek.message
            ?.conversation ||
        downloadMek.message
            ?.extendedTextMessage
            ?.text ||
        '';

    const choiceNum =
        parseInt(
            downloadChoice.trim(),
            10
        ) - 1;

    if (
        Number.isNaN(choiceNum) ||
        choiceNum < 0 ||
        choiceNum >=
            videoDownloads.length
    ) {
        await socket.sendMessage(
            sender,
            {
                text:
`❌ *INVALID SELECTION*

*1-${videoDownloads.length} අතර අංකයක් තෝරන්න.*`
            },
            {
                quoted:
                    downloadMek
            }
        );

        return;
    }

    // Valid selection ලැබුණම listener remove
    if (
        sinhalasubDownloadListener
    ) {
        socket.ev.off(
            'messages.upsert',
            sinhalasubDownloadListener
        );

        sinhalasubDownloadListener =
            null;
    }

    if (
        sinhalasubDownloadTimeout
    ) {
        clearTimeout(
            sinhalasubDownloadTimeout
        );

        sinhalasubDownloadTimeout =
            null;
    }

    const selectedDownload =
        videoDownloads[
            choiceNum
        ];

    const linkPage =
        selectedDownload
            ?.link_page ||
        selectedDownload
            ?.url;

    if (!linkPage) {
        await socket.sendMessage(
            sender,
            {
                text:
                    '❌ *Download Link Not Found*'
            },
            {
                quoted:
                    downloadMek
            }
        );

        clearAllSinhalasubListeners();

        return;
    }

    await socket.sendMessage(
        sender,
        {
            text:
`⏳ *Getting ${selectedDownload?.quality || 'movie'} download link...*`
        },
        {
            quoted:
                downloadMek
        }
    );

    try {
        // =================================
        // FINAL DOWNLOAD URL
        // =================================
        const downloadResponse =
            await axios.get(
                `${API_BASE}/sinhalasub/download2`,
                {
                    params: {
                        url:
                            linkPage,

                        api_key:
                            API_KEY
                    },

                    timeout:
                        30000
                }
            );

        const downloadData =
            downloadResponse.data;

        if (
            !downloadData?.status ||
            !downloadData?.data?.download
        ) {
            throw new Error(
                'Failed to get download URL'
            );
        }

        const finalDownloadUrl =
            downloadData
                .data
                .download;

        const fileInfo =
            downloadData
                ?.data
                ?.file_info ||
            {};

        // =================================
        // CLEAN FILE NAME
        // =================================
        const safeTitle =
            String(
                title ||
                movieInfo?.title ||
                selectedMovie?.title ||
                'Movie'
            )
                .replace(
                    /[\\/:*?"<>|]/g,
                    ''
                )
                .replace(
                    /\s+/g,
                    ' '
                )
                .trim();

        let fileName =
            fileInfo?.name ||
            `${safeTitle}.mp4`;

        fileName =
            String(fileName)
                .replace(
                    /[\\/:*?"<>|]/g,
                    ''
                )
                .replace(
                    /\s+/g,
                    ' '
                )
                .trim();

        if (
            !/\.[a-z0-9]{2,5}$/i
                .test(fileName)
        ) {
            fileName += '.mp4';
        }

        const mimeType =
            fileInfo?.mimeType ||
            fileInfo?.mimetype ||
            'video/mp4';

        // =================================
        // THUMBNAIL
        // =================================
        const thumbUrl =
            movieInfo?.poster ||
            selectedMovie?.poster ||
            BOT_IMAGE;

        let thumbBuffer;

        try {
            const thumbResponse =
                await axios.get(
                    thumbUrl,
                    {
                        responseType:
                            'arraybuffer',

                        timeout:
                            15000
                    }
                );

            thumbBuffer =
                await sharp(
                    Buffer.from(
                        thumbResponse.data
                    )
                )
                    .resize(
                        200,
                        200,
                        {
                            fit:
                                'cover'
                        }
                    )
                    .jpeg({
                        quality:
                            70
                    })
                    .toBuffer();

        } catch (
            thumbError
        ) {
            console.error(
                'Thumbnail error:',
                thumbError?.message
            );

            thumbBuffer =
                undefined;
        }

        // =================================
        // DOWNLOAD REACT
        // =================================
        await socket.sendMessage(
            sender,
            {
                react: {
                    text:
                        '📥',

                    key:
                        downloadMek.key
                }
            }
        );

        // =================================
        // SEND MOVIE DOCUMENT
        // NO CAPTION
        // =================================
        await socket.sendMessage(
    sender,
    {
        document: {
            url: finalDownloadUrl
        },

        mimetype: mimeType,

        fileName: fileName,

        jpegThumbnail: thumbBuffer,

        caption:
`*☘️ ${movieInfo.title || selectedMovie.title || 'Movie'}*

[\` Quality = ${selectedDownload.quality || 'Unknown'} \`]

> ${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
    },
    {
        quoted: downloadMek
    }
);

        // =================================
        // SUCCESS REACT
        // =================================
        await socket.sendMessage(
            sender,
            {
                react: {
                    text:
                        '✅',

                    key:
                        downloadMek.key
                }
            }
        );

        clearAllSinhalasubListeners();

    } catch (
        downloadError
    ) {
        console.error(
            'Sinhalasub download error:',
            downloadError
                ?.response
                ?.data ||
            downloadError
                ?.message ||
            downloadError
        );

        await socket.sendMessage(
            sender,
            {
                image: {
                    url:
                        BOT_IMAGE
                },

                caption:
                    formatMessage(
                        '❌ DOWNLOAD ERROR',

                        `*Download link එක ලබාගැනීමේ දෝෂයක්.*

${downloadError?.response?.data?.message ||
downloadError?.response?.data?.error ||
downloadError?.message ||
'Unknown error'}`,

                        BOT_FOOTER
                    )
            },
            {
                quoted:
                    downloadMek
            }
        );

        clearAllSinhalasubListeners();
    }
};

sinhalasubDownloadListener =
    handleDownload;

socket.ev.on(
    'messages.upsert',
    sinhalasubDownloadListener
);

// =====================================
// SILENT DOWNLOAD TIMEOUT
// =====================================
sinhalasubDownloadTimeout =
    setTimeout(
        () => {
            if (
                sinhalasubDownloadListener
            ) {
                socket.ev.off(
                    'messages.upsert',
                    sinhalasubDownloadListener
                );

                sinhalasubDownloadListener =
                    null;
            }

            sinhalasubDownloadTimeout =
                null;
        },
        120000
    );

} catch (
    infoError
) {
    console.error(
        'Sinhalasub info error:',
        infoError
            ?.response
            ?.data ||
        infoError
            ?.message ||
        infoError
    );

    await socket.sendMessage(
        sender,
        {
            image: {
                url:
                    BOT_IMAGE
            },

            caption:
                formatMessage(
                    '❌ ERROR',

                    `*Movie details ලබාගැනීමේ දෝෂයක්.*

${infoError?.response?.data?.message ||
infoError?.response?.data?.error ||
infoError?.message ||
'Unknown error'}`,

                    BOT_FOOTER
                )
        },
        {
            quoted:
                replyMek
        }
    );

    clearAllSinhalasubListeners();
}

};

sinhalasubSelectionListener =
    handleSelection;

socket.ev.on(
    'messages.upsert',
    sinhalasubSelectionListener
);

// =====================================
// SILENT SEARCH SELECTION TIMEOUT
// =====================================
sinhalasubSelectionTimeout =
    setTimeout(
        () => {
            if (
                sinhalasubSelectionListener
            ) {
                socket.ev.off(
                    'messages.upsert',
                    sinhalasubSelectionListener
                );

                sinhalasubSelectionListener =
                    null;
            }

            sinhalasubSelectionTimeout =
                null;
        },
        120000
    );

} catch (error) {
    console.error(
        'Sinhalasub command error:',
        error?.response?.data ||
        error?.message ||
        error
    );

    clearAllSinhalasubListeners();

    await socket.sendMessage(
        sender,
        {
            image: {
                url:
                    BOT_IMAGE
            },

            caption:
                formatMessage(
                    '❌ ERROR',

                    `*දෝෂයක් ඇතිවුණා.*

${error?.response?.data?.message ||
error?.response?.data?.error ||
error?.message ||
'Unknown error'}`,

                    BOT_FOOTER
                )
        },
        {
            quoted:
                msg
        }
    );
}

break;
}
            case 'instagram':
case 'ig': {
    const FOOTER = `\n\n> 📥 𝗭𝗘𝗦𝗥 𝗜𝗚 𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗥`;

    if (!args.length) {
        await socket.sendMessage(sender, {
            text:
`📸 *INSTAGRAM DOWNLOADER*

Instagram Post / Carousel / Reel link එකක් දෙන්න.

*Example:*
.ig https://www.instagram.com/p/XXXXXXXX/
.ig https://www.instagram.com/reel/XXXXXXXX/${FOOTER}`
        }, { quoted: msg });
        break;
    }

    const input = args.join(' ').trim();

    const match = input.match(
        /https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|reels|tv)\/[A-Za-z0-9_-]+(?:\/)?(?:\?[^\s]*)?/i
    );

    if (!match) {
        await socket.sendMessage(sender, {
            text: `❌ *Invalid Instagram URL*${FOOTER}`
        }, { quoted: msg });
        break;
    }

    let igUrl = match[0].trim();

    // Share params තිබුණත් full URL එක යවන්න
    if (!igUrl.endsWith('/')) {
        igUrl += '/';
    }

    const API_URL = 'https://api.saveapi.org/v1/download';
    const API_KEY = 'sk_live_L6bsg0POp56mAejEJizKOQV4OR0Epl2ysaUCKJob'; // <-- මෙතන ඔයාගේ SaveAPI key එක දාන්න

    try {
        await socket.sendMessage(sender, {
            react: {
                text: '⏳',
                key: msg.key
            }
        });

        const res = await axios.get(API_URL, {
            params: {
                url: igUrl
            },
            headers: {
                Authorization: `Bearer ${API_KEY}`
            },
            timeout: 45000
        });

        console.log(
            'SAVEAPI RAW RESPONSE:',
            JSON.stringify(res.data, null, 2)
        );

        const body = res.data || {};

        let rawMedia =
            body.medias ||
            body.data?.medias ||
            body.data ||
            body.results ||
            body.items ||
            body.downloads ||
            [];

        if (!Array.isArray(rawMedia)) {
            if (rawMedia?.url) {
                rawMedia = [rawMedia];
            } else {
                rawMedia = [];
            }
        }

        const mediaList = [];

        for (const item of rawMedia) {
            if (!item) continue;

            if (typeof item === 'string') {
                mediaList.push({
                    url: item,
                    type: ''
                });
                continue;
            }

            const mediaUrl =
                item.url ||
                item.download_url ||
                item.downloadUrl ||
                item.download ||
                item.src ||
                item.media_url ||
                item.mediaUrl;

            if (!mediaUrl) continue;

            mediaList.push({
                url: mediaUrl,
                type: String(
                    item.type ||
                    item.media_type ||
                    item.mime ||
                    ''
                ).toLowerCase()
            });
        }

        const uniqueMedia = [
            ...new Map(
                mediaList.map(item => [item.url, item])
            ).values()
        ];

        console.log(
            'SAVEAPI MEDIA FOUND:',
            uniqueMedia.length
        );

        if (!uniqueMedia.length) {
            await socket.sendMessage(sender, {
                react: {
                    text: '❌',
                    key: msg.key
                }
            });

            await socket.sendMessage(sender, {
                text:
`❌ *Instagram Media Not Found*

• Public Instagram post එකක් try කරන්න
• Correct Instagram link එකක් දෙන්න${FOOTER}`
            }, { quoted: msg });

            break;
        }

        let success = 0;
        let failed = 0;

        for (let i = 0; i < uniqueMedia.length; i++) {
            const item = uniqueMedia[i];

            try {
                const mediaUrl = item.url;

                let isVideo =
                    item.type.includes('video') ||
                    item.type.includes('mp4') ||
                    /\.mp4(\?|$)/i.test(mediaUrl) ||
                    /\.mov(\?|$)/i.test(mediaUrl);

                const caption =
`📸 *INSTAGRAM ${isVideo ? 'VIDEO' : 'PHOTO'}*

${uniqueMedia.length > 1
    ? `📦 ${i + 1}/${uniqueMedia.length}`
    : ''
}${FOOTER}`;

                if (isVideo) {
                    await socket.sendMessage(
                        sender,
                        {
                            video: { url: mediaUrl },
                            caption
                        },
                        { quoted: msg }
                    );
                } else {
                    await socket.sendMessage(
                        sender,
                        {
                            image: { url: mediaUrl },
                            caption
                        },
                        { quoted: msg }
                    );
                }

                success++;

                if (i < uniqueMedia.length - 1) {
                    await new Promise(resolve =>
                        setTimeout(resolve, 700)
                    );
                }

            } catch (mediaErr) {
                failed++;

                console.error(
                    `SAVEAPI MEDIA ${i + 1} ERROR:`,
                    mediaErr?.response?.data ||
                    mediaErr?.message ||
                    mediaErr
                );
            }
        }

        await socket.sendMessage(sender, {
            react: {
                text: success > 0 ? '✅' : '❌',
                key: msg.key
            }
        });

        if (failed > 0) {
            await socket.sendMessage(sender, {
                text:
`📥 *INSTAGRAM DOWNLOAD COMPLETE*

✅ Downloaded: *${success}*
❌ Failed: *${failed}*
📦 Total: *${uniqueMedia.length}*${FOOTER}`
            }, { quoted: msg });
        }

    } catch (err) {
        console.error(
            'SAVEAPI INSTAGRAM ERROR:',
            err?.response?.data ||
            err?.message ||
            err
        );

        await socket.sendMessage(sender, {
            react: {
                text: '❌',
                key: msg.key
            }
        });

        const errorText =
            err?.response?.data?.message ||
            err?.response?.data?.error ||
            err?.response?.data?.detail ||
            err?.message ||
            'Unknown Error';

        await socket.sendMessage(sender, {
            text:
`❌ *Instagram Download Error*

${errorText}${FOOTER}`
        }, { quoted: msg });
    }

    break;
}
            case 'dubbedfilm':
case 'pupilmovie': {
    const API = 'https://zara.laksidu.site/pupilvideo';
    const BASE = 'https://zara.laksidu.site';
    const KEY = 'lakiya_72b96b423d046110b5947b625e05ecf2007e009f5ba61d1c4f9a4547fb983e8b';
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    const apiGet = async (url, params) => {
        let last;

        for (let i = 0; i < 3; i++) {
            try {
                return await axios.get(url, { params });
            } catch (e) {
                last = e;

                if (
                    e?.response?.status !== 429 ||
                    i === 2
                ) throw e;

                const wait =
                    Number(
                        e?.response?.headers?.['retry-after']
                    ) || (i + 1) * 3;

                await sleep(wait * 1000);
            }
        }

        throw last;
    };

    const unwrap = x =>
        x?.data?.data ??
        x?.data?.result ??
        x?.data ??
        x?.result ??
        x;

    const providerOf = (x, url = '') => {
        const p =
            x?.server ||
            x?.provider ||
            x?.host ||
            x?.source ||
            x?.name ||
            '';

        if (
            /drive|gdrive|google/i.test(p) ||
            /drive\.google\.com|docs\.google\.com/i.test(url)
        ) return 'Drive';

        if (
            /telegram|tg/i.test(p) ||
            /telegram|t\.me/i.test(url)
        ) return 'Telegram';

        if (
            /pixeldrain/i.test(p) ||
            /pixeldrain/i.test(url)
        ) return 'Pixeldrain';

        return p || 'Direct';
    };

    const downloadsOf = data => {
        const out = [];

        const walk = x => {
            if (!x) return;

            if (Array.isArray(x)) {
                x.forEach(walk);
                return;
            }

            if (typeof x !== 'object') return;

            const url =
                x.download ||
                x.download_url ||
                x.downloadUrl ||
                x.download_link ||
                x.downloadLink ||
                x.direct ||
                x.direct_url ||
                x.directUrl ||
                x.direct_link ||
                x.file_url ||
                x.fileUrl ||
                x.video_url ||
                x.videoUrl ||
                x.url ||
                x.link ||
                x.href;

            if (
                typeof url === 'string' &&
                url.startsWith('http') &&
                !/\.(jpg|jpeg|png|webp)(\?|$)/i.test(url)
            ) {
                out.push({
                    url,
                    provider: providerOf(x, url),
                    quality:
                        x.quality ||
                        x.resolution ||
                        x.label ||
                        x.format ||
                        'HD',
                    size:
                        x.size ||
                        x.filesize ||
                        x.file_size ||
                        x.fileSize ||
                        'Unknown'
                });
            }

            Object.values(x).forEach(walk);
        };

        walk(data);

        return out.filter(
            (x, i, a) =>
                x.url &&
                a.findIndex(y => y.url === x.url) === i
        );
    };

    const convertGDrive = async url => {
        const res = await apiGet(
            `${BASE}/api/convert/gdrive`,
            {
                url,
                api_key: KEY
            }
        );

        const d =
            res.data?.data ||
            res.data?.result ||
            res.data ||
            {};

        if (typeof d === 'string') {
            return {
                url: d.startsWith('http') ? d : null
            };
        }

        return {
            url:
                d.download ||
                d.download_url ||
                d.downloadUrl ||
                d.direct ||
                d.direct_url ||
                d.directUrl ||
                d.direct_link ||
                d.file_url ||
                d.fileUrl ||
                d.video_url ||
                d.videoUrl ||
                d.url ||
                d.link ||
                null,

            name:
                d.name ||
                d.fileName ||
                d.filename ||
                null,

            size:
                d.size ||
                d.file_size ||
                d.fileSize ||
                null,

            mime:
                d.mimeType ||
                d.mimetype ||
                d.mime ||
                null
        };
    };

    const makeThumb = async url => {
        try {
            const r = await axios.get(url, {
                responseType: 'arraybuffer'
            });

            return await sharp(
                Buffer.from(r.data)
            )
                .resize(320, 180, {
                    fit: 'cover'
                })
                .jpeg({
                    quality: 75
                })
                .toBuffer();

        } catch {
            return undefined;
        }
    };

    if (!args.length) {
        await socket.sendMessage(sender, {
            image: {
                url:
                    sessionConfig.BOT_IMAGE ||
                    config.BOT_IMAGE
            },
            caption:
`🎬 *PUPILVIDEO - SINHALA DUBBED*

🔎 Movie name එකක් දෙන්න.

*Example:*
.pupilmovie Harry Potter
.dubbedfilm Harry Potter

> ${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
        }, { quoted: msg });

        break;
    }

    const query = args.join(' ').trim();

    await socket.sendMessage(sender, {
        text: '🎬 *Searching Pupilvideo...*'
    }, { quoted: msg });

    try {
        const sr = await apiGet(
            `${API}/search`,
            {
                query,
                api_key: KEY
            }
        );

        const sd = unwrap(sr.data);

        let results = Array.isArray(sd)
            ? sd
            : sd?.results ||
              sd?.items ||
              sd?.movies ||
              sd?.posts ||
              sd?.data ||
              [];

        if (
            !Array.isArray(results) ||
            !results.length
        ) {
            await socket.sendMessage(sender, {
                text: '❌ *No Results Found*'
            }, { quoted: msg });

            break;
        }

        results = results.slice(0, 20);

        let list =
`▣ *SEARCH* _${query}_

🔢 *REPLY BELOW NUMBER*

`;

        results.forEach((x, i) => {
            list +=
`🎀 *${i + 1} |➤* ${x.title || x.name || 'Movie'}\n`;
        });

        list +=
`\n${sessionConfig.MOVIE_FOOTER || config.MOVIE_FOOTER}`;

        const firstPoster =
            results[0]?.image ||
            results[0]?.poster ||
            results[0]?.thumbnail ||
            sessionConfig.BOT_IMAGE ||
            config.BOT_IMAGE;

        let searchMsg;

        try {
            searchMsg = await socket.sendMessage(
                sender,
                {
                    image: {
                        url: firstPoster
                    },
                    caption: list
                },
                { quoted: msg }
            );
        } catch {
            searchMsg = await socket.sendMessage(
                sender,
                { text: list },
                { quoted: msg }
            );
        }

        const searchId =
            searchMsg.key.id;

        const chooseMovie = async ({ messages }) => {
            const r = messages?.[0];

            if (!r?.message) return;

            if (
                r.message
                    ?.extendedTextMessage
                    ?.contextInfo
                    ?.stanzaId !== searchId
            ) return;

            const text =
                r.message?.conversation ||
                r.message
                    ?.extendedTextMessage
                    ?.text ||
                '';

            const n = parseInt(text.trim());

            if (
                isNaN(n) ||
                n < 1 ||
                n > results.length
            ) return;

            socket.ev.off(
                'messages.upsert',
                chooseMovie
            );

            const selected =
                results[n - 1];

            const movieUrl =
                selected.url ||
                selected.link ||
                selected.href ||
                selected.movie_url ||
                selected.movieUrl;

            if (!movieUrl) {
                await socket.sendMessage(sender, {
                    text: '❌ *Movie URL Not Found*'
                }, { quoted: r });

                return;
            }

            try {
                const mr = await apiGet(
                    `${API}/movie`,
                    {
                        url: movieUrl,
                        api_key: KEY
                    }
                );

                const root =
                    unwrap(mr.data) || {};

                const info =
                    root.movie ||
                    root.details ||
                    root.info ||
                    root;

                const title =
                    info.title ||
                    selected.title ||
                    selected.name ||
                    'Movie';

                const poster =
                    info.image ||
                    info.poster ||
                    info.thumbnail ||
                    selected.image ||
                    selected.poster ||
                    selected.thumbnail ||
                    sessionConfig.BOT_IMAGE ||
                    config.BOT_IMAGE;

                let story =
                    info.story ||
                    info.description ||
                    info.plot ||
                    info.overview ||
                    '';

                if (typeof story !== 'string') {
                    story = '';
                }

                if (story.length > 300) {
                    story =
                        story.slice(0, 300) +
                        '...';
                }

                try {
                    await socket.sendMessage(sender, {
                        image: {
                            url: poster
                        },
                        caption:
`${sessionConfig.MOVIE_CAPTION || config.MOVIE_CAPTION}

☘️ *${title}*

📅 *Year -* ${info.year || selected.year || 'N/A'}
⭐ *IMDb -* ${info.imdb || info.rating || 'N/A'}
⏱️ *Duration -* ${info.duration || info.runtime || 'N/A'}

${story ? `📝 ${story}\n\n` : ''}${sessionConfig.MOVIE_FOOTER || config.MOVIE_FOOTER}`
                    }, { quoted: r });
                } catch {}

                await sleep(1500);

                const wr = await apiGet(
                    `${API}/watch`,
                    {
                        url: movieUrl,
                        api_key: KEY
                    }
                );

                console.log(
                    'PUPILVIDEO WATCH:',
                    JSON.stringify(wr.data)
                );

                let downloads =
                    downloadsOf(
                        unwrap(wr.data)
                    ).slice(0, 20);

                if (!downloads.length) {
                    await socket.sendMessage(sender, {
                        text: '❌ *Download Links Not Found*'
                    }, { quoted: r });

                    return;
                }

                let dlText =
`⬇️☘️ *DOWNLOAD OPTIONS*

*Reply with number* 👇

`;

                downloads.forEach((d, i) => {
                    dlText +=
`🎀 *${i + 1} |* ${d.provider} • ${d.quality} • ${d.size}\n`;
                });

                dlText +=
`\n${sessionConfig.MOVIE_FOOTER || config.MOVIE_FOOTER}`;

                const dlMsg =
                    await socket.sendMessage(
                        sender,
                        {
                            text: dlText
                        },
                        { quoted: r }
                    );

                const dlId =
                    dlMsg.key.id;

                const chooseDownload =
                    async ({ messages }) => {

                        const x =
                            messages?.[0];

                        if (!x?.message) return;

                        if (
                            x.message
                                ?.extendedTextMessage
                                ?.contextInfo
                                ?.stanzaId !==
                            dlId
                        ) return;

                        const t =
                            x.message
                                ?.conversation ||
                            x.message
                                ?.extendedTextMessage
                                ?.text ||
                            '';

                        const q =
                            parseInt(t.trim());

                        if (
                            isNaN(q) ||
                            q < 1 ||
                            q > downloads.length
                        ) return;

                        socket.ev.off(
                            'messages.upsert',
                            chooseDownload
                        );

                        const dl =
                            downloads[q - 1];

                        await socket.sendMessage(
                            sender,
                            {
                                text:
                                    '⬇️ *Downloading movie...*'
                            },
                            { quoted: x }
                        );

                        try {
                            let finalUrl =
                                dl.url;

                            let finalName = null;
                            let finalSize =
                                dl.size;
                            let finalMime =
                                'video/mp4';

                            if (
                                dl.provider === 'Drive' ||
                                /drive\.google\.com|docs\.google\.com/i
                                    .test(dl.url)
                            ) {
                                const drive =
                                    await convertGDrive(
                                        dl.url
                                    );

                                if (!drive?.url) {
                                    throw new Error(
                                        'Google Drive direct link not found'
                                    );
                                }

                                finalUrl =
                                    drive.url;

                                finalName =
                                    drive.name;

                                finalSize =
                                    drive.size ||
                                    dl.size;

                                finalMime =
                                    drive.mime ||
                                    'video/mp4';
                            }

                            console.log(
                                'SERVER:',
                                dl.provider
                            );

                            console.log(
                                'FINAL URL:',
                                finalUrl
                            );

                            const cleanTitle =
                                title
                                    .replace(
                                        /[\\/:*?"<>|]/g,
                                        ''
                                    )
                                    .trim();

                            const thumbnail =
                                await makeThumb(
                                    poster
                                );

                            const fileName =
                                finalName ||
`${cleanTitle} - ${dl.quality || 'HD'} - ${dl.provider}.mp4`;

                            await socket.sendMessage(
                                sender,
                                {
                                    document: {
                                        url:
                                            finalUrl
                                    },

                                    mimetype:
                                        finalMime,

                                    fileName,

                                    ...(thumbnail
                                        ? {
                                            jpegThumbnail:
                                                thumbnail
                                        }
                                        : {}),

                                    caption:
`${sessionConfig.MOVIE_CAPTION || config.MOVIE_CAPTION}

☘️ *${title}*

📥 *Server -* ${dl.provider}
✨ *Quality -* \`${dl.quality || 'HD'}\`
💾 *Size -* ${finalSize || 'Unknown'}

${sessionConfig.MOVIE_FOOTER || config.MOVIE_FOOTER}`
                                },
                                { quoted: x }
                            );

                            await socket.sendMessage(
                                sender,
                                {
                                    react: {
                                        text:
                                            '✅',
                                        key:
                                            x.key
                                    }
                                }
                            );

                        } catch (e) {
                            console.error(
                                'PupilVideo Send:',
                                e?.response?.data ||
                                e
                            );

                            await socket.sendMessage(
                                sender,
                                {
                                    text:
`❌ *Movie Send Error*

📥 *Server:* ${dl.provider}

${e?.response?.data?.message ||
e?.response?.data?.error ||
e?.message ||
'Unknown Error'}`
                                },
                                { quoted: x }
                            );
                        }
                    };

                socket.ev.on(
                    'messages.upsert',
                    chooseDownload
                );

                setTimeout(() => {
                    socket.ev.off(
                        'messages.upsert',
                        chooseDownload
                    );
                }, 180000);

            } catch (e) {
                console.error(
                    'PupilVideo Movie:',
                    e?.response?.data ||
                    e
                );

                await socket.sendMessage(sender, {
                    text:
`❌ *Movie Error*

${e?.response?.data?.message ||
e?.response?.data?.error ||
e?.message ||
'Unknown Error'}`
                }, { quoted: r });
            }
        };

        socket.ev.on(
            'messages.upsert',
            chooseMovie
        );

        setTimeout(() => {
            socket.ev.off(
                'messages.upsert',
                chooseMovie
            );
        }, 180000);

    } catch (e) {
        console.error(
            'PupilVideo Error:',
            e?.response?.data ||
            e
        );
      await socket.sendMessage(sender, {
    text:
`❌ *PupilVideo Error*

${e?.response?.data?.message ||
e?.response?.data?.error ||
e?.message ||
'Unknown Error'}`
}, { quoted: msg });
}

break;
}
        
     case 'tinkiri':
case 'thenkiri': {
    if (!isOwner) {
        await socket.sendMessage(sender, {
            text: '❌ *Only Owner & Creator Can Use This Command*'
        }, { quoted: msg });
        break;
    }

    const API_BASE = 'https://zara.laksidu.site';
    const API_KEY = 'lakiya_72b96b423d046110b5947b625e05ecf2007e009f5ba61d1c4f9a4547fb983e8b';
    const chatJid = msg.key.remoteJid;

    const BOT_FOOTER =
        sessionConfig.BOT_FOOTER ||
        config.BOT_FOOTER;

    const MOVIE_FOOTER =
        sessionConfig.MOVIE_FOOTER ||
        config.MOVIE_FOOTER;

    const MOVIE_CAPTION =
        sessionConfig.MOVIE_CAPTION ||
        config.MOVIE_CAPTION;

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
            let done = false;

            const finish = result => {
                if (done) return;

                done = true;
                clearTimeout(timer);

                socket.ev.off(
                    'messages.upsert',
                    handler
                );

                resolve(result);
            };

            const handler = update => {
                for (const replyMsg of update.messages || []) {
                    if (
                        !replyMsg?.message ||
                        replyMsg.key.fromMe
                    ) {
                        continue;
                    }

                    if (
                        replyMsg.key.remoteJid !==
                        chatJid
                    ) {
                        continue;
                    }

                    const context =
                        getContextInfo(replyMsg);

                    if (
                        context.stanzaId !==
                        messageId
                    ) {
                        continue;
                    }

                    const text =
                        getReplyText(replyMsg);

                    if (!/^\d+$/.test(text)) {
                        continue;
                    }

                    const number =
                        Number(text);

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

            const timer =
                setTimeout(
                    () => finish(null),
                    timeout
                );

            socket.ev.on(
                'messages.upsert',
                handler
            );
        });
    };

    const cleanFileName = value =>
        String(value || 'Tinkiri')
            .replace(/[\\/:*?"<>|]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 100);

    const getExtension = (url, fileName) =>
        (
            String(fileName || '').match(
                /\.(mkv|mp4|avi|webm)$/i
            )?.[1] ||
            String(url || '').match(
                /\.(mkv|mp4|avi|webm)(?:\?|$)/i
            )?.[1] ||
            'mkv'
        ).toLowerCase();

    const getMimeType = ext => {
        if (ext === 'mp4') return 'video/mp4';
        if (ext === 'avi') return 'video/x-msvideo';
        if (ext === 'webm') return 'video/webm';

        return 'video/x-matroska';
    };

    const getEpisodeDetails = (
        fileName,
        fallback
    ) => {
        const name =
            String(fileName || '');

        const se =
            name.match(
                /S(\d{1,2})E(\d{1,3})/i
            );

        if (se) {
            return {
                season:
                    Number(se[1]) || 1,

                episode:
                    Number(se[2]) ||
                    fallback
            };
        }

        const ep =
            name.match(
                /(?:episode|ep)[.\s_-]*(\d{1,3})/i
            );

        return {
            season: 1,
            episode:
                Number(ep?.[1]) ||
                fallback
        };
    };

    if (!query) {
        await socket.sendMessage(
            chatJid,
            {
                image: {
                    url:
                        sessionConfig.BOT_IMAGE ||
                        config.BOT_IMAGE
                },

                caption:
`❌ *ERROR*

Search name එකක් දෙන්න.

*Example:*
.tinkiri Korean

> ${BOT_FOOTER}`
            },
            { quoted: msg }
        );

        break;
    }

    await socket.sendMessage(chatJid, {
        react: {
            text: '🔎',
            key: msg.key
        }
    });

    await socket.sendMessage(
        chatJid,
        {
            text: '🔎 *Searching...*'
        },
        { quoted: msg }
    );

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

        results = results
            .filter(
                (item, index, array) =>
                    item?.url &&
                    array.findIndex(
                        x =>
                            x.url === item.url
                    ) === index
            )
            .slice(0, 20);

        if (!results.length) {
            await socket.sendMessage(
                chatJid,
                {
                    text:
`❌ *No Results Found*

> ${BOT_FOOTER}`
                },
                { quoted: msg }
            );

            break;
        }

        let searchText =
`🎀 *SEARCH:* ${query}

🔢 *REPLY BELOW NUMBER*

`;

        results.forEach(
            (item, index) => {
                searchText +=
`🎀 *${index + 1} | ${item.title || 'Unknown'}*\n`;
            }
        );

        searchText +=
`\n${MOVIE_FOOTER}`;

        const searchImage =
            sessionConfig.BOT_IMAGE ||
            config.BOT_IMAGE ||
            results[0]?.thumbnail;

        let searchMessage;

        try {
            searchMessage =
                await socket.sendMessage(
                    chatJid,
                    {
                        image: {
                            url: searchImage
                        },
                        caption:
                            searchText
                    },
                    { quoted: msg }
                );
        } catch {
            searchMessage =
                await socket.sendMessage(
                    chatJid,
                    {
                        text:
                            searchText
                    },
                    { quoted: msg }
                );
        }

        const resultReply =
            await waitForNumber(
                searchMessage.key.id,
                1,
                results.length
            );

        if (!resultReply) {
            break;
        }

        await socket.sendMessage(
            chatJid,
            {
                react: {
                    text: '✅',
                    key:
                        resultReply
                            .message.key
                }
            }
        );

        const selectedResult =
            results[
                resultReply.number - 1
            ];

        await socket.sendMessage(
            chatJid,
            {
                text:
                    '📥 *Loading Details...*'
            },
            {
                quoted:
                    resultReply.message
            }
        );

        const detailsResponse =
            await axios.get(
                `${API_BASE}/tinkiri/details`,
                {
                    params: {
                        url:
                            selectedResult.url,
                        api_key:
                            API_KEY
                    },
                    timeout: 90000
                }
            );

        const detailsData =
            detailsResponse?.data?.data ||
            {};

        const movie =
            detailsData.movie || {};

        let downloadOptions =
            detailsData.download_options ||
            [];

        downloadOptions =
            downloadOptions.filter(
                option =>
                    option
                        ?.direct_download_url &&
                    option?.status !==
                        'failed'
            );

        if (!downloadOptions.length) {
            throw new Error(
                'Download links not found.'
            );
        }

        const title =
            String(
                movie.title ||
                selectedResult.title ||
                'Tinkiri Download'
            )
                .replace(
                    /^DOWNLOAD\s+/i,
                    ''
                )
                .trim();

        const poster =
            movie.thumbnail ||
            selectedResult.thumbnail ||
            sessionConfig.BOT_IMAGE ||
            config.BOT_IMAGE;

        const description =
            movie.description ||
            selectedResult.description ||
            '';

        const hasEpisodes =
            downloadOptions.some(
                option =>
                    /S\d{1,2}E\d{1,3}|episode[\s._-]*\d+|ep[\s._-]*\d+/i
                        .test(
                            option.file_name ||
                            ''
                        )
            );

        const isSeries =
            hasEpisodes &&
            downloadOptions.length > 1;

        const shortDescription =
            description.length > 300
                ? description.slice(
                    0,
                    300
                ) + '...'
                : description;

        const detailsCaption =
`${MOVIE_CAPTION}

☘️ *${title}*

🎬 *Type:* ${isSeries ? 'TV Series' : 'Movie'}
📦 *Files:* ${downloadOptions.length}

${shortDescription ? `📝 ${shortDescription}\n\n` : ''}${MOVIE_FOOTER}`;

        try {
            await socket.sendMessage(
                chatJid,
                {
                    image: {
                        url: poster
                    },
                    caption:
                        detailsCaption
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
                    text:
                        detailsCaption
                },
                {
                    quoted:
                        resultReply.message
                }
            );
        }

        let jpegThumbnail;

        try {
            const posterResponse =
                await axios.get(
                    poster,
                    {
                        responseType:
                            'arraybuffer',
                        timeout: 30000
                    }
                );

            jpegThumbnail =
                await sharp(
                    Buffer.from(
                        posterResponse.data
                    )
                )
                    .resize(
                        300,
                        300,
                        {
                            fit: 'cover'
                        }
                    )
                    .jpeg({
                        quality: 75
                    })
                    .toBuffer();

        } catch {
            jpegThumbnail =
                undefined;
        }

        if (isSeries) {
            const episodes =
                downloadOptions.map(
                    (option, index) => {

                        const ep =
                            getEpisodeDetails(
                                option.file_name,
                                index + 1
                            );

                        return {
                            season:
                                ep.season,

                            episode:
                                ep.episode,

                            url:
                                option
                                    .direct_download_url,

                            fileName:
                                option
                                    .file_name,

                            fileSize:
                                option
                                    .file_size ||
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
                (ep, i) => {
                    episodeText +=
`🎀 *${i + 1} | Episode ${ep.episode}*`;

                    if (
                        ep.fileSize !==
                        'Unknown'
                    ) {
                        episodeText +=
                            ` — ${ep.fileSize}`;
                    }

                    episodeText += '\n';
                }
            );

            episodeText +=
`\n${MOVIE_FOOTER}`;

            const episodeMessage =
                await socket.sendMessage(
                    chatJid,
                    {
                        text:
                            episodeText
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

            if (!episodeReply) {
                break;
            }

            await socket.sendMessage(
                chatJid,
                {
                    react: {
                        text: '✅',
                        key:
                            episodeReply
                                .message.key
                    }
                }
            );

            const selectedEpisodes =
                episodeReply.number === 0
                    ? episodes
                    : [
                        episodes[
                            episodeReply
                                .number - 1
                        ]
                    ];

            let successCount = 0;
            let failedCount = 0;

            for (
                let i = 0;
                i <
                selectedEpisodes.length;
                i++
            ) {
                const ep =
                    selectedEpisodes[i];

                try {
                    const ext =
                        getExtension(
                            ep.url,
                            ep.fileName
                        );

                    const mime =
                        getMimeType(ext);

                    const season =
                        String(
                            ep.season || 1
                        ).padStart(
                            2,
                            '0'
                        );

                    const episode =
                        String(
                            ep.episode
                        ).padStart(
                            2,
                            '0'
                        );

                    await socket.sendMessage(
                        chatJid,
                        {
                            document: {
                                url: ep.url
                            },

                            mimetype:
                                mime,

                            fileName:
`${cleanFileName(title)} S${season}E${episode}.${ext}`,

                            ...(jpegThumbnail
                                ? {
                                    jpegThumbnail
                                }
                                : {}),

                            caption:
`${MOVIE_CAPTION}

☘️ *${title}*

🎀 *Episode:* ${ep.episode}
📦 *Size:* ${ep.fileSize}

${MOVIE_FOOTER}`
                        },
                        {
                            quoted:
                                episodeReply.message
                        }
                    );

                    successCount++;

                } catch (e) {
                    failedCount++;

                    console.error(
                        'Tinkiri Episode Error:',
                        e
                    );
                }

                if (
                    i <
                    selectedEpisodes.length -
                        1
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
❌ Failed: ${failedCount}

${MOVIE_FOOTER}`
                },
                {
                    quoted:
                        episodeReply.message
                }
            );

            break;
        }

        let selectedMovieOption;
        let movieReplyMessage =
            resultReply.message;

        if (
            downloadOptions.length ===
            1
        ) {
            selectedMovieOption =
                downloadOptions[0];

        } else {
            let optionText =
`🎬 *DOWNLOAD OPTIONS*

`;

            downloadOptions.forEach(
                (option, index) => {
                    optionText +=
`📁 *${index + 1} | ${option.file_size || 'Download'}*\n`;
                }
            );

            optionText +=
`\n${MOVIE_FOOTER}`;

            const optionMessage =
                await socket.sendMessage(
                    chatJid,
                    {
                        text:
                            optionText
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

            if (!optionReply) {
                break;
            }

            selectedMovieOption =
                downloadOptions[
                    optionReply.number -
                        1
                ];

            movieReplyMessage =
                optionReply.message;
        }

        await socket.sendMessage(
            chatJid,
            {
                text:
                    '⬇️ *Downloading movie...*'
            },
            {
                quoted:
                    movieReplyMessage
            }
        );

        const movieUrl =
            selectedMovieOption
                .direct_download_url;

        const ext =
            getExtension(
                movieUrl,
                selectedMovieOption
                    .file_name
            );

        await socket.sendMessage(
            chatJid,
            {
                document: {
                    url: movieUrl
                },

                mimetype:
                    getMimeType(ext),

                fileName:
`${cleanFileName(title)}.${ext}`,

                ...(jpegThumbnail
                    ? {
                        jpegThumbnail
                    }
                    : {}),

                caption:
`${MOVIE_CAPTION}

☘️ *${title}*

📦 *Size:* ${selectedMovieOption.file_size || 'Unknown'}

${MOVIE_FOOTER}`
            },
            {
                quoted:
                    movieReplyMessage
            }
        );

        await socket.sendMessage(
            chatJid,
            {
                react: {
                    text: '✅',
                    key:
                        movieReplyMessage
                            .key
                }
            }
        );

    } catch (error) {
        console.error(
            'Tinkiri Error:',
            error?.response?.data ||
            error?.message ||
            error
        );

        await socket.sendMessage(
            chatJid,
            {
                text:
`❌ *TINKIRI ERROR*

${error?.response?.data?.message ||
error?.response?.data?.error ||
error?.message ||
'Unknown Error'}

> ${BOT_FOOTER}`
            },
            {
                quoted: msg
            }
        );
    }

    break;
}
    case 'cinesend': {
    // =====================================================
    // CREATOR ONLY
    // =====================================================
    if (!isCreator) {
        return await socket.sendMessage(sender, {
            text: '❌ *Only Creator Can Use This Command*'
        }, { quoted: msg });
    }

    // =====================================================
    // SAFE LIMITS
    // =====================================================
    const MAX_TARGET_GROUPS = 5;
    const MAX_MOVIES_PER_BATCH = 5;

    // request burst අඩු කරන්න
    const DETAILS_TO_MOVIE_DELAY = 2500;
    const BETWEEN_GROUPS_DELAY = 4000;
    const BETWEEN_MOVIES_DELAY = 8000;

    // Strictly less than 2GB
    const MAX_FILE_SIZE =
        2 * 1024 * 1024 * 1024;

    const sleep = ms =>
        new Promise(resolve =>
            setTimeout(resolve, ms)
        );

    const BOT_IMAGE =
        sessionConfig.BOT_IMAGE ||
        config.BOT_IMAGE;

    const FOOTER =
        sessionConfig.BOT_FOOTER ||
        config.BOT_FOOTER;

    const MOVIE_FOOTER =
        sessionConfig.MOVIE_FOOTER ||
        config.MOVIE_FOOTER;

    // =====================================================
    // INPUT
    // =====================================================
    const rawInput =
        args.join(' ').trim();

    if (!rawInput) {
        await socket.sendMessage(sender, {
            image: {
                url: BOT_IMAGE
            },
            caption:
`🎬 *CINESEND*

*Normal Search*
.cinesend 2026 120363xxx@g.us

*Multiple Groups*
.cinesend avatar 120363xxx@g.us,120363yyy@g.us

*Trending*
.cinesend trending 120363xxx@g.us

*Top Movies*
.cinesend top 120363xxx@g.us

━━━━━━━━━━━━━━

🎬 Movie selection examples:

1

1-5

1,3,5

2-4,7

📦 2GB ට අඩු Highest Quality එක Auto Select වෙනවා.

${FOOTER}`
        }, { quoted: msg });

        break;
    }

    // =====================================================
    // EXTRACT JIDS
    // =====================================================
    let targetJids = [
        ...new Set(
            rawInput.match(
                /\d+@g\.us/gi
            ) || []
        )
    ];

    if (!targetJids.length) {
        await socket.sendMessage(sender, {
            text:
`❌ *Group JID Not Found*

Example:

.cinesend 2026 120363xxxxxxxx@g.us`
        }, { quoted: msg });

        break;
    }

    if (
        targetJids.length >
        MAX_TARGET_GROUPS
    ) {
        return await socket.sendMessage(sender, {
            text:
`❌ *Too Many Target Groups*

Maximum groups per batch:
*${MAX_TARGET_GROUPS}*

මෙය request burst අඩු කර තබාගැනීමට දාපු limit එකක්.`
        }, { quoted: msg });
    }

    // JIDs remove -> search query
    const cinezubQuery =
        rawInput
            .replace(
                /\d+@g\.us/gi,
                ' '
            )
            .replace(
                /[,|]+/g,
                ' '
            )
            .replace(
                /\s+/g,
                ' '
            )
            .trim();

    if (!cinezubQuery) {
        return await socket.sendMessage(sender, {
            text:
`❌ *Movie name එකක් ලබාදෙන්න.*

Example:

.cinesend avatar 120363xxx@g.us`
        }, { quoted: msg });
    }

    // =====================================================
    // VALIDATE GROUP JIDS
    // =====================================================
    const validTargets = [];
    const invalidTargets = [];

    for (const jid of targetJids) {
        try {
            await socket.groupMetadata(jid);

            validTargets.push(jid);

            // Metadata calls too fast නොකරන්න
            await sleep(500);

        } catch (e) {
            invalidTargets.push(jid);
        }
    }

    targetJids = validTargets;

    if (!targetJids.length) {
        return await socket.sendMessage(sender, {
            text:
`❌ *Valid Target Group එකක් හමු වුණේ නැහැ.*

Bot එක target groups වල member ද කියලා බලන්න.`
        }, { quoted: msg });
    }

    // =====================================================
    // HELPERS
    // =====================================================

    const sizeToBytes = value => {
        if (
            value === undefined ||
            value === null ||
            value === ''
        ) {
            return null;
        }

        const text =
            String(value)
                .replace(/,/g, '')
                .trim()
                .toUpperCase();

        const match =
            text.match(
                /([\d.]+)\s*(TB|GB|MB|KB|B)/
            );

        if (!match) {
            return null;
        }

        const amount =
            parseFloat(match[1]);

        if (
            !Number.isFinite(amount)
        ) {
            return null;
        }

        const units = {
            B: 1,
            KB: 1024,
            MB: 1024 ** 2,
            GB: 1024 ** 3,
            TB: 1024 ** 4
        };

        return (
            amount *
            units[match[2]]
        );
    };

    const getQualityScore =
        quality => {

            const q =
                String(
                    quality || ''
                ).toLowerCase();

            if (/2160|4k/.test(q))
                return 2160;

            if (/1440/.test(q))
                return 1440;

            if (/1080/.test(q))
                return 1080;

            if (/720/.test(q))
                return 720;

            if (/480/.test(q))
                return 480;

            if (/360/.test(q))
                return 360;

            if (/240/.test(q))
                return 240;

            return 0;
        };

    const cleanQuality =
        quality => {

            let value =
                String(
                    quality || ''
                );

            value =
                value.replace(
                    /\s*[-–|]?\s*\d+(\.\d+)?\s*(TB|GB|MB|KB|B)\b/gi,
                    ''
                );

            value =
                value.replace(
                    /\([^)]*(TB|GB|MB|KB|B)[^)]*\)/gi,
                    ''
                );

            value =
                value
                    .replace(
                        /\s+/g,
                        ' '
                    )
                    .trim();

            return value || 'HD';
        };

    // =====================================================
    // 1-5 / 1,3,5 / 2-4,7 PARSER
    // =====================================================

    const parseSelections =
        (
            input,
            maxResults
        ) => {

            const value =
                String(input || '')
                    .replace(
                        /\s+/g,
                        ''
                    );

            if (!value) {
                return {
                    ok: false,
                    error: 'EMPTY'
                };
            }

            const tokens =
                value
                    .split(',')
                    .filter(Boolean);

            const numbers = [];

            for (const token of tokens) {

                // Single number
                if (/^\d+$/.test(token)) {

                    numbers.push(
                        Number(token)
                    );

                    continue;
                }

                // Range
                const range =
                    token.match(
                        /^(\d+)-(\d+)$/
                    );

                if (!range) {
                    return {
                        ok: false,
                        error: 'FORMAT'
                    };
                }

                let start =
                    Number(range[1]);

                let end =
                    Number(range[2]);

                const step =
                    start <= end
                        ? 1
                        : -1;

                for (
                    let i = start;
                    step > 0
                        ? i <= end
                        : i >= end;
                    i += step
                ) {
                    numbers.push(i);
                }
            }

            const unique =
                [...new Set(numbers)];

            for (const n of unique) {

                if (
                    n < 1 ||
                    n > maxResults
                ) {
                    return {
                        ok: false,
                        error: 'RANGE'
                    };
                }
            }

            if (
                unique.length >
                MAX_MOVIES_PER_BATCH
            ) {
                return {
                    ok: false,
                    error: 'TOO_MANY'
                };
            }

            return {
                ok: true,
                numbers: unique
            };
        };

    // =====================================================
    // AUTO QUALITY
    // =====================================================

    const selectBestDownload =
        downloads => {

            const candidates = [];

            for (const dl of downloads) {

                if (
                    !dl ||
                    !dl.url ||
                    !dl.quality
                ) {
                    continue;
                }

                let bytes =
                    sizeToBytes(
                        dl.quality
                    );

                if (!bytes) {
                    bytes =
                        sizeToBytes(
                            dl.size ||
                            dl.file_size ||
                            dl.filesize ||
                            dl.fileSize
                        );
                }

                // Unknown size -> don't auto send
                if (!bytes) {
                    continue;
                }

                // STRICTLY UNDER 2 GB
                if (
                    bytes >=
                    MAX_FILE_SIZE
                ) {
                    continue;
                }

                candidates.push({
                    ...dl,

                    _bytes:
                        bytes,

                    _qualityScore:
                        getQualityScore(
                            dl.quality
                        )
                });
            }

            if (
                !candidates.length
            ) {
                return null;
            }

            candidates.sort(
                (a, b) => {

                    if (
                        b._qualityScore !==
                        a._qualityScore
                    ) {
                        return (
                            b._qualityScore -
                            a._qualityScore
                        );
                    }

                    return (
                        b._bytes -
                        a._bytes
                    );
                }
            );

            return candidates[0];
        };

    // =====================================================
    // THUMBNAIL
    // =====================================================

    const makeThumbnail =
        async url => {

            if (!url) {
                return undefined;
            }

            try {

                const response =
                    await axios.get(
                        url,
                        {
                            responseType:
                                'arraybuffer',

                            timeout:
                                20000
                        }
                    );

                return await sharp(
                    Buffer.from(
                        response.data
                    )
                )
                    .resize(
                        300,
                        300,
                        {
                            fit: 'cover',
                            position: 'center'
                        }
                    )
                    .jpeg({
                        quality: 70
                    })
                    .toBuffer();

            } catch (e) {

                console.error(
                    'Cinesend thumb:',
                    e.message
                );

                return undefined;
            }
        };

    // =====================================================
    // LISTENER
    // =====================================================

    let selectionListener = null;
    let selectionTimeout = null;

    const clearSelection = () => {

        if (selectionListener) {

            socket.ev.off(
                'messages.upsert',
                selectionListener
            );

            selectionListener = null;
        }

        if (selectionTimeout) {

            clearTimeout(
                selectionTimeout
            );

            selectionTimeout = null;
        }
    };

    try {
        // =================================================
        // SEARCH MODE
        // =================================================

        let searchMode = 'search';
        let searchUrl;

        const queryLower =
            cinezubQuery
                .toLowerCase()
                .trim();

        if (
            queryLower ===
                'trending' ||
            queryLower ===
                'trend'
        ) {

            searchMode =
                'trending';

            searchUrl =
                `${config.API_MAIN_URL}/cinesubz/trending?api_key=${config.API_KEY}`;

        } else if (
            queryLower === 'top' ||
            queryLower ===
                'topmovies' ||
            queryLower ===
                'top-movies'
        ) {

            searchMode =
                'top';

            searchUrl =
                `${config.API_MAIN_URL}/cinesubz/top-movies?api_key=${config.API_KEY}`;

        } else {

            searchUrl =
                `${config.API_MAIN_URL}/cinesubz/search?query=${encodeURIComponent(cinezubQuery)}&api_key=${config.API_KEY}`;
        }

        await socket.sendMessage(sender, {
            react: {
                text: '🔎',
                key: msg.key
            }
        });

        const searchResponse =
            await axios.get(
                searchUrl,
                {
                    timeout: 30000
                }
            );

        const searchData =
            searchResponse.data || {};

        let rawResults =
            searchData.results ||
            searchData?.data
                ?.results ||
            searchData?.data
                ?.movies ||
            searchData.movies ||
            searchData.items ||
            searchData.data ||
            [];

        if (
            !Array.isArray(
                rawResults
            )
        ) {
            rawResults =
                rawResults?.results ||
                rawResults?.movies ||
                rawResults?.items ||
                [];
        }

        if (
            !Array.isArray(
                rawResults
            )
        ) {
            rawResults = [];
        }

        // Movies only
        let cinezubResults =
            rawResults.filter(
                item => {

                    const link =
                        String(
                            item?.link ||
                            item?.url ||
                            ''
                        ).toLowerCase();

                    const type =
                        String(
                            item?.type ||
                            item?.category ||
                            ''
                        ).toLowerCase();

                    return !(
                        link.includes(
                            '/tvshows/'
                        ) ||
                        type.includes(
                            'series'
                        ) ||
                        type.includes(
                            'tv'
                        )
                    );
                }
            );

        if (
            !cinezubResults.length
        ) {
            cinezubResults =
                rawResults;
        }

        cinezubResults =
            cinezubResults.slice(
                0,
                40
            );

        if (
            !cinezubResults.length
        ) {

            await socket.sendMessage(
                sender,
                {
                    image: {
                        url:
                            BOT_IMAGE
                    },

                    caption:
                        formatMessage(
                            '❌ NO RESULTS',

                            '*Movies හමු වුණේ නැහැ.*',

                            FOOTER
                        )
                },
                {
                    quoted: msg
                }
            );

            break;
        }

        // =================================================
        // SEARCH CARD
        // =================================================

        let searchTitle =
            `🎀 SEARCH : ${cinezubQuery}`;

        if (
            searchMode ===
            'trending'
        ) {
            searchTitle =
                '🔥 TRENDING MOVIES';
        }

        if (
            searchMode ===
            'top'
        ) {
            searchTitle =
                '🏆 TOP MOVIES';
        }

        let listText =
`_❐ Search From cinesubz.lk_

❐ *${searchTitle}*

🎯 *TARGETS : ${targetJids.length}*

╭──────●➤
*🔢 Reply Movie Number / Range*
╰──────────●➤

`;

        cinezubResults.forEach(
            (item, index) => {

                const title =
                    item?.title ||
                    item?.name ||
                    'Unknown';

                listText +=
`*🌸 ${index + 1} ║❯❯ ${title}*
`;
            }
        );

        listText +=
`
╰──────────●➤

*Examples*
\`1\`
\`1-5\`
\`1,3,5\`
\`2-4,7\`

⚠️ Maximum ${MAX_MOVIES_PER_BATCH} Movies Per Batch

> ${FOOTER}`;

        const sentMsg =
            await socket.sendMessage(
                sender,
                {
                    image: {
                        url:
                            BOT_IMAGE
                    },

                    caption:
                        listText
                },
                {
                    quoted: msg
                }
            );

        const messageID =
            sentMsg.key.id;

        // =================================================
        // WAIT SELECTION
        // =================================================

        selectionListener =
            async ({
                messages:
                    replyMessages
            }) => {

                const replyMek =
                    replyMessages?.[0];

                if (
                    !replyMek?.message
                ) {
                    return;
                }

                if (
                    replyMek.key
                        .remoteJid !==
                    sender
                ) {
                    return;
                }

                const context =
                    replyMek.message
                        ?.extendedTextMessage
                        ?.contextInfo;

                if (
                    context?.stanzaId !==
                    messageID
                ) {
                    return;
                }

                const replyText =
                    replyMek.message
                        ?.conversation ||
                    replyMek.message
                        ?.extendedTextMessage
                        ?.text ||
                    '';

                const selection =
                    parseSelections(
                        replyText,
                        cinezubResults
                            .length
                    );

                if (!selection.ok) {

                    let error =
                        'Invalid selection.';

                    if (
                        selection.error ===
                        'TOO_MANY'
                    ) {
                        error =
`Batch එකකට උපරිම Movies ${MAX_MOVIES_PER_BATCH}යි.`;
                    }

                    if (
                        selection.error ===
                        'FORMAT'
                    ) {
                        error =
`Format:

1
1-5
1,3,5
2-4,7`;
                    }

                    if (
                        selection.error ===
                        'RANGE'
                    ) {
                        error =
`1-${cinezubResults.length} අතර numbers දෙන්න.`;
                    }

                    await socket.sendMessage(
                        sender,
                        {
                            text:
`❌ *INVALID SELECTION*

${error}`
                        },
                        {
                            quoted:
                                replyMek
                        }
                    );

                    return;
                }

                // Valid selection ->
                // listener remove immediately
                clearSelection();

                const selectedMovies =
                    selection.numbers.map(
                        number => ({
                            number,

                            item:
                                cinezubResults[
                                    number - 1
                                ]
                        })
                    );

                await socket.sendMessage(
                    sender,
                    {
                        text:
`📥 *CINESEND QUEUE STARTED*

🎬 Movies: *${selectedMovies.length}*
🎯 Groups: *${targetJids.length}*

🔢 Selected:
${selection.numbers.join(', ')}

Movies එකින් එක පිළිවෙළට send කරනවා.

⏳ ටික වෙලාවක් යන්න පුළුවන්.`
                    },
                    {
                        quoted:
                            replyMek
                    }
                );

                let totalSuccess = 0;
                let totalFailed = 0;

                const results = [];

                // ==========================================
                // MOVIES SEQUENTIAL LOOP
                // ==========================================

                for (
                    let movieIndex = 0;
                    movieIndex <
                    selectedMovies.length;
                    movieIndex++
                ) {

                    const selected =
                        selectedMovies[
                            movieIndex
                        ];

                    const selectedItem =
                        selected.item;

                    const selectedLink =
                        selectedItem?.link ||
                        selectedItem?.url ||
                        selectedItem
                            ?.post_url ||
                        selectedItem?.href;

                    if (!selectedLink) {

                        totalFailed++;

                        results.push(
                            `❌ ${selectedItem?.title || 'Unknown'} - URL missing`
                        );

                        continue;
                    }

                    try {
                        // ==================================
                        // DETAILS
                        // ==================================

                        await socket.sendMessage(
                            sender,
                            {
                                text:
`⏳ *[${movieIndex + 1}/${selectedMovies.length}]* Fetching:

🎬 ${selectedItem.title}`
                            }
                        );

                        const detailsResponse =
                            await axios.get(
                                `${config.API_MAIN_URL}/cinesubz/details?url=${encodeURIComponent(selectedLink)}&api_key=${config.API_KEY}`,
                                {
                                    timeout:
                                        30000
                                }
                            );

                        const detailsData =
                            detailsResponse
                                .data;

                        if (
                            !detailsData
                                ?.status ||
                            !detailsData
                                ?.data
                        ) {
                            throw new Error(
                                'Details not found'
                            );
                        }

                        const movieInfo =
                            detailsData.data;

                        const downloads =
                            movieInfo
                                .downloads
                                ?.filter(
                                    dl =>
                                        dl &&
                                        dl.url &&
                                        dl.quality
                                ) || [];

                        if (
                            !downloads.length
                        ) {
                            throw new Error(
                                'No downloads'
                            );
                        }

                        // ==================================
                        // AUTO QUALITY
                        // ==================================

                        const selectedDownload =
                            selectBestDownload(
                                downloads
                            );

                        if (
                            !selectedDownload
                        ) {
                            throw new Error(
                                'No verified quality under 2GB'
                            );
                        }

                        const qualityDisplay =
                            cleanQuality(
                                selectedDownload
                                    .quality
                            );

                        const sizeMB =
                            selectedDownload
                                ._bytes /
                            (1024 * 1024);

                        const sizeDisplay =
                            sizeMB >= 1024
                                ? `${(
                                    sizeMB /
                                    1024
                                ).toFixed(2)} GB`
                                : `${Math.round(sizeMB)} MB`;

                        // ==================================
                        // DETAILS CARD
                        // NO TARGET INFO
                        // ==================================

                        const description =
                            movieInfo.description
                                ?.substring(
                                    0,
                                    300
                                ) +
                            (
                                movieInfo
                                    .description
                                    ?.length >
                                300
                                    ? '...'
                                    : ''
                            ) ||
                            'No description available.';

                        const imdbRating =
                            movieInfo
                                .imdb_rating
                                ? `${movieInfo.imdb_rating}/10`
                                : 'N/A';

                        const year =
                            movieInfo.year ||
                            'N/A';

                        const runtime =
                            movieInfo.runtime ||
                            'N/A';

                        const director =
                            movieInfo.director ||
                            'N/A';

                        const country =
                            movieInfo.country ||
                            'N/A';

                        const cast =
                            movieInfo.cast ||
                            'N/A';

                        const detailsCaption =
                            formatMessage(
                                `☘️ 𝗧ɪᴛʟᴇ ➟ ${movieInfo.title}`,

`▫️🥇 *𝗜ᴍᴅʙ 𝗥ᴀᴛɪɴɢ ➟ ${imdbRating}*
▫️⏳ *𝗗ᴜʀᴀᴛɪᴏɴ ➟ ${runtime}*
▫️📅 *𝗥ᴇʟᴇᴀꜱᴇ 𝗬ᴇᴀʀ ➟ ${year}*
▫️🎬 *𝗗ɪʀᴇᴄᴛᴏʀ ➟ ${director}*
▫️🌎 *𝗖ᴏᴜɴᴛʀʏ ➟ ${country}*
▫️👥 *𝗖ᴀꜱᴛ ➟ ${cast}*
▫️📖 *Sᴛᴏʀʏ ➟ ${description}*
▫️🔗 *Jᴏɪɴ ➟ ${sessionConfig.MGROUP_LINK || config.MGROUP_LINK}*`,

                                MOVIE_FOOTER
                            );

                        // ==================================
                        // GET DOWNLOAD URL
                        // ==================================

                        const downloadResponse =
                            await axios.get(
                                `${config.API_MAIN_URL2}/movie/cinesubz?url=${encodeURIComponent(selectedDownload.url)}&api_key=${config.API_KEY}`,
                                {
                                    timeout:
                                        30000
                                }
                            );

                        const downloadData =
                            downloadResponse
                                .data;

                        if (
                            !downloadData
                                ?.status ||
                            !downloadData
                                ?.data
                                ?.download
                        ) {
                            throw new Error(
                                'Direct download link failed'
                            );
                        }

                        const downloadLinks =
                            downloadData
                                .data
                                .download;

                        if (
                            !Array.isArray(
                                downloadLinks
                            )
                        ) {
                            throw new Error(
                                'Invalid download links'
                            );
                        }

                        const usableLinks =
                            downloadLinks.filter(
                                link =>
                                    link?.url &&
                                    String(
                                        link
                                            ?.name ||
                                        ''
                                    )
                                        .toLowerCase() !==
                                    'telegram'
                            );

                        if (
                            !usableLinks.length
                        ) {
                            throw new Error(
                                'No usable direct link'
                            );
                        }

                        const preferredLink =
                            usableLinks.find(
                                link =>
                                    String(
                                        link
                                            ?.name ||
                                        ''
                                    )
                                        .toLowerCase() ===
                                    'unknown'
                            ) ||
                            usableLinks[0];

                        // ==================================
                        // THUMBNAIL ONCE
                        // ==================================

                        const poster =
                            movieInfo.poster ||
                            BOT_IMAGE;

                        const thumbBuffer =
                            await makeThumbnail(
                                poster
                            );

                        // ==================================
                        // SEND TO GROUPS SEQUENTIALLY
                        // ==================================

                        let movieSuccess =
                            0;

                        let movieFailed =
                            0;

                        for (
                            let groupIndex = 0;
                            groupIndex <
                            targetJids.length;
                            groupIndex++
                        ) {

                            const targetJid =
                                targetJids[
                                    groupIndex
                                ];

                            try {
                                // --------------------------
                                // DETAILS CARD FIRST
                                // --------------------------

                                await socket.sendMessage(
                                    targetJid,
                                    {
                                        image: {
                                            url:
                                                poster
                                        },

                                        caption:
                                            detailsCaption
                                    }
                                );

                                await sleep(
                                    DETAILS_TO_MOVIE_DELAY
                                );

                                // --------------------------
                                // MOVIE SECOND
                                // --------------------------

                                await socket.sendMessage(
                                    targetJid,
                                    {
                                        document: {
                                            url:
                                                preferredLink
                                                    .url
                                        },

                                        mimetype:
                                            'video/mp4',

                                        fileName:
                                            downloadData
                                                .data
                                                .title ||
                                            `${movieInfo.title} ${selectedDownload.quality}.mp4`,

                                        jpegThumbnail:
                                            thumbBuffer,

                                        caption:
                                            formatMessage(
                                                `☘️ ${movieInfo.title}`,

`\`❚█${sessionConfig.MOVIE_CAPTION || config.MOVIE_CAPTION}█❚\`

\`❪${qualityDisplay}❫\``,

                                                MOVIE_FOOTER
                                            )
                                    }
                                );

                                movieSuccess++;
                                totalSuccess++;

                            } catch (
                                sendError
                            ) {

                                movieFailed++;
                                totalFailed++;

                                console.error(
                                    `Cinesend group error ${targetJid}:`,
                                    sendError
                                        ?.message ||
                                    sendError
                                );
                            }

                            // Next group delay
                            if (
                                groupIndex <
                                targetJids.length -
                                    1
                            ) {
                                await sleep(
                                    BETWEEN_GROUPS_DELAY
                                );
                            }
                        }

                        results.push(
                            `✅ ${movieInfo.title} | ${qualityDisplay} | ${sizeDisplay} | ${movieSuccess}/${targetJids.length}`
                        );

                        await socket.sendMessage(
                            sender,
                            {
                                text:
`✅ *${movieIndex + 1}/${selectedMovies.length} COMPLETE*

🎬 ${movieInfo.title}
🎞️ ${qualityDisplay}
📦 ${sizeDisplay}

✅ Sent: ${movieSuccess}
❌ Failed: ${movieFailed}`
                            }
                        );

                    } catch (
                        movieError
                    ) {

                        console.error(
                            'Cinesend movie error:',
                            movieError
                                ?.response
                                ?.data ||
                            movieError
                                ?.message ||
                            movieError
                        );

                        totalFailed++;

                        results.push(
                            `❌ ${selectedItem?.title || 'Unknown'} - ${movieError.message}`
                        );

                        await socket.sendMessage(
                            sender,
                            {
                                text:
`❌ *MOVIE FAILED*

🎬 ${selectedItem?.title || 'Unknown'}

${movieError?.response?.data?.message ||
movieError?.message ||
'Unknown Error'}

⏭️ Next movie එක continue කරනවා.`
                            }
                        );
                    }

                    // ======================================
                    // DELAY BEFORE NEXT MOVIE
                    // ======================================

                    if (
                        movieIndex <
                        selectedMovies.length -
                            1
                    ) {

                        await sleep(
                            BETWEEN_MOVIES_DELAY
                        );
                    }
                }

                // ==========================================
                // FINAL SUMMARY
                // ==========================================

                await socket.sendMessage(
                    sender,
                    {
                        react: {
                            text: '✅',
                            key:
                                replyMek.key
                        }
                    }
                );

                await socket.sendMessage(
                    sender,
                    {
                        text:
`✅ *CINESEND QUEUE COMPLETE*

🎬 Movies: *${selectedMovies.length}*
🎯 Groups: *${targetJids.length}*

📤 Successful Sends: *${totalSuccess}*
❌ Failed: *${totalFailed}*

━━━━━━━━━━━━━━

${results.join('\n')}

${invalidTargets.length
    ? `

⚠️ Invalid / inaccessible groups:
${invalidTargets.join('\n')}`
    : ''
}

> ${FOOTER}`
                    },
                    {
                        quoted:
                            replyMek
                    }
                );
            };

        socket.ev.on(
            'messages.upsert',
            selectionListener
        );

        selectionTimeout =
            setTimeout(
                () => {

                    clearSelection();

                    console.log(
                        '🧹 Cinesend selection timeout'
                    );

                },
                180000
            );

    } catch (error) {

        clearSelection();

        console.error(
            'Cinesend Error:',
            error?.response?.data ||
            error?.message ||
            error
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
                        BOT_IMAGE
                },

                caption:
                    formatMessage(
                        '❌ CINESEND ERROR',

                        `${error?.response?.data?.message ||
error?.response?.data?.error ||
error?.message ||
'Unknown Error'}`,

                        FOOTER
                    )
            },
            {
                quoted: msg
            }
        );
    }

    break;
        }        
            
            case 'kdrama':
case 'drama': {
    if (!isOwner && !isCreator) {
        await socket.sendMessage(sender, {
            text: '❌ *Only Owner & Creator Can Use This Command*'
        }, { quoted: msg });
        break;
    }

    const API_BASE = 'https://zara.laksidu.site';

    const API_KEY =
        config.API_KEY ||
        'lakiya_72b96b423d046110b5947b625e05ecf2007e009f5ba61d1c4f9a4547fb983e8b';

    const FOOTER =
        `\n\n> ${sessionConfig.BOT_FOOTER || config.BOT_FOOTER || 'Zᴇꜱʀ ✘ 〽️ᴏᴠɪᴇ Bᴏᴛ ᴠ1.1'}`;

    const chatJid =
        msg.key.remoteJid;

    const query =
        args.join(' ').trim();


    // =====================================
    // 📨 MESSAGE TEXT
    // =====================================

    const getReplyText = replyMsg => {

        const m =
            replyMsg?.message || {};

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

        const m =
            replyMsg?.message || {};

        return (
            m.extendedTextMessage?.contextInfo ||
            m.imageMessage?.contextInfo ||
            m.videoMessage?.contextInfo ||
            m.documentMessage?.contextInfo ||
            {}
        );
    };


    // =====================================
    // 👤 REQUESTER CHECK
    // PN / LID SUPPORT
    // =====================================

    const requesterCandidates =
        new Set(
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
                        : String(x || '')
                            .split('@')[0]
                            .split(':')[0]
                )
                .filter(Boolean)
                .map(String)
        );

    if (senderNumber) {
        requesterCandidates.add(
            String(senderNumber)
        );
    }


    const isRequesterReply = replyMsg => {

        if (!replyMsg?.key) {
            return false;
        }

        if (
            replyMsg.key.remoteJid !==
            chatJid
        ) {
            return false;
        }

        // Private chat
        if (!isGroup) {
            return true;
        }

        const candidates =
            (
                typeof getMessageSenderCandidates === 'function'
                    ? getMessageSenderCandidates(replyMsg)
                    : [
                        replyMsg?.key?.participant,
                        replyMsg?.key?.remoteJid
                    ]
            )
                .map(x =>
                    typeof jidNumber === 'function'
                        ? jidNumber(x)
                        : String(x || '')
                            .split('@')[0]
                            .split(':')[0]
                )
                .filter(Boolean)
                .map(String);

        return candidates.some(
            n => requesterCandidates.has(n)
        );
    };


    // =====================================
    // 🔢 WAIT NUMBER
    // =====================================

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

                    if (
                        !isRequesterReply(
                            replyMsg
                        )
                    ) {
                        continue;
                    }

                    const contextInfo =
                        getContextInfo(
                            replyMsg
                        );

                    if (
                        contextInfo?.stanzaId !==
                        messageId
                    ) {
                        continue;
                    }

                    const text =
                        getReplyText(
                            replyMsg
                        );

                    if (
                        !/^\d+$/.test(text)
                    ) {
                        continue;
                    }

                    const number =
                        Number(text);

                    if (
                        number < minimum ||
                        number > maximum
                    ) {
                        continue;
                    }

                    finish({
                        number,
                        message:
                            replyMsg
                    });

                    return;
                }
            };


            const timer =
                setTimeout(
                    () => finish(null),
                    timeout
                );

            socket.ev.on(
                'messages.upsert',
                replyHandler
            );
        });
    };


    // =====================================
    // 🧹 FILE NAME
    // =====================================

    const cleanFileName = value => {

        return String(
            value || 'KDrama'
        )
            .replace(
                /[\\/:*?"<>|]/g,
                ''
            )
            .replace(
                /\s+/g,
                ' '
            )
            .trim()
            .slice(0, 90);
    };


    // =====================================
    // ❌ NO QUERY
    // =====================================

    if (!query) {

        await socket.sendMessage(
            chatJid,
            {
                text:
`🐧 *KDRAMA DOWNLOADER*

Drama නමක් දෙන්න.

*Example:*
${prefix}kdrama My Demon${FOOTER}`
            },
            {
                quoted: msg
            }
        );

        break;
    }


    await socket.sendMessage(
        chatJid,
        {
            react: {
                text: '🔎',
                key: msg.key
            }
        }
    );


    // =====================================
    // 🔍 SEARCH
    // =====================================

    try {

        await socket.sendMessage(
            chatJid,
            {
                text:
`🐧 *Searching KDrama...*

🔎 ${query}`
            },
            {
                quoted: msg
            }
        );


        let searchResponse;

        // dramakeycc first
        try {

            searchResponse =
                await axios.get(
                    `${API_BASE}/dramakeycc/search`,
                    {
                        params: {
                            query,
                            api_key:
                                API_KEY
                        },

                        timeout:
                            60000
                    }
                );

        } catch (error) {

            console.log(
                'KDrama CC Search fallback:',
                error?.response?.data ||
                error?.message
            );

            // dramakey fallback
            searchResponse =
                await axios.get(
                    `${API_BASE}/dramakey/search`,
                    {
                        params: {
                            query,
                            api_key:
                                API_KEY
                        },

                        timeout:
                            60000
                    }
                );
        }


        let results =
            searchResponse
                ?.data
                ?.data
                ?.results ||

            searchResponse
                ?.data
                ?.results ||

            searchResponse
                ?.data
                ?.data ||

            [];


        if (
            !Array.isArray(results)
        ) {
            results = [];
        }


        // =====================================
        // DUPLICATES REMOVE
        // =====================================

        const seenResults =
            new Set();

        results =
            results.filter(item => {

                const url =
                    item?.link ||
                    item?.url;

                if (!url) {
                    return false;
                }

                if (
                    seenResults.has(url)
                ) {
                    return false;
                }

                seenResults.add(url);

                return true;
            });


        results =
            results.slice(
                0,
                20
            );


        if (!results.length) {

            await socket.sendMessage(
                chatJid,
                {
                    text:
`❌ *NO RESULTS FOUND*

🔎 ${query}${FOOTER}`
                },
                {
                    quoted: msg
                }
            );

            break;
        }


        // =====================================
        // 🐧 SEARCH RESULTS
        // =====================================

        let searchText =
`🐧 *KDRAMA SEARCH*

🔎 *${query}*

`;


        results.forEach(
            (item, index) => {

                searchText +=
                    `🐧 *${index + 1} | ${item.title || item.name || 'KDrama'}*`;

                if (item.year) {
                    searchText +=
                        ` (${item.year})`;
                }

                searchText += '\n';
            }
        );


        searchText +=
            `\n> Result number එකට reply කරන්න.${FOOTER}`;


        const firstPoster =
            results[0]?.poster ||
            results[0]?.image ||
            config.BOT_IMAGE;


        let searchMessage;


        try {

            searchMessage =
                await socket.sendMessage(
                    chatJid,
                    {
                        image: {
                            url:
                                firstPoster
                        },

                        caption:
                            searchText
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
                        text:
                            searchText
                    },
                    {
                        quoted: msg
                    }
                );
        }


        // =====================================
        // SELECT DRAMA
        // =====================================

        const dramaReply =
            await waitForNumber(
                searchMessage.key.id,
                1,
                results.length
            );


        if (!dramaReply) {

            await socket.sendMessage(
                chatJid,
                {
                    text:
`⌛ *Selection Timeout*

Command එක නැවත use කරන්න.${FOOTER}`
                }
            );

            break;
        }


        await socket.sendMessage(
            chatJid,
            {
                react: {
                    text: '✅',
                    key:
                        dramaReply
                            .message
                            .key
                }
            }
        );


        const selectedResult =
            results[
                dramaReply.number - 1
            ];


        const selectedUrl =
            selectedResult.link ||
            selectedResult.url;


        await socket.sendMessage(
            chatJid,
            {
                text:
                    '🐧 *Fetching Drama Details...*'
            },
            {
                quoted:
                    dramaReply.message
            }
        );


        // =====================================
        // 📡 INFO
        // =====================================

        let infoRaw = {};


        try {

            const response =
                await axios.get(
                    `${API_BASE}/dramakeycc/info`,
                    {
                        params: {
                            url:
                                selectedUrl,

                            api_key:
                                API_KEY
                        },

                        timeout:
                            60000
                    }
                );

            infoRaw =
                response?.data || {};

        } catch (error) {

            console.log(
                'KDrama CC info fallback:',
                error?.response?.data ||
                error?.message
            );

            try {

                const response =
                    await axios.get(
                        `${API_BASE}/dramakey/info`,
                        {
                            params: {
                                url:
                                    selectedUrl,

                                api_key:
                                    API_KEY
                            },

                            timeout:
                                60000
                        }
                    );

                infoRaw =
                    response?.data || {};

            } catch (error2) {

                console.log(
                    'KDrama info error:',
                    error2?.response?.data ||
                    error2?.message
                );
            }
        }


        // =====================================
        // 📺 TV INFO
        // =====================================

        let tvRaw = {};


        try {

            const response =
                await axios.get(
                    `${API_BASE}/dramakeycc/tvinfo`,
                    {
                        params: {
                            url:
                                selectedUrl,

                            api_key:
                                API_KEY
                        },

                        timeout:
                            60000
                    }
                );

            tvRaw =
                response?.data || {};

        } catch (error) {

            console.log(
                'KDrama TVInfo Error:',
                error?.response?.data ||
                error?.message
            );
        }


        const drama =
            infoRaw?.data?.drama ||
            infoRaw?.drama ||
            infoRaw?.data ||
            infoRaw ||
            {};


        const tvshow =
            tvRaw?.data?.tvshow ||
            tvRaw?.tvshow ||
            tvRaw?.data ||
            tvRaw ||
            {};


        // =====================================
        // ℹ️ DRAMA INFO
        // =====================================

        const title =
            drama?.title ||
            tvshow?.title ||
            selectedResult?.title ||
            selectedResult?.name ||
            'KDrama';


        const poster =
            drama?.poster ||
            drama?.image ||
            tvshow?.poster ||
            tvshow?.image ||
            selectedResult?.poster ||
            selectedResult?.image ||
            config.BOT_IMAGE;


        const year =
            drama?.year ||
            tvshow?.year ||
            selectedResult?.year ||
            'N/A';


        const language =
            drama?.language ||
            tvshow?.language ||
            selectedResult?.language ||
            'N/A';


        const description =
            drama?.description ||
            drama?.synopsis ||
            tvshow?.description ||
            tvshow?.synopsis ||
            'Description not available.';


        const genres =
            Array.isArray(
                drama?.genres
            )
                ? drama.genres.join(', ')
                : drama?.genres ||
                  tvshow?.genres ||
                  'Drama';


        // =====================================
        // 🎞️ EPISODE PARSER
        // =====================================

        let episodes = [];


        const addEpisode = (
            episode,
            index = 0,
            seasonNo = 1
        ) => {

            if (
                !episode ||
                typeof episode !==
                    'object'
            ) {
                return;
            }


            const url =
                episode.downloadUrl ||
                episode.download_url ||
                episode.downloadLink ||
                episode.download_link ||
                episode.file ||
                episode.src ||
                episode.link ||
                episode.url;


            if (
                !url ||
                typeof url !==
                    'string' ||
                !/^https?:\/\//i.test(
                    url
                )
            ) {
                return;
            }


            const number =
                Number(
                    episode.episode ||
                    episode.episode_number ||
                    episode.episodeNumber ||
                    episode.number ||
                    episode.no
                ) ||
                index + 1;


            episodes.push({

                number,

                season:
                    Number(
                        episode.season ||
                        episode.season_number ||
                        episode.seasonNumber
                    ) ||
                    seasonNo,

                title:
                    episode.title ||
                    episode.name ||
                    `Episode ${number}`,

                url
            });
        };


        // =====================================
        // 📀 SEASONS
        // =====================================

        const seasonSources = [

            drama?.seasons,

            tvshow?.seasons,

            infoRaw?.seasons,

            tvRaw?.seasons,

            infoRaw
                ?.data
                ?.seasons,

            tvRaw
                ?.data
                ?.seasons
        ];


        for (
            const source
            of seasonSources
        ) {

            if (!source) {
                continue;
            }


            let seasons =
                source;


            if (
                !Array.isArray(
                    seasons
                ) &&
                typeof seasons ===
                    'object'
            ) {

                seasons =
                    Object.values(
                        seasons
                    );
            }
            if (
    !Array.isArray(
        seasons
    )
) {
    continue;
}

seasons.forEach(
    (
        season,
        seasonIndex
    ) => {

        const seasonNo =
            Number(
                season?.season ||
                season?.number ||
                season?.season_number ||
                season?.seasonNumber
            ) ||
            seasonIndex + 1;

        let eps =
            season?.episodes ||
            season?.items ||
            season?.episode ||
            [];

        if (
            !Array.isArray(eps) &&
            eps &&
            typeof eps === 'object'
        ) {
            eps = Object.values(eps);
        }

        if (
            Array.isArray(eps)
        ) {
            eps.forEach(
                (
                    episode,
                    index
                ) => {
                    addEpisode(
                        episode,
                        index,
                        seasonNo
                    );
                }
            );
        }
    }
);

if (episodes.length) {
    break;
}
}


// =====================================
// 🎬 DIRECT EPISODES
// =====================================

if (!episodes.length) {

    const episodeSources = [
        drama?.episodes,
        tvshow?.episodes,
        infoRaw?.episodes,
        tvRaw?.episodes,
        infoRaw?.data?.episodes,
        tvRaw?.data?.episodes,
        drama?.items,
        tvshow?.items
    ];

    for (
        const source
        of episodeSources
    ) {

        if (!source) {
            continue;
        }

        let eps = source;

        if (
            !Array.isArray(eps) &&
            typeof eps === 'object'
        ) {
            eps = Object.values(eps);
        }

        if (
            !Array.isArray(eps)
        ) {
            continue;
        }

        eps.forEach(
            (
                episode,
                index
            ) => {
                addEpisode(
                    episode,
                    index,
                    1
                );
            }
        );

        if (episodes.length) {
            break;
        }
    }
}


// =====================================
// 🔍 DEEP EPISODE FALLBACK
// =====================================

const scanEpisodes = (
    value,
    depth = 0
) => {

    if (
        !value ||
        depth > 8
    ) {
        return;
    }

    if (Array.isArray(value)) {

        value.forEach(
            (
                item,
                index
            ) => {

                if (
                    item &&
                    typeof item === 'object'
                ) {

                    const looksLikeEpisode =
                        item.episode !== undefined ||
                        item.episode_number !== undefined ||
                        item.episodeNumber !== undefined ||
                        item.number !== undefined ||
                        /episode|ep\s*\d+/i.test(
                            String(
                                item.title ||
                                item.name ||
                                ''
                            )
                        );

                    if (looksLikeEpisode) {
                        addEpisode(
                            item,
                            index,
                            1
                        );
                    }
                }

                scanEpisodes(
                    item,
                    depth + 1
                );
            }
        );

        return;
    }

    if (
        typeof value === 'object'
    ) {
        for (
            const child
            of Object.values(value)
        ) {
            scanEpisodes(
                child,
                depth + 1
            );
        }
    }
};


// TVINFO first
if (!episodes.length) {
    scanEpisodes(tvRaw);
}

// INFO fallback
if (!episodes.length) {
    scanEpisodes(infoRaw);
}


// =====================================
// 🧹 REMOVE DUPLICATES
// =====================================

const seenEpisodes = new Set();

episodes = episodes.filter(
    episode => {

        if (!episode?.url) {
            return false;
        }

        const key =
            `${episode.season}|${episode.number}|${episode.url}`;

        if (
            seenEpisodes.has(key)
        ) {
            return false;
        }

        seenEpisodes.add(key);

        return true;
    }
);


// =====================================
// 🔢 SORT EPISODES
// =====================================

episodes.sort(
    (a, b) => {

        const seasonA =
            Number(a.season) || 1;

        const seasonB =
            Number(b.season) || 1;

        if (
            seasonA !== seasonB
        ) {
            return seasonA - seasonB;
        }

        return (
            (Number(a.number) || 0) -
            (Number(b.number) || 0)
        );
    }
);


console.log(
    '🐧 KDRAMA EPISODES:',
    episodes.length
);


if (!episodes.length) {

    console.log(
        '❌ KDRAMA INFO RAW:',
        JSON.stringify(
            infoRaw,
            null,
            2
        )
    );

    console.log(
        '❌ KDRAMA TVINFO RAW:',
        JSON.stringify(
            tvRaw,
            null,
            2
        )
    );

    throw new Error(
        'Episodes not found.'
    );
}


// =====================================
// 📝 DESCRIPTION
// =====================================

const shortDescription =
    String(
        description ||
        'Description not available.'
    ).length > 400

        ? `${String(description).slice(0, 400)}...`

        : String(
            description ||
            'Description not available.'
        );


// =====================================
// 🐧 DRAMA DETAILS
// =====================================

const detailsText =
`🐧 *${title}*

📅 *Year:* ${year}
🌐 *Language:* ${language}
🎭 *Genres:* ${genres}
🎞️ *Episodes:* ${episodes.length}

📝 ${shortDescription}${FOOTER}`;


try {

    await socket.sendMessage(
        chatJid,
        {
            image: {
                url: poster
            },
            caption: detailsText
        },
        {
            quoted:
                dramaReply.message
        }
    );

} catch {

    await socket.sendMessage(
        chatJid,
        {
            text: detailsText
        },
        {
            quoted:
                dramaReply.message
        }
    );
}


// =====================================
// 📺 EPISODE LIST
// =====================================

let episodeText =
`🐧 *EPISODE LIST*

🎬 *${title}*

📦 *0 | Download All Episodes*

`;


episodes.forEach(
    (
        episode,
        index
    ) => {

        episodeText +=
            `🐧 *${index + 1} | Episode ${episode.number}*\n`;
    }
);


episodeText +=
    `\n> Episode number එකට reply කරන්න.${FOOTER}`;


const episodeMessage =
    await socket.sendMessage(
        chatJid,
        {
            text: episodeText
        },
        {
            quoted:
                dramaReply.message
        }
    );


// =====================================
// 🔢 SELECT EPISODE
// =====================================

const episodeReply =
    await waitForNumber(
        episodeMessage.key.id,
        0,
        episodes.length,
        180000
    );


if (!episodeReply) {

    await socket.sendMessage(
        chatJid,
        {
            text:
`⌛ *Episode Selection Timeout*

Command එක නැවත use කරන්න.${FOOTER}`
        },
        {
            quoted:
                episodeMessage
        }
    );

    break;
}


await socket.sendMessage(
    chatJid,
    {
        react: {
            text: '📥',
            key:
                episodeReply.message.key
        }
    }
);


// =====================================
// 📦 DOWNLOAD SELECTION
// =====================================

const downloadEpisodes =
    episodeReply.number === 0
        ? episodes
        : [
            episodes[
                episodeReply.number - 1
            ]
        ];


// =====================================
// 🖼️ THUMBNAIL
// =====================================

let jpegThumbnail;

if (
    poster &&
    /^https?:\/\//i.test(
        poster
    )
) {

    try {

        const response =
            await axios.get(
                poster,
                {
                    responseType:
                        'arraybuffer',

                    timeout:
                        30000,

                    headers: {
                        'User-Agent':
                            'Mozilla/5.0'
                    }
                }
            );

        jpegThumbnail =
            await sharp(
                Buffer.from(
                    response.data
                )
            )
                .resize(
                    300,
                    300,
                    {
                        fit: 'cover'
                    }
                )
                .jpeg({
                    quality: 75
                })
                .toBuffer();

    } catch (thumbnailError) {

        console.log(
            'KDrama Thumbnail Error:',
            thumbnailError?.message
        );

        jpegThumbnail =
            undefined;
    }
}


// =====================================
// ⬇️ DOWNLOAD START
// =====================================

if (
    episodeReply.number === 0
) {

    await socket.sendMessage(
        chatJid,
        {
            text:
`📦 *DOWNLOAD ALL STARTED*

🐧 *${title}*
🎞️ Episodes: ${downloadEpisodes.length}

⏳ Please wait...${FOOTER}`
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
`⬇️ *Downloading Episode ${downloadEpisodes[0].number}...*`
        },
        {
            quoted:
                episodeReply.message
        }
    );
}


let successCount = 0;
let failedCount = 0;


// =====================================
// 📥 SEND EPISODES
// =====================================

for (
    let index = 0;
    index < downloadEpisodes.length;
    index++
) {

    const episode =
        downloadEpisodes[index];

    try {

        let directUrl =
            String(
                episode.url
            ).trim();

        // Remove preview query
        directUrl =
            directUrl.replace(
                /\?preview.*$/i,
                ''
            );


        if (
            !/^https?:\/\//i.test(
                directUrl
            )
        ) {
            throw new Error(
                'Invalid episode URL'
            );
        }


        const extension =
            directUrl.match(
                /\.(mkv|mp4)(?:\?|$)/i
            )?.[1]?.toLowerCase() ||
            'mp4';


        const mimeType =
            extension === 'mkv'
                ? 'video/x-matroska'
                : 'video/mp4';


        const seasonNumber =
            String(
                episode.season || 1
            ).padStart(
                2,
                '0'
            );


        const episodeNumber =
            String(
                episode.number
            ).padStart(
                2,
                '0'
            );


        const safeTitle =
            cleanFileName(
                title
            );


        const fileName =
            `${safeTitle} ` +
            `S${seasonNumber}` +
            `E${episodeNumber}.` +
            extension;


        await socket.sendMessage(
            chatJid,
            {
                document: {
                    url: directUrl
                },

                mimetype:
                    mimeType,

                fileName,

                jpegThumbnail,

                caption:
`🐧 *${title}*

🎞️ *Episode:* ${episode.number}
📀 *Season:* ${episode.season || 1}
🌐 *Language:* ${language}
📁 *Format:* ${extension.toUpperCase()}

${sessionConfig.MOVIE_CAPTION || config.MOVIE_CAPTION || ''}${FOOTER}`
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
            `❌ KDRAMA EPISODE ${episode.number}:`,
            episodeError?.response?.data ||
            episodeError?.message ||
            episodeError
        );


        await socket.sendMessage(
            chatJid,
            {
                text:
`❌ *Episode ${episode.number} Failed!*

${episodeError?.response?.data?.message ||
episodeError?.message ||
'Download failed'}${FOOTER}`
            },
            {
                quoted:
                    episodeReply.message
            }
        );
    }


    // Small delay between files
    if (
        index <
        downloadEpisodes.length - 1
    ) {
        await delay(3000);
    }
}


// =====================================
// ✅ DOWNLOAD COMPLETE
// =====================================

await socket.sendMessage(
    chatJid,
    {
        text:
`✅ *DOWNLOAD COMPLETED*

🐧 *${title}*

🎞️ Total: ${downloadEpisodes.length}
✅ Success: ${successCount}
❌ Failed: ${failedCount}${FOOTER}`
    },
    {
        quoted:
            episodeReply.message
    }
);


await socket.sendMessage(
    chatJid,
    {
        react: {
            text:
                failedCount === 0
                    ? '✅'
                    : '⚠️',

            key:
                episodeReply.message.key
        }
    }
);


} catch (error) {

    console.error(
        '❌ KDRAMA ERROR:',
        error?.response?.data ||
        error?.message ||
        error
    );


    await socket.sendMessage(
        chatJid,
        {
            text:
`❌ *KDRAMA ERROR*

${error?.response?.data?.message ||
error?.response?.data?.error ||
error?.message ||
'Unknown Error'}${FOOTER}`
        },
        {
            quoted: msg
        }
    );
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
│ 🧸 ".scartoon"
│ 🍿 ".cartoontv"
│ 🎏 ".kdrama"
│ 🍯 ".tinkiri"
*╰────────●●►*

╭─「 𝐌𝐄𝐃𝐈𝐀 𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃 」
│ 🎵 ".song"
│ 🎶 ".tiktok"
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
break; 

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

            
 case 'pair':
case 'paircode': {
    if (!isCreator) {
        return await socket.sendMessage(sender, {
            text: '❌ *Creator Only Command*'
        }, { quoted: msg });
    }

    const inputNumber = String(args?.[0] || '').replace(/\D/g, '');

    if (!inputNumber || inputNumber.length < 8) {
        return await socket.sendMessage(sender, {
            text: `📱 *PAIR CODE*\n\nUsage: .pair 947XXXXXXXX\n\n> ${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
        }, { quoted: msg });
    }

    // Do not generate a new code for an already-online linked number.
    if (activeSockets.has(inputNumber)) {
        return await socket.sendMessage(sender, {
            text: `⚠️ *Already Linked & Online*\n\n📱 ${inputNumber}\n\n> ${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
        }, { quoted: msg });
    }

    if (pairingNumbers.has(inputNumber)) {
        return await socket.sendMessage(sender, {
            text: '⏳ *Pairing is already in progress for this number.*'
        }, { quoted: msg });
    }

    try {
        await socket.sendMessage(sender, {
            react: { text: '⏳', key: msg.key }
        }).catch(() => {});

        pairingNumbers.add(inputNumber);

        let capturedCode = null;
        let capturedError = null;

        // EmpirePair normally writes the code to an Express response. This small
        // response adapter lets the same safe pairing flow be used from WhatsApp.
        const commandResponse = {
            headersSent: false,
            statusCode: 200,
            status(code) {
                this.statusCode = code;
                return this;
            },
            send(payload) {
                this.headersSent = true;
                if (payload?.code) capturedCode = String(payload.code);
                if (payload?.error) capturedError = String(payload.error);
                return this;
            }
        };

        await EmpirePair(inputNumber, commandResponse, { pairing: true });

        if (!capturedCode) {
            throw new Error(capturedError || 'Pair code could not be generated');
        }

        const prettyCode = capturedCode.match(/.{1,4}/g)?.join('-') || capturedCode;

        await socket.sendMessage(sender, {
            text:
`🔗 *WHATSAPP PAIR CODE*\n\n📱 *Number:* ${inputNumber}\n🔐 *Code:* \`${prettyCode}\`\n\nWhatsApp → Linked Devices → Link with phone number\n\n> ${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
        }, { quoted: msg });

        await socket.sendMessage(sender, {
            react: { text: '✅', key: msg.key }
        }).catch(() => {});

    } catch (error) {
        console.error('PAIR COMMAND ERROR:', error?.message || error);

        await socket.sendMessage(sender, {
            text: `❌ *Pair Code Failed*\n\n${error?.message || 'Try again later.'}`
        }, { quoted: msg });
    } finally {
        setTimeout(() => pairingNumbers.delete(inputNumber), 8000).unref?.();
    }

    break;
}

case 'channeljid':
case 'cjid': {
    if (!isCreator) {
        return await socket.sendMessage(sender, {
            text: '❌ *Creator Only Command*'
        }, { quoted: msg });
    }

    const input = args.join(' ').trim();

    if (!input) {
        return await socket.sendMessage(sender, {
            text:
`📢 *CHANNEL JID FINDER*\n\nUsage:\n.channeljid https://whatsapp.com/channel/XXXXXXXX\n\n> ${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
        }, { quoted: msg });
    }

    try {
        const match = input.match(/whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/i);
        const inviteCode = match?.[1] || input.replace(/[^A-Za-z0-9_-]/g, '');

        if (!inviteCode) throw new Error('Invalid WhatsApp Channel link');

        const meta = await socket.newsletterMetadata('invite', inviteCode);
        const channelJid = meta?.id;

        if (!channelJid || !String(channelJid).endsWith('@newsletter')) {
            throw new Error('Channel JID not found');
        }

        await socket.sendMessage(sender, {
            text:
`📢 *CHANNEL JID*\n\n📝 *Name:* ${meta?.name || 'WhatsApp Channel'}\n🆔 *JID:* \`${channelJid}\`\n\n> ${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
        }, { quoted: msg });

    } catch (error) {
        console.error('CHANNEL JID ERROR:', error?.message || error);

        await socket.sendMessage(sender, {
            text: `❌ *Channel JID Failed*\n\n${error?.message || 'Invalid channel link.'}`
        }, { quoted: msg });
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

const authSyncTimers = new Map();

async function readAuthFolder(sessionPath) {
    const authFiles = [];

    if (!fs.existsSync(sessionPath)) return authFiles;

    const names = await fs.readdir(sessionPath);
    for (const name of names) {
        const fullPath = path.join(sessionPath, name);

        try {
            const stat = await fs.stat(fullPath);
            if (!stat.isFile()) continue;

            // useMultiFileAuthState stores JSON files here.
            const data = await fs.readFile(fullPath, 'utf8');
            authFiles.push({ name, data });
        } catch (error) {
            console.log(`Auth file read skipped (${name}):`, error?.message || error);
        }
    }

    return authFiles;
}

async function persistSessionFolder(number, sessionPath) {
    const sanitizedNumber = String(number || '').replace(/[^0-9]/g, '');
    if (!sanitizedNumber) return;

    const authFiles = await readAuthFolder(sessionPath);
    if (!authFiles.length) return;

    let creds = {};
    const credsFile = authFiles.find(file => file.name === 'creds.json');

    if (credsFile) {
        try {
            creds = JSON.parse(credsFile.data);
        } catch (_) {}
    }

    await Session.findOneAndUpdate(
        { number: sanitizedNumber },
        {
            $set: {
                creds,
                authFiles,
                updatedAt: new Date()
            }
        },
        { upsert: true }
    );

    let numbers = [];
    if (fs.existsSync(NUMBER_LIST_PATH)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
            numbers = Array.isArray(parsed) ? parsed : [];
        } catch (_) {
            numbers = [];
        }
    }

    if (!numbers.includes(sanitizedNumber)) {
        numbers.push(sanitizedNumber);
        fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
    }
}

function scheduleSessionSync(number, sessionPath, waitMs = 500) {
    const sanitizedNumber = String(number || '').replace(/[^0-9]/g, '');
    if (!sanitizedNumber) return;

    const oldTimer = authSyncTimers.get(sanitizedNumber);
    if (oldTimer) clearTimeout(oldTimer);

    const timer = setTimeout(async () => {
        authSyncTimers.delete(sanitizedNumber);
        try {
            await persistSessionFolder(sanitizedNumber, sessionPath);
        } catch (error) {
            console.error(`Session sync failed for ${sanitizedNumber}:`, error?.message || error);
        }
    }, waitMs);

    authSyncTimers.set(sanitizedNumber, timer);
}

async function restoreSession(number) {
    try {
        const sanitizedNumber = String(number || '').replace(/[^0-9]/g, '');
        const session = await Session.findOne({ number: sanitizedNumber }).lean();
        if (!session) return false;

        const authFiles = Array.isArray(session.authFiles) ? session.authFiles : [];

        // Old versions saved only creds.json to MongoDB. That is not a complete
        // Baileys auth state, so do not recreate a broken session from it.
        if (!authFiles.some(file => file?.name === 'creds.json')) {
            console.log(`⚠️ Legacy/incomplete Mongo session for ${sanitizedNumber}; fresh pairing required once.`);
            return false;
        }

        const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);
        fs.ensureDirSync(sessionPath);
        fs.emptyDirSync(sessionPath);

        for (const file of authFiles) {
            if (!file?.name || typeof file.data !== 'string') continue;
            // Keep writes inside the session folder.
            const safeName = path.basename(file.name);
            await fs.writeFile(path.join(sessionPath, safeName), file.data, 'utf8');
        }

        return true;
    } catch (error) {
        console.error(`Session restore failed for ${number}:`, error?.message || error);
        return false;
    }
}

async function clearAuthState(number) {
    const sanitizedNumber = String(number || '').replace(/[^0-9]/g, '');

    try {
        // Keep user config, but clear invalid WhatsApp auth after a real 401 logout.
        await Session.findOneAndUpdate(
            { number: sanitizedNumber },
            {
                $set: {
                    creds: {},
                    authFiles: [],
                    updatedAt: new Date()
                }
            }
        );

        const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);
        if (fs.existsSync(sessionPath)) {
            fs.removeSync(sessionPath);
        }

        if (fs.existsSync(NUMBER_LIST_PATH)) {
            try {
                const parsed = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
                const numbers = (Array.isArray(parsed) ? parsed : [])
                    .filter(n => n !== sanitizedNumber);
                fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
            } catch (_) {}
        }
    } catch (error) {
        console.error(`Failed to clear auth for ${sanitizedNumber}:`, error?.message || error);
    }
}

async function deleteSession(number) {
    try {
        const sanitizedNumber = String(number || '').replace(/[^0-9]/g, '');
        await Session.deleteOne({ number: sanitizedNumber });

        const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);
        if (fs.existsSync(sessionPath)) {
            fs.removeSync(sessionPath);
        }

        if (fs.existsSync(NUMBER_LIST_PATH)) {
            let numbers = [];
            try {
                const parsed = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
                numbers = Array.isArray(parsed) ? parsed : [];
            } catch (_) {}

            numbers = numbers.filter(n => n !== sanitizedNumber);
            fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
        }
    } catch (error) {
        console.error(`Failed to delete session ${number}:`, error?.message || error);
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
function getDisconnectStatusCode(lastDisconnect) {
    return (
        lastDisconnect?.error?.output?.statusCode ||
        lastDisconnect?.error?.statusCode ||
        lastDisconnect?.error?.data?.statusCode ||
        null
    );
}

function setupAutoRestart(socket, number) {
    const sanitized = String(number || '').replace(/[^0-9]/g, '');

    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            reconnectingNumbers.delete(sanitized);
            console.log(`✅ Connection established for ${sanitized}`);
            return;
        }

        if (connection !== 'close') return;

        const statusCode = getDisconnectStatusCode(lastDisconnect);
        console.log(`⚠️ Connection closed for ${sanitized}. Code: ${statusCode ?? 'unknown'}`);

        // A real WhatsApp logout/unlink. Do NOT keep reconnecting with invalid auth.
        if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
            reconnectingNumbers.delete(sanitized);
            activeSockets.delete(sanitized);
            socketCreationTime.delete(sanitized);
            await clearAuthState(sanitized);
            console.log(`❌ ${sanitized} was unlinked by WhatsApp/user. Fresh pairing is required.`);
            return;
        }

        // If a newer socket for this number is already open, this old socket was
        // simply replaced. Do not start a reconnect war between two sockets.
        const current = activeSockets.get(sanitized)?.socket;
        if (statusCode === DisconnectReason.connectionReplaced || statusCode === 440) {
            if (current && current !== socket) {
                console.log(`ℹ️ Old socket replaced for ${sanitized}; newer socket is active.`);
                return;
            }
        }

        if (reconnectingNumbers.has(sanitized)) return;
        reconnectingNumbers.add(sanitized);

        let attempt = 0;
        while (reconnectingNumbers.has(sanitized)) {
            attempt += 1;

            // 515 is the normal "restart required" flow that can occur after pairing.
            const waitMs = (statusCode === DisconnectReason.restartRequired || statusCode === 515)
                ? 1500
                : Math.min(3000 * attempt, 30000);

            console.log(`🔄 Reconnecting ${sanitized} in ${Math.round(waitMs / 1000)}s (attempt ${attempt})...`);
            await delay(waitMs);

            try {
                activeSockets.delete(sanitized);
                socketCreationTime.delete(sanitized);

                await EmpirePair(sanitized, null, { pairing: false });
                await delay(12000);

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

async function waitForConnecting(socket, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        let finished = false;

        const cleanup = () => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            socket.ev.off('connection.update', onUpdate);
        };

        const onUpdate = (update) => {
            const { connection, qr, lastDisconnect } = update || {};

            if (connection === 'connecting' || qr) {
                cleanup();
                resolve(true);
                return;
            }

            if (connection === 'close') {
                cleanup();
                const code = getDisconnectStatusCode(lastDisconnect);
                reject(new Error(`Socket closed before pairing code (${code ?? 'unknown'})`));
            }
        };

        const timer = setTimeout(() => {
            cleanup();
            // Some builds do not always emit "connecting" to userland. Allow one
            // controlled fallback attempt instead of hanging the HTTP request.
            resolve(false);
        }, timeoutMs);

        socket.ev.on('connection.update', onUpdate);
    });
}

const pairingNumbers = new Set();

async function EmpirePair(number, res = null, { pairing = false } = {}) {
    const sanitizedNumber = String(number || '').replace(/[^0-9]/g, '');

    if (!sanitizedNumber || sanitizedNumber.length < 8) {
        if (res && !res.headersSent) {
            res.status(400).send({ error: 'Invalid phone number' });
        }
        return null;
    }

    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);
    fs.ensureDirSync(sessionPath);

    // Restore the COMPLETE auth folder (creds + Signal keys) from MongoDB.
    await restoreSession(sanitizedNumber);

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    try {
        const { version } = await fetchLatestBaileysVersion();

        const socket = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            version,
            browser: Browsers.macOS('Safari'),
            markOnlineOnConnect: false,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 20000,
            defaultQueryTimeoutMs: 60000,
            syncFullHistory: false
        });

        socketCreationTime.set(sanitizedNumber, Date.now());

        // Attach auth persistence BEFORE requesting a pairing code. Pairing can
        // update credentials immediately, and missing those updates corrupts auth.
        const originalKeySet = state.keys.set.bind(state.keys);
        state.keys.set = async (data) => {
            await originalKeySet(data);
            scheduleSessionSync(sanitizedNumber, sessionPath, 350);
        };

        socket.ev.on('creds.update', async () => {
            try {
                await saveCreds();
                await persistSessionFolder(sanitizedNumber, sessionPath);
            } catch (error) {
                console.error(`Credential save failed for ${sanitizedNumber}:`, error?.message || error);
            }
        });

        setupCommandHandlers(socket, sanitizedNumber);
        setupAutoRestart(socket, sanitizedNumber);

        socket.ev.on('connection.update', async (update) => {
            const { connection } = update;

            if (connection === 'open') {
                try {
                    reconnectingNumbers.delete(sanitizedNumber);

                    await delay(1500);
                    await socket.sendPresenceUpdate('unavailable').catch(() => {});

                    try {
                        const lidStore = socket.signalRepository?.lidMapping;
                        const userJid = jidNormalizedUser(socket.user.id);

                        if (lidStore && isPnUser(userJid)) {
                            const lid = await lidStore.getLIDForPN(userJid);
                            console.log(`✅ ${sanitizedNumber} → PN: ${userJid} → LID: ${lid}`);
                        }
                    } catch (lidError) {
                        console.log(`⚠️ LID mapping not available yet for ${sanitizedNumber}:`, lidError?.message || lidError);
                    }

                    const presenceTimer = setInterval(() => {
                        socket.sendPresenceUpdate('unavailable').catch(() => {});
                    }, 30000);
                    presenceTimer.unref?.();

                    const userJid = jidNormalizedUser(socket.user.id);
                    const sessionConfig = await loadUserConfig(sanitizedNumber);

                    // Only NOW is the socket considered active.
                    activeSockets.set(sanitizedNumber, { socket, config: sessionConfig });

                    await persistSessionFolder(sanitizedNumber, sessionPath);

                    // Welcome failure must never restart/logout the whole bot.
                    try {
                        await socket.sendMessage(userJid, {
                            image: { url: sessionConfig.BOT_IMAGE || config.BOT_IMAGE },
                            caption: formatMessage(
                                '✨ Bot Activated !',
                                `📱 *Number:* ${sanitizedNumber}\n🕒 *Time:* ${getSriLankaTimestamp()}\n🟢 *Status:* Online`,
                                'Simple & Clean 🐾                 ㅤㅤ    ㅤ © Zᴇꜱʀ ✘ 〽️ᴏᴠɪᴇ Bᴏᴛ ᴠ1.1'
                            )
                        });
                    } catch (welcomeError) {
                        console.log(`Welcome message skipped for ${sanitizedNumber}:`, welcomeError?.message || welcomeError);
                    }

                } catch (error) {
                    console.error(`connection.open setup error for ${sanitizedNumber}:`, error?.message || error);
                }
            }
        });

        if (pairing) {
            // If a complete saved auth state already exists, never call logout just
            // to generate another code. Let the saved linked device reconnect.
            if (state.creds.registered) {
                if (res && !res.headersSent) {
                    res.status(409).send({
                        error: 'This number already has a saved linked session. Wait for reconnect, or use the bot logout command before pairing again.'
                    });
                }
                return socket;
            }

            let code = null;
            let lastError = null;

            // The maintained fork recommends requesting the code when the socket
            // reaches the connecting stage.
            await waitForConnecting(socket, 12000).catch(() => false);

            for (let attempt = 1; attempt <= Math.max(1, config.MAX_RETRIES || 3); attempt++) {
                try {
                    await delay(attempt === 1 ? 800 : 1500 * attempt);
                    code = await socket.requestPairingCode(sanitizedNumber);
                    if (code) break;
                } catch (error) {
                    lastError = error;
                    console.log(`Pair code attempt ${attempt} failed for ${sanitizedNumber}:`, error?.message || error);
                }
            }

            if (!code) {
                throw lastError || new Error('Unable to generate pairing code');
            }

            if (res && !res.headersSent) {
                res.send({ code });
            }
        }

        return socket;

    } catch (error) {
        console.error('Pairing/reconnect error:', error?.message || error);
        socketCreationTime.delete(sanitizedNumber);

        if (res && !res.headersSent) {
            res.status(503).send({
                error: error?.message || 'Service Unavailable'
            });
        }

        return null;
    }
}

router.get('/', async (req, res) => {
    const { number } = req.query;

    if (!number) {
        return res.status(400).send({ error: 'Number parameter is required' });
    }

    const sanitizedNumber = String(number).replace(/[^0-9]/g, '');

    if (sanitizedNumber.length < 8) {
        return res.status(400).send({ error: 'Invalid phone number' });
    }

    // CRITICAL FIX: the old route called socket.logout() here, which remotely
    // unlinked an already connected device whenever someone requested a pair code.
    if (activeSockets.has(sanitizedNumber)) {
        return res.status(409).send({
            error: 'This number is already linked and online.'
        });
    }

    if (pairingNumbers.has(sanitizedNumber)) {
        return res.status(429).send({
            error: 'Pairing is already in progress. Please wait a few seconds.'
        });
    }

    pairingNumbers.add(sanitizedNumber);

    try {
        await EmpirePair(sanitizedNumber, res, { pairing: true });
    } finally {
        // Prevent rapid duplicate pairing sockets/codes for the same number.
        setTimeout(() => pairingNumbers.delete(sanitizedNumber), 8000).unref?.();
    }
});

// Never call socket.logout() or erase auth files during app shutdown/restart.
// logout() means "unlink this device from WhatsApp", not "close the process".
async function closeSocketsWithoutLogout() {
    for (const [number, data] of activeSockets.entries()) {
        try {
            data?.socket?.end?.(new Error('Server shutting down'));
        } catch (_) {}
        try {
            data?.socket?.ws?.close?.();
        } catch (_) {}
        activeSockets.delete(number);
        socketCreationTime.delete(number);
    }
}

process.on('SIGTERM', () => {
    closeSocketsWithoutLogout().finally(() => process.exit(0));
});

process.on('SIGINT', () => {
    closeSocketsWithoutLogout().finally(() => process.exit(0));
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    // Heroku/container process managers handle restarts. Do not run pm2 here.
});

export default router;
    
      
