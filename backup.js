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
        oAuth2Client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH)));
    } else {
        const authUrl = oAuth2Client.generateAuthUrl({ access_type: "offline", scope: SCOPES });
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

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupName = `mc_backup_${timestamp}.zip`;
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
        from: EMAIL_USER,
        to: EMAIL_TO,
        subject: "Minecraft Backup Completed",
        html:`<!DOCTYPE html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Minecraft Backup Notification</title>
                <style>
                    body {
                        font-family: 'Segoe UI', sans-serif;
                        background-color: #f3f3f3;
                        color: #333;
                        margin: 0;
                        padding: 0;
                        text-align: center;
                        background: url('https://wallpapercave.com/uwp/uwp4702799.png') no-repeat center center fixed;
                        background-size: cover;
                    }
                    .container {
                        max-width: 600px;
                        margin: 50px auto;
                        padding: 20px;
                        background: rgba(255, 255, 255, 0.9);
                        border-radius: 10px;
                        box-shadow: 0px 0px 15px rgba(0, 0, 0, 0.2);
                    }
                    .header {
                        font-size: 26px;
                        font-weight: bold;
                        padding: 15px;
                        background: #26a269;
                        color: #fff;
                        border-top-left-radius: 10px;
                        border-top-right-radius: 10px;
                    }
                    .content {
                        padding: 20px;
                    }
                    .footer {
                        font-size: 14px;
                        margin-top: 20px;
                        padding: 10px;
                        background: #26a269;
                        border-bottom-left-radius: 10px;
                        border-bottom-right-radius: 10px;
                        color: #fff;
                    }
                    .minecraft-image {
                        width: 120px;
                        height: auto;
                    }
                    .info {
                        font-size: 18px;
                        color: #444;
                    }
                    .highlight {
                        font-size: 20px;
                        font-weight: bold;
                        color: #26a269;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">Minecraft Server Backup Completed ✅</div>
                    <div class="content">
                        <img src="https://www.minecraft.net/etc.clientlibs/minecraft/clientlibs/main/resources/img/minecraft-creeper-face.jpg" alt="Minecraft Backup" class="minecraft-image">
                        <p class="info">Great news! Your Minecraft world has been successfully backed up.</p>
                        <p class="highlight">Backup Name: ${backupName}</p>
                        <p>📁 Your backup has been securely stored in Google Drive.</p>
                        <p>🛠️ This ensures you never lose your progress, no matter what happens!</p>
                        <p>💾 Keep building, crafting, and exploring without worries.</p>
                    </div>
                    <div class="footer">Stay safe and happy mining! ⛏️ - Aayu Corp</div>
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
