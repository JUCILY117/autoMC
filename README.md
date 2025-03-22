# 🌍 Minecraft Server Auto Backup & Upload Tool 🚀  

![Minecraft](https://www.minecraft.net/etc.clientlibs/minecraft/clientlibs/main/resources/img/minecraft-creeper-face.jpg)

## 🎮 About This Project  
This is a simple yet powerful **Minecraft Server Auto Backup Tool** that:  
✅ Creates **automatic backups** of your Minecraft world.  
✅ Compresses backups for **smaller file size**.  
✅ Uploads backups to **Google Drive**.  
✅ Sends **Discord notifications** for backup status.  
✅ Sends **email alerts** upon successful backups.  

With this tool, you can ensure your Minecraft world is **always safe** without any manual work!  

---

## ⚡ Features  
🔹 **Automated Backups** – Backs up your world when the server stops.  
🔹 **Google Drive Integration** – Automatically uploads backups.  
🔹 **Email Notifications** – Get notified via email.  
🔹 **Discord Notifications** – Receive updates on Discord.  
🔹 **Compression Level Control** – Optimize backup size.  
🔹 **Automatic Cleanup** – Deletes old backups from Google Drive to save space.  

---

## 🛠️ Setup Guide  

Follow these **simple steps** to set up the tool:  

### **Step 1: Choose Your Minecraft Server**  
You can use any Minecraft server software like **Paper, Spigot, Fabric, Forge**, etc.  
1. Download your preferred server `.jar` file (e.g., `paper.jar`).  
2. Place it inside the **root directory** of this project.  

### **Step 2: Install & Run the Server**  
1. Open `start.bat` to initialize your server.  
2. The first time, the server will close automatically.  
3. Edit `eula.txt` and set `eula=true`.  
4. Run `start.bat` again to fully start your server.  

### **Step 3: Configure the Environment Variables**  
1. Open `.env.example` and **rename** it to `.env`.  
2. Open `.env` in a text editor and **fill in the details**:  
   ```ini
   DISCORD_WEBHOOK_URL=your_discord_webhook_url_here
   GOOGLE_DRIVE_FOLDER_ID=your_google_drive_folder_id_here
   EMAIL_USER=your_email_here
   EMAIL_PASS=your_email_password_here
   EMAIL_TO=your_email_here
   COMPRESSION_LEVEL=6  # (Set between 1-9, higher = more compression)
3. Save the file.

### **Step 4: Install Node.js Dependencies**
1. Make sure you have Node.js installed.
2. Open a terminal inside the project folder and run:
    ```
    npm install
    ```
### **Step 5: Run Your Minecraft Server**
-   Start your server by running:
    ```
    start.bat
    ```
    or simply run **start.bat** file.
-   Once the server shuts down, the backup process will start automatically! 🎉

### **🏗️ How It Works**
1. When you stop the server, backup.js runs automatically.
2. The script checks if there are any new changes in the world.
3. If changes exist:
    - It creates a compressed ZIP backup.
    - The backup is uploaded to Google Drive.
    - A Discord message is sent with backup details.
    - An email alert is sent (if configured).
4. The script also deletes old backups from Google Drive to free space.

### **📢 Notifications**
🔹 💬 **Discord Webhook** – Notifies when backup is completed.
🔹 📧 **Email Alerts** – Receive an email with backup details.
🔹 ⚠️ **Errors & Logs** – If something goes wrong, errors will be logged.

### **🛑 Troubleshooting**
**Q: My backups are not being uploaded!**
- ✅ Check if your GOOGLE_DRIVE_FOLDER_ID is correct.

**Q: Discord notifications not working!**
- ✅ Make sure you set the DISCORD_WEBHOOK_URL properly in .env.

**Q: How do I change the compression level?**
- ✅ Edit .env and set COMPRESSION_LEVEL=1 (low) to 9 (high).

### **💡 Future Improvements**
- Add SFTP support to upload backups to a remote server.
- More customization options for backup frequency.

### **💖 Contribute & Support**
    🔹 If you find this project useful, give it a ⭐ on GitHub!
    🔹 Want to contribute? Feel free to fork and submit a pull request!

## **📜 License: MIT License – Free to use & modify.**
🎮 Made for Minecraft lovers, by a Minecraft lover!