console.log("🔥 NEW VERSION DEPLOYED");

const express = require("express");
const fetch = require("node-fetch");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const AbortController = global.AbortController || require("abort-controller");

const app = express();
app.use(express.json());

// ================================
// CONFIG
// ================================
const PLAYFAB_TITLE_ID = process.env.PLAYFAB_TITLE_ID;
const PLAYFAB_SECRET_KEY = process.env.PLAYFAB_SECRET_KEY;
const SALT = "your_super_secret_salt";
const DISCORD_WEBHOOK = "https://discord.com/api/webhooks/1521553365409206293/tGG4m48ekJX5mU47MlqYFV8cQ-3Fb43hYk3MPVEl1h2h4Bfh1hMweSPK52TNeCUMSET-";

console.log("TITLE ID:", PLAYFAB_TITLE_ID);
console.log("SECRET KEY:", PLAYFAB_SECRET_KEY ? "Loaded" : "Missing");

// ================================
// RATE LIMIT
// ================================
app.use("/createAccount", rateLimit({
    windowMs: 60000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false
}));

// ================================
// HASH
// ================================
function sha256(data) {
    return crypto.createHash("sha256")
        .update(data)
        .digest("hex");
}

// ================================
// WAIT
// ================================
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ================================
// PLAYFAB LOGIN
// ================================
async function playfabLogin(customId, createAccount) {
    const url = `https://${PLAYFAB_TITLE_ID}.playfabapi.com/Server/LoginWithCustomID`;
    for (let attempt = 1; attempt <= 5; attempt++) {
        console.log(
            `[PlayFab] Attempt ${attempt} (CreateAccount=${createAccount})`
        );
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            const response = await fetch(url, {
                method: "POST",
                signal: controller.signal,
                headers: {
                    "Content-Type": "application/json",
                    "X-SecretKey": PLAYFAB_SECRET_KEY
                },
                body: JSON.stringify({
                    CustomId: customId,
                    CreateAccount: createAccount
                })
            });
            clearTimeout(timeout);
            const data = await response.json();
            console.log("[PlayFab]", JSON.stringify(data));
            if (response.ok && !data.error) {

                return data;

            }
            console.log(
                `[PlayFab] Failed attempt ${attempt}`
            );
        }
        catch (err) {
            console.log(
                `[PlayFab] Exception attempt ${attempt}:`,
                err.message
            );
        }
        await sleep(attempt * 1000);
    }
    throw new Error("PlayFab failed after 5 attempts.");
}

// ================================
// VERIFY ACCOUNT EXISTS
// ================================
async function verifyAccount(customId) {
    console.log("Verifying account...");
    for (let i = 0; i < 5; i++) {
        try {
            const result = await playfabLogin(customId, false);
            console.log("Verification successful.");
            return result;
        }
        catch {
            console.log(
                `Verification failed (${i + 1}/5)`
            );
            await sleep(1000);
        }
    }
    throw new Error("Unable to verify account.");
}

// ================================
// CREATE ACCOUNT
// ================================
app.post("/createAccount", async (req, res) => {
    console.log("Incoming request:", req.body);
    const {
        deviceId,
        timestamp,
        hash
    } = req.body;
    if (!deviceId || !timestamp || !hash) {
        await logFailure(
            req,
            "Missing Fields",
            "deviceId, timestamp, or hash was missing"
        );
        return res.status(400).json({
            error: "Missing fields"
        });
    }
    if (Math.abs(Date.now() - timestamp) > 30000) {
        await logFailure(
            req,
            "Expired Request",
            "Timestamp outside 30 second window",
            {
                timestamp,
                serverTime: Date.now()
            }
        );
        return res.status(400).json({
            error: "Request expired"
        });
    }
    const expected = sha256(`${deviceId}_${timestamp}_${SALT}`);
    if (expected !== hash) {
        await logFailure(
            req,
            "Invalid Signature",
            "Hash mismatch",
            {
                expected,
                received: hash
            }
        );
        return res.status(403).json({
            error: "Invalid signature"
        });
    }
    const startTime = Date.now();
    try {

        console.log("Creating PlayFab account...");
        let result;
        try {
            result =
                await playfabLogin(deviceId, true);
        }
                catch (err) {
            await logFailure(
                req,
                "Unhandled Backend Exception",
                err.stack || err.message
            );
            console.log("CreateAccount login failed.");
            console.log("Trying to verify if account already exists...");
            result = await verifyAccount(deviceId);
        }
        await verifyAccount(deviceId);
        const elapsed = Date.now() - startTime;
        console.log(
            `Account ready in ${elapsed}ms`
        );
        return res.json({
            success: true,
            playFabId: result.data.PlayFabId,
            elapsed
        });
    }
    catch (err) {
        console.error("Backend failure:", err);
        return res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

// ================================
// HEALTH CHECK
// ================================
app.get("/", (req, res) => {
    res.json({
        status: "online",
        titleId: PLAYFAB_TITLE_ID,
        secretLoaded: !!PLAYFAB_SECRET_KEY,
        uptime: process.uptime(),
        timestamp: Date.now()
    });
});

// ================================
// Failure Logs
// ================================
async function logFailure(req, title, error, extra = {}) {
    if (!DISCORD_WEBHOOK) return;

    try {
        const ip =
            req.headers["cf-connecting-ip"] ||
            req.headers["x-forwarded-for"] ||
            req.socket.remoteAddress ||
            "Unknown";

        const embed = {
            title: `❌ ${title}`,
            color: 0xff0000,
            timestamp: new Date().toISOString(),
            fields: [
                {
                    name: "IP",
                    value: `\`${ip}\``,
                    inline: true
                },
                {
                    name: "Method",
                    value: `\`${req.method}\``,
                    inline: true
                },
                {
                    name: "Path",
                    value: `\`${req.originalUrl}\``,
                    inline: true
                },
                {
                    name: "User-Agent",
                    value: "```" + (req.headers["user-agent"] || "Unknown").slice(0, 1000) + "```"
                },
                {
                    name: "Headers",
                    value: "```json\n" + JSON.stringify(req.headers, null, 2).slice(0, 1000) + "\n```"
                },
                {
                    name: "Body",
                    value: "```json\n" + JSON.stringify(req.body, null, 2).slice(0, 1000) + "\n```"
                },
                {
                    name: "Error",
                    value: "```" + String(error).slice(0, 1000) + "```"
                }
            ]
        };

        if (Object.keys(extra).length) {
            embed.fields.push({
                name: "Extra",
                value: "```json\n" + JSON.stringify(extra, null, 2).slice(0, 1000) + "\n```"
            });
        }

        await fetch(DISCORD_WEBHOOK, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                embeds: [embed]
            })
        });

    } catch (e) {
        console.error("Failed to send Discord log:", e);
    }
}

// ================================
// START SERVER
// ================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("====================================");
    console.log("PlayFab Backend Started");
    console.log("Port:", PORT);
    console.log("====================================");

});
