const path = require("path");
const express = require("express");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname)));

app.post("/api/ai", async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(500).json({
        error: "Missing GEMINI_API_KEY in server environment."
      });
    }

    const message = String(req.body?.message || "").trim();
    const systemInstruction = String(req.body?.systemInstruction || "").trim();
    const model = String(req.body?.model || DEFAULT_MODEL).trim();

    if (!message) {
      return res.status(400).json({ error: "Message is required." });
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...(systemInstruction
          ? { systemInstruction: { parts: [{ text: systemInstruction }] } }
          : {}),
        contents: [{ role: "user", parts: [{ text: message }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 1000 }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      const details = data?.error?.message || data?.message || "Gemini request failed.";
      return res.status(response.status).json({ error: details });
    }

    const text = data?.candidates?.[0]?.content?.parts
      ?.map((part) => part?.text || "")
      .join("")
      .trim() || "";
    return res.json({ text });
  } catch (error) {
    return res.status(500).json({ error: error.message || "AI proxy error." });
  }
});

app.listen(PORT, () => {
  console.log(`GCLF server running at http://localhost:${PORT}`);
});
