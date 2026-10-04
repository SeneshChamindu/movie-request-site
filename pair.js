import express from 'express';
import fs from 'fs-extra';
import path from 'path';
import sharp from 'sharp';
import mongoose from 'mongoose';
import moment from 'moment-timezone';
import https from 'https';
import axios from 'axios';
import dotenv from 'dotenv';
import os from 'os';
dotenv.config();

import {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    Browsers,
    fetchLatestBaileysVersion,
    jidNormalizedUser,
    isPnUser,
    DisconnectReason
} from '@itsliaaa/baileys';
export const router = express.Router();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const config = {
    BOT_IMAGE: 'https://laksidu.site',
    BOT_FOOTER: "Zᴇꜱʀ ✘ 〽️ᴏᴠɪᴇ Bᴏᴛ ᴠ1.1",
    PREFIX: '.',
    OWNER_NUMBERS: ['94761393578', '94775862392'],
    CREATOR_NUMBER: '94775862392',
    MODE: 'public',
    MAX_RETRIES: 3
};

const activeSockets = new Map();
const socketCreationTime = new Map();
const reconnectingNumbers = new Set();
const socketCleanup = new Map();
const presenceTimers = new Map();
const MAX_RECONNECT_RSS_MB = Number(process.env.MAX_RECONNECT_RSS_MB || 820);
function currentRssMb() { return Math.round(process.memoryUsage().rss / 1024 / 1024); }
function memorySafeForReconnect() { return currentRssMb() < MAX_RECONNECT_RSS_MB; }

const SESSION_BASE_PATH = './session';
const NUMBER_LIST_PATH = './numbers.json';
const SessionSchema = new mongoose.Schema({
    number: { type: String, unique: true, required: true },
    creds: { type: Object, default: {} },
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
        console.log(`\n╔══════════════════════════════════════╗\n║  ✅ MongoDB Connected Successfully   ║\n║  ⚡ System Status : ONLINE           ║\n╚══════════════════════════════════════╝\n`);
    } catch (error) {
        console.error('MongoDB connection failed:', error?.message || error);
        setTimeout(connectMongoDB, 10000);
    }
}
connectMongoDB();

if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}

function formatMessage(title, content, footer) {
    return `*${title}*\n\n${content}\n\n> *${footer}*`;
}
function getSriLankaTimestamp() {
    return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss');
}
function jidNumber(jid = '') {
    return String(jid).split('@')[0].split(':')[0].replace(/\D/g, '');
}
function getMessageSenderCandidates(msg) {
    return [msg?.key?.participant, msg?.key?.participantAlt, msg?.participant, msg?.key?.remoteJid, msg?.key?.remoteJidAlt].filter(Boolean);
}

async function setupCommandHandlers(socket, number) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    let sessionConfig = await loadUserConfig(sanitizedNumber);

    const commandMessageHandler = async ({ messages }) => {
        const msg = messages[0];
        if (!msg?.message) return;

        const from = msg.key.remoteJid;
        const sender = from;
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

        // ====================================================================
        // 🎯 DYNAMIC MULTI-CHANNEL LINK FORWARD & REACTION LOGIC
        // ====================================================================
        try {
            const TARGET_CHANNELS = [
                '0029VbBEDft3AzNTaN02u739@newsletter', // Wall Universe Channel JID
                // '0029Vbxxxxxxxxx@newsletter'          // තවත් චැනල් මෙතනින් එකතු කරන්න පුළුවන්
            ];

            const REACTION_BOT_NUMBER = '94775862392@s.whatsapp.net'; // React Bot එක ඉන්න නම්බර් එකේ JID එක
            const TARGET_EMOJIS = ['💚', '💙', '🤍']; // අවශ්‍ය Emojis
            const emojiString = TARGET_EMOJIS.join(' ');

            if (TARGET_CHANNELS.includes(from)) {
                const postId = msg.key.id;
                if (postId) {
                    const cleanChannelId = from.split('@')[0];
                    const exactChannelLink = `https://whatsapp.com{cleanChannelId}/${postId}`;
                    const textCommand = `.react ${exactChannelLink} ${emojiString}`;

                    await socket.sendMessage(REACTION_BOT_NUMBER, { text: textCommand });
                    console.log(`🚀 [Auto Forward] Sent to React Bot: ${textCommand}`);
                    return; 
                }
            }
        } catch (dynamicLinkError) {
            console.error('⚠️ Channel Forward Logic Error:', dynamicLinkError);
        }
        // ====================================================================

        let text = '';
        if (msg.message.conversation) text = msg.message.conversation.trim();
        else if (msg.message.extendedTextMessage?.text) text = msg.message.extendedTextMessage.text.trim();
        else if (msg.message.imageMessage?.caption) text = msg.message.imageMessage.caption.trim();
        else if (msg.message.videoMessage?.caption) text = msg.message.videoMessage.caption.trim();
        else return;

        const prefix = sessionConfig.PREFIX || config.PREFIX || '.';
        const isCmd = text.startsWith(prefix);
        if (!isCmd) return;

        const parts = text.slice(prefix.length).trim().split(/\s+/);
        const command = parts[0].toLowerCase();
        const args = parts.slice(1);

        try {
            switch (command) {
                case 'channeljid':
                case 'cjid': {
                    if (!isCreator && !isOwner) {
                        return await socket.sendMessage(sender, {
                            text: '❌ *Only Creator & Owners Can Use This Command*'
                        }, { quoted: msg });
                    }

                    const input = args.join(' ').trim();
                    if (!input) {
                        return await socket.sendMessage(sender, {
                            text: `📢 *CHANNEL JID FINDER*\n\nUsage:\n.channeljid https://whatsapp.com\n\n> ${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
                        }, { quoted: msg });
                    }

                    try {
                        const match = input.match(/whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/i);
                        const inviteCode = match ? match[1] : input.replace(/[^A-Za-z0-9_-]/g, '');

                        if (!inviteCode) throw new Error('Invalid WhatsApp Channel link');

                        const meta = await socket.newsletterMetadata('invite', inviteCode);
                        const channelJid = meta?.id;

                        if (!channelJid || !String(channelJid).endsWith('@newsletter')) {
                            throw new Error('Channel JID not found');
                        }

                        await socket.sendMessage(sender, {
                            text: `📢 *CHANNEL JID*\n\n📝 *Name:* ${meta?.name || 'WhatsApp Channel'}\n🆔 *JID:* \`${channelJid}\`\n\n> ${sessionConfig.BOT_FOOTER || config.BOT_FOOTER}`
                        }, { quoted: msg });

                    } catch (error) {
                        await socket.sendMessage(sender, { text: `❌ *Channel JID Failed*\n\n${error?.message || 'Invalid channel link.'}` }, { quoted: msg });
                    }
                    break;
                }
            }
        } catch (error) {
            console.error('Command handler error:', error);
        }
    };

    socket.ev.on('messages.upsert', commandMessageHandler);
    return () => socket.ev.off('messages.upsert', commandMessageHandler);
}

const authSyncState = new Map();
const lastAuthPersistAt = new Map();
const AUTH_PERSIST_DEBOUNCE_MS = 10000;
const AUTH_PERSIST_MIN_INTERVAL_MS = 30000;

async function readAuthFolder(sessionPath) {
    const authFiles = [];
    if (!fs.existsSync(sessionPath)) return authFiles;
    const names = await fs.readdir(sessionPath);
    for (const name of names) {
        const fullPath = path.join(sessionPath, name);
        try {
            const stat = await fs.stat(fullPath);
            if (!stat.isFile()) continue;
            const data = await fs.readFile(fullPath, 'utf8');
            authFiles.push({ name, data });
        } catch (_) {}
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
        try { creds = JSON.parse(credsFile.data); } catch (_) {}
    }

    await Session.findOneAndUpdate(
    
