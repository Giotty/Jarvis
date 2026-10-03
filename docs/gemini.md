# Gemini and local fallback

Use **Settings → AI → Connection routing** to select Gemini as primary and Ollama as fallback. Enable cloud inference. Choose `gemini-3.8-flash` for conversation and vision in **Model & credential**, and save the key with Windows encryption. Credentials stay outside Git in JARVIS's Windows user data.

**AI → Agent bounds (panel 4)** has **JARVIS Gemini requests / day**, default **100**. This is JARVIS's own safety budget, **not Google's real quota or a billing guarantee**. Change it manually when needed. The HUD shows `37 / 100 today` below the model name. A warning appears at 80%; at the cap new inference requests use Ollama without contacting Gemini. The cap covers chat, streaming, planning, requested cloud vision and grounded research. Failed and cancelled requests count once dispatched; a pre-aborted request does not count. Model catalog discovery does not spend this generation budget.

The usage ledger persists across restarts and resets at midnight in the PC's local time zone. Lowering the cap below usage immediately selects local mode; raising it permits more requests. Google rate limits independently trigger Ollama and a temporary cooldown. No Google project-wide remaining quota is inferred from this counter. A damaged ledger fails closed until the next local day.

The owner chose **free public web research**, so **Google Search grounding / research** is disabled. Gemini 3.8's Google Search grounding requires a paid tier. For eligible older Gemini accounts, this optional setting is available in AI's inference options. Gemini researches public information in a separate Google Search call without opening your browser. Citations and Search Suggestions are available in **Google research sources**. Blocked publisher pages are distinguished from Google-grounded cited evidence. When Gemini is unavailable, research uses the existing free public indexes.

Set screen observation to **Manual** and cloud screen sharing to **Manual** in privacy settings. Requested screen observations may use Gemini; background monitoring, if enabled later, always uses local inference. Local file and clipboard sharing remain separately controlled. Sensitive PC actions still require confirmation. The local Kokoro voice is independent of the AI provider.

This local request budget cannot enforce Google's free tier or account billing settings. JARVIS does not enable billing or purchase services; manage Google's project settings in AI Studio.
