// api/analyze.js — Vercel Serverless Function
// Proxy seguro entre el navegador y la API de OpenAI
// La API key vive en variables de entorno del servidor (nunca en el cliente)

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'OPENAI_API_KEY no está configurada en las variables de entorno de Vercel.',
      envKeys: Object.keys(process.env)
    });
  }

  const { imageBase64, prompt } = req.body || {};
  if (!imageBase64 || !prompt) {
    return res.status(400).json({ error: 'Faltan campos: imageBase64, prompt' });
  }

  try {
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method  : 'POST',
      headers : {
        'Content-Type' : 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model    : 'gpt-4o-mini',
        messages : [{
          role   : 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: 'high' } }
          ]
        }],
        response_format : { type: 'json_object' },
        max_tokens      : 3000,
        temperature     : 0.05,
      }),
    });

    const data = await openaiRes.json();
    return res.status(openaiRes.status).json(data);

  } catch (err) {
    console.error('OpenAI proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
}
