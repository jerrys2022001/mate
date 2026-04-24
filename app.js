(function () {
  const isFileMode = window.location.protocol === "file:";
  const pageName = document.body.getAttribute("data-page") || "";
  const runtimeApiStorageKey = "mate.apiBaseUrl";
  const sessionTokenStorageKey = "mate.sessionToken";
  const defaultLocalApiBases = ["http://127.0.0.1:4317", "http://localhost:4317"];
  let runtimeInfo = {
    apiAvailable: !isFileMode,
    apiBaseUrl: !isFileMode ? window.location.origin : "",
    mode: isFileMode ? "file" : "checking",
    proxyEnabled: false,
    backendLabel: isFileMode ? "Local file preview" : "Mate BFF",
    configured: false,
    upstreamReachable: false,
    websocketClientAvailable: false,
    endpoints: {},
    proxyCapabilities: {},
    checkedApiBases: [],
    lastError: ""
  };
  let sessionInfo = {
    authenticated: false,
    user: null,
    sessionToken: safeReadLocalStorage(sessionTokenStorageKey)
  };
  let chatSessions = {};
  let authRedirecting = false;

  function isLocalHostName(hostname) {
    return hostname === "localhost" || hostname === "127.0.0.1";
  }

  function normalizeApiBaseUrl(value) {
    const raw = String(value || "").trim();

    if (!raw) {
      return "";
    }

    try {
      const fallbackBase = isFileMode ? "http://127.0.0.1:4317/" : `${window.location.origin}/`;
      const url = new URL(raw, fallbackBase);

      if (!/^https?:$/.test(url.protocol)) {
        return "";
      }

      return `${url.protocol}//${url.host}`;
    } catch (error) {
      return "";
    }
  }

  function safeReadLocalStorage(key) {
    try {
      return window.localStorage.getItem(key) || "";
    } catch (error) {
      return "";
    }
  }

  function safeWriteLocalStorage(key, value) {
    try {
      if (!value) {
        window.localStorage.removeItem(key);
        return;
      }

      window.localStorage.setItem(key, value);
    } catch (error) {
      // Ignore storage failures in restricted browser contexts.
    }
  }

  function pushApiBaseCandidate(list, value) {
    const normalized = normalizeApiBaseUrl(value);

    if (normalized && !list.includes(normalized)) {
      list.push(normalized);
    }
  }

  function buildApiBaseCandidates() {
    const candidates = [];
    const query = new URLSearchParams(window.location.search);
    const explicitFromQuery = normalizeApiBaseUrl(query.get("api"));
    const explicitFromMeta = normalizeApiBaseUrl(document.querySelector('meta[name="mate-api-base"]')?.getAttribute("content"));
    const explicitFromWindow = normalizeApiBaseUrl(typeof window.__MATE_API_BASE__ === "string" ? window.__MATE_API_BASE__ : "");
    const explicitFromStorage = normalizeApiBaseUrl(safeReadLocalStorage(runtimeApiStorageKey));

    if (explicitFromQuery) {
      safeWriteLocalStorage(runtimeApiStorageKey, explicitFromQuery);
    }

    [explicitFromQuery, explicitFromMeta, explicitFromWindow, explicitFromStorage].forEach(function (value) {
      pushApiBaseCandidate(candidates, value);
    });

    if (!isFileMode) {
      pushApiBaseCandidate(candidates, window.location.origin);

      if (!isLocalHostName(window.location.hostname) && !String(window.location.hostname || "").startsWith("api.")) {
        pushApiBaseCandidate(candidates, `${window.location.protocol}//api.${window.location.host}`);
      }
    }

    if (isFileMode || window.location.protocol === "http:" || isLocalHostName(window.location.hostname)) {
      defaultLocalApiBases.forEach(function (value) {
        pushApiBaseCandidate(candidates, value);
      });
    }

    return candidates;
  }

  function getRequestCredentials(url) {
    try {
      return new URL(url).origin === window.location.origin ? "same-origin" : "include";
    } catch (error) {
      return "same-origin";
    }
  }

  function getStoredSessionToken() {
    return String((sessionInfo && sessionInfo.sessionToken) || safeReadLocalStorage(sessionTokenStorageKey) || "").trim();
  }

  function persistSessionToken(value) {
    const normalized = String(value || "").trim();
    safeWriteLocalStorage(sessionTokenStorageKey, normalized);
    sessionInfo.sessionToken = normalized;
  }

  function buildAuthHeaders(headers) {
    const nextHeaders = Object.assign({}, headers || {});
    const token = getStoredSessionToken();

    if (token && !nextHeaders.Authorization) {
      nextHeaders.Authorization = `Bearer ${token}`;
    }

    return nextHeaders;
  }

  function buildApiUrl(path) {
    const normalizedPath = String(path || "").replace(/^\/+/, "");
    const baseUrl = normalizeApiBaseUrl(runtimeInfo.apiBaseUrl) || (!isFileMode ? window.location.origin : "");

    if (!baseUrl) {
      return `/${normalizedPath}`;
    }

    return new URL(normalizedPath, `${baseUrl}/`).toString();
  }

  function setRuntimeUnavailable(reason, checkedApiBases) {
    runtimeInfo = {
      apiAvailable: false,
      apiBaseUrl: "",
      mode: isFileMode ? "file" : "demo",
      proxyEnabled: false,
      backendLabel: isFileMode ? "Local file preview" : "Mate UI fallback",
      configured: false,
      upstreamReachable: false,
      websocketClientAvailable: false,
      endpoints: {},
      proxyCapabilities: {},
      checkedApiBases: Array.isArray(checkedApiBases) ? checkedApiBases.slice() : [],
      lastError: String(reason || "").trim()
    };

    return runtimeInfo;
  }

  function formatApiBaseSummary() {
    const checked = Array.isArray(runtimeInfo.checkedApiBases) ? runtimeInfo.checkedApiBases.filter(Boolean) : [];
    return checked.length ? ` Checked: ${checked.join(", ")}.` : "";
  }

  function buildApiUnavailableMessage() {
    if (isFileMode) {
      return `Mate BFF was not detected for this file preview.${formatApiBaseSummary()} Start the local Node server or provide ?api=https://your-bff-origin.`;
    }

    return `Mate BFF is unreachable from this page.${formatApiBaseSummary()} Deploy the Node BFF with this site or provide ?api=https://your-bff-origin.`;
  }

  async function probeApiBase(apiBaseUrl) {
    const healthUrl = new URL("api/health", `${apiBaseUrl}/`).toString();
    const response = await fetch(healthUrl, {
      headers: buildAuthHeaders({
        Accept: "application/json"
      }),
      credentials: getRequestCredentials(healthUrl)
    });

    if (!response.ok) {
      throw new Error(`Health check failed for ${apiBaseUrl}`);
    }

    return response.json();
  }

  const painStories = {
    ielts: {
      badge: "Exam Writing",
      title: "Lift essay drafts.",
      copy: "Structure, grammar, rewrite.",
      output: "\"Clearer thesis. Tighter opening. Stronger tone.\""
    },
    email: {
      badge: "Business Email",
      title: "Polish work email.",
      copy: "Reply, follow up, request.",
      output: "\"Thanks for your patience. I've attached the revised timeline.\""
    },
    grammar: {
      badge: "Grammar Coach",
      title: "Fix grammar fast.",
      copy: "Rule, example, drill.",
      output: "\"Use 'is' here. 'Information' is singular.\""
    },
    upgrade: {
      badge: "Expression Upgrade",
      title: "Upgrade your tone.",
      copy: "Academic, concise, polished.",
      output: "\"I believe this approach offers clear practical value.\""
    }
  };

  const chatScenarios = {
    essay: {
      title: "Essay rewrite",
      route: "POST /api/chat",
      engine: "Mate BFF -> DeepTutor Chat",
      goal: "Rewrite with stronger structure",
      suggestions: ["Improve thesis", "Fix grammar", "Upgrade vocabulary"],
      placeholder: "Paste your IELTS / TOEFL / SAT paragraph or essay introduction here...",
      starters: [
        "Please grade this IELTS Task 2 introduction and give me a Band 7.5 rewrite.",
        "Tighten the logic in my SAT argumentative paragraph and show where the evidence feels weak.",
        "Turn this broad thesis into a clearer academic position with stronger topic vocabulary."
      ],
      deliverables: [
        {
          title: "Diagnosis",
          text: "Structure, thesis, grammar."
        },
        {
          title: "Rewrite",
          text: "Cleaner paragraph."
        },
        {
          title: "Upgrade",
          text: "Sharper wording."
        }
      ],
      stats: [
        { value: "Band +1.5", label: "target lift" },
        { value: "3", label: "revision passes" },
        { value: "1", label: "clearer thesis" }
      ],
      thread: [
        {
          role: "user",
          content: "Please review my IELTS essay introduction. I want it to sound more academic and direct."
        },
        {
          role: "assistant",
          content: [
            "Your opening idea is relevant, but the thesis is still too broad for a high-scoring response.",
            "Try this rewrite: 'While public transport investment is costly, it remains one of the most effective ways to reduce congestion and improve urban sustainability.'",
            "Why this works: the sentence is more specific, the contrast is cleaner, and the tone sounds more confident."
          ]
        }
      ]
    },
    email: {
      title: "Email polish",
      route: "POST /api/chat",
      engine: "Mate BFF -> DeepTutor Chat",
      goal: "Rewrite for a clean client send",
      suggestions: ["Soften tone", "Add clear next steps", "Sound more professional"],
      placeholder: "Paste the business email, Slack update, or client message you want to improve...",
      starters: [
        "Rewrite this delayed project update so it sounds professional and calm, not defensive.",
        "Turn this direct request into a polite client email with a clear next step.",
        "Generate a reusable meeting follow-up template I can adapt after every client call."
      ],
      deliverables: [
        {
          title: "Rewrite",
          text: "Clean email draft."
        },
        {
          title: "Tone",
          text: "Soft, direct, concise."
        },
        {
          title: "Template",
          text: "Save and reuse."
        }
      ],
      stats: [
        { value: "2", label: "tone variants" },
        { value: "1", label: "clear CTA" },
        { value: "Zero", label: "translation feel" }
      ],
      thread: [
        {
          role: "user",
          content: "Can you rewrite this email so it sounds professional but not too cold? We need to push the deadline by three days."
        },
        {
          role: "assistant",
          content: [
            "Here is a polished draft:",
            "'Thank you for your patience. To ensure the final deliverable meets the agreed quality standard, we need a short extension of three business days.'",
            "I also added a reassuring next-step sentence so the client feels informed rather than surprised."
          ]
        }
      ]
    },
    grammar: {
      title: "Grammar fix",
      route: "POST /api/chat",
      engine: "Mate BFF -> DeepTutor Chat",
      goal: "Fix repeat grammar mistakes",
      suggestions: ["Explain simply", "Show two examples", "Create mini practice"],
      placeholder: "Paste the sentence, paragraph, or grammar question you want Mate to explain...",
      starters: [
        "Explain why this sentence is wrong, then show two corrected examples I can copy.",
        "Point out every article and tense mistake in this paragraph and tell me the pattern behind them.",
        "Turn my most common grammar error into a mini drill with three short questions."
      ],
      deliverables: [
        {
          title: "Rule",
          text: "Short explanation."
        },
        {
          title: "Pattern",
          text: "Spot repeat errors."
        },
        {
          title: "Drill",
          text: "Quick follow-up."
        }
      ],
      stats: [
        { value: "2", label: "error patterns" },
        { value: "3", label: "practice items" },
        { value: "1", label: "clear rule" }
      ],
      thread: [
        {
          role: "user",
          content: "Why is 'the information are useful' wrong? Please explain it like a teacher."
        },
        {
          role: "assistant",
          content: [
            "'Information' is an uncountable noun in English, so it takes a singular verb.",
            "Correct version: 'The information is useful.'",
            "You can compare it with 'advice' and 'furniture', which also use singular verbs."
          ]
        }
      ]
    },
    upgrade: {
      title: "Tone upgrade",
      route: "POST /api/chat",
      engine: "Mate BFF -> DeepTutor Chat",
      goal: "Make the sentence sound stronger",
      suggestions: ["Academic tone", "More concise", "More persuasive"],
      placeholder: "Paste the sentence you want to make more advanced, natural, or persuasive...",
      starters: [
        "Upgrade this sentence so it sounds more academic but still natural.",
        "Give me three stronger versions of this simple English sentence with different tones.",
        "Turn this plain idea into a sharper workplace sentence and a stronger essay sentence."
      ],
      deliverables: [
        {
          title: "Rewrite",
          text: "Stronger wording."
        },
        {
          title: "Tone",
          text: "Academic, business, concise."
        },
        {
          title: "Pattern",
          text: "Reuse the phrasing."
        }
      ],
      stats: [
        { value: "3", label: "tone options" },
        { value: "1", label: "stronger rhythm" },
        { value: "Less", label: "basic wording" }
      ],
      thread: [
        {
          role: "user",
          content: "Can you upgrade this sentence: 'Many students feel stress because exams are hard.'"
        },
        {
          role: "assistant",
          content: [
            "Stronger version: 'Many students experience significant stress because high-stakes exams place sustained pressure on their academic performance.'",
            "This version is more precise, more formal, and uses stronger academic phrasing."
          ]
        }
      ]
    }
  };

  const kbSamples = [
    {
      id: "rubric",
      name: "IELTS Writing Band Descriptors.pdf",
      type: "Scoring rubric",
      status: "Indexed and ready",
      summary: "Official scoring criteria for task response, coherence, lexical resource, and grammar.",
      sourceText: "Band 7 and above responses maintain a clear position, strong cohesion, varied vocabulary, and a high level of grammatical control.",
      tags: ["exam", "ielts", "rubric", "starter"]
    },
    {
      id: "emails",
      name: "Business Email Tone Guide.docx",
      type: "Style guide",
      status: "Synced to KB",
      summary: "Approved phrasing patterns for client updates, scheduling, escalation, and follow-up emails.",
      sourceText: "Use a calm opener, state the update directly, explain the reason briefly, and end with a clear next step or request.",
      tags: ["business", "email", "tone", "starter"]
    },
    {
      id: "essay-bank",
      name: "Top Essays Collection.docx",
      type: "Reference essays",
      status: "Chunked into examples",
      summary: "High-quality introductions, body paragraphs, and conclusion structures for common writing prompts.",
      sourceText: "Strong essays define the position early, develop one main idea per paragraph, and connect examples back to the thesis.",
      tags: ["essay", "writing", "examples", "starter"]
    }
  ];

  const kbCards = [
    {
      title: "Rubrics",
      meta: "Band guides and score notes."
    },
    {
      title: "Drafts",
      meta: "Corrected essays and samples."
    },
    {
      title: "Email Guides",
      meta: "Tone and template files."
    },
    {
      title: "Class Notes",
      meta: "Rules, phrases, reminders."
    }
  ];

  const quizModes = {
    solve: {
      eyebrow: "Deep Solve",
      title: "Break the prompt before you write.",
      prompt: "Analyze this SAT Writing prompt. Show the central claim, two weaknesses in my draft, and a stronger thesis statement.",
      outputTitle: "Model reasoning path",
      route: "POST /api/deep-solve",
      actionLabel: "Run Deep Solve",
      blocks: [
        {
          heading: "Prompt diagnosis",
          text: "The draft has a clear topic, but it does not define a specific position or show how the examples connect back to the thesis."
        },
        {
          heading: "Step-by-step improvement",
          text: "1. Narrow the claim. 2. State the relationship between cause and effect. 3. Use one example per paragraph with explicit explanation."
        },
        {
          heading: "Stronger thesis",
          text: "Although technology can distract students, its educational value is substantial when schools guide its use with clear academic goals."
        }
      ],
      scores: [
        { value: "3", label: "logic gaps found" },
        { value: "2", label: "rewrite options" },
        { value: "1", label: "clearer thesis" }
      ]
    },
    quiz: {
      eyebrow: "Quiz Builder",
      title: "Build practice from real mistakes.",
      prompt: "Create 5 grammar questions focused on article usage and subject-verb agreement for an upper-intermediate learner.",
      outputTitle: "Generated practice set",
      route: "POST /api/quiz",
      actionLabel: "Generate quiz set",
      blocks: [
        {
          heading: "How to practice",
          text: "Choose a preset, adjust difficulty and question count, then click Generate quiz set. The questions will appear here as practice cards."
        },
        {
          heading: "Answer first",
          text: "Type your answer inside each card before opening the model answer. For choice questions, pick your answer mentally or write the option letter."
        },
        {
          heading: "Check and repeat",
          text: "Open the model answer and explanation, compare the difference, then rewrite your answer once more."
        }
      ],
      scores: [
        { value: "0", label: "questions generated" },
        { value: "Ready", label: "practice mode" },
        { value: "1", label: "click to start" }
      ]
    }
  };

  const quizPresets = {
    "ielts-band": {
      mode: "solve",
      label: "IELTS Band Lift",
      prompt: "Analyze this IELTS Task 2 prompt. Show the strongest position, two logic gaps in my draft, and a Band 7.5 thesis plus topic sentence plan.",
      helper: "Logic, structure, thesis.",
      difficulty: "upper-intermediate",
      count: "5",
      focus: ["Clarify the thesis before rewriting", "Tighten paragraph logic and evidence links", "Turn weak ideas into score-ready topic sentences"]
    },
    "sat-logic": {
      mode: "solve",
      label: "SAT Logic Repair",
      prompt: "Break down this SAT writing response. Identify unsupported claims, show where evidence feels thin, and propose a stronger argumentative outline.",
      helper: "Claim, evidence, reasoning.",
      difficulty: "advanced",
      count: "5",
      focus: ["Separate claim from evidence", "Repair unsupported reasoning", "Produce a cleaner outline before drafting"]
    },
    "grammar-drill": {
      mode: "quiz",
      label: "Grammar Drill",
      prompt: "Create 8 targeted grammar questions focused on articles, tense consistency, and subject-verb agreement for a learner who makes repeated editing mistakes.",
      helper: "Repeat one weak grammar pattern.",
      difficulty: "intermediate",
      count: "8",
      focus: ["Repeat one weak grammar pattern several times", "Mix correction and explanation style questions", "Keep examples close to real student writing"]
    },
    "email-template": {
      mode: "quiz",
      label: "Email Practice",
      prompt: "Generate 5 business writing practice tasks for apology emails, timeline updates, follow-ups, and polite requests with short answer keys.",
      helper: "Drills for work email.",
      difficulty: "upper-intermediate",
      count: "5",
      focus: ["Practice calm professional tone", "Generate reusable email openings and closings", "Reinforce clarity and next-step language"]
    }
  };

  let currentChatScenario = "essay";
  let currentQuizMode = "quiz";
  let currentQuizPreset = "grammar-drill";
  let currentKbFilter = "all";

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }

  function formatInlineMarkdown(value) {
    return escapeHtml(value)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");
  }

  function isUnorderedListLine(line) {
    return /^[-*]\s+/.test(line);
  }

  function isOrderedListLine(line) {
    return /^\d+[.)]\s+/.test(line);
  }

  function renderFormattedList(lines, ordered) {
    const tag = ordered ? "ol" : "ul";
    const className = ordered ? "message-list message-list-ordered" : "message-list";
    const markerPattern = ordered ? /^\d+[.)]\s+/ : /^[-*]\s+/;
    const items = lines.map((line) => line.replace(markerPattern, "").trim());

    return `<${tag} class="${className}">${items.map((item) => `<li>${formatInlineMarkdown(item)}</li>`).join("")}</${tag}>`;
  }

  function formatMessageText(value) {
    const text = String(value || "").trim();

    if (!text) {
      return "<p class=\"message-line\">Mate returned an empty response.</p>";
    }

    return text
      .split(/\n{2,}/)
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => {
        const lines = chunk.split(/\n/).map((line) => line.trim()).filter(Boolean);
        const headingMatch = chunk.match(/^(#{1,4})\s+(.+)$/);

        if (headingMatch) {
          return `<h4 class="message-heading">${formatInlineMarkdown(headingMatch[2])}</h4>`;
        }

        if (lines.length && lines.every((line) => line.startsWith(">"))) {
          const quote = lines.map((line) => formatInlineMarkdown(line.replace(/^>\s*/, ""))).join("<br>");
          return `<blockquote>${quote}</blockquote>`;
        }

        if (lines.length > 1 && lines.slice(1).every(isUnorderedListLine)) {
          const intro = `<p class="message-line">${formatInlineMarkdown(lines[0])}</p>`;
          return `${intro}${renderFormattedList(lines.slice(1), false)}`;
        }

        if (lines.length > 1 && lines.slice(1).every(isOrderedListLine)) {
          const intro = `<p class="message-line">${formatInlineMarkdown(lines[0])}</p>`;
          return `${intro}${renderFormattedList(lines.slice(1), true)}`;
        }

        if (lines.length && lines.every(isUnorderedListLine)) {
          return renderFormattedList(lines, false);
        }

        if (lines.length && lines.every(isOrderedListLine)) {
          return renderFormattedList(lines, true);
        }

        return `<p class="message-line">${formatInlineMarkdown(chunk)}</p>`;
      })
      .join("");
  }

  function getDocumentDownloadName(document) {
    const rawName = String(document && document.name ? document.name : "mate-document.txt").trim();
    return rawName || "mate-document.txt";
  }

  function truncate(value, maxLength) {
    const text = String(value || "");
    if (text.length <= maxLength) {
      return text;
    }

    return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
  }

  function setText(id, value) {
    const node = document.getElementById(id);
    if (node) {
      node.textContent = value;
    }
  }

  function setHtml(id, value) {
    const node = document.getElementById(id);
    if (node) {
      node.innerHTML = value;
    }
  }

  function setValue(id, value) {
    const node = document.getElementById(id);
    if (node && "value" in node) {
      node.value = value;
    }
  }

  function setSelectValue(id, value) {
    const node = document.getElementById(id);
    if (!node || !("value" in node)) {
      return;
    }

    const stringValue = String(value || "");
    const hasOption = Array.from(node.options || []).some((option) => option.value === stringValue);
    if (hasOption) {
      node.value = stringValue;
    }
  }

  function normalizeUserGoalLabel(value) {
    const raw = String(value || "").trim();
    if (!raw) {
      return "English learning plan";
    }

    const normalized = raw.toLowerCase();

    if (normalized.includes("ielts") || normalized.includes("toefl") || normalized.includes("sat")) {
      return "Exam writing plan";
    }

    if (normalized.includes("business") || normalized.includes("email")) {
      return "Professional writing plan";
    }

    if (normalized.includes("grammar")) {
      return "Grammar improvement plan";
    }

    if (normalized.includes("daily") || normalized.includes("expression") || /[^\x00-\x7F]/.test(raw)) {
      return "Expression upgrade plan";
    }

    return truncate(raw, 32);
  }

  function setBadge(node, text, tone) {
    if (!node) {
      return;
    }

    node.textContent = text;
    node.classList.remove("is-live", "is-demo", "is-file");

    if (tone) {
      node.classList.add(tone);
    }
  }

  function getSurfaceRuntimeState(surfaceKey) {
    const capabilities = runtimeInfo.proxyCapabilities || {};
    const liveEnabled = Boolean(capabilities[surfaceKey]);

    if (liveEnabled) {
      return {
        label: surfaceKey === "kb" ? "KB synced" : "DeepTutor live",
        tone: "is-live"
      };
    }

    if (runtimeInfo.mode === "file") {
      return {
        label: "Local preview",
        tone: "is-file"
      };
    }

    if (!runtimeInfo.apiAvailable || runtimeInfo.mode === "demo") {
      return {
        label: surfaceKey === "kb" ? "KB demo mode" : "UI fallback",
        tone: "is-demo"
      };
    }

    if (surfaceKey === "kb") {
      return {
        label: "KB local store",
        tone: "is-file"
      };
    }

    return {
      label: "BFF mock mode",
      tone: "is-file"
    };
  }

  function getRuntimeRouteLabel(surfaceKey, fallbackLabel) {
    const endpoints = runtimeInfo.endpoints || {};

    if (!runtimeInfo.proxyEnabled) {
      return fallbackLabel;
    }

    if (surfaceKey === "chat" && endpoints.chat) {
      return `WS ${endpoints.chat}`;
    }

    if (surfaceKey === "deepSolve" && endpoints.deepSolve) {
      return `WS ${endpoints.deepSolve}`;
    }

    if (surfaceKey === "quiz" && endpoints.quiz) {
      return `WS ${endpoints.quiz}`;
    }

    if (surfaceKey === "kb" && endpoints.kbList) {
      return `GET ${endpoints.kbList}`;
    }

    return fallbackLabel;
  }

  function getChatRuntimeEngineLabel() {
    if (!runtimeInfo.apiAvailable) {
      return isFileMode ? "Mate local preview" : "Mate UI fallback";
    }

    if (runtimeInfo.proxyEnabled) {
      return "Mate writing coach";
    }

    if (runtimeInfo.configured && runtimeInfo.websocketClientAvailable === false) {
      return "Node runtime lacks WebSocket, using mock";
    }

    if (runtimeInfo.configured) {
      return "DeepTutor unavailable, using mock";
    }

    return "Mate mock coach";
  }

  function applyRuntimeSurfaceState() {
    const chatBadgeState = getSurfaceRuntimeState("chat");
    const kbBadgeState = getSurfaceRuntimeState("kb");
    const quizBadgeState = getSurfaceRuntimeState(currentQuizMode === "quiz" ? "quiz" : "deepSolve");
    const currentQuiz = quizModes[currentQuizMode] || quizModes.solve;

    setBadge(document.getElementById("chat-runtime"), chatBadgeState.label, chatBadgeState.tone);
    setBadge(document.getElementById("kb-runtime"), kbBadgeState.label, kbBadgeState.tone);
    setBadge(document.getElementById("quiz-runtime"), quizBadgeState.label, quizBadgeState.tone);

    setText("chat-engine", getChatRuntimeEngineLabel());
    setText("chat-route", getRuntimeRouteLabel("chat", "POST /api/chat"));
    setText(
      "quiz-route-chip",
      getRuntimeRouteLabel(currentQuizMode === "quiz" ? "quiz" : "deepSolve", currentQuiz.route)
    );
  }

  function getCurrentPagePath() {
    const pathname = window.location.pathname || "";
    return pathname.split("/").pop() || "index.html";
  }

  function getNextPath() {
    const params = new URLSearchParams(window.location.search);
    const next = String(params.get("next") || "").trim();

    if (!next || next.startsWith("http") || next.startsWith("//")) {
      return "";
    }

    return next;
  }

  function buildLoginPath() {
    return `index.html?next=${encodeURIComponent(getCurrentPagePath())}`;
  }

  function pageRequiresAuth() {
    return pageName === "chat" || pageName === "kb" || pageName === "quiz";
  }

  function getChatSessionStorageKey() {
    return sessionInfo.authenticated && sessionInfo.user
      ? `mate.chat.sessions.${sessionInfo.user.id}`
      : "";
  }

  function loadChatSessions() {
    chatSessions = {};

    const storageKey = getChatSessionStorageKey();
    if (!storageKey || !window.sessionStorage) {
      return;
    }

    try {
      const raw = window.sessionStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === "object") {
        chatSessions = parsed;
      }
    } catch (error) {
      chatSessions = {};
    }
  }

  function persistChatSessions() {
    const storageKey = getChatSessionStorageKey();
    if (!storageKey || !window.sessionStorage) {
      return;
    }

    if (!Object.keys(chatSessions).length) {
      window.sessionStorage.removeItem(storageKey);
      return;
    }

    window.sessionStorage.setItem(storageKey, JSON.stringify(chatSessions));
  }

  function clearChatSessionsForCurrentUser() {
    const storageKey = getChatSessionStorageKey();
    chatSessions = {};

    if (storageKey && window.sessionStorage) {
      window.sessionStorage.removeItem(storageKey);
    }
  }

  function setFormStatus(node, text, tone) {
    if (!node) {
      return;
    }

    setBadge(node, text, tone);
  }

  function handleUnauthorized() {
    persistSessionToken("");
    sessionInfo = {
      authenticated: false,
      user: null,
      sessionToken: ""
    };
    renderAccountShell();
    syncAuthPageState();

    if (runtimeInfo.apiAvailable && pageRequiresAuth() && !authRedirecting) {
      authRedirecting = true;
      window.location.href = buildLoginPath();
    }
  }

  async function restoreSession() {
    if (!runtimeInfo.apiAvailable) {
      sessionInfo = {
        authenticated: false,
        user: null,
        sessionToken: getStoredSessionToken()
      };
      return sessionInfo;
    }

    try {
      const requestUrl = buildApiUrl("/api/auth/session");
      const response = await fetch(requestUrl, {
        headers: buildAuthHeaders({
          Accept: "application/json"
        }),
        credentials: getRequestCredentials(requestUrl)
      });

      if (!response.ok) {
        throw new Error("Session restore failed");
      }

      const payload = await response.json();
      persistSessionToken(payload.sessionToken || getStoredSessionToken());
      sessionInfo = {
        authenticated: Boolean(payload.authenticated && payload.user),
        user: payload.user || null,
        sessionToken: getStoredSessionToken()
      };
      loadChatSessions();
    } catch (error) {
      sessionInfo = {
        authenticated: false,
        user: null,
        sessionToken: getStoredSessionToken()
      };
      setRuntimeUnavailable(error.message || "Session restore failed", runtimeInfo.checkedApiBases);
    }

    return sessionInfo;
  }

  function renderAccountShell() {
    const shell = document.getElementById("account-shell");
    if (!shell) {
      return;
    }

    if (sessionInfo.authenticated && sessionInfo.user) {
      shell.innerHTML = `
        <div class="account-pill">
          <span class="account-avatar">${escapeHtml(sessionInfo.user.initials || "M")}</span>
          <span class="account-copy">
            <strong>${escapeHtml(sessionInfo.user.name)}</strong>
            <span>Workspace account</span>
          </span>
        </div>
        <button class="secondary-button account-logout" type="button" id="header-logout-button">Log out</button>
      `;

      const logoutButton = document.getElementById("header-logout-button");
      if (logoutButton) {
        logoutButton.addEventListener("click", handleLogout);
      }
      return;
    }

    shell.innerHTML = `<span class="status-chip ${runtimeInfo.apiAvailable ? "is-file" : "is-demo"}">Signed out</span>`;
  }

  function syncAuthPageState() {
    const toggle = document.getElementById("auth-toggle");
    const forms = Array.from(document.querySelectorAll("[data-auth-form]"));
    const summaryCard = document.getElementById("auth-session-card");
    const continueLink = document.getElementById("auth-continue-link");
    const summaryName = document.getElementById("auth-session-name");
    const summaryEmail = document.getElementById("auth-session-email");
    const summaryGoal = document.getElementById("auth-session-goal");
    const summaryKb = document.getElementById("auth-session-kb");
    const signoutButton = document.getElementById("auth-session-signout");
    const nextPath = getNextPath() || "chat.html";

    if (!summaryCard) {
      return;
    }

    if (sessionInfo.authenticated && sessionInfo.user) {
      if (toggle) {
        toggle.classList.add("is-hidden");
      }

      forms.forEach((form) => form.classList.add("is-hidden"));
      summaryCard.classList.remove("is-hidden");

      setText("auth-session-name", sessionInfo.user.name);
      setText("auth-session-email", sessionInfo.user.email);
      setText("auth-session-goal", normalizeUserGoalLabel(sessionInfo.user.goal));
      setText("auth-session-kb", sessionInfo.user.preferredKbName || "mate-english");

      if (continueLink) {
        continueLink.setAttribute("href", nextPath);
      }

      if (signoutButton) {
        signoutButton.onclick = handleLogout;
      }

      return;
    }

    if (toggle) {
      toggle.classList.remove("is-hidden");
    }

    const activeMode = document.querySelector("[data-auth-mode].is-active");
    const activeKey = activeMode ? activeMode.getAttribute("data-auth-mode") : "signin";

    forms.forEach((form) => {
      const isTarget = form.getAttribute("data-auth-form") === activeKey;
      form.classList.toggle("is-hidden", !isTarget);
    });

    summaryCard.classList.add("is-hidden");

    if (summaryName) {
      summaryName.textContent = "";
    }
    if (summaryEmail) {
      summaryEmail.textContent = "";
    }
    if (summaryGoal) {
      summaryGoal.textContent = "";
    }
    if (summaryKb) {
      summaryKb.textContent = "";
    }
  }

  async function submitAuthRequest(path, body, statusNode, successLabel) {
    if (!runtimeInfo.apiAvailable) {
      await bootstrapRuntime();

      if (!runtimeInfo.apiAvailable) {
        setFormStatus(statusNode, buildApiUnavailableMessage(), "is-demo");
        return null;
      }
    }

    setFormStatus(statusNode, "Saving account", "is-file");

    try {
      const requestUrl = buildApiUrl(path);
      const response = await fetch(requestUrl, {
        method: "POST",
        headers: buildAuthHeaders({
          "Content-Type": "application/json",
          Accept: "application/json"
        }),
        credentials: getRequestCredentials(requestUrl),
        body: JSON.stringify(body)
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Authentication failed");
      }

      sessionInfo = {
        authenticated: Boolean(payload.authenticated && payload.user),
        user: payload.user || null,
        sessionToken: String(payload.sessionToken || "").trim()
      };
      persistSessionToken(payload.sessionToken);
      loadChatSessions();
      renderAccountShell();
      syncAuthPageState();
      setFormStatus(statusNode, successLabel, "is-live");
      window.location.href = getNextPath() || "chat.html";
      return payload;
    } catch (error) {
      setFormStatus(statusNode, error.message || "Authentication failed", "is-demo");
      return null;
    }
  }

  async function handleLogout() {
    const previousStorageKey = getChatSessionStorageKey();

    if (runtimeInfo.apiAvailable) {
      try {
        const requestUrl = buildApiUrl("/api/auth/logout");
        await fetch(requestUrl, {
          method: "POST",
          headers: buildAuthHeaders({
            Accept: "application/json"
          }),
          credentials: getRequestCredentials(requestUrl)
        });
      } catch (error) {
        // Ignore logout transport failures and clear the local state anyway.
      }
    }

    if (previousStorageKey && window.sessionStorage) {
      window.sessionStorage.removeItem(previousStorageKey);
    }

    persistSessionToken("");
    sessionInfo = {
      authenticated: false,
      user: null,
      sessionToken: ""
    };
    chatSessions = {};
    renderAccountShell();
    syncAuthPageState();

    if (pageName === "auth") {
      setFormStatus(document.getElementById("signin-status"), "Signed out", "is-file");
      setFormStatus(document.getElementById("signup-status"), "Signed out", "is-file");
      return;
    }

    window.location.href = "index.html";
  }

  async function bootstrapRuntime() {
    const candidates = buildApiBaseCandidates();
    let lastError = "";

    for (const apiBaseUrl of candidates) {
      try {
        const payload = await probeApiBase(apiBaseUrl);
        runtimeInfo = {
          apiAvailable: true,
          apiBaseUrl,
          mode: payload.mode || "mock",
          proxyEnabled: Boolean(payload.proxyEnabled),
          backendLabel: payload.backendLabel || "Mate BFF",
          configured: Boolean(payload.configured),
          upstreamReachable: Boolean(payload.upstreamReachable),
          websocketClientAvailable: Boolean(payload.websocketClientAvailable),
          endpoints: payload.endpoints && typeof payload.endpoints === "object" ? payload.endpoints : {},
          proxyCapabilities: payload.proxyCapabilities && typeof payload.proxyCapabilities === "object" ? payload.proxyCapabilities : {},
          checkedApiBases: candidates.slice(),
          lastError: ""
        };
        safeWriteLocalStorage(runtimeApiStorageKey, apiBaseUrl);
        return runtimeInfo;
      } catch (error) {
        lastError = error && error.message ? error.message : String(error || "");
      }
    }

    return setRuntimeUnavailable(lastError || "Mate BFF health check failed", candidates);
  }

  async function requestJson(path, options, fallbackFactory) {
    const requestOptions = Object.assign(
      {
        method: "GET",
        headers: {}
      },
      options || {}
    );

    if (!runtimeInfo.apiAvailable) {
      await bootstrapRuntime();
    }

    if (runtimeInfo.apiAvailable) {
      try {
        const requestUrl = buildApiUrl(path);
        const response = await fetch(requestUrl, Object.assign({}, requestOptions, {
          headers: buildAuthHeaders(requestOptions.headers),
          credentials: requestOptions.credentials || getRequestCredentials(requestUrl)
        }));

        if (response.status === 401) {
          handleUnauthorized();
          return fallbackFactory();
        }

        if (!response.ok) {
          throw new Error("Request failed");
        }

        return await response.json();
      } catch (error) {
        setRuntimeUnavailable(error.message || "Request failed", runtimeInfo.checkedApiBases);
      }
    }

    return fallbackFactory();
  }

  async function ensureApiRuntime() {
    if (!runtimeInfo.apiAvailable) {
      await bootstrapRuntime();
    }

    if (!runtimeInfo.apiAvailable) {
      throw new Error(buildApiUnavailableMessage());
    }

    return runtimeInfo;
  }

  async function requestJsonStrict(path, options) {
    await ensureApiRuntime();

    const requestOptions = Object.assign(
      {
        method: "GET",
        headers: {}
      },
      options || {}
    );

    const requestUrl = buildApiUrl(path);
    let response;

    try {
      response = await fetch(requestUrl, Object.assign({}, requestOptions, {
        headers: buildAuthHeaders(requestOptions.headers),
        credentials: requestOptions.credentials || getRequestCredentials(requestUrl)
      }));
    } catch (error) {
      setRuntimeUnavailable(error.message || "Request failed", runtimeInfo.checkedApiBases);
      throw new Error(buildApiUnavailableMessage());
    }

    if (response.status === 401) {
      handleUnauthorized();
      throw new Error("Authentication required.");
    }

    let payload = {};
    const responseText = await response.text();
    if (responseText) {
      try {
        payload = JSON.parse(responseText);
      } catch (error) {
        payload = {
          error: responseText
        };
      }
    }

    if (!response.ok) {
      throw new Error(payload.error || "Request failed");
    }

    return payload;
  }

  async function uploadFilesWithProgress(path, files, onProgress) {
    await ensureApiRuntime();

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      const requestUrl = buildApiUrl(path);

      files.forEach((file) => {
        formData.append("files", file, file.name);
      });

      xhr.open("POST", requestUrl, true);
      xhr.withCredentials = true;
      const token = getStoredSessionToken();

      if (token) {
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      }

      xhr.upload.addEventListener("progress", function (event) {
        if (typeof onProgress !== "function") {
          return;
        }

        if (event.lengthComputable) {
          const ratio = event.total ? event.loaded / event.total : 0;
          onProgress({
            loaded: event.loaded,
            total: event.total,
            percent: Math.min(100, Math.round(ratio * 100))
          });
          return;
        }

        onProgress({
          loaded: event.loaded,
          total: 0,
          percent: 0
        });
      });

      xhr.addEventListener("load", function () {
        if (xhr.status === 401) {
          handleUnauthorized();
          reject(new Error("Authentication required."));
          return;
        }

        let payload = {};

        if (xhr.responseText) {
          try {
            payload = JSON.parse(xhr.responseText);
          } catch (error) {
            payload = {
              error: xhr.responseText
            };
          }
        }

        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(payload);
          return;
        }

        reject(new Error(payload.error || "Upload failed"));
      });

      xhr.addEventListener("error", function () {
        setRuntimeUnavailable("Upload failed", runtimeInfo.checkedApiBases);
        reject(new Error(buildApiUnavailableMessage()));
      });

      xhr.send(formData);
    });
  }

  async function downloadDocumentFile(kbDocument) {
    await ensureApiRuntime();

    const requestUrl = buildApiUrl(`/api/kb/documents/${encodeURIComponent(kbDocument.id)}/download`);
    const response = await fetch(requestUrl, {
      method: "GET",
      headers: buildAuthHeaders({
        Accept: "application/octet-stream"
      }),
      credentials: getRequestCredentials(requestUrl)
    });

    if (!response.ok) {
      let message = "Download failed";
      try {
        const payload = await response.json();
        message = payload.error || message;
      } catch (error) {
        // Keep the generic message for non-JSON download errors.
      }
      throw new Error(message);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = getDocumentDownloadName(kbDocument);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function buildChatFallback(message, scenarioKey) {
    const normalized = message.toLowerCase();
    const compact = String(message || "").replace(/\s+/g, " ").trim();
    const excerpt = compact ? truncate(compact, 110) : "";
    const containsCjkText = /[\u3400-\u9fff]/.test(String(message || ""));
    const scenario = chatScenarios[scenarioKey] || chatScenarios.essay;
    let suggestions = scenario.suggestions.slice(0, 3);
    let assistantLines;

    if (((/[\u3400-\u9fff]/.test(String(message || "")) && normalized.includes("ai")) && (/\u4e0a\u6e38|\u5b9e\u65f6|\u6a21\u677f|\u56de\u590d/.test(String(message || "")))) || normalized.includes("upstream") || normalized.includes("real-time") || normalized.includes("realtime") || normalized.includes("deeptutor") || normalized.includes("mock") || normalized.includes("proxy")) {
      assistantLines = [
        "This page has fallen back to the UI demo layer, so it is not talking to the upstream realtime AI right now.",
        "To switch back, the BFF and DeepTutor both need to be reachable and /api/health needs to report proxyEnabled as true.",
        "If you want, I can still work on this exact message instead of repeating the fixed template."
      ];
      suggestions = ["Check /api/health", "Restore upstream connection", "Continue with this message"];
    } else if (normalized.includes("email") || scenarioKey === "email" || /\u90ae\u4ef6|\u5ba2\u6237|\u5546\u52a1\u90ae\u4ef6/.test(String(message || ""))) {
      assistantLines = [
        `I can rewrite this message around: ${excerpt || "your email draft"}.`,
        "First pass: make the ask explicit, trim apology loops, and end with one clear next step.",
        "Next pass options: more polite, more concise, or more executive-friendly."
      ];
      suggestions = ["Add subject line", "Make it more concise", "Clarify next step"];
    } else if (normalized.includes("grammar") || normalized.includes("tense") || scenarioKey === "grammar" || /\u8bed\u6cd5|\u65f6\u6001|\u51a0\u8bcd|\u5355\u590d\u6570/.test(String(message || ""))) {
      assistantLines = [
        `I would explain the grammar point inside: ${excerpt || "your sentence"}.`,
        "Then I would show the corrected version, explain why it changes, and add one extra example.",
        "Next step: turn the same point into a short drill for repetition."
      ];
      suggestions = ["Explain simply", "Show two examples", "Create mini practice"];
    } else if (normalized.includes("upgrade") || normalized.includes("better") || normalized.includes("rewrite") || normalized.includes("polish") || scenarioKey === "upgrade" || /\u6da6\u8272|\u6539\u5199|\u5347\u7ea7\u8868\u8fbe|\u66f4\u81ea\u7136|\u66f4\u5b66\u672f/.test(String(message || ""))) {
      assistantLines = [
        `I can keep the meaning of ${excerpt || "your line"} and raise the tone.`,
        "The usual improvements are stronger verbs, tighter rhythm, and fewer flat filler words.",
        "Ask for academic, business, or natural spoken tone and I can steer the next pass."
      ];
      suggestions = ["Academic tone", "More concise", "More persuasive"];
    } else if (compact.length >= 220 || compact.split(/[.!?]/).filter(Boolean).length >= 4 || (containsCjkText && compact.length >= 120)) {
      assistantLines = [
        "You pasted a full passage, so I should work on the actual text instead of returning the generic template.",
        `The section I would focus on first is: ${excerpt || "the passage you pasted"}.`,
        "Next step options: summarise the claim, extract the structure, or rewrite it into a clearer academic paragraph."
      ];
      suggestions = ["Summarise the claim", "Extract the structure", "Rewrite directly"];
    } else {
      assistantLines = [
        `I can work directly on: ${excerpt || "your last message"}.`,
        "For an essay-style pass, I would tighten the position, make the paragraph logic more explicit, and cut repeated wording.",
        "If you want, the next turn can be a direct rewrite, a band-style diagnosis, or a Chinese explanation."
      ];
      suggestions = containsCjkText
        ? ["Rewrite", "Line-by-line feedback", "Chinese explanation"]
        : ["Improve thesis", "Fix grammar", "Upgrade vocabulary"];
    }

    return {
      mode: "demo",
      backendLabel: "Mate UI fallback",
      routeLabel: "POST /api/chat",
      engineLabel: "Demo coach response",
      suggestions: suggestions,
      assistantLines: assistantLines
    };
  }

  function buildKnowledgeCards(query, documents) {
    const normalized = query.trim().toLowerCase();
    const documentCards = (documents || []).map((document) => ({
      title: `${document.type}: ${document.name}`,
      meta: `${document.summary || "Saved in Mate knowledge base."}${getDocumentTags(document).length ? ` Tags: ${getDocumentTags(document).join(", ")}` : ""}`
    }));

    return kbCards.concat(documentCards).filter((card) => {
      if (!normalized) {
        return true;
      }
      return `${card.title} ${card.meta}`.toLowerCase().includes(normalized);
    });
  }

  function formatBytes(size) {
    const numericSize = Number(size || 0);

    if (numericSize >= 1024 * 1024) {
      return `${(numericSize / (1024 * 1024)).toFixed(1)} MB`;
    }

    if (numericSize >= 1024) {
      return `${Math.max(1, Math.round(numericSize / 1024))} KB`;
    }

    return `${numericSize} B`;
  }

  function buildUploadedFileFallbackDocuments(files) {
    return files.map((file, index) => ({
      id: `demo-upload-${Date.now()}-${index}`,
      name: file.name,
      type: "Uploaded file",
      summary: `Uploaded from your device. ${formatBytes(file.size)} ready for indexing.`,
      status: "Saved in UI preview",
      fileSize: file.size,
      tags: ["file", "upload"],
      sourceOrigin: "personal",
      editable: false
    }));
  }

  function getDocumentTags(document) {
    return Array.isArray(document.tags) ? document.tags.slice(0, 6) : [];
  }

  function buildFilterLabel(filterKey) {
    const labels = {
      all: "All docs",
      personal: "My uploads",
      starter: "Starter docs",
      files: "Files",
      notes: "Notes"
    };

    return labels[filterKey] || "All docs";
  }

  function isFileDocument(document) {
    return Boolean(document.storagePath || document.fileSize || document.mimeType);
  }

  function isNoteDocument(document) {
    const normalizedType = String(document.type || "").toLowerCase();
    return normalizedType.includes("note") || normalizedType.includes("guide") || !isFileDocument(document);
  }

  function matchesKbFilter(document, filterKey) {
    if (filterKey === "personal") {
      return document.sourceOrigin === "personal";
    }

    if (filterKey === "starter") {
      return document.sourceOrigin === "starter";
    }

    if (filterKey === "files") {
      return isFileDocument(document);
    }

    if (filterKey === "notes") {
      return isNoteDocument(document);
    }

    return true;
  }

  function getDocumentGroupMeta(groupKey) {
    const map = {
      personal: {
        title: "Your workspace",
        meta: "Private uploads, notes, and files tied to your Mate account."
      },
      starter: {
        title: "Starter library",
        meta: "Shared seed documents that help the first session feel useful immediately."
      },
      deeptutor: {
        title: "DeepTutor sync",
        meta: "Knowledge bases currently visible from the upstream DeepTutor layer."
      },
      other: {
        title: "Other documents",
        meta: "Additional knowledge sources connected to this workspace."
      }
    };

    return map[groupKey] || map.other;
  }

  function groupKnowledgeDocuments(documents) {
    const order = ["personal", "starter", "deeptutor", "other"];
    const groups = new Map();

    documents.forEach((document) => {
      const groupKey = ["personal", "starter", "deeptutor"].includes(document.sourceOrigin)
        ? document.sourceOrigin
        : "other";

      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }

      groups.get(groupKey).push(document);
    });

    return order
      .filter((groupKey) => groups.has(groupKey))
      .map((groupKey) => ({
        key: groupKey,
        meta: getDocumentGroupMeta(groupKey),
        documents: groups.get(groupKey)
      }));
  }

  function buildQuizFallback(modeKey, payload) {
    const mode = quizModes[modeKey];
    const requestedCount = Math.max(1, Number((payload && payload.count) || 5));
    const requestedDifficulty = String((payload && payload.difficulty) || "upper-intermediate");
    const requestedTopic = String((payload && (payload.topic || payload.prompt)) || mode.prompt);

    if (modeKey === "quiz") {
      return {
        mode: "demo",
        backendLabel: "Mate UI fallback",
        routeLabel: mode.route,
        outputTitle: mode.outputTitle,
        blocks: [
          {
            heading: "Question mix",
            text: `${requestedCount} items requested for ${truncate(requestedTopic, 76)}. Mate would blend correction, rewrite, and explanation-style questions.`
          },
          {
            heading: "Difficulty control",
            text: `The practice set is tuned for a ${requestedDifficulty} learner and stays close to exam, classroom, or business writing pain points.`
          },
          {
            heading: "Feedback design",
            text: "Each answer key should include a short explanation, a corrected version, and one transfer example learners can reuse."
          }
        ],
        questions: buildClientPracticeQuestions(requestedTopic, requestedCount, requestedDifficulty, payload && payload.questionType),
        scores: [
          { value: String(requestedCount), label: "questions requested" },
          { value: requestedDifficulty, label: "difficulty" },
          { value: "Mixed", label: "question type" }
        ]
      };
    }

    return {
      mode: "demo",
      backendLabel: "Mate UI fallback",
      routeLabel: mode.route,
      outputTitle: mode.outputTitle,
      blocks: [
        {
          heading: "Prompt diagnosis",
          text: requestedTopic
            ? `Mate would first clarify the writing task in: ${truncate(requestedTopic, 110)}`
            : mode.blocks[0].text
        },
        mode.blocks[1],
        mode.blocks[2]
      ],
      scores: mode.scores
    };
  }

  function buildClientPracticeQuestions(topic, count, difficulty, questionType) {
    const requestedCount = Math.max(1, Number(count || 5));
    const normalizedTopic = String(topic || "English writing practice").trim();
    const normalizedType = String(questionType || "mixed").trim();

    return Array.from({ length: requestedCount }).map((_, index) => {
      const number = index + 1;
      const isChoice = normalizedType === "choice" || (normalizedType === "mixed" && number % 2 === 0);

      return {
        id: `demo-practice-${number}`,
        number,
        type: isChoice ? "choice" : "written",
        difficulty,
        concentration: normalizedTopic,
        question: isChoice
          ? `Choose the strongest correction for a learner mistake related to ${normalizedTopic}.`
          : `Rewrite one sentence about ${normalizedTopic} with clearer grammar and stronger academic wording.`,
        options: isChoice ? [
          { key: "A", text: "Keep the sentence as-is." },
          { key: "B", text: "Use a clearer subject, verb, and article pattern." },
          { key: "C", text: "Add more filler words before the main verb." },
          { key: "D", text: "Remove the specific example." }
        ] : [],
        correctAnswer: isChoice ? "B" : "Answers should be grammatical, specific, and concise.",
        explanation: "Practice the target pattern, then compare your answer with the model answer and explanation."
      };
    });
  }

  function createMessageMarkup(role, content) {
    const body = Array.isArray(content)
      ? content.map((line) => formatMessageText(line)).join("")
      : formatMessageText(content);

    return `
      <article class="message ${role}">
        <span class="message-role">${role === "user" ? "Learner" : "Mate"}</span>
        ${body}
      </article>
    `;
  }

  function buildScoreCardsMarkup(scores) {
    const items = Array.isArray(scores) ? scores : [];

    if (!items.length) {
      return `
        <article class="score-card">
          <strong>0</strong>
          <span>No metrics yet</span>
        </article>
      `;
    }

    return items.map((score) => `
      <article class="score-card">
        <strong>${escapeHtml(score.value)}</strong>
        <span>${escapeHtml(score.label)}</span>
      </article>
    `).join("");
  }

  function renderChatStarters(items) {
    const starters = Array.isArray(items) ? items : [];
    setHtml(
      "chat-starter-list",
      starters.map((item) => `
        <button class="starter-button" type="button" data-chat-starter="${escapeHtml(item)}">
          ${escapeHtml(item)}
        </button>
      `).join("")
    );
  }

  function renderDeliverables(items) {
    const deliverables = Array.isArray(items) ? items : [];
    setHtml(
      "chat-deliverables",
      deliverables.map((item) => `
        <article class="deliverable-card">
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.text)}</p>
        </article>
      `).join("")
    );
  }

  function renderScoreCards(targetId, scores) {
    setHtml(targetId, buildScoreCardsMarkup(scores));
  }

  function renderAnalysisList(targetId, items) {
    const list = Array.isArray(items) ? items : [];
    setHtml(targetId, list.map((item) => `<li>${escapeHtml(item)}</li>`).join(""));
  }

  function renderChatFocusChips(items) {
    const chips = Array.isArray(items) ? items : [];
    setHtml(
      "chat-tone-row",
      chips.map((item) => `<span class="status-chip is-file">${escapeHtml(item)}</span>`).join("")
    );
  }

  function buildDocumentBadgeTone(status) {
    const normalized = String(status || "").toLowerCase();

    if (normalized.includes("failed")) {
      return "is-demo";
    }

    if (normalized.includes("uploaded") || normalized.includes("synced") || normalized.includes("ready") || normalized.includes("default")) {
      return "is-live";
    }

    if (normalized.includes("saved") || normalized.includes("queued") || normalized.includes("local")) {
      return "is-file";
    }

    return "";
  }

  function buildDocumentIcon(document) {
    const name = String(document.name || "");
    const ext = name.includes(".") ? name.split(".").pop().toUpperCase() : "";

    if (ext) {
      return ext.slice(0, 4);
    }

    const type = String(document.type || "DOC").toUpperCase().replace(/[^A-Z]/g, "");
    return type.slice(0, 4) || "DOC";
  }

  function renderChatScenario(key) {
    const scenario = chatScenarios[key];
    const thread = document.getElementById("chat-thread");
    const textarea = document.getElementById("chat-input");

    if (!scenario || !thread) {
      return;
    }

    currentChatScenario = key;
    setText("chat-scenario-title", scenario.title);
    setText("chat-surface-chip", scenario.title);
    setText("chat-goal", scenario.goal);
    setText("chat-route", getRuntimeRouteLabel("chat", scenario.route));
    setText("chat-engine", getChatRuntimeEngineLabel() || scenario.engine);
    renderAnalysisList("chat-suggestions", scenario.suggestions);
    renderChatStarters(scenario.starters);
    renderDeliverables(scenario.deliverables);
    renderScoreCards("chat-score-grid", scenario.stats);
    renderChatFocusChips(scenario.suggestions);
    if (textarea) {
      textarea.placeholder = scenario.placeholder || "Paste your writing task here...";
    }
    thread.innerHTML = scenario.thread.map((message) => createMessageMarkup(message.role, message.content)).join("");
    thread.scrollTop = thread.scrollHeight;
  }

  function renderDocuments(documents) {
    const feed = document.getElementById("kb-doc-feed");
    if (!feed) {
      return;
    }

    const filteredDocuments = documents.filter((document) => matchesKbFilter(document, currentKbFilter));
    const groupedDocuments = groupKnowledgeDocuments(filteredDocuments);

    if (!filteredDocuments.length) {
      feed.innerHTML = `
        <li class="doc-empty-state">
          <strong>No documents match this view yet.</strong>
          <span class="source-meta">Try another filter, upload a file, or add a custom note to grow this library.</span>
        </li>
      `;
      return;
    }

    feed.innerHTML = groupedDocuments.map((group) => `
      <li class="doc-group">
        <div class="doc-group-head">
          <div>
            <strong>${escapeHtml(group.meta.title)}</strong>
            <span class="source-meta">${escapeHtml(group.meta.meta)} - ${escapeHtml(`${group.documents.length} file${group.documents.length === 1 ? "" : "s"}`)}</span>
          </div>
        </div>
        <div class="doc-group-list">
          ${group.documents.map((document) => {
            const canDownload = document.downloadable !== false && !String(document.id || "").startsWith("deeptutor:");
            return `
            <article class="doc-item">
              <div class="doc-top">
                <span class="doc-icon">${escapeHtml(buildDocumentIcon(document))}</span>
                <div class="doc-copy">
                  <strong>${escapeHtml(document.name)}</strong>
                  <span class="file-meta">${escapeHtml(document.type)}${document.fileSize ? ` - ${escapeHtml(formatBytes(document.fileSize))}` : ""}</span>
                </div>
                <span class="status-chip ${buildDocumentBadgeTone(document.status)}">${escapeHtml(document.status || "Saved")}</span>
              </div>
              <span class="source-meta">${escapeHtml(document.summary || "No summary yet.")}</span>
              ${getDocumentTags(document).length ? `
                <div class="doc-tag-row">
                  ${getDocumentTags(document).map((tag) => `<span class="doc-tag">${escapeHtml(tag)}</span>`).join("")}
                </div>
              ` : ""}
              <div class="doc-footer">
                <span class="doc-origin">${escapeHtml(document.sourceOrigin || "personal")}</span>
                <div class="doc-actions">
                  ${canDownload ? `<button class="secondary-button doc-action-button" type="button" data-doc-action="download" data-doc-id="${escapeAttribute(document.id)}">Download</button>` : ""}
                  ${document.editable ? `
                    <button class="secondary-button doc-action-button" type="button" data-doc-action="rename" data-doc-id="${escapeAttribute(document.id)}">Rename</button>
                    <button class="secondary-button doc-action-button is-danger" type="button" data-doc-action="delete" data-doc-id="${escapeAttribute(document.id)}">Delete</button>
                  ` : canDownload ? "" : `<span class="doc-lock">Managed by Mate</span>`}
                </div>
              </div>
            </article>
          `; }).join("")}
        </div>
      </li>
    `).join("");
  }

  function renderKnowledgeCards(cards) {
    const grid = document.getElementById("kb-source-grid");
    if (!grid) {
      return;
    }

    grid.innerHTML = cards.map((card) => `
      <article class="source-card">
        <h3>${escapeHtml(card.title)}</h3>
        <p class="source-meta">${escapeHtml(card.meta)}</p>
      </article>
    `).join("");
  }

  function renderUploadQueue(files) {
    const queue = document.getElementById("kb-upload-queue");
    if (!queue) {
      return;
    }

    if (!files.length) {
      queue.innerHTML = "<li>No files in queue yet.</li>";
      return;
    }

    queue.innerHTML = files.map((file) => `
      <li>
        <strong>${escapeHtml(file.name)}</strong>
        <span class="file-meta">${escapeHtml(file.type || "Local file")} - ${escapeHtml(formatBytes(file.size))}</span>
      </li>
    `).join("");
  }

  function renderQuizResult(payload) {
    setText("quiz-output-title", payload.outputTitle);
    setText(
      "quiz-route-chip",
      payload.routeLabel || getRuntimeRouteLabel(currentQuizMode === "quiz" ? "quiz" : "deepSolve", quizModes[currentQuizMode].route)
    );

    const blocks = document.getElementById("quiz-output-blocks");
    const scores = document.getElementById("quiz-score-grid");
    const blockItems = Array.isArray(payload.blocks) ? payload.blocks : [];
    const questionItems = Array.isArray(payload.questions) ? payload.questions : [];
    const scoreItems = Array.isArray(payload.scores) ? payload.scores : [];

    if (blocks) {
      const practiceMarkup = questionItems.length ? buildPracticeQuestionsMarkup(questionItems) : "";
      const blockMarkup = blockItems.map((block) => `
        <article class="output-block">
          <h3>${escapeHtml(block.heading)}</h3>
          <div class="rich-output">${formatMessageText(block.text)}</div>
        </article>
      `).join("");
      blocks.innerHTML = `${practiceMarkup}${blockMarkup}`;
    }

    if (scores) {
      scores.innerHTML = buildScoreCardsMarkup(scoreItems);
    }
  }

  function buildPracticeQuestionsMarkup(questions) {
    return `
      <section class="practice-set" aria-label="Practice questions">
        <div class="practice-set-header">
          <span class="small-label">Practice Set</span>
          <strong>${questions.length} question${questions.length === 1 ? "" : "s"} ready</strong>
          <p>Write your answer first. Then open the answer panel to compare with Mate.</p>
        </div>
        ${questions.map((question, index) => buildPracticeQuestionMarkup(question, index)).join("")}
      </section>
    `;
  }

  function buildPracticeQuestionMarkup(question, index) {
    const number = Number(question.number || index + 1);
    const options = Array.isArray(question.options) ? question.options : [];
    const optionMarkup = options.length
      ? `
        <ul class="practice-options">
          ${options.map((option) => `
            <li>
              <span>${escapeHtml(option.key || "")}</span>
              <p>${escapeHtml(option.text || "")}</p>
            </li>
          `).join("")}
        </ul>
      `
      : "";
    const answer = question.correctAnswer || "No model answer was returned.";
    const explanation = question.explanation || "No explanation was returned.";

    return `
      <article class="practice-question-card">
        <div class="practice-question-top">
          <span class="status-chip is-file">Q${number}</span>
          <span>${escapeHtml(question.type || "written")}${question.difficulty ? ` - ${escapeHtml(question.difficulty)}` : ""}</span>
        </div>
        ${question.concentration ? `<p class="practice-focus">${escapeHtml(question.concentration)}</p>` : ""}
        <h4>${escapeHtml(question.question || "")}</h4>
        ${optionMarkup}
        <label class="practice-answer-box">
          <span>Your answer</span>
          <textarea placeholder="Type your answer here before opening the model answer..."></textarea>
        </label>
        <details class="practice-answer">
          <summary>Show model answer and explanation</summary>
          <div>
            <strong>Answer</strong>
            <p>${formatInlineMarkdown(answer)}</p>
            <strong>Explanation</strong>
            <p>${formatInlineMarkdown(explanation)}</p>
          </div>
        </details>
      </article>
    `;
  }

  function renderQuizFocus(items) {
    renderAnalysisList("quiz-focus-list", items);
  }

  function getFirstQuizPresetForMode(modeKey) {
    const entry = Object.entries(quizPresets).find(function (item) {
      return item[1].mode === modeKey;
    });
    return entry ? entry[0] : "";
  }

  function syncQuizModeTabs(modeKey) {
    Array.from(document.querySelectorAll("[data-quiz-mode]")).forEach((tab) => {
      tab.classList.toggle("is-active", tab.getAttribute("data-quiz-mode") === modeKey);
    });
  }

  function syncQuizPresetButtons(presetKey) {
    Array.from(document.querySelectorAll("[data-quiz-preset]")).forEach((button) => {
      button.classList.toggle("is-active", button.getAttribute("data-quiz-preset") === presetKey);
    });
  }

  function renderQuizMode(modeKey, options) {
    const mode = quizModes[modeKey];
    const promptInput = document.getElementById("quiz-prompt-input");
    const nextPrompt = options && options.promptValue ? options.promptValue : mode ? mode.prompt : "";
    const helperText = options && options.helperText ? options.helperText : mode ? mode.prompt : "";

    if (!mode) {
      return;
    }

    currentQuizMode = modeKey;
    syncQuizModeTabs(modeKey);
    setText("quiz-eyebrow", mode.eyebrow);
    setText("quiz-mode-chip", mode.eyebrow);
    setText("quiz-title", mode.title);
    setText("quiz-prompt", helperText);
    setText("quiz-run-label", mode.actionLabel);
    setText(
      "quiz-action-hint",
      modeKey === "quiz"
        ? "Questions will appear in the practice panel on the right."
        : "The analysis will appear in the result panel on the right."
    );
    setText("quiz-route-chip", getRuntimeRouteLabel(modeKey === "quiz" ? "quiz" : "deepSolve", mode.route));
    if (promptInput && (!options || !options.preservePrompt || !String(promptInput.value || "").trim())) {
      promptInput.value = nextPrompt;
    }
    renderQuizResult({
      outputTitle: mode.outputTitle,
      routeLabel: mode.route,
      blocks: mode.blocks,
      scores: mode.scores
    });
  }

  function applyQuizPreset(presetKey) {
    const preset = quizPresets[presetKey];
    if (!preset) {
      return;
    }

    currentQuizPreset = presetKey;
    renderQuizMode(preset.mode, {
      promptValue: preset.prompt,
      helperText: preset.helper
    });
    setSelectValue("quiz-difficulty", preset.difficulty);
    setSelectValue("quiz-count", preset.count);
    renderQuizFocus(preset.focus);
    syncQuizPresetButtons(presetKey);
  }

  function updateRuntimeLabels() {
    applyRuntimeSurfaceState();
  }

  function initAuth() {
    const painButtons = Array.from(document.querySelectorAll("[data-pain-key]"));
    const authButtons = Array.from(document.querySelectorAll("[data-auth-mode]"));
    const authForms = Array.from(document.querySelectorAll("[data-auth-form]"));
    const signinForm = document.getElementById("signin-form");
    const signupForm = document.getElementById("signup-form");
    const signinStatus = document.getElementById("signin-status");
    const signupStatus = document.getElementById("signup-status");

    painButtons.forEach((button) => {
      button.addEventListener("click", function () {
        const key = button.getAttribute("data-pain-key");
        const story = painStories[key];
        if (!story) {
          return;
        }

        painButtons.forEach((item) => item.classList.remove("is-active"));
        button.classList.add("is-active");
        setText("pain-badge", story.badge);
        setText("pain-title", story.title);
        setText("pain-copy", story.copy);
        setText("pain-output", story.output);
      });
    });

    authButtons.forEach((button) => {
      button.addEventListener("click", function () {
        const mode = button.getAttribute("data-auth-mode");
        authButtons.forEach((item) => item.classList.remove("is-active"));
        button.classList.add("is-active");
        syncAuthPageState();
      });
    });

    if (signinForm) {
      signinForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        const emailField = document.getElementById("signin-email");
        const passwordField = document.getElementById("signin-password");
        const submitButton = signinForm.querySelector("button[type='submit']");

        if (!emailField || !passwordField || !submitButton) {
          return;
        }

        if (isFileMode) {
          window.location.href = getNextPath() || "chat.html";
          return;
        }

        submitButton.disabled = true;
        await submitAuthRequest(
          "/api/auth/login",
          {
            email: emailField.value.trim(),
            password: passwordField.value
          },
          signinStatus,
          "Welcome back"
        );
        submitButton.disabled = false;
      });
    }

    if (signupForm) {
      signupForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        const nameField = document.getElementById("signup-name");
        const emailField = document.getElementById("signup-email");
        const goalField = document.getElementById("signup-goal");
        const passwordField = document.getElementById("signup-password");
        const submitButton = signupForm.querySelector("button[type='submit']");

        if (!nameField || !emailField || !goalField || !passwordField || !submitButton) {
          return;
        }

        if (isFileMode) {
          window.location.href = getNextPath() || "chat.html";
          return;
        }

        submitButton.disabled = true;
        await submitAuthRequest(
          "/api/auth/signup",
          {
            name: nameField.value.trim(),
            email: emailField.value.trim(),
            goal: goalField.value,
            password: passwordField.value
          },
          signupStatus,
          "Account created"
        );
        submitButton.disabled = false;
      });
    }

    syncAuthPageState();
  }

  function initChat() {
    const thread = document.getElementById("chat-thread");
    const chips = Array.from(document.querySelectorAll("[data-chat-scenario]"));
    const form = document.getElementById("chat-composer");
    const textarea = document.getElementById("chat-input");
    const runtimeBadge = document.getElementById("chat-runtime");
    const starterList = document.getElementById("chat-starter-list");

    if (!thread || !form || !textarea) {
      return;
    }

    renderChatScenario("essay");
    setBadge(runtimeBadge, "Checking BFF", "is-file");

    chips.forEach((chip) => {
      chip.addEventListener("click", function () {
        const key = chip.getAttribute("data-chat-scenario");
        chips.forEach((item) => item.classList.remove("is-active"));
        chip.classList.add("is-active");
        renderChatScenario(key);
      });
    });

    if (starterList) {
      starterList.addEventListener("click", function (event) {
        const button = event.target.closest("[data-chat-starter]");
        if (!button) {
          return;
        }

        textarea.value = button.getAttribute("data-chat-starter") || "";
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      });
    }

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      const text = textarea.value.trim();
      const submitButton = form.querySelector("button[type='submit']");

      if (!text || !submitButton) {
        return;
      }

      thread.insertAdjacentHTML("beforeend", createMessageMarkup("user", text));
      thread.insertAdjacentHTML("beforeend", createMessageMarkup("assistant", ["Mate is preparing a coaching response..."]));

      const loadingMessage = thread.lastElementChild;
      textarea.value = "";
      submitButton.disabled = true;
      try {
        const payload = await requestJsonStrict(
          "/api/chat",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              scenario: currentChatScenario,
              message: text,
              goal: chatScenarios[currentChatScenario].goal,
              sessionId: chatSessions[currentChatScenario] || null
            })
          }
        );

        if (payload.sessionId) {
          chatSessions[currentChatScenario] = payload.sessionId;
          persistChatSessions();
        }

        if (loadingMessage) {
          loadingMessage.outerHTML = createMessageMarkup("assistant", payload.assistantLines || ["Mate returned an empty response."]);
        }

        if (Array.isArray(payload.suggestions) && payload.suggestions.length) {
          setHtml("chat-suggestions", payload.suggestions.map((item) => `<li>${escapeHtml(item)}</li>`).join(""));
        }

        if (payload.routeLabel) {
          setText("chat-route", payload.routeLabel);
        }

        if (payload.engineLabel) {
          setText("chat-engine", payload.engineLabel);
        }

        if (runtimeBadge) {
          setBadge(runtimeBadge, payload.mode === "proxy" ? "DeepTutor live" : "Chat error", payload.mode === "proxy" ? "is-live" : "is-file");
        }
      } catch (error) {
        if (loadingMessage) {
          loadingMessage.outerHTML = createMessageMarkup("assistant", [
            "Live chat is currently unavailable, so I am not going to fake a template response.",
            error && error.message ? error.message : "Chat request failed.",
            "Reconnect DeepTutor or refresh the runtime before sending another turn."
          ]);
        }

        if (runtimeBadge) {
          setBadge(runtimeBadge, "Chat unavailable", "is-file");
        }

        setText("chat-route", "POST /api/chat");
        setText("chat-engine", "Mate writing coach");
      }

      submitButton.disabled = false;
      thread.scrollTop = thread.scrollHeight;
    });
  }

  function initKnowledgeBase() {
    const feed = document.getElementById("kb-doc-feed");
    const buttons = Array.from(document.querySelectorAll("[data-kb-add]"));
    const filterButtons = Array.from(document.querySelectorAll("[data-kb-filter]"));
    const search = document.getElementById("kb-search");
    const runtimeBadge = document.getElementById("kb-runtime");
    const docStatus = document.getElementById("kb-doc-status");
    const filterStatus = document.getElementById("kb-filter-status");
    const entryForm = document.getElementById("kb-entry-form");
    const entryStatus = document.getElementById("kb-entry-status");
    const dropzone = document.getElementById("kb-dropzone");
    const fileInput = document.getElementById("kb-file-input");
    const filePicker = document.getElementById("kb-file-picker");
    const uploadButton = document.getElementById("kb-upload-submit");
    const uploadStatus = document.getElementById("kb-upload-status");
    const uploadProgress = document.getElementById("kb-upload-progress");
    const uploadProgressFill = document.getElementById("kb-upload-progress-fill");
    const uploadProgressText = document.getElementById("kb-upload-progress-text");
    const uploadProgressDetail = document.getElementById("kb-upload-progress-detail");
    let activeDocs = kbSamples.slice();
    let queuedFiles = [];

    if (!feed || !search) {
      return;
    }

    function updateUploadStatus(text, tone) {
      setBadge(uploadStatus, text, tone);
    }

    function updateDocStatus(text, tone) {
      setBadge(docStatus, text, tone);
    }

    function setUploadProgress(percent, detailText) {
      if (!uploadProgress || !uploadProgressFill || !uploadProgressText || !uploadProgressDetail) {
        return;
      }

      uploadProgress.classList.remove("is-hidden");
      uploadProgressFill.style.width = `${Math.max(0, Math.min(100, percent || 0))}%`;
      uploadProgressText.textContent = `${Math.max(0, Math.min(100, percent || 0))}%`;
      uploadProgressDetail.textContent = detailText || "Uploading files";
    }

    function hideUploadProgress() {
      if (!uploadProgress || !uploadProgressFill || !uploadProgressText || !uploadProgressDetail) {
        return;
      }

      uploadProgress.classList.add("is-hidden");
      uploadProgressFill.style.width = "0%";
      uploadProgressText.textContent = "0%";
      uploadProgressDetail.textContent = "Waiting for upload";
    }

    function updateFilterState() {
      filterButtons.forEach((button) => {
        button.classList.toggle("is-active", button.getAttribute("data-kb-filter") === currentKbFilter);
      });

      if (filterStatus) {
        setBadge(filterStatus, buildFilterLabel(currentKbFilter), "is-file");
      }
    }

    function syncKnowledgeSurface() {
      renderDocuments(activeDocs);
      renderKnowledgeCards(buildKnowledgeCards(search.value, activeDocs));
      const visibleCount = activeDocs.filter((document) => matchesKbFilter(document, currentKbFilter)).length;
      updateDocStatus(`${visibleCount} visible / ${activeDocs.length} total`, "is-file");
      updateFilterState();
    }

    function setQueuedFiles(fileList) {
      queuedFiles = Array.from(fileList || []).filter((file) => file && file.size > 0);
      renderUploadQueue(queuedFiles);

      if (uploadButton) {
        uploadButton.disabled = !queuedFiles.length;
      }

      if (!queuedFiles.length) {
        updateUploadStatus("No files selected", "is-demo");
        hideUploadProgress();
        return;
      }

      updateUploadStatus(`${queuedFiles.length} file${queuedFiles.length > 1 ? "s" : ""} ready`, "is-file");
      hideUploadProgress();
    }

    syncKnowledgeSurface();
    renderUploadQueue([]);
    hideUploadProgress();
    const kbRuntimeState = getSurfaceRuntimeState("kb");
    setBadge(runtimeBadge, kbRuntimeState.label, kbRuntimeState.tone);

    requestJson(
      "/api/kb/documents",
      {
        method: "GET",
        headers: {
          Accept: "application/json"
        }
      },
      function () {
        return {
          mode: "demo",
          documents: activeDocs
        };
      }
    ).then((payload) => {
      activeDocs = payload.documents || activeDocs;
      syncKnowledgeSurface();
      setBadge(runtimeBadge, payload.mode === "proxy" ? "KB synced" : payload.mode === "mock" ? "KB local store" : "Local preview", payload.mode === "proxy" ? "is-live" : "is-demo");
    });

    if (feed) {
      feed.addEventListener("click", async function (event) {
        const button = event.target.closest("[data-doc-action]");
        if (!button) {
          return;
        }

        const action = button.getAttribute("data-doc-action");
        const documentId = button.getAttribute("data-doc-id");
        const targetDocument = activeDocs.find((item) => item.id === documentId);

        if (!action || !documentId || !targetDocument) {
          return;
        }

        if (action === "download") {
          button.disabled = true;
          updateDocStatus("Preparing download", "is-file");

          try {
            await downloadDocumentFile(targetDocument);
            updateDocStatus("Download ready", "is-live");
          } catch (error) {
            updateDocStatus(error.message || "Download failed", "is-demo");
          } finally {
            button.disabled = false;
          }
          return;
        }

        if (action === "rename") {
          const nextName = window.prompt("Rename this document", targetDocument.name);
          if (!nextName || nextName.trim() === targetDocument.name) {
            return;
          }

          button.disabled = true;
          updateDocStatus("Renaming document", "is-file");

          try {
            const payload = await requestJsonStrict(`/api/kb/documents/${encodeURIComponent(documentId)}`, {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json"
              },
              body: JSON.stringify({
                name: nextName.trim()
              })
            });

            activeDocs = payload.documents || activeDocs;
            syncKnowledgeSurface();
            updateDocStatus("Document renamed", payload.mode === "proxy" ? "is-live" : "is-file");
          } catch (error) {
            updateDocStatus(error.message || "Rename failed", "is-demo");
          } finally {
            button.disabled = false;
          }
          return;
        }

        if (action === "delete") {
          const shouldDelete = window.confirm(`Delete "${targetDocument.name}" from your Mate knowledge base?`);
          if (!shouldDelete) {
            return;
          }

          button.disabled = true;
          updateDocStatus("Deleting document", "is-file");

          try {
            const payload = await requestJsonStrict(`/api/kb/documents/${encodeURIComponent(documentId)}`, {
              method: "DELETE",
              headers: {
                Accept: "application/json"
              }
            });

            activeDocs = payload.documents || activeDocs;
            syncKnowledgeSurface();
            updateDocStatus("Document removed", payload.mode === "proxy" ? "is-live" : "is-file");
          } catch (error) {
            updateDocStatus(error.message || "Delete failed", "is-demo");
          } finally {
            button.disabled = false;
          }
        }
      });
    }

    filterButtons.forEach((button) => {
      button.addEventListener("click", function () {
        currentKbFilter = button.getAttribute("data-kb-filter") || "all";
        syncKnowledgeSurface();
      });
    });

    if (filePicker && fileInput) {
      filePicker.addEventListener("click", function () {
        fileInput.click();
      });

      fileInput.addEventListener("change", function () {
        setQueuedFiles(fileInput.files);
      });
    }

    if (dropzone && fileInput) {
      ["dragenter", "dragover"].forEach((eventName) => {
        dropzone.addEventListener(eventName, function (event) {
          event.preventDefault();
          dropzone.classList.add("is-dragging");
        });
      });

      ["dragleave", "dragend"].forEach((eventName) => {
        dropzone.addEventListener(eventName, function (event) {
          event.preventDefault();
          if (!dropzone.contains(event.relatedTarget)) {
            dropzone.classList.remove("is-dragging");
          }
        });
      });

      dropzone.addEventListener("drop", function (event) {
        event.preventDefault();
        dropzone.classList.remove("is-dragging");
        setQueuedFiles(event.dataTransfer ? event.dataTransfer.files : []);
      });

      dropzone.addEventListener("keydown", function (event) {
        if ((event.key === "Enter" || event.key === " ") && event.target === dropzone) {
          event.preventDefault();
          fileInput.click();
        }
      });
    }

    if (uploadButton) {
      uploadButton.disabled = true;
      uploadButton.addEventListener("click", async function () {
        if (!queuedFiles.length) {
          updateUploadStatus("Choose files before uploading", "is-demo");
          return;
        }

        uploadButton.disabled = true;
        updateUploadStatus("Uploading files", "is-file");
        setUploadProgress(0, "Preparing files");

        let payload;

        if (runtimeInfo.apiAvailable) {
          try {
            payload = await uploadFilesWithProgress("/api/kb/documents", queuedFiles, function (progress) {
              setUploadProgress(progress.percent, `Uploaded ${formatBytes(progress.loaded)} of ${progress.total ? formatBytes(progress.total) : "?"}`);
            });
          } catch (error) {
            setRuntimeUnavailable(error.message || "Upload failed", runtimeInfo.checkedApiBases);
          }
        }

        if (!payload) {
          payload = {
            mode: "demo",
            uploadedCount: queuedFiles.length,
            documents: buildUploadedFileFallbackDocuments(queuedFiles).concat(activeDocs)
          };
        }

        activeDocs = payload.documents || activeDocs;
        syncKnowledgeSurface();
        setBadge(runtimeBadge, payload.mode === "proxy" ? "KB synced" : payload.mode === "mock" ? "KB local store" : "KB demo mode", payload.mode === "proxy" ? "is-live" : "is-demo");
        setUploadProgress(100, payload.mode === "proxy" ? "Upload completed and synced" : payload.mode === "mock" ? "Upload saved locally" : "Upload saved in preview");
        updateUploadStatus(
          payload.mode === "proxy"
            ? `${payload.uploadedCount || queuedFiles.length} file${(payload.uploadedCount || queuedFiles.length) > 1 ? "s" : ""} synced`
            : payload.mode === "mock"
              ? `${payload.uploadedCount || queuedFiles.length} file${(payload.uploadedCount || queuedFiles.length) > 1 ? "s" : ""} saved locally`
              : `${payload.uploadedCount || queuedFiles.length} file${(payload.uploadedCount || queuedFiles.length) > 1 ? "s" : ""} saved in preview`,
          payload.mode === "proxy" ? "is-live" : "is-demo"
        );
        queuedFiles = [];
        renderUploadQueue([]);
        if (fileInput) {
          fileInput.value = "";
        }
        uploadButton.disabled = true;
      });
    }

    buttons.forEach((button) => {
      button.addEventListener("click", async function () {
        const id = button.getAttribute("data-kb-add");
        const sample = kbSamples.find((item) => item.id === id);

        if (!sample) {
          return;
        }

        const payload = await requestJson(
          "/api/kb/documents",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              name: sample.name,
              type: sample.type,
              summary: sample.summary,
              sourceText: sample.sourceText
            })
          },
          function () {
            return {
              mode: "demo",
              documents: [
                {
                  id: `demo-sample-${sample.id}-${Date.now()}`,
                  name: `${sample.name} (new upload)`,
                  type: sample.type,
                  summary: sample.summary,
                  status: "Queued for indexing",
                  tags: sample.tags || [],
                  sourceOrigin: "personal",
                  editable: false
                }
              ].concat(activeDocs)
            };
          }
        );

        activeDocs = payload.documents || activeDocs;
        syncKnowledgeSurface();
        setBadge(runtimeBadge, payload.mode === "proxy" ? "KB synced" : "KB demo mode", payload.mode === "proxy" ? "is-live" : "is-demo");
      });
    });

    if (entryForm && entryStatus) {
      entryForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        const titleField = document.getElementById("kb-entry-title");
        const typeField = document.getElementById("kb-entry-type");
        const summaryField = document.getElementById("kb-entry-summary");
        const textField = document.getElementById("kb-entry-text");
        const submitButton = document.getElementById("kb-entry-submit");

        if (!titleField || !typeField || !summaryField || !textField || !submitButton) {
          return;
        }

        const title = titleField.value.trim();
        const type = typeField.value.trim();
        const summary = summaryField.value.trim();
        const tagsField = document.getElementById("kb-entry-tags");
        const sourceText = textField.value.trim();

        if (!title || !sourceText || !tagsField) {
          setBadge(entryStatus, "Add a title and knowledge text", "is-demo");
          return;
        }

        submitButton.disabled = true;
        setBadge(entryStatus, "Saving entry", "is-file");

        const payload = await requestJson(
          "/api/kb/documents",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              name: title,
              type: type || "Custom note",
              summary: summary || "Custom knowledge entry for Mate",
              sourceText: sourceText,
              tags: tagsField.value
            })
          },
          function () {
            return {
              mode: "demo",
              documents: [
                {
                  id: `demo-note-${Date.now()}`,
                  name: title,
                  type: type || "Custom note",
                  summary: summary || "Custom knowledge entry for Mate",
                  status: "Saved in UI preview",
                  tags: String(tagsField.value || "").split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean),
                  sourceOrigin: "personal",
                  editable: false
                }
              ].concat(activeDocs)
            };
          }
        );

        activeDocs = payload.documents || activeDocs;
        syncKnowledgeSurface();
        setBadge(entryStatus, payload.mode === "proxy" ? "Saved to DeepTutor KB" : payload.mode === "mock" ? "Saved to local KB store" : "Saved in local preview", payload.mode === "proxy" ? "is-live" : "is-demo");
        setBadge(runtimeBadge, payload.mode === "proxy" ? "KB synced" : "KB local store", payload.mode === "proxy" ? "is-live" : "is-demo");
        entryForm.reset();
        submitButton.disabled = false;
      });
    }

    search.addEventListener("input", async function () {
      const query = search.value;
      const payload = await requestJson(
        "/api/kb/search",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            query: query
          })
        },
        function () {
          return {
            mode: "demo",
            cards: buildKnowledgeCards(query, activeDocs)
          };
        }
      );

      renderKnowledgeCards(payload.cards || buildKnowledgeCards(query, activeDocs));
      setBadge(runtimeBadge, payload.mode === "proxy" ? "KB search live" : "KB demo mode", payload.mode === "proxy" ? "is-live" : "is-demo");
    });
  }

  function initQuiz() {
    const tabs = Array.from(document.querySelectorAll("[data-quiz-mode]"));
    const presetButtons = Array.from(document.querySelectorAll("[data-quiz-preset]"));
    const runButton = document.getElementById("quiz-run-button");
    const runtimeBadge = document.getElementById("quiz-runtime");
    const promptInput = document.getElementById("quiz-prompt-input");
    const difficultySelect = document.getElementById("quiz-difficulty");
    const countSelect = document.getElementById("quiz-count");

    if (!tabs.length || !runButton || !promptInput || !difficultySelect || !countSelect) {
      return;
    }

    applyQuizPreset(currentQuizPreset);
    setBadge(runtimeBadge, "Checking BFF", "is-file");

    tabs.forEach((tab) => {
      tab.addEventListener("click", function () {
        const mode = tab.getAttribute("data-quiz-mode");
        const nextPreset = currentQuizPreset && quizPresets[currentQuizPreset] && quizPresets[currentQuizPreset].mode === mode
          ? currentQuizPreset
          : getFirstQuizPresetForMode(mode);

        if (nextPreset) {
          applyQuizPreset(nextPreset);
          return;
        }

        currentQuizMode = mode;
        renderQuizMode(mode);
        renderQuizFocus([]);
        syncQuizPresetButtons("");
      });
    });

    presetButtons.forEach((button) => {
      button.addEventListener("click", function () {
        const presetKey = button.getAttribute("data-quiz-preset");
        applyQuizPreset(presetKey);
      });
    });

    runButton.addEventListener("click", async function () {
      const mode = quizModes[currentQuizMode];
      const prompt = promptInput.value.trim();
      const difficulty = difficultySelect.value;
      const count = Math.max(1, Number(countSelect.value || 5));
      const activePreset = quizPresets[currentQuizPreset];

      if (!prompt) {
        setBadge(runtimeBadge, "Add a prompt first", "is-demo");
        promptInput.focus();
        return;
      }

      runButton.disabled = true;
      const requestPayload = currentQuizMode === "solve"
        ? {
            mode: currentQuizMode,
            prompt: prompt,
            question: prompt,
            detailedAnswer: false,
            audience: "English learners",
            difficulty: difficulty,
            preference: activePreset ? activePreset.label : mode.title,
            tools: []
          }
        : {
          mode: currentQuizMode,
          prompt: prompt,
          topic: prompt,
          difficulty: difficulty,
          count: count,
          questionType: "mixed",
          preference: activePreset ? activePreset.label : "Targeted practice for English learning"
        };

      try {
        const payload = await requestJson(
          currentQuizMode === "solve" ? "/api/deep-solve" : "/api/quiz",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(requestPayload)
          },
          function () {
            return buildQuizFallback(currentQuizMode, requestPayload);
          }
        );

        renderQuizResult(payload);
        setBadge(
          runtimeBadge,
          payload.mode === "proxy" ? "DeepTutor live" : payload.mode === "mock" ? "BFF mock mode" : "Demo fallback",
          payload.mode === "proxy" ? "is-live" : payload.mode === "mock" ? "is-file" : "is-demo"
        );
      } catch (error) {
        setBadge(runtimeBadge, error.message || "Practice request failed", "is-demo");
      } finally {
        runButton.disabled = false;
      }
    });
  }

  document.addEventListener("DOMContentLoaded", async function () {
    await bootstrapRuntime();
    await restoreSession();
    renderAccountShell();
    syncAuthPageState();

    if (runtimeInfo.apiAvailable && pageRequiresAuth() && !sessionInfo.authenticated) {
      handleUnauthorized();
      return;
    }

    initAuth();
    initChat();
    initKnowledgeBase();
    initQuiz();
    applyRuntimeSurfaceState();
  });
})();
