const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // Preferences
  getPreferences:   ()       => ipcRenderer.invoke("get-preferences"),
  savePreferences:  (prefs)  => ipcRenderer.invoke("save-preferences", prefs),
  togglePlatform:   (p)      => ipcRenderer.invoke("toggle-platform", p),

  // WhatsApp
  whatsappConnect:    ()         => ipcRenderer.invoke("whatsapp-connect"),
  whatsappDisconnect: ()         => ipcRenderer.invoke("whatsapp-disconnect"),
  whatsappStatus:     ()         => ipcRenderer.invoke("whatsapp-status"),
  whatsappCampaign:   (p)        => ipcRenderer.invoke("whatsapp-campaign", p),

  // Gmail
  gmailTest:     (p) => ipcRenderer.invoke("gmail-test", p),
  gmailCampaign: (p) => ipcRenderer.invoke("gmail-campaign", p),

  // YouTube
  youtubeAuthUrl:   ()  => ipcRenderer.invoke("youtube-auth-url"),
  youtubeAuthCode:  (c) => ipcRenderer.invoke("youtube-auth-code", c),
  youtubeUpload:    (p) => ipcRenderer.invoke("youtube-upload", p),
  youtubeCommunity: (p) => ipcRenderer.invoke("youtube-community", p),

  // Instagram
  instagramLogin: (p) => ipcRenderer.invoke("instagram-login", p),
  instagramPost:  (p) => ipcRenderer.invoke("instagram-post", p),

  // iMessage
  imessageCampaign: (p) => ipcRenderer.invoke("imessage-campaign", p),

  // TTS
  ttsPreview: (p) => ipcRenderer.invoke("tts-preview", p),

  // Contacts
  openCSVDialog:    ()  => ipcRenderer.invoke("open-csv-dialog"),
  getContactPrefs:  ()  => ipcRenderer.invoke("get-contact-prefs"),

  // WhatsApp Business API
  waBusinessTest:     (p) => ipcRenderer.invoke("wa-business-test", p),
  waBusinessCampaign: (p) => ipcRenderer.invoke("wa-business-campaign", p),
  waBusinessWebhook:  (p) => ipcRenderer.invoke("wa-business-webhook", p),

  // Events from main → renderer
  on: (channel, cb) => {
    const allowed = [
      "whatsapp-qr", "whatsapp-ready", "whatsapp-disconnected",
      "campaign-progress", "whatsapp-inbound-log",
    ];
    if (allowed.includes(channel)) {
      ipcRenderer.on(channel, (_, data) => cb(data));
    }
  },
  off: (channel) => ipcRenderer.removeAllListeners(channel),
});
