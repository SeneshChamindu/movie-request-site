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
    API_MAIN_URL: 'https://api-siteh-22e22e4cb068.herokuapp.com',
    API_MAIN_URL2:'https://api.laksidu.site',
    API_CINESUBZ_URL:'https://api-siteh-22e22e4cb068.herokuapp.com',
    API_MOVIE_URL: 'https://api-siteh-22e22e4cb068.herokuapp.com',
    API_KEY:'lakiya_72b96b423d046110b5947b625e05ecf2007e009f5ba61d1c4f9a4547fb983e8b',
    BOT_IMAGE:'https://cloud.laksidu.site/dl/ekd2TaS5eS/IMG_20251127_192734_723.webp',
    BOT_FOOTER:"Zᴇꜱʀ ✘ 〽️ᴏᴠɪᴇ Bᴏᴛ ᴠ1.1",
    MGROUP_LINK: 'https://whatsapp.com/channel/0029VbBEDft3AzNTaN02u739',
    MOVIE_FOOTER:"⏤͟͟͞͞★❮ Sᴇɴᴇ Oꜰᴄ 〽️ᴏᴠɪᴇꜱ ⏤͟͟͞͞★",
    MOVIE_CAPTION:"🥷 𝐙𝐞𝐬𝐫 𝐎𝐟𝐜",
    PREFIX: '.',
    OWNER_NUMBERS: ['94761393578', '94775862392'],
    CREATOR_NUMBER: '94775862392',
    ANTISTATUS: 'off',
    ANTISTATUS_GROUPS: {},
    BOT_NAME: "Zᴇꜱʀ ✘ 〽️ᴏᴠɪᴇ Bᴏᴛ",
    AIR_FOOTER: "Zᴇꜱʀ Bᴏᴛ ᴠ1.0.0",
    MODE: 'public',
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
        console.error('MongoDB connection failed:', error);
        process.exit(1);
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

        const isCmd = text.startsWith(sessionConfig.PREFIX || '!');

        if (!sessionConfig.MODE === 'public') return;
        if (!isOwner && sessionConfig.MODE === 'private') return;
        if (!isOwner && isGroup && sessionConfig.MODE === 'inbox') return;
        if (!isOwner && !isGroup && sessionConfig.MODE === 'groups') return;

        if (isCmd && sessionConfig.READ_CMD === 'true') {
            try {
                await socket.readMessages([msg.key]);
            } catch (error) {
               
            }
        }

        if (!isCmd) return;
        const parts = text.slice((sessionConfig.PREFIX || '!').length).trim().split(/\s+/);
        const command = parts[0].toLowerCase();
        const args = parts.slice(1);

        const groupMetadata = isGroup ? await socket.groupMetadata(msg.key.remoteJid) : {};
        const participants = groupMetadata.participants || [];
        const groupAdmins = participants.filter((p) => p.admin).map((p) => p.id);
        const groupAdminNumbers = groupAdmins.map(jidNumber);
        const isBotAdmins = groupAdminNumbers.includes(jidNumber(socket.user.id));
        const isAdmins = senderNumbers.some(n => groupAdminNumbers.includes(n));

        const reply = async (text, options = {}) => {
            await socket.sendMessage(msg.key.remoteJid, { text, ...options }, { quoted: msg });
        };

        try {

    switch (command) {

        case 'cinesubz':
            if ( !isCreator) {
    return await socket.sendMessage(sender, {
        text: '❌ *Only Authorized Users Can Use This Command*'
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

> Zᴇꜱʀ ✘ 〽️ᴏᴠɪᴇ Bᴏᴛ ᴠ1.1`
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
        case'sinhalasub':{
            if ( !isCreator) {
    return await socket.sendMessage(sender, {
        text: '❌ *Only Authorized Users Can Use This Command*'
    }, { quoted: msg });
            }
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

                             
                                
                                const thumbUrl = movieInfo.poster || selectedMovie.poster || sessionConfig.BOT_IMAGE || config.BOT_IMAGE;
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
    break;}
                 
    case 'antistatus': {
    try {
        // ==========================================
        // GROUP ONLY
        // ==========================================
        if (!isGroup) {
            return await socket.sendMessage(sender, {
                text: '❌ *This command can only be used in groups.*'
            }, { quoted: msg });
        }

        // ==========================================
        // SAFE NUMBER EXTRACTOR
        // PN / LID / DEVICE JID SUPPORT
        // ==========================================
        const antiCleanNumber = (jid = '') => {
            return String(jid)
                .split('@')[0]
                .split(':')[0]
                .replace(/\D/g, '');
        };

        const antiSenderJid =
            msg.key?.participant ||
            msg.participant ||
            msg.key?.remoteJid ||
            '';

        const antiSenderNumber = antiCleanNumber(antiSenderJid);

        const antiBotJid = socket.user?.id || '';
        const antiBotNumber = antiCleanNumber(antiBotJid);

        // ==========================================
        // GET FRESH GROUP METADATA
        // ==========================================
        const antiMetadata = await socket.groupMetadata(sender);
        const antiParticipants = antiMetadata?.participants || [];

        // ==========================================
        // CHECK USER ADMIN
        // ==========================================
        let antiIsUserAdmin = false;

        for (const p of antiParticipants) {
            if (!p?.admin) continue;

            const participantNumber = antiCleanNumber(p.id);

            if (
                jidNormalizedUser(p.id || '') ===
                    jidNormalizedUser(antiSenderJid || '') ||
                participantNumber === antiSenderNumber
            ) {
                antiIsUserAdmin = true;
                break;
            }
        }

        // ==========================================
        // CHECK BOT ADMIN
        // ==========================================
        let antiIsBotAdmin = false;

        for (const p of antiParticipants) {
            if (!p?.admin) continue;

            const participantNumber = antiCleanNumber(p.id);

            if (
                jidNormalizedUser(p.id || '') ===
                    jidNormalizedUser(antiBotJid || '') ||
                participantNumber === antiBotNumber
            ) {
                antiIsBotAdmin = true;
                break;
            }
        }

        // ==========================================
        // LID -> PN FALLBACK
        // BAILEYS V7 SUPPORT
        // ==========================================
        try {
            const antiLidStore =
                socket.signalRepository?.lidMapping;

            if (antiLidStore) {

                // BOT ADMIN FALLBACK
                if (!antiIsBotAdmin) {
                    for (const p of antiParticipants) {
                        if (!p?.admin || !p?.id) continue;

                        try {
                            if (
                                String(p.id).endsWith('@lid') &&
                                typeof antiLidStore.getPNForLID === 'function'
                            ) {
                                const pn =
                                    await antiLidStore.getPNForLID(p.id);

                                if (
                                    pn &&
                                    antiCleanNumber(pn) ===
                                        antiBotNumber
                                ) {
                                    antiIsBotAdmin = true;
                                    break;
                                }
                            }
                        } catch {}
                    }
                }

                // USER ADMIN FALLBACK
                if (!antiIsUserAdmin) {
                    for (const p of antiParticipants) {
                        if (!p?.admin || !p?.id) continue;

                        try {
                            if (
                                String(p.id).endsWith('@lid') &&
                                typeof antiLidStore.getPNForLID === 'function'
                            ) {
                                const pn =
                                    await antiLidStore.getPNForLID(p.id);

                                if (
                                    pn &&
                                    antiCleanNumber(pn) ===
                                        antiSenderNumber
                                ) {
                                    antiIsUserAdmin = true;
                                    break;
                                }
                            }
                        } catch {}
                    }
                }
            }
        } catch (lidError) {
            console.log(
                'AntiStatus LID admin check:',
                lidError?.message
            );
        }

        // ==========================================
        // OWNER / CREATOR / ADMIN ACCESS
        // ==========================================
        if (!isOwner && !antiIsUserAdmin) {
            return await socket.sendMessage(sender, {
                text:
`❌ *ANTI STATUS*

මෙම command එක භාවිතා කරන්න පුළුවන්:

👑 Group Admin
🥷 Bot Creator
👑 Bot Owner

> ${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
            }, { quoted: msg });
        }

        // ==========================================
        // MODE
        // ==========================================
        const mode =
            String(args?.[0] || '')
                .trim()
                .toLowerCase();

        const allowedModes = [
            'on',
            'warn',
            'delete',
            'off'
        ];

        // ==========================================
        // CURRENT MODE
        // ==========================================
        const currentMode =
            sessionConfig.ANTISTATUS_GROUPS?.[sender] ||
            'off';

        // ==========================================
        // HELP MESSAGE
        // ==========================================
        if (!allowedModes.includes(mode)) {
            return await socket.sendMessage(sender, {
                text:
`🛡️ *ANTI STATUS MENTION*

╭───────────────
│ 🟢 *.antistatus on*
│ Delete + Remove User
│
│ ⚠️ *.antistatus warn*
│ Warning Only
│
│ 🗑️ *.antistatus delete*
│ Delete Message Only
│
│ 🔴 *.antistatus off*
│ Disable Anti Status
╰───────────────

📌 *Current Mode:* ${String(currentMode).toUpperCase()}

> ${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
            }, { quoted: msg });
        }

        // ==========================================
        // BOT ADMIN REQUIRED
        // ON / DELETE NEED DELETE PERMISSION
        // ==========================================
        if (
            (mode === 'on' || mode === 'delete') &&
            !antiIsBotAdmin
        ) {
            return await socket.sendMessage(sender, {
                text:
`❌ *BOT ADMIN REQUIRED*

Anti Status *${mode.toUpperCase()}* mode එකට
Bot එක Group Admin කරන්න.

📌 *Bot Admin:* ${antiIsBotAdmin ? 'YES ✅' : 'NO ❌'}

> ${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
            }, { quoted: msg });
        }

        // ==========================================
        // SAVE PER GROUP
        // ==========================================
        const antiStatusGroups = {
            ...(sessionConfig.ANTISTATUS_GROUPS || {})
        };

        antiStatusGroups[sender] = mode;

        sessionConfig = {
            ...sessionConfig,
            ANTISTATUS_GROUPS: antiStatusGroups
        };

        await updateUserConfig(
            sanitizedNumber,
            sessionConfig
        );

        activeSockets.set(
            sanitizedNumber,
            {
                socket,
                config: sessionConfig
            }
        );

        // ==========================================
        // MODE RESPONSE
        // ==========================================
        let antiResponse = '';

        if (mode === 'on') {
            antiResponse =
`✅ *ANTI STATUS ON*

⚠️ Status mentions are not allowed.

🗑️ Message → Delete
🚫 User → Remove`;

        } else if (mode === 'warn') {
            antiResponse =
`⚠️ *ANTI STATUS WARN*

Status mention කරන userට
warning message එකක් ලබා දෙනවා.`;

        } else if (mode === 'delete') {
            antiResponse =
`🗑️ *ANTI STATUS DELETE*

Status mention message එක
automatically delete කරනවා.`;

        } else if (mode === 'off') {
            antiResponse =
`🔴 *ANTI STATUS OFF*

Anti Status protection
disable කරලා තියෙනවා.`;
        }

        // ==========================================
        // REACTION
        // ==========================================
        await socket.sendMessage(sender, {
            react: {
                text:
                    mode === 'off'
                        ? '❌'
                        : '🛡️',
                key: msg.key
            }
        });

        // ==========================================
        // SUCCESS MESSAGE
        // ==========================================
        await socket.sendMessage(sender, {
            text:
`${antiResponse}

> ${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
        }, { quoted: msg });

    } catch (error) {
        console.error(
            'AntiStatus command error:',
            error
        );

        await socket.sendMessage(sender, {
            text:
`❌ *ANTI STATUS ERROR*

${error?.message || 'Unknown error'}

> ${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
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
*╭─「 ᴄᴏᴍᴍᴀɴᴅꜱ ᴘᴀɴᴇʟ」*
*┃ \`🐸 ${greetings}\`*
*┃ \`⏳ 𝚃𝚒𝚖𝚎\` : ${formattedTime}*
*┃ \`🦊 𝙳𝚊𝚝𝚎\` : ${formattedDate}*
*┃ \`👾 𝙱𝚘𝚝 𝙽𝚊𝚖𝚎:\` Zᴇꜱʀ-ᴍᴅ*
*┃ \`🐞 𝙿𝚕𝚊𝚝𝚏𝚘𝚛𝚖:\` Linux*
*╰────────●●►*    
*╭─「 ᴄᴏᴍᴍᴀɴᴅꜱ ᴘᴀɴᴇʟ 」*
│ 🎥 .cinesubz
│ 🎞️ .sinhalasub
│ 👑 .owner 
│ 🤟 .alive
│ ⚙️ .setting 
│ 🏓 .ping
│ 🆔 .jid
│ ⏩ .forward 
│ 📹 .vnote 
│ ✍️ .rename
│ 🤫 .vv
│ 👤 .getpp
│ 🧩 .ginfo 
│ 🎨 .sticker 
│ 🕵️ .hack 
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

    case 'hack': {
    try {
        const contextInfo =
            msg.message?.extendedTextMessage?.contextInfo;

        const target =
            contextInfo?.participant ||
            contextInfo?.remoteJid;

        if (!target) {
            return await socket.sendMessage(sender, {
                text: `⚠️ *𝗧𝗔𝗥𝗚𝗘𝗧 𝗡𝗢𝗧 𝗙𝗢𝗨𝗡𝗗*

Reply to someone's message and type *.hack*

> Zᴇꜱʀ ✘ 〽️ᴏᴠɪᴇ Bᴏᴛ`
            }, { quoted: msg });
        }

        await socket.sendMessage(sender, {
            react: {
                text: '💀',
                key: msg.key
            }
        });

        const wait = ms =>
            new Promise(resolve => setTimeout(resolve, ms));

        // =========================
        // 10%
        // =========================

        const hackMsg = await socket.sendMessage(sender, {
            text: `╭─「 ⚠️ 𝗦𝗬𝗦𝗧𝗘𝗠 𝗔𝗖𝗖𝗘𝗦𝗦 」
│
│ 🎯 Target locked
│ 🔗 Establishing connection...
│ 📡 Initializing secure session...
│
│ ▰▱▱▱▱▱▱▱▱▱ 10%
╰────────────────►`
        }, { quoted: msg });

        await wait(2000);

        // =========================
        // 20%
        // =========================

        await socket.sendMessage(sender, {
            text: `╭─「 ⚡ 𝗖𝗢𝗡𝗡𝗘𝗖𝗧𝗜𝗡𝗚 」
│
│ 📡 Connection established
│ 🔍 Detecting device...
│ 🧬 Reading system information...
│
│ ▰▰▱▱▱▱▱▱▱▱ 20%
╰────────────────►`,
            edit: hackMsg.key
        });

        await wait(2200);

        // =========================
        // 30%
        // =========================

        await socket.sendMessage(sender, {
            text: `╭─「 🛰️ 𝗗𝗘𝗩𝗜𝗖𝗘 𝗦𝗖𝗔𝗡 」
│
│ 📱 Device detected
│ 🧩 Loading modules...
│ 🔐 Checking security layer...
│
│ ▰▰▰▱▱▱▱▱▱▱ 30%
╰────────────────►`,
            edit: hackMsg.key
        });

        await wait(2400);

        // =========================
        // 40%
        // =========================

        await socket.sendMessage(sender, {
            text: `╭─「 🔐 𝗦𝗘𝗖𝗨𝗥𝗜𝗧𝗬 𝗦𝗖𝗔𝗡 」
│
│ 🛡️ Security detected
│ ⚡ Processing access request...
│ 🧠 Analyzing system...
│
│ ▰▰▰▰▱▱▱▱▱▱ 40%
╰────────────────►`,
            edit: hackMsg.key
        });

        await wait(2600);

        // =========================
        // 50%
        // =========================

        await socket.sendMessage(sender, {
            text: `╭─「 ☠️ 𝗦𝗬𝗦𝗧𝗘𝗠 𝗕𝗥𝗘𝗔𝗖𝗛 」
│
│ 🔓 Security bypassed
│ 📂 Private storage detected
│ 📸 Camera module detected
│ 🎙️ Microphone module detected
│
│ ▰▰▰▰▰▱▱▱▱▱ 50%
╰────────────────►`,
            edit: hackMsg.key
        });

        await wait(2800);

        // =========================
        // 60%
        // =========================

        await socket.sendMessage(sender, {
            text: `╭─「 👁️ 𝗗𝗔𝗧𝗔 𝗦𝗖𝗔𝗡 」
│
│ 💬 Message database detected
│ 🖼️ Gallery storage detected
│ 📁 Files indexed
│
│ ▰▰▰▰▰▰▱▱▱▱ 60%
╰────────────────►`,
            edit: hackMsg.key
        });

        await wait(3000);

        // =========================
        // 70%
        // =========================

        await socket.sendMessage(sender, {
            text: `╭─「 🚨 𝗖𝗥𝗜𝗧𝗜𝗖𝗔𝗟 𝗔𝗖𝗖𝗘𝗦𝗦 」
│
│ 📱 Device session active
│ 💬 Messages processing...
│ 🖼️ Gallery scanning...
│ 📍 Location module loading...
│
│ ▰▰▰▰▰▰▰▱▱▱ 70%
╰────────────────►`,
            edit: hackMsg.key
        });

        await wait(3200);

        // =========================
        // 80%
        // =========================

        await socket.sendMessage(sender, {
            text: `╭─「 🧬 𝗘𝗫𝗧𝗥𝗔𝗖𝗧𝗜𝗡𝗚 」
│
│ 📦 Creating data package...
│ 🔗 Syncing remote session...
│ ⚙️ Processing information...
│
│ ▰▰▰▰▰▰▰▰▱▱ 80%
╰────────────────►`,
            edit: hackMsg.key
        });

        await wait(3400);

        // =========================
        // 90%
        // =========================

        await socket.sendMessage(sender, {
            text: `╭─「 🔴 𝗙𝗜𝗡𝗔𝗟𝗜𝗭𝗜𝗡𝗚 」
│
│ 🧠 Collecting information...
│ 📂 Finalizing data...
│ 🔒 Securing remote session...
│
│ ▰▰▰▰▰▰▰▰▰▱ 90%
╰────────────────►`,
            edit: hackMsg.key
        });

        await wait(3800);

        // =========================
        // 100%
        // =========================

        await socket.sendMessage(sender, {
            text: `╭─「 ☠️ 𝗛𝗔𝗖𝗞 𝗖𝗢𝗠𝗣𝗟𝗘𝗧𝗘 」
│
│ ▰▰▰▰▰▰▰▰▰▰ 100%
│
│ ✅ Device compromised
│ ✅ Gallery extracted
│ ✅ Messages extracted
│ ✅ Camera access enabled
│ ✅ Microphone access enabled
│ ✅ Location acquired
│ ✅ Remote session active
│
│ ⚠️ 𝗙𝗨𝗟𝗟 𝗔𝗖𝗖𝗘𝗦𝗦 𝗚𝗥𝗔𝗡𝗧𝗘𝗗
╰────────────────►

☠️ *SYSTEM CONTROL ESTABLISHED*

> Zᴇꜱʀ ✘ 〽️ᴏᴠɪᴇ Bᴏᴛ`,
            edit: hackMsg.key
        });

        await socket.sendMessage(sender, {
            react: {
                text: '☠️',
                key: msg.key
            }
        });

    } catch (error) {
        console.error('Hack simulation error:', error);

        await socket.sendMessage(sender, {
            react: {
                text: '❌',
                key: msg.key
            }
        });

        await socket.sendMessage(sender, {
            text: `❌ *𝗦𝗬𝗦𝗧𝗘𝗠 𝗘𝗥𝗥𝗢𝗥*

Simulation failed.

> Zᴇꜱʀ ✘ 〽️ᴏᴠɪᴇ Bᴏᴛ`
        }, { quoted: msg });
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
case 'cinevibes': {
    const DEFAULT_FOOTER = `\n\n> 🎭 𝗖𝗛𝗔𝗠𝗔 𝗖𝗜𝗡𝗘 𝗛𝗨𝗕 🎭\n> 🧬 ᴘᴏᴡᴇʀᴇᴅ ʙʏ 🇨🇭𝗔𝗠𝗔 𝗧𝗘𝗖𝗛`;

    if (!args.length) {
        await socket.sendMessage(sender, {
            text: `*❪ ERROR ❫*\n\n⚠️ *Invalid Usage!*\n\n🎬 *Example:*\n• .cinevibes spider man\n\n📝 _Please provide the Movie name!_${DEFAULT_FOOTER}`
        }, { quoted: msg });
        break;
    }

    const query = args.join(' ');
    await socket.sendMessage(sender, { 
        text: `*❪ SEARCHING ❫*\n\n🔍 *Searching CineVibes.lk...*\n⚡ _Please wait a moment._`
    });

    const API_BASE = "https://chama-movie-api.koyeb.app";
    const API_KEY = "chama_api_be042a389ee6cd43e15a9d8fe17c080c"; // ඔබේ API Key එක දාන්න
    const DEFAULT_IMAGE = "https://chama-movie-api.koyeb.app/logo.png";

    try {
        const searchResponse = await axios.get(`${API_BASE}/api/v1/movie/cinevibes/search?q=${encodeURIComponent(query)}&api_key=${API_KEY}`);
        const searchData = searchResponse.data;

        if (!searchData.status || !searchData.data || searchData.data.length === 0) {
            await socket.sendMessage(sender, {
                text: `*❪ NO RESULTS ❫*\n\n😞 *No Results Found!*\n\n🎬 *Query:* _${query}_\n💡 *Tip:* _Please check the spelling and try again!_${DEFAULT_FOOTER}`
            }, { quoted: msg });
            break;
        }

        const results = searchData.data.slice(0, 25);
        let listText = `*❪ SEARCH RESULTS ❫*\n\n🎯 *Query:* _${query}_\n📊 *Results:* _${results.length} Items_\n\n*👇 SELECT A NUMBER 👇*\n\n`;

        results.forEach((item, index) => {
            const num = (index + 1) < 10 ? `0${index + 1}` : `${index + 1}`;
            listText += `*${num}* ➜ 🎥 _${item.title.substring(0, 30)}_
`;
        });

        listText += `${DEFAULT_FOOTER}`;
        
        const sentMsg = await socket.sendMessage(sender, { text: listText }, { quoted: msg });
        const messageID = sentMsg.key.id;

        const handleSelection = async ({ messages: replyMessages }) => {
            const replyMek = replyMessages[0];
            if (!replyMek?.message) return;

            const messageType = replyMek.message.conversation || replyMek.message.extendedTextMessage?.text;
            const isReplyToSentMsg = replyMek.message.extendedTextMessage?.contextInfo?.stanzaId === messageID;

            if (isReplyToSentMsg && sender === replyMek.key.remoteJid) {
                const choice = parseInt(messageType) - 1;
                if (isNaN(choice) || choice < 0 || choice >= results.length) {
                    await socket.sendMessage(sender, {
                        text: `*❪ INVALID ❫*\n\n⚠️ *Wrong Number!*\n🎯 *Range:* _01 - 	ext ${results.length}_\n📝 _Please reply with a valid number!_${DEFAULT_FOOTER}`
                    }, { quoted: replyMek });
                    return;
                }

                const selectedItem = results[choice];
                
                await socket.sendMessage(sender, { 
                    text: `*❪ FETCHING ❫*\n\n🎬 *Fetching Movie...*\n⚡ _Please wait..._`
                }, { quoted: replyMek });

                try {
                    const detailsResponse = await axios.get(`${API_BASE}/api/v1/movie/cinevibes/infodl?q=${encodeURIComponent(selectedItem.link)}&api_key=${API_KEY}`);
                    const detailsData = detailsResponse.data;

                    if (!detailsData.status || !detailsData.data) {
                        throw new Error('Failed to fetch details');
                    }

                    const movieInfo = detailsData.data;
                    const validDownloads = movieInfo.downloads || [];
                    
                    if (validDownloads.length === 0) {
                        await socket.sendMessage(sender, {
                            text: `*❪ NO DOWNLOADS ❫*\n\n⚠️ *No Downloads Found!*\n😞 _There are no downloads available for this movie!_${DEFAULT_FOOTER}`
                        }, { quoted: replyMek });
                        return;
                    }
                    
                    const movieDetailsText = `*❪ MOVIE DETAILS ❫*\n\n🎬 *${movieInfo.title}*\n⭐ 𝗜𝗠𝗗𝗕 ➜ ★ ${movieInfo.imdb || movieInfo.rating || 'N/A'}\n📅 𝗬𝗲𝗮𝗿 ➜ ${movieInfo.year || 'N/A'}\n⏳ 𝗗𝘂𝗿𝗮𝘁𝗶𝗼𝗻 ➜ ${movieInfo.duration || 'N/A'}\n🌍 🇨🇴🇺🇳🇹🇷🇾 ➜ ${movieInfo.country || 'N/A'}\n🎭 𝗚𝗲𝗻 genres ➜ ${movieInfo.genres ? movieInfo.genres.join(', ') : 'N/A'}\n🏷️  ➜ ${movieInfo.language || movieInfo.tag || 'N/A'}\n🎬  ➜ ${movieInfo.directors || movieInfo.director || 'N/A'}\n⭐  ➜ ${movieInfo.stars || 'N/A'}\n📝  ➜ ${movieInfo.story ? (movieInfo.story.length > 250 ? movieInfo.story.substring(0, 250) + '...' : movieInfo.story) : 'N/A'}\n🗿 𝗪ᴇʙ ➜ cinevibes.lk\n ${DEFAULT_FOOTER}`;

                    const moviePosterUrl = movieInfo.image || selectedItem.image || DEFAULT_IMAGE;
                    await socket.sendMessage(sender, {
                        image: { url: moviePosterUrl },
                        caption: movieDetailsText
                    }, { quoted: replyMek });

                    const downloadOptionsText = `*❪ DOWNLOADS ❫*\n\n📥 *Select Quality:*\n\n${validDownloads.map((dl, i) => {
    const num = (i + 1) < 10 ? `0${i + 1}` : `${i + 1}`;
    const qualityIcon = (dl.quality || '').includes('1080') ? '🔥' : (dl.quality || '').includes('720') ? '💎' : '📱';
    return `*${num}* ➜ ${qualityIcon} _${dl.quality}_ 💾 _${dl.size || 'N/A'}_`;
}).join('\n')}\n\n*💬 REPLY TO DOWNLOAD 💬*\n📌 _Reply with the number_${DEFAULT_FOOTER}`;

                    const dlSentMsg = await socket.sendMessage(sender, { text: downloadOptionsText }, { quoted: replyMek });
                    const dlMessageID = dlSentMsg.key.id;

                    const handleDownloadSelection = async ({ messages: dlReplyMessages }) => {
                        const dlReplyMek = dlReplyMessages[0];
                        if (!dlReplyMek?.message) return;

                        const dlChoiceText = dlReplyMek.message.conversation || dlReplyMek.message.extendedTextMessage?.text;
                        const isReplyToDlMsg = dlReplyMek.message.extendedTextMessage?.contextInfo?.stanzaId === dlMessageID;

                        if (isReplyToDlMsg && sender === dlReplyMek.key.remoteJid) {
                            const dlChoice = parseInt(dlChoiceText) - 1;
                            if (isNaN(dlChoice) || dlChoice < 0 || dlChoice >= validDownloads.length) {
                                await socket.sendMessage(sender, {
                                    text: `*❪ INVALID ❫*\n\n⚠️ *Wrong Number!*\n🎯 *Range:* _01 - 	ext ${validDownloads.length}_\n📝 _Please reply with a valid number!_${DEFAULT_FOOTER}`
                                }, { quoted: dlReplyMek });
                                return;
                            }

                            const selectedDownload = validDownloads[dlChoice];
                            
                            await socket.sendMessage(sender, { 
                                text: `*❪ SENDING MOVIE ❫*\n\n📥 *Sending:* _${movieInfo.title}_\n📊 *Quality:* _${selectedDownload.quality}_\n💾 *Size:* _${selectedDownload.size || 'N/A'}_
⚡ _Uploading file to WhatsApp..._`
                            }, { quoted: dlReplyMek });

                            try {
                                await socket.sendMessage(sender, {
                                    document: { url: selectedDownload.link },
                                    mimetype: 'video/mp4',
                                    fileName: `${movieInfo.title} (${selectedDownload.quality}).mp4`,
                                    caption: `*🎬 𝗖𝗛𝗔𝗠𝗔 𝗖𝗜𝗡𝗘 𝗠𝗢𝗩𝗜𝗘 🎬*\n\n🎭 *Title:* ${movieInfo.title}\n🌟 *IMDB:* ${movieInfo.imdb || movieInfo.rating || 'N/A'}\n📅 *Year:* ${movieInfo.year || 'N/A'}\n📊 *Quality:* ${selectedDownload.quality}\n💾 *Size:* ${selectedDownload.size || 'N/A'}\n\n${DEFAULT_FOOTER}`
                                }, { quoted: dlReplyMek });
                            } catch (uploadErr) {
                                await socket.sendMessage(sender, {
                                    text: `*❪ UPLOAD FAILED ❫*\n\n❌ *Failed to upload file directly!*\n🔗 *Direct Link:* ${selectedDownload.link}${DEFAULT_FOOTER}`
                                }, { quoted: dlReplyMek });
                            }

                            socket.ev.off('messages.upsert', handleDownloadSelection);
                        }
                    };

                    socket.ev.on('messages.upsert', handleDownloadSelection);
                    socket.ev.off('messages.upsert', handleSelection);

                } catch (movieDetailsError) {
                    console.error('Movie Details error:', movieDetailsError);
                    await socket.sendMessage(sender, {
                        text: `*❪ ERROR ❫*\n\n❌ *Movie Details Error!*\n🚫 _${movieDetailsError.message}_	ext ${DEFAULT_FOOTER}`
                    }, { quoted: replyMek });
                    socket.ev.off('messages.upsert', handleSelection);
                }
            }
        };

        socket.ev.on('messages.upsert', handleSelection);

    } catch (error) {
        console.error('CineVibes.lk command error:', error);
        await socket.sendMessage(sender, {
            text: `*❪ SYSTEM ERROR ❫*\n\n❌ *System Error!*\n🚫 _${error.message || 'Unknown error'}_\n\n🔄 _Please try again later..._${DEFAULT_FOOTER}`
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
            if ( !isCreator) {
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
                            seasonsText += `🍀 *${idx + 1} ┃》📀 Season ${season.season} (${season.total_episodes} episodes)*\n`;
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
                                    episodesText += `*♦️${idx + 1} ║❯❯ 📺 Episode ${ep.episode}: ${ep.title}*\n`;
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
                                                const episodeResponse = await axios.get(`${config.API_CINESUBZ_URL}/api/episode?url=${encodeURIComponent(firstEpisode.url)}&api_key=lae`);
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
                                                    qualityText += `♦️ *${idx + 1} ║❯❯ 📥 ${quality}*\n`;
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
                                                    qualityText += `♦️ *${idx + 1} ║❯❯ 📥 ${quality}*\n`;
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
    
    break;
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

> Zᴇꜱʀ ✘ 〽️ᴏᴠɪᴇ Bᴏᴛ ᴠ1.1`
        }, { quoted: msg });

    } catch (error) {
        console.error('JID Error:', error);

        await socket.sendMessage(sender, {
            text:
`❌ *JID ලබාගන්න බැරි වුණා.*

${error?.message || error}

> Zᴇꜱʀ ✘ 〽️ᴏᴠɪᴇ Bᴏᴛ ᴠ1.1`
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


case 'ig':
case 'instagram': {
    let tempDir = null;

    try {
        const url = args?.[0];

        if (!url || !/(instagram\.com|instagr\.am)/i.test(url)) {
            return await socket.sendMessage(sender, {
                text: `❌ *Valid Instagram link එකක් දෙන්න!*\n\n📌 Example:\n${prefixUsed}ig https://www.instagram.com/p/xxxxx/`
            }, { quoted: msg });
        }

        await socket.sendMessage(sender, {
            react: { text: '📥', key: msg.key }
        });

        tempDir = fs.mkdtempSync(
            path.join(os.tmpdir(), 'zesr-ig-')
        );

        const outputTemplate = path.join(
            tempDir,
            '%(playlist_index)03d-%(id)s.%(ext)s'
        );

        await ytdlp(url, {
            output: outputTemplate,
            format: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            mergeOutputFormat: 'mp4',
            yesPlaylist: true,
            noWarnings: true,
            restrictFilenames: true
        });

        const files = fs.readdirSync(tempDir)
            .filter(file =>
                ['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.mov']
                    .includes(path.extname(file).toLowerCase())
            )
            .sort((a, b) =>
                a.localeCompare(b, undefined, { numeric: true })
            );

        if (!files.length) {
            throw new Error('Instagram media හමු වුණේ නැහැ.');
        }

        for (let i = 0; i < files.length; i++) {
            const filePath = path.join(tempDir, files[i]);
            const ext = path.extname(files[i]).toLowerCase();
            const buffer = fs.readFileSync(filePath);

            const caption =
                `📸 *Instagram Downloader*\n\n` +
                `📦 ${i + 1}/${files.length}\n` +
                `✅ Download Successful`;

            if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
                await socket.sendMessage(sender, {
                    image: buffer,
                    caption
                }, { quoted: i === 0 ? msg : undefined });
            } else {
                await socket.sendMessage(sender, {
                    video: buffer,
                    caption
                }, { quoted: i === 0 ? msg : undefined });
            }
        }

        await socket.sendMessage(sender, {
            react: { text: '✅', key: msg.key }
        });

    } catch (err) {
        console.error('IG ERROR:', err);

        await socket.sendMessage(sender, {
            react: { text: '❌', key: msg.key }
        }).catch(() => {});

        await socket.sendMessage(sender, {
            text: `❌ *Instagram download failed!*\n\n${err.message}`
        }, { quoted: msg });

    } finally {
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    }

    break;
}
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

    } catch (error) {
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
    const maxReconnectAttempts = 10;
    let reconnectAttempts = 0;

    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close' && lastDisconnect?.error?.output?.statusCode !== 401) {
            if (reconnectAttempts >= maxReconnectAttempts) {
                activeSockets.delete(number.replace(/[^0-9]/g, ''));
                socketCreationTime.delete(number.replace(/[^0-9]/g, ''));
                return;
            }
            console.log(`Connection lost for ${number}, attempt ${reconnectAttempts + 1}/${maxReconnectAttempts}`);
            try {
                await delay(5000 * (reconnectAttempts + 1));
                activeSockets.delete(number.replace(/[^0-9]/g, ''));
                socketCreationTime.delete(number.replace(/[^0-9]/g, ''));
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
                reconnectAttempts = 0;
            } catch (error) {
                console.error(`Reconnect failed for ${number}:`, error);
                reconnectAttempts++;
            }
        } else if (connection === 'open') {
            reconnectAttempts = 0;
            console.log(`Connection established for ${number}`);
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
