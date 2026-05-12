const path = require("path");
const express = require("express");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const AI_PROVIDER = String(process.env.AI_PROVIDER || "gemini").toLowerCase();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-oss-120b:free";

app.use(express.json({ limit: "1mb" }));

function isAiConfigured() {
  if (AI_PROVIDER === "openrouter") return Boolean(OPENROUTER_API_KEY);
  return Boolean(GEMINI_API_KEY);
}

async function callGemini(message, systemInstruction) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
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
    }
  );

  const data = await response.json();
  if (!response.ok) {
    const details = data?.error?.message || data?.message || "Gemini request failed.";
    const error = new Error(details);
    error.status = response.status;
    throw error;
  }

  return (
    data?.candidates?.[0]?.content?.parts
      ?.map((part) => part?.text || "")
      .join("")
      .trim() || ""
  );
}

async function callOpenRouter(message, systemInstruction) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        ...(systemInstruction ? [{ role: "system", content: systemInstruction }] : []),
        { role: "user", content: message }
      ],
      temperature: 0.7
    })
  });

  const data = await response.json();
  if (!response.ok) {
    const details = data?.error?.message || data?.message || "OpenRouter request failed.";
    const error = new Error(details);
    error.status = response.status;
    throw error;
  }

  return String(data?.choices?.[0]?.message?.content || "").trim();
}

// --- API routes MUST be registered before express.static so POST /api/ai is never swallowed ---

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    provider: AI_PROVIDER,
    aiConfigured: isAiConfigured(),
    model: AI_PROVIDER === "openrouter" ? OPENROUTER_MODEL : GEMINI_MODEL
  });
});

app.options("/api/ai", (_req, res) => {
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  res.setHeader("Access-Control-Max-Age", "86400");
  return res.sendStatus(204);
});

app.post("/api/ai", async (req, res) => {
  try {
    if (!isAiConfigured()) {
      const missingKeyName =
        AI_PROVIDER === "openrouter" ? "OPENROUTER_API_KEY" : "GEMINI_API_KEY";
      return res.status(500).json({
        error: `Missing ${missingKeyName} in server environment.`
      });
    }

    const message = String(req.body?.message || "").trim();
    const systemInstruction = String(req.body?.systemInstruction || "").trim();
    if (!message) {
      return res.status(400).json({ error: "Message is required." });
    }

    const text =
      AI_PROVIDER === "openrouter"
        ? await callOpenRouter(message, systemInstruction)
        : await callGemini(message, systemInstruction);
    return res.json({ text });
  } catch (error) {
    return res
      .status(error.status || 500)
      .json({ error: error.message || "AI proxy error." });
  }
});

app.use(express.static(path.join(__dirname)));

app.listen(PORT, () => {
  console.log(`GCLF server running at http://localhost:${PORT}`);
  console.log(`AI provider: ${AI_PROVIDER}`);
  if (!isAiConfigured()) {
    const missingKeyName =
      AI_PROVIDER === "openrouter" ? "OPENROUTER_API_KEY" : "GEMINI_API_KEY";
    console.warn(
      `Warning: ${missingKeyName} is not set. AI assistant endpoint will return configuration errors until this is provided.`
    );
  }
});
