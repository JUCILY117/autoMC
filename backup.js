require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const archiver = require("archiver");
const readlineSync = require("readline-sync");
const crypto = require("crypto");
const axios = require("axios");
const nodemailer = require("nodemailer");

const SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const TOKEN_PATH = "token.json";
const CREDENTIALS_PATH = "credentials.json";
const BACKUP_DIR = "backups";

//all env vars
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const EMAIL_TO = process.env.EMAIL_TO;
const COMPRESSION_LEVEL = parseInt(process.env.COMPRESSION_LEVEL) || 9;

async function authenticate() {
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
    const { client_secret, client_id, redirect_uris } = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    if (fs.existsSync(TOKEN_PATH)) {
        const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH));
        oAuth2Client.setCredentials(tokens);

        oAuth2Client.on('tokens', (newTokens) => {
            if (newTokens.refresh_token || newTokens.access_token) {
                const updatedTokens = {
                    ...tokens,
                    ...newTokens
                };
                fs.writeFileSync(TOKEN_PATH, JSON.stringify(updatedTokens));
                console.log("🔄 Refreshed tokens saved.");
            }
        });
    } else {
        const authUrl = oAuth2Client.generateAuthUrl({
            access_type: "offline",
            prompt: "consent",
            scope: SCOPES
        });
        console.log("Authorize this app by visiting:", authUrl);
        const code = readlineSync.question("Enter the code from that page: ");
        const { tokens } = await oAuth2Client.getToken(code);
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
        oAuth2Client.setCredentials(tokens);
    }

    return oAuth2Client;
}

function getWorldHash() {
    const files = fs.readdirSync("world", { withFileTypes: true });
    const hash = crypto.createHash("md5");

    files.forEach((file) => {
        if (file.isFile()) {
            const content = fs.readFileSync(path.join("world", file.name));
            hash.update(content);
        }
    });

    return hash.digest("hex");
}

async function createBackupIfChanged() {
    const lastHashPath = path.join(BACKUP_DIR, "last_hash.txt");
    const newHash = getWorldHash();

    if (fs.existsSync(lastHashPath)) {
        const lastHash = fs.readFileSync(lastHashPath, "utf8");
        if (lastHash === newHash) {
            console.log("No changes detected in world, skipping backup.");
            return null;
        }
    }

    fs.writeFileSync(lastHashPath, newHash);
    return await createBackup();
}

async function createBackup() {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR);

    const now = new Date();
    const day = String(now.getDate()).padStart(2, "0");
    const month = now.toLocaleString("en-US", { month: "long" });
    const year = now.getFullYear();
    const time = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;

    const backupName = `mc_${day}_${month}_${year}_${time}.zip`;
    const backupPath = path.join(BACKUP_DIR, backupName);

    const output = fs.createWriteStream(backupPath);
    const archive = archiver("zip", { zlib: { level: COMPRESSION_LEVEL } });

    return new Promise((resolve, reject) => {
        archive.pipe(output);
        archive.directory("world", "world");
        archive.directory("world_nether", "world_nether");
        archive.directory("world_the_end", "world_the_end");
        archive.finalize();

        output.on("close", () => {
            console.log(`✅ Backup created: ${backupName} (${archive.pointer()} bytes)`);
            resolve(backupPath);
        });

        archive.on("error", reject);
    });
}

async function uploadToDrive(auth, backupPath) {
    const drive = google.drive({ version: "v3", auth });

    if (!GOOGLE_DRIVE_FOLDER_ID) {
        console.error("❌ Google Drive Folder ID is missing!");
        return;
    }

    const fileMetadata = {
        name: path.basename(backupPath),
        parents: [GOOGLE_DRIVE_FOLDER_ID.trim()],
    };

    const media = { mimeType: "application/zip", body: fs.createReadStream(backupPath) };

    try {
        const response = await drive.files.create({
            resource: fileMetadata,
            media: media,
            fields: "id, parents",
        });

        console.log(`✅ Backup uploaded successfully: ${response.data.id} to folder: ${response.data.parents}`);
    } catch (error) {
        console.error("❌ Google Drive Upload Error:", error.response?.data || error.message);
    }
}

function cleanupOldBackups() {
    const cutoffTime = Date.now() - 7 * 24 * 60 * 60 * 1000;

    fs.readdirSync(BACKUP_DIR).forEach((file) => {
        const filePath = path.join(BACKUP_DIR, file);
        if (fs.statSync(filePath).mtimeMs < cutoffTime) {
            fs.unlinkSync(filePath);
            console.log(`Deleted old backup: ${file}`);
        }
    });
}

async function deleteOldGoogleDriveBackups(auth) {
    const drive = google.drive({ version: "v3", auth });
    const files = await drive.files.list({
        q: "name contains 'mc_backup_'",
        fields: "files(id, name, createdTime)",
    });

    const backups = files.data.files;
    if (backups.length > 5) {
        backups.sort((a, b) => new Date(a.createdTime) - new Date(b.createdTime));
        const oldBackup = backups[0];
        await drive.files.delete({ fileId: oldBackup.id });
        console.log(`Deleted old backup from Drive: ${oldBackup.name}`);
    }
}

function logBackup(backupName) {
    fs.appendFileSync(path.join(BACKUP_DIR, "backup_log.txt"), `${new Date().toISOString()} - ${backupName}\n`);
}

async function sendDiscordNotification(backupName) {
    if (!DISCORD_WEBHOOK_URL) return console.log("⚠️ Discord Webhook URL is missing.");

    try {
        await axios.post(DISCORD_WEBHOOK_URL, {
            embeds: [
                {
                    title: "✅ Minecraft Backup Completed",
                    description: `Your Minecraft world backup has been successfully created!`,
                    color: 3066993,
                    fields: [
                        {
                            name: "📁 Backup Name",
                            value: `\`${backupName}\``,
                            inline: true
                        },
                        {
                            name: "☁️ Storage",
                            value: "Uploaded to Google Drive",
                            inline: true
                        }
                    ],
                    thumbnail: {
                        url: "https://www.minecraft.net/etc.clientlibs/minecraft/clientlibs/main/resources/img/minecraft-creeper-face.jpg"
                    },
                    footer: {
                        text: "Stay safe and happy mining! ⛏️",
                        icon_url: "https://i.imgur.com/AfFp7pu.png"
                    },
                    timestamp: new Date()
                }
            ]
        });

        console.log("✅ Discord notification sent.");
    } catch (error) {
        console.error("❌ Discord Notification Error:", error.response?.data || error.message);
    }
}


async function sendEmailNotification(backupName) {
    if (!EMAIL_USER || !EMAIL_PASS || !EMAIL_TO){
        console.log("⚠️ Email credentials missing. Skipping email notification.");
        return;
    }

    let transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: EMAIL_USER,
            pass: EMAIL_PASS,
        },
    });

    try{
    await transporter.sendMail({
        from: `"Aayu Backups" <${EMAIL_USER}>`,
        to: EMAIL_TO,
        subject: "Minecraft Backup Completed",
        html:`<!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Minecraft Backup Notification</title>
                    <style>
                        body, html {
                            margin: 0;
                            padding: 0;
                            width: 100%;
                            height: 100%;
                            font-family: 'Segoe UI', sans-serif;
                            background: #0f0f0f;
                            color: #e5e7eb;
                            line-height: 1.6;
                        }
                        
                        a {
                            text-decoration: none;
                        }

                        .email-container {
                            max-width: 680px;
                            margin: 0 auto;
                            background: linear-gradient(135deg, #1e1e1e, #2a2a2a);
                            box-shadow: 0 12px 30px rgba(0, 0, 0, 0.5);
                            border-radius: 16px;
                            overflow: hidden;
                            color: #e5e7eb;
                        }

                        .email-header {
                            background: radial-gradient(circle, #1a73e8, #0f0f0f);
                            color: #fff;
                            text-align: center;
                            padding: 50px 40px;
                            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                        }
                        
                        .email-header h1 {
                            font-size: 36px;
                            margin: 0;
                            font-weight: 600;
                        }
                        
                        .email-header img {
                            width: 90px;
                            margin: 20px 0;
                            filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.7));
                        }

                        .email-content {
                            padding: 50px 40px;
                            text-align: center;
                        }

                        .email-content p {
                            font-size: 18px;
                            color: #d1d5db;
                            margin: 20px 0;
                        }

                        .email-content .highlight {
                            font-size: 24px;
                            font-weight: bold;
                            color: #1a73e8;
                        }

                        .btn {
                            display: inline-block;
                            padding: 16px 40px;
                            margin: 30px 0;
                            font-size: 18px;
                            color: #fff;
                            background: linear-gradient(135deg, #1a73e8, #0052cc);
                            border-radius: 8px;
                            box-shadow: 0 8px 20px rgba(0, 123, 255, 0.4);
                            transition: transform 0.3s, background 0.3s;
                        }

                        .btn:hover {
                            background: linear-gradient(135deg, #0052cc, #1a73e8);
                            transform: translateY(-4px);
                        }

                        .email-footer {
                            background: #1e1e1e;
                            color: #9ca3af;
                            text-align: center;
                            padding: 35px 40px;
                            font-size: 14px;
                            border-top: 1px solid rgba(255, 255, 255, 0.1);
                        }

                        .email-footer a {
                            color: #1a73e8;
                            text-decoration: none;
                            transition: color 0.3s;
                        }

                        .email-footer a:hover {
                            color: #3b82f6;
                        }

                        .glass-card {
                            background: rgba(255, 255, 255, 0.05);
                            border: 1px solid rgba(255, 255, 255, 0.1);
                            backdrop-filter: blur(12px);
                            -webkit-backdrop-filter: blur(12px);
                            padding: 20px;
                            border-radius: 12px;
                            margin: 20px auto;
                            width: 80%;
                            max-width: 540px;
                            box-shadow: 0 8px 20px rgba(0, 0, 0, 0.2);
                        }

                        @media screen and (max-width: 680px) {
                            .email-header, .email-content, .email-footer {
                                padding: 30px 20px;
                            }
                            
                            .email-header h1 {
                                font-size: 28px;
                            }

                            .btn {
                                width: 100%;
                                font-size: 16px;
                                padding: 14px 30px;
                            }
                        }
                    </style>
                </head>
                <body>

                <div class="email-container">

                    <div class="email-header">
                        <h1>🎯 Minecraft Backup Successful</h1>
                        <img src="https://www.minecraft.net/etc.clientlibs/minecraft/clientlibs/main/resources/img/minecraft-creeper-face.jpg" 
                            alt="Minecraft Backup">
                    </div>

                    <div class="email-content">
                        <p>✅ Your Minecraft server backup has been successfully created and stored in Google Drive.</p>
                        
                        <div class="glass-card">
                            <p class="highlight">Backup Name: <strong>${backupName}</strong></p>
                            <p>📁 Securely saved in your Drive folder.</p>
                            <p>🛠️ This ensures your progress is always safe.</p>
                        </div>

                        <a href="https://drive.google.com/drive/folders/${GOOGLE_DRIVE_FOLDER_ID}" 
                        class="btn" target="_blank">
                            View Backup in Drive
                        </a>

                        <p>💾 Keep building, crafting, and exploring without worries.</p>
                    </div>

                    <div class="email-footer">
                        <p>Stay safe and happy mining! ⛏️</p>
                        <p>&copy; 2025 Aayu Corp. All rights reserved | 
                            <a href="https://aayumats.vercel.app" target="_blank">Website</a>
                        </p>
                    </div>

                </div>

                </body>
                </html>
            `,
        });

    console.log("✅ Email notification sent.");
    } catch (error) {
        console.error("❌ Email Notification Error:", error.message);
    }
}

async function main() {
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
        console.log("Created missing backup folder.");
    }
    const auth = await authenticate();
    const backupPath = await createBackupIfChanged();
    if (backupPath) {
        await uploadToDrive(auth, backupPath);
        logBackup(path.basename(backupPath));
        await deleteOldGoogleDriveBackups(auth);
        await sendDiscordNotification(path.basename(backupPath));
        await sendEmailNotification(path.basename(backupPath));
        cleanupOldBackups();
    }
}

main().catch(console.error);
