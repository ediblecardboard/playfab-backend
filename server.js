console.log("🔥 NEW VERSION DEPLOYED");
const express = require("express");
const fetch = require("node-fetch");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");

const app = express();
app.use(express.json());

// ✅ USE ENV VARIABLES FOR EVERYTHING
const PLAYFAB_TITLE_ID = process.env.PLAYFAB_TITLE_ID;
const PLAYFAB_SECRET_KEY = process.env.PLAYFAB_SECRET_KEY;
const SALT = "your_super_secret_salt";

// 🔍 Debug (VERY IMPORTANT)
console.log("TITLE ID:", PLAYFAB_TITLE_ID);
console.log("SECRET KEY LOADED:", PLAYFAB_SECRET_KEY ? "YES" : "NO");

// 🛑 Rate limit
app.use("/createAccount", rateLimit({
    windowMs: 60 * 1000,
    max: 5
}));

// 🔐 Hash
function sha256(data) {
    return crypto.createHash("sha256").update(data).digest("hex");
}

// ✅ CREATE ACCOUNT
app.post("/createAccount", async (req, res) => {
    console.log("📥 Incoming request:", req.body);

    const { deviceId, timestamp, hash } = req.body;

    if (!deviceId || !timestamp || !hash)
        return res.status(400).json({ error: "Missing fields" });

    if (Math.abs(Date.now() - timestamp) > 30000)
        return res.status(400).json({ error: "Request expired" });

    const expected = sha256(`${deviceId}_${timestamp}_${SALT}`);

    if (expected !== hash)
        return res.status(403).json({ error: "Invalid signature" });

    try {
        console.log("🎮 Creating PlayFab account...");

        const url = `https://${PLAYFAB_TITLE_ID}.playfabapi.com/Server/LoginWithCustomID`;

        console.log("🌐 URL:", url);

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-SecretKey": PLAYFAB_SECRET_KEY
            },
            body: JSON.stringify({
                CustomId: deviceId,
                CreateAccount: true
            })
        });

        const data = await response.json();

        console.log("📡 PlayFab response:", data);

        if (!response.ok || data.error) {
            return res.status(400).json({
                error: data.errorMessage || "PlayFab error",
                full: data
            });
        }

        return res.json({
            success: true,
            playFabId: data.data?.PlayFabId
        });

    } catch (err) {
        console.error("🔥 Server error:", err);
        return res.status(500).json({ error: "Server error" });
    }
});

// test route
app.get("/", (req, res) => {
    res.send("Backend running");
});

app.listen(3000, () => {
    console.log("🚀 Server running");
});