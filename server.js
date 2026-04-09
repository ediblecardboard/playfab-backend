const express = require("express");
const fetch = require("node-fetch");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");

const app = express();
app.use(express.json());

// 🔒 CONFIG
const PLAYFAB_TITLE_ID = "YOUR_TITLE_ID";
const PLAYFAB_SECRET_KEY = "YOUR_SECRET_KEY";
const SALT = "your_super_secret_salt";

// 🛑 Rate limit (5 requests per minute per IP)
const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5
});
app.use("/createAccount", limiter);

// 🔐 Hash function
function sha256(data) {
    return crypto.createHash("sha256").update(data).digest("hex");
}

// ✅ Create account endpoint
app.post("/createAccount", async (req, res) => {
    const { deviceId, timestamp, hash } = req.body;

    if (!deviceId || !timestamp || !hash) {
        return res.status(400).json({ error: "Missing fields" });
    }

    // ⏱ Check timestamp (anti-replay)
    const now = Date.now();
    if (Math.abs(now - timestamp) > 30000) {
        return res.status(400).json({ error: "Request expired" });
    }

    // 🔐 Verify hash
    const expectedHash = sha256(deviceId + "_" + timestamp + "_" + SALT);
    if (expectedHash !== hash) {
        return res.status(403).json({ error: "Invalid signature" });
    }

    try {
        // 🎮 Call PlayFab Server API
        const response = await fetch(`https://${PLAYFAB_TITLE_ID}.playfabapi.com/Server/LoginWithCustomID`, {
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

        if (data.error) {
            return res.status(400).json(data);
        }

        return res.json({ success: true });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Server error" });
    }
});

app.get("/", (req, res) => {
    res.send("Backend running");
});

app.listen(3000, () => {
    console.log("Server running on port 3000");
});