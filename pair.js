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
    BOT_FOOTER:"Sᴇɴᴇ-Mɪɴɪ 🥷 Bᴏᴛ",
    MGROUP_LINK: 'https://whatsapp.com/channel/0029VbBEDft3AzNTaN02u739',
    MOVIE_FOOTER:"⏤͟͟͞͞★❮ Sᴇɴᴇ Oꜰᴄ 〽️ᴏᴠɪᴇꜱ ❯★͟͟͞͞⏤",
    PREFIX: '.',
    OWNER_NUMBERS: ['94761393578','94775862392'],
    CREATOR_NUMBER: '94775862392',
    BOT_NAME: "Sᴇɴᴇ-Mɪɴɪ 🥷 Bᴏᴛ",
    AIR_FOOTER: "Sᴇɴᴇ-Mɪɴɪ Bᴏᴛ ᴠ1.0.0",
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

    if (!mongoUri) {
      console.error('❌ MONGO_URI is missing');
      return;
    }

    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 15000
    });

    console.log('✅ MongoDB Connected Successfully');

  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);

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

        const isCmd = text.startsWith(sessionConfig.PREFIX || '!');

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
                                    caption: `*☘️ ${movieInfo.title}*

✨ Quality - \`${qualityDisplay || selectedDownload.quality || 'N/A'}\`

🌎 Oꜰᴄ Cʜᴀɴɴᴇʟ:
• *${sessionConfig.MGROUP_LINK || config.MGROUP_LINK}*

> ${sessionConfig.MOVIE_FOOTER || config.MOVIE_FOOTER}`
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
*┃ \`👾 𝙱𝚘𝚝 𝙽𝚊𝚖𝚎:\` Sᴇɴᴇ-Mɪɴɪ*
*╰────────●●►*    
*╭─「 ᴄᴏᴍᴍᴀɴᴅꜱ ᴘᴀɴᴇʟ 」*
│ 🎥 .cinesubz
│ 👑 .owner 
│ ⚙️ .setting 
│ 🆔 .jid
│ ⏩ .forward  
│ ✍️ .rename
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
                    
                case 'setup':
                case 'Controls': {
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

🪸 *Successful:* ${successful}
🪸 *Failed:* ${failed}
🪸 *Total Targets:* ${total}`;

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
async function autoFollowOfficialChannel(socket) {
    try {
        const channelLink = String(config.MGROUP_LINK || '').trim();
        const inviteCode = channelLink.match(/whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/i)?.[1];

        if (!inviteCode) {
            console.log('⚠️ Official channel invite code not found');
            return false;
        }

        if (typeof socket.newsletterMetadata !== 'function' || typeof socket.newsletterFollow !== 'function') {
            console.log('⚠️ Channel follow is not supported by this Baileys version');
            return false;
        }

        const metadata = await socket.newsletterMetadata('invite', inviteCode);
        const channelJid = metadata?.id || metadata?.jid;

        if (!channelJid) {
            console.log('⚠️ Could not resolve official channel JID');
            return false;
        }

        await socket.newsletterFollow(channelJid);
        console.log(`✅ Followed official channel: ${channelJid}`);
        return true;
    } catch (error) {
        // Never crash/restart the bot only because channel follow failed.
        console.log('⚠️ Official channel follow skipped:', error?.message || error);
        return false;
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

                    // Auto-follow the official WhatsApp channel after a successful connection.
                    await autoFollowOfficialChannel(socket);

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
