(function () {
  const isFileMode = window.location.protocol === "file:";
  const pageName = document.body.getAttribute("data-page") || "";
  const runtimeApiStorageKey = "mate.apiBaseUrl";
  const sessionTokenStorageKey = "mate.sessionToken";
  const practiceQuestionBankStorageKey = "mate.practiceQuestionBank";
  const defaultLocalApiBases = ["http://127.0.0.1:4317", "http://localhost:4317"];
  let runtimeInfo = {
    apiAvailable: !isFileMode,
    apiBaseUrl: !isFileMode ? window.location.origin : "",
    mode: isFileMode ? "file" : "checking",
    proxyEnabled: false,
    backendLabel: isFileMode ? "Mate" : "Mate BFF",
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
      backendLabel: "Mate",
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
      return `Mate BFF was not detected for this local page.${formatApiBaseSummary()} Start the local Node server or provide ?api=https://your-bff-origin.`;
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
      title: "Lift essay drafts."
    },
    email: {
      badge: "Business Email",
      title: "Polish work email."
    },
    grammar: {
      badge: "Grammar Coach",
      title: "Fix grammar fast."
    },
    upgrade: {
      badge: "Expression Upgrade",
      title: "Upgrade your tone."
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
      meta: "Band guides, scoring criteria, and quick-check note sets.",
      filters: ["starter", "notes"]
    },
    {
      title: "Drafts",
      meta: "Corrected essays, model samples, and revision references.",
      filters: ["starter", "files"]
    },
    {
      title: "Email Guides",
      meta: "Tone guides, reusable templates, and professional phrasing.",
      filters: ["starter", "notes"]
    },
    {
      title: "Class Notes",
      meta: "Rules, phrases, reminders, and saved coaching notes.",
      filters: ["personal", "notes"]
    },
    {
      title: "My uploads",
      meta: "Personal documents and notes you added for reuse in chat and practice.",
      filters: ["personal", "files"]
    },
    {
      title: "Quick reference notes",
      meta: "Short summaries that surface fast while you coach, write, or revise.",
      filters: ["personal", "notes"]
    }
  ];

  const kbFilterMeta = {
    all: {
      label: "All docs",
      context: "Browse starter material, uploads, files, and notes in one compact view.",
      sideTitle: "Recent files"
    },
    personal: {
      label: "My uploads",
      context: "Focus on the files and notes saved to your personal Mate workspace.",
      sideTitle: "My upload details"
    },
    starter: {
      label: "Starter docs",
      context: "See bundled examples, guides, and reference packs ready for quick practice.",
      sideTitle: "Starter doc details"
    },
    files: {
      label: "Files",
      context: "Show document uploads and synced assets that are ready to download or review.",
      sideTitle: "File details"
    },
    notes: {
      label: "Notes",
      context: "Focus on lightweight notes, saved guidance, and reusable teaching snippets.",
      sideTitle: "Note details"
    }
  };

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
          text: "Choose a preset, adjust difficulty and question count, then click Generate quiz set. The questions will open in a separate practice window."
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
  let practiceTimerId = null;
  let practiceTimerWindow = window;
  let latestPracticePayload = null;
  let localPracticeQuestionBank = null;

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

  function buildIconMarkup(iconName) {
    const icons = {
      mic: [
        '<path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Z"></path>',
        '<path d="M19 10v1a7 7 0 0 1-14 0v-1"></path>',
        '<path d="M12 18v4"></path>',
        '<path d="M8 22h8"></path>'
      ],
      volume: [
        '<path d="M5 9v6h4l5 4V5L9 9H5Z"></path>',
        '<path d="M18 9a5 5 0 0 1 0 6"></path>',
        '<path d="M20.5 6.5a9 9 0 0 1 0 11"></path>'
      ]
    };
    const paths = icons[iconName] || icons.volume;

    return `<svg class="button-icon" aria-hidden="true" viewBox="0 0 24 24">${paths.join("")}</svg>`;
  }

  function sanitizeFilename(value) {
    const fallback = "mate-export";
    const normalized = String(value || fallback)
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1f]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase();

    return normalized ? normalized.slice(0, 80) : fallback;
  }

  function getExportDateStamp() {
    return new Date().toISOString().slice(0, 10);
  }

  function getCleanNodeText(node) {
    if (!node) {
      return "";
    }

    const clone = node.cloneNode(true);
    clone.querySelectorAll("button, svg, .message-actions, .message-role").forEach((item) => item.remove());
    return clone.textContent.replace(/\s+/g, " ").trim();
  }

  function getElementText(selector) {
    const node = document.querySelector(selector);
    return node ? node.textContent.replace(/\s+/g, " ").trim() : "";
  }

  function getFieldValue(id) {
    const node = document.getElementById(id);
    if (!node || !("value" in node)) {
      return "";
    }

    return String(node.value || "").trim();
  }

  function getSelectDisplayValue(id) {
    const node = document.getElementById(id);
    if (!node || !("selectedIndex" in node) || node.selectedIndex < 0) {
      return getFieldValue(id);
    }

    return node.options[node.selectedIndex].textContent.trim();
  }

  function buildExportParagraphs(value) {
    const lines = String(value || "")
      .split(/\n+/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);

    if (!lines.length) {
      return '<p class="muted">No content yet.</p>';
    }

    return lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
  }

  function buildExportList(items) {
    const normalizedItems = items.map((item) => String(item || "").trim()).filter(Boolean);

    if (!normalizedItems.length) {
      return '<p class="muted">No content yet.</p>';
    }

    return `<ul>${normalizedItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  }

  function buildExportDetails(items) {
    const rows = items.filter((item) => item && item.value);

    if (!rows.length) {
      return '<p class="muted">No details yet.</p>';
    }

    return `
      <table>
        <tbody>
          ${rows.map((item) => `
            <tr>
              <th>${escapeHtml(item.label)}</th>
              <td>${escapeHtml(item.value)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  function collectCardTexts(selector, root) {
    return Array.from((root || document).querySelectorAll(selector)).map(getCleanNodeText).filter(Boolean);
  }

  function buildExportDocument(title, sections) {
    const sectionMarkup = sections.map((section) => `
      <section>
        <h2>${escapeHtml(section.heading)}</h2>
        ${section.content || '<p class="muted">No content yet.</p>'}
      </section>
    `).join("");

    return `<!doctype html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>${escapeHtml(title)}</title>
          <style>
            body { font-family: Aptos, Calibri, Arial, sans-serif; color: #1f2d36; line-height: 1.55; }
            h1 { font-size: 26px; margin: 0 0 6px; }
            h2 { font-size: 18px; margin: 24px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #d8ded6; }
            h3 { font-size: 15px; margin: 14px 0 4px; }
            p { margin: 0 0 8px; }
            ul { margin: 0 0 8px 20px; padding: 0; }
            li { margin: 0 0 6px; }
            table { width: 100%; border-collapse: collapse; margin: 0 0 10px; }
            th, td { border: 1px solid #d8ded6; padding: 7px 9px; vertical-align: top; text-align: left; }
            th { width: 28%; background: #f7f5ef; }
            .meta, .muted { color: #667482; }
            .turn { margin: 0 0 14px; padding: 10px 12px; border: 1px solid #d8ded6; }
          </style>
        </head>
        <body>
          <h1>${escapeHtml(title)}</h1>
          <p class="meta">Exported from Mate on ${escapeHtml(getExportDateStamp())}</p>
          ${sectionMarkup}
        </body>
      </html>`;
  }

  function downloadGeneratedDocument(title, sections) {
    const html = buildExportDocument(title, sections);
    const blob = new Blob(["\ufeff", html], { type: "application/msword;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${sanitizeFilename(title)}-${getExportDateStamp()}.doc`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function collectChatExportSections() {
    const messages = Array.from(document.querySelectorAll("#chat-thread .message")).map((message) => {
      const role = message.classList.contains("user") ? "Learner" : "Mate";
      return `
        <div class="turn">
          <h3>${escapeHtml(role)}</h3>
          ${buildExportParagraphs(getCleanNodeText(message))}
        </div>
      `;
    });

    const draft = getFieldValue("chat-input");
    const suggestions = collectCardTexts("#chat-suggestions li");
    const deliverables = collectCardTexts("#chat-deliverables .deliverable-card");

    return {
      title: `Study Chat - ${getElementText("#chat-scenario-title") || "Session"}`,
      sections: [
        {
          heading: "Session",
          content: buildExportDetails([
            { label: "Mode", value: getElementText("#chat-scenario-title") },
            { label: "Goal", value: getElementText("#chat-goal") },
            { label: "Current draft", value: draft }
          ])
        },
        {
          heading: "Conversation",
          content: messages.join("") || '<p class="muted">No chat messages yet.</p>'
        },
        {
          heading: "Outputs",
          content: buildExportList(deliverables)
        },
        {
          heading: "Next steps",
          content: buildExportList(suggestions)
        }
      ]
    };
  }

  function collectKnowledgeExportSections() {
    const libraryCards = collectCardTexts("#kb-source-grid .source-card");
    const visibleDocuments = collectCardTexts("#kb-doc-feed .doc-item");
    const queuedFiles = collectCardTexts("#kb-upload-queue li");

    return {
      title: "Knowledge Base",
      sections: [
        {
          heading: "Library View",
          content: buildExportDetails([
            { label: "Filter", value: getElementText("#kb-filter-status") },
            { label: "Visible documents", value: getElementText("#kb-doc-status") },
            { label: "Library matches", value: getElementText("#kb-library-count") },
            { label: "Context", value: getElementText("#kb-library-context") },
            { label: "Search", value: getFieldValue("kb-search") }
          ])
        },
        {
          heading: "Library Cards",
          content: buildExportList(libraryCards)
        },
        {
          heading: "Recent Files",
          content: buildExportList(visibleDocuments)
        },
        {
          heading: "Draft Note",
          content: buildExportDetails([
            { label: "Title", value: getFieldValue("kb-entry-title") },
            { label: "Type", value: getSelectDisplayValue("kb-entry-type") },
            { label: "Summary", value: getFieldValue("kb-entry-summary") },
            { label: "Tags", value: getFieldValue("kb-entry-tags") },
            { label: "Knowledge text", value: getFieldValue("kb-entry-text") },
            { label: "Upload queue", value: queuedFiles.join("; ") }
          ])
        }
      ]
    };
  }

  function collectQuizExportSections() {
    const focusItems = collectCardTexts("#quiz-focus-list li");
    const outputBlocks = collectCardTexts("#quiz-output-blocks > *");
    const scoreItems = collectCardTexts("#quiz-score-grid .score-card");

    return {
      title: `Practice - ${getElementText("#quiz-title") || "Session"}`,
      sections: [
        {
          heading: "Practice Setup",
          content: buildExportDetails([
            { label: "Mode", value: getElementText("#quiz-mode-chip") || getElementText("#quiz-eyebrow") },
            { label: "Title", value: getElementText("#quiz-title") },
            { label: "Prompt helper", value: getElementText("#quiz-prompt") },
            { label: "Difficulty", value: getSelectDisplayValue("quiz-difficulty") },
            { label: "Question count", value: getFieldValue("quiz-count") }
          ])
        },
        {
          heading: "Prompt",
          content: buildExportParagraphs(getFieldValue("quiz-prompt-input"))
        },
        {
          heading: "Generated Output",
          content: buildExportList(outputBlocks)
        },
        {
          heading: "Focus",
          content: buildExportList(focusItems)
        },
        {
          heading: "Metrics",
          content: buildExportList(scoreItems)
        }
      ]
    };
  }

  function getDocumentExportPayload(exportKey) {
    if (exportKey === "chat") {
      return collectChatExportSections();
    }

    if (exportKey === "kb") {
      return collectKnowledgeExportSections();
    }

    if (exportKey === "quiz") {
      return collectQuizExportSections();
    }

    return {
      title: "Mate Export",
      sections: [
        {
          heading: "Page Content",
          content: buildExportParagraphs(document.body.textContent)
        }
      ]
    };
  }

  function initDocumentExport() {
    document.querySelectorAll("[data-export-document]").forEach((button) => {
      button.addEventListener("click", function () {
        const label = button.querySelector("span");
        const originalLabel = label ? label.textContent : "";
        const exportKey = button.getAttribute("data-export-document") || pageName;

        button.disabled = true;
        if (label) {
          label.textContent = "Exporting";
        }

        try {
          const payload = getDocumentExportPayload(exportKey);
          downloadGeneratedDocument(payload.title, payload.sections);
          if (label) {
            label.textContent = "Exported";
            window.setTimeout(() => {
              label.textContent = originalLabel || "Export doc";
            }, 1200);
          }
        } catch (error) {
          if (label) {
            label.textContent = originalLabel || "Export doc";
          }
          window.alert(error && error.message ? error.message : "Document export failed.");
        } finally {
          window.setTimeout(() => {
            button.disabled = false;
          }, 400);
        }
      });
    });
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
        label: "Ready",
        tone: "is-file"
      };
    }

    if (!runtimeInfo.apiAvailable || runtimeInfo.mode === "demo") {
      return {
        label: "Ready",
        tone: "is-demo"
      };
    }

    if (surfaceKey === "kb") {
      return {
        label: "Local store",
        tone: "is-file"
      };
    }

    return {
      label: "Ready",
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
      return "Ready";
    }

    if (runtimeInfo.proxyEnabled) {
      return "Mate writing coach";
    }

    if (runtimeInfo.configured && runtimeInfo.websocketClientAvailable === false) {
      return "Ready";
    }

    if (runtimeInfo.configured) {
      return "Ready";
    }

    return "Ready";
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
      backendLabel: "Mate",
      routeLabel: "POST /api/chat",
      engineLabel: "Demo coach response",
      suggestions: suggestions,
      assistantLines: assistantLines
    };
  }

  function buildKnowledgeCards(query, documents, filterKey) {
    const normalized = query.trim().toLowerCase();
    const scopedFilter = filterKey || "all";
    const starterCards = kbCards.filter((card) => (
      scopedFilter === "all" || !Array.isArray(card.filters) || card.filters.includes(scopedFilter)
    ));
    const documentCards = (documents || [])
      .filter((document) => matchesKbFilter(document, scopedFilter))
      .map((document) => ({
        title: `${document.type}: ${document.name}`,
        meta: `${document.summary || "Saved in Mate knowledge base."}${getDocumentTags(document).length ? ` Tags: ${getDocumentTags(document).join(", ")}` : ""}`
      }));

    return starterCards.concat(documentCards).filter((card) => {
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
      status: "Saved",
      fileSize: file.size,
      tags: ["file", "upload"],
      sourceOrigin: "personal",
      editable: false
    }));
  }

  function getDocumentTags(document) {
    return Array.isArray(document.tags) ? document.tags.slice(0, 6) : [];
  }

  function getKbFilterMeta(filterKey) {
    return kbFilterMeta[filterKey] || kbFilterMeta.all;
  }

  function buildFilterLabel(filterKey) {
    return getKbFilterMeta(filterKey).label;
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

  function clampPracticeQuestionCount(value, fallback) {
    const fallbackNumber = Number.isFinite(Number(fallback)) ? Number(fallback) : 5;
    const numericValue = Number(value);
    const resolvedValue = Number.isFinite(numericValue) ? numericValue : fallbackNumber;

    return Math.max(1, Math.min(50, Math.round(resolvedValue)));
  }

  function parsePracticeQuestionCount(value) {
    const compact = String(value || "").replace(/\s+/g, "");
    const digitMatch = compact.match(/(\d{1,2})(?:题|道|个|questions?|items?)/i);

    if (digitMatch) {
      return clampPracticeQuestionCount(digitMatch[1], 5);
    }

    const chineseMatch = compact.match(/([一二两三四五六七八九十]{1,3})(?:题|道|个)/);

    if (!chineseMatch) {
      return null;
    }

    const numerals = {
      一: 1,
      二: 2,
      两: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9,
      十: 10
    };
    const text = chineseMatch[1];

    if (text === "十") {
      return 10;
    }

    if (text.length === 1) {
      return numerals[text] || null;
    }

    if (text.startsWith("十")) {
      return 10 + (numerals[text.slice(1)] || 0);
    }

    if (text.includes("十")) {
      const parts = text.split("十");
      return (numerals[parts[0]] || 1) * 10 + (numerals[parts[1]] || 0);
    }

    return null;
  }

  function resolvePracticeQuestionCount(topic, fallbackCount) {
    const parsedCount = parsePracticeQuestionCount(topic);

    if (parsedCount) {
      return clampPracticeQuestionCount(parsedCount, fallbackCount);
    }

    return clampPracticeQuestionCount(fallbackCount, 5);
  }

  function isInfinitivePracticeTopic(topic) {
    return /不定式|动词不定式|to\s+do|infinitive/i.test(String(topic || ""));
  }

  function buildClientInfinitivePracticeQuestions(topic, count, difficulty) {
    const concentration = String(topic || "").includes("初三")
      ? "初三英语：动词不定式（to do）"
      : "English grammar: infinitives (to do)";
    const bank = [
      {
        type: "choice",
        question: "Choose the correct answer: It is important ___ English every day.",
        options: [
          { key: "A", text: "learn" },
          { key: "B", text: "to learn" },
          { key: "C", text: "learning" },
          { key: "D", text: "learned" }
        ],
        correctAnswer: "B. to learn",
        explanation: "It is + adjective + to do sth. 表示“做某事是……的”。"
      },
      {
        type: "fill-in",
        question: "Fill in the blank with the correct form: My teacher asked me ___ (open) the window.",
        options: [],
        correctAnswer: "to open",
        explanation: "ask sb. to do sth. 是固定结构，意思是“要求某人做某事”。"
      },
      {
        type: "choice",
        question: "Choose the correct answer: She has a lot of homework ___ tonight.",
        options: [
          { key: "A", text: "do" },
          { key: "B", text: "to do" },
          { key: "C", text: "doing" },
          { key: "D", text: "did" }
        ],
        correctAnswer: "B. to do",
        explanation: "不定式可以作后置定语，修饰 homework，表示“要做的作业”。"
      },
      {
        type: "fill-in",
        question: "Fill in the blank: We went to the library ___ (borrow) some books.",
        options: [],
        correctAnswer: "to borrow",
        explanation: "动词不定式可作目的状语，说明 went to the library 的目的。"
      },
      {
        type: "choice",
        question: "Choose the correct answer: The box is too heavy for the boy ___.",
        options: [
          { key: "A", text: "carry" },
          { key: "B", text: "to carry" },
          { key: "C", text: "carrying" },
          { key: "D", text: "carried" }
        ],
        correctAnswer: "B. to carry",
        explanation: "too + adjective + for sb. + to do sth. 表示“太……以至于某人不能做某事”。"
      },
      {
        type: "fill-in",
        question: "Fill in the blank: The teacher told us ___ (not be) late again.",
        options: [],
        correctAnswer: "not to be",
        explanation: "tell sb. not to do sth. 表示“告诉某人不要做某事”。"
      }
    ];

    return Array.from({ length: count }).map((_, index) => {
      const source = bank[index % bank.length];
      const number = index + 1;

      return {
        id: `demo-infinitive-practice-${number}`,
        number,
        type: source.type,
        difficulty,
        concentration,
        question: source.question,
        options: source.options,
        correctAnswer: source.correctAnswer,
        explanation: source.explanation
      };
    });
  }

  function buildQuizFallback(modeKey, payload) {
    const mode = quizModes[modeKey];
    const requestedDifficulty = String((payload && payload.difficulty) || "upper-intermediate");
    const requestedTopic = String((payload && (payload.topic || payload.prompt)) || mode.prompt);
    const requestedCount = resolvePracticeQuestionCount(requestedTopic, payload && payload.count);
    const isInfinitiveSet = isInfinitivePracticeTopic(requestedTopic);

    if (modeKey === "quiz") {
      return {
        mode: "demo",
        backendLabel: "Mate",
        routeLabel: mode.route,
        outputTitle: mode.outputTitle,
        blocks: [
          {
            heading: isInfinitiveSet ? "Grammar drill" : "Question mix",
            text: isInfinitiveSet
              ? `已生成 ${requestedCount} 道动词不定式练习题。先在页面作答，再展开答案和解析。`
              : `${requestedCount} items requested for ${truncate(requestedTopic, 76)}. Mate would blend correction, rewrite, and explanation-style questions.`
          },
          {
            heading: "Difficulty control",
            text: isInfinitiveSet
              ? `The practice set is tuned for ${requestedDifficulty} learners and uses junior-high grammar patterns instead of generic rewrite prompts.`
              : `The practice set is tuned for a ${requestedDifficulty} learner and stays close to exam, classroom, or business writing pain points.`
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
      backendLabel: "Mate",
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
    const normalizedTopic = String(topic || "English writing practice").trim();
    const requestedCount = resolvePracticeQuestionCount(normalizedTopic, count);
    const normalizedType = String(questionType || "mixed").trim();

    if (isInfinitivePracticeTopic(normalizedTopic)) {
      return buildClientInfinitivePracticeQuestions(normalizedTopic, requestedCount, difficulty);
    }

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

  function normalizeQuestionOption(option, index) {
    const fallbackKey = String.fromCharCode(65 + index);

    if (option && typeof option === "object") {
      return {
        key: String(option.key || option.label || option.id || fallbackKey).trim() || fallbackKey,
        text: String(option.text || option.value || option.answer || "").trim()
      };
    }

    return {
      key: fallbackKey,
      text: String(option || "").trim()
    };
  }

  function normalizeLocalBankQuestion(item, index) {
    const source = item && typeof item === "object" ? item : {};
    const question = String(
      source.question || source.prompt || source.stem || source.title || source.text || ""
    ).replace(/\s+/g, " ").trim();

    if (!question) {
      return null;
    }

    const optionKeys = ["A", "B", "C", "D", "E", "F"];
    let options = [];

    if (Array.isArray(source.options)) {
      options = source.options.map(normalizeQuestionOption);
    } else if (source.options && typeof source.options === "object") {
      options = Object.entries(source.options).map(([key, value], optionIndex) => normalizeQuestionOption({
        key,
        text: value
      }, optionIndex));
    } else {
      options = optionKeys
        .map((key, optionIndex) => normalizeQuestionOption(
          source[`option${key}`] || source[`option_${key}`] || source[key] || source[key.toLowerCase()],
          optionIndex
        ))
        .filter((option) => option.text);
    }

    options = options.filter((option) => option.text);

    return {
      id: String(source.id || source.question_id || `bank-${index + 1}`),
      number: index + 1,
      type: String(source.type || source.question_type || (options.length ? "choice" : "written")).trim() || (options.length ? "choice" : "written"),
      difficulty: String(source.difficulty || "").trim(),
      concentration: String(source.concentration || source.topic || source.skill || "").trim(),
      question,
      options,
      correctAnswer: String(source.correctAnswer || source.correct_answer || source.answer || source.key || "").trim(),
      explanation: String(source.explanation || source.analysis || source.reason || source.note || "").trim()
    };
  }

  function buildPracticeQuestionBank(name, questions, fileMeta) {
    const normalizedQuestions = questions
      .map(normalizeLocalBankQuestion)
      .filter(Boolean)
      .slice(0, 500)
      .map((question, index) => Object.assign({}, question, {
        number: index + 1
      }));

    return {
      name: String(name || "Local question bank").trim(),
      importedAt: new Date().toISOString(),
      fileSize: fileMeta && fileMeta.size ? Number(fileMeta.size) : 0,
      questionCount: normalizedQuestions.length,
      questions: normalizedQuestions
    };
  }

  function parseQuestionBankJson(text, fileName, fileMeta) {
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.questions)
        ? parsed.questions
        : Array.isArray(parsed.items)
          ? parsed.items
          : Array.isArray(parsed.data)
            ? parsed.data
            : [];

    return buildPracticeQuestionBank(parsed.name || fileName, list, fileMeta);
  }

  function parseCsvRows(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      const nextChar = text[index + 1];

      if (char === '"' && inQuotes && nextChar === '"') {
        field += '"';
        index += 1;
        continue;
      }

      if (char === '"') {
        inQuotes = !inQuotes;
        continue;
      }

      if (char === "," && !inQuotes) {
        row.push(field.trim());
        field = "";
        continue;
      }

      if ((char === "\n" || char === "\r") && !inQuotes) {
        if (char === "\r" && nextChar === "\n") {
          index += 1;
        }

        row.push(field.trim());
        if (row.some(Boolean)) {
          rows.push(row);
        }
        row = [];
        field = "";
        continue;
      }

      field += char;
    }

    row.push(field.trim());
    if (row.some(Boolean)) {
      rows.push(row);
    }

    return rows;
  }

  function parseQuestionBankCsv(text, fileName, fileMeta) {
    const rows = parseCsvRows(text);
    const header = rows[0] || [];
    const headerMap = {};
    const knownHeaders = new Set([
      "question",
      "prompt",
      "stem",
      "answer",
      "correctanswer",
      "correct_answer",
      "explanation",
      "analysis",
      "type",
      "difficulty",
      "topic",
      "\u9898\u76ee",
      "\u7b54\u6848",
      "\u89e3\u6790"
    ]);
    const hasHeader = header.some((cell) => knownHeaders.has(String(cell || "").trim().toLowerCase()));

    if (hasHeader) {
      header.forEach((cell, index) => {
        headerMap[String(cell || "").trim().toLowerCase()] = index;
      });
    }

    function getCell(row, keys, fallbackIndex) {
      for (const key of keys) {
        const mappedIndex = headerMap[key.toLowerCase()];
        if (mappedIndex !== undefined && row[mappedIndex]) {
          return row[mappedIndex];
        }
      }

      return fallbackIndex === undefined ? "" : row[fallbackIndex] || "";
    }

    const dataRows = hasHeader ? rows.slice(1) : rows;
    const questions = dataRows.map((row) => ({
      question: getCell(row, ["question", "prompt", "stem", "\u9898\u76ee"], 0),
      optionA: getCell(row, ["a", "optiona", "option_a", "option a"], 1),
      optionB: getCell(row, ["b", "optionb", "option_b", "option b"], 2),
      optionC: getCell(row, ["c", "optionc", "option_c", "option c"], 3),
      optionD: getCell(row, ["d", "optiond", "option_d", "option d"], 4),
      answer: getCell(row, ["answer", "correctanswer", "correct_answer", "\u7b54\u6848"], 5),
      explanation: getCell(row, ["explanation", "analysis", "\u89e3\u6790"], 6),
      type: getCell(row, ["type", "question_type"], undefined),
      difficulty: getCell(row, ["difficulty", "level"], undefined),
      topic: getCell(row, ["topic", "skill", "concentration"], undefined)
    }));

    return buildPracticeQuestionBank(fileName, questions, fileMeta);
  }

  function parseQuestionBankText(text, fileName, fileMeta) {
    const normalized = String(text || "").replace(/\r\n/g, "\n").trim();
    const blocks = normalized
      .split(/\n\s*\n|^---+$/m)
      .map((block) => block.trim())
      .filter(Boolean);
    const numberedBlocks = normalized
      .split(/\n(?=\d+[\.\)]\s+)/)
      .map((block) => block.trim())
      .filter(Boolean);
    const sourceBlocks = blocks.length > 1 ? blocks : numberedBlocks.length > 1 ? numberedBlocks : blocks;
    const questions = sourceBlocks.map((block) => {
      const options = [];
      const questionLines = [];
      let answer = "";
      let explanation = "";

      block.split(/\n+/).map((line) => line.trim()).filter(Boolean).forEach((line) => {
        const optionMatch = line.match(/^([A-H])[\.\)\:\uFF1A\u3001]\s*(.+)$/i);
        const answerMatch = line.match(/^(?:answer|ans|correct|\u7b54\u6848)\s*[:\uFF1A]\s*(.+)$/i);
        const explanationMatch = line.match(/^(?:explanation|analysis|\u89e3\u6790|\u5206\u6790)\s*[:\uFF1A]\s*(.+)$/i);

        if (optionMatch) {
          options.push({
            key: optionMatch[1].toUpperCase(),
            text: optionMatch[2].trim()
          });
          return;
        }

        if (answerMatch) {
          answer = answerMatch[1].trim();
          return;
        }

        if (explanationMatch) {
          explanation = explanationMatch[1].trim();
          return;
        }

        questionLines.push(line.replace(/^(?:question|q\d*|\u9898\u76ee)\s*[:\uFF1A]\s*/i, ""));
      });

      return {
        question: questionLines.join(" ").replace(/^\d+[\.\)]\s*/, "").trim(),
        options,
        answer,
        explanation,
        type: options.length ? "choice" : "written"
      };
    });

    return buildPracticeQuestionBank(fileName, questions, fileMeta);
  }

  function parsePracticeQuestionBankFile(text, fileName, fileMeta) {
    const trimmed = String(text || "").trim();
    const lowerName = String(fileName || "").toLowerCase();

    if (!trimmed) {
      return buildPracticeQuestionBank(fileName, [], fileMeta);
    }

    if (lowerName.endsWith(".json") || /^[\[{]/.test(trimmed)) {
      try {
        return parseQuestionBankJson(trimmed, fileName, fileMeta);
      } catch (error) {
        if (lowerName.endsWith(".json")) {
          throw error;
        }
      }
    }

    if (lowerName.endsWith(".csv") || trimmed.split(/\r?\n/, 1)[0].includes(",")) {
      return parseQuestionBankCsv(trimmed, fileName, fileMeta);
    }

    return parseQuestionBankText(trimmed, fileName, fileMeta);
  }

  function readLocalTextFile(file) {
    if (file && typeof file.text === "function") {
      return file.text();
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(String(reader.result || "")));
      reader.addEventListener("error", () => reject(reader.error || new Error("File read failed")));
      reader.readAsText(file);
    });
  }

  function loadStoredPracticeQuestionBank() {
    const raw = safeReadLocalStorage(practiceQuestionBankStorageKey);

    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw);
      return buildPracticeQuestionBank(parsed.name, Array.isArray(parsed.questions) ? parsed.questions : [], parsed);
    } catch (error) {
      return null;
    }
  }

  function persistPracticeQuestionBank(bank) {
    if (!bank || !Array.isArray(bank.questions) || !bank.questions.length) {
      safeWriteLocalStorage(practiceQuestionBankStorageKey, "");
      return;
    }

    try {
      safeWriteLocalStorage(practiceQuestionBankStorageKey, JSON.stringify(bank));
    } catch (error) {
      // The bank remains usable for this page session even if localStorage is full.
    }
  }

  function buildSamplePracticeQuestionBank() {
    return buildPracticeQuestionBank("Sample grammar bank", [
      {
        question: "Choose the correct answer: She ___ to school by bus every day.",
        options: [
          { key: "A", text: "go" },
          { key: "B", text: "goes" },
          { key: "C", text: "went" },
          { key: "D", text: "going" }
        ],
        answer: "B. goes",
        explanation: "Use the third-person singular verb form after she/he/it in the present simple.",
        topic: "Subject-verb agreement"
      },
      {
        question: "Fill in the blank: It is important ___ (review) your notes before a test.",
        answer: "to review",
        explanation: "Use the infinitive after It is + adjective.",
        topic: "Infinitive"
      },
      {
        question: "Choose the best revision: He don't like reading long articles.",
        options: [
          { key: "A", text: "He doesn't like reading long articles." },
          { key: "B", text: "He don't likes reading long articles." },
          { key: "C", text: "He not like reading long articles." },
          { key: "D", text: "He didn't likes reading long articles." }
        ],
        answer: "A. He doesn't like reading long articles.",
        explanation: "Use doesn't with he/she/it in negative present-simple sentences.",
        topic: "Present simple"
      }
    ], {
      size: 0
    });
  }

  function shufflePracticeQuestions(questions) {
    const items = questions.slice();

    for (let index = items.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      const temp = items[index];
      items[index] = items[swapIndex];
      items[swapIndex] = temp;
    }

    return items;
  }

  function filterPracticeBankQuestions(bank, prompt) {
    const questions = bank && Array.isArray(bank.questions) ? bank.questions : [];
    const rawPrompt = String(prompt || "").trim().toLowerCase();

    if (!rawPrompt) {
      return questions;
    }

    const tokens = rawPrompt
      .split(/[\s,.;:!?，。；：！？、/\\|]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3)
      .slice(0, 8);

    if (!tokens.length) {
      return questions;
    }

    const matches = questions.filter((question) => {
      const haystack = [
        question.question,
        question.concentration,
        question.explanation,
        question.correctAnswer
      ].join(" ").toLowerCase();

      return tokens.some((token) => haystack.includes(token));
    });

    return matches.length ? matches : questions;
  }

  function renumberPracticeQuestions(questions, difficulty) {
    return questions.map((question, index) => Object.assign({}, question, {
      id: `${question.id || "local"}-${index + 1}`,
      number: index + 1,
      difficulty: question.difficulty || difficulty
    }));
  }

  function drawPracticeQuestionsFromBank(bank, count, difficulty, prompt) {
    const pool = filterPracticeBankQuestions(bank, prompt);
    return renumberPracticeQuestions(shufflePracticeQuestions(pool).slice(0, count), difficulty);
  }

  function buildSimulatedQuestionFromBankQuestion(question, index, difficulty, bankName, prompt) {
    const topic = String(prompt || question.concentration || bankName || "local bank").trim();
    const options = Array.isArray(question.options) ? question.options.map((option) => Object.assign({}, option)) : [];
    const lead = options.length
      ? "Choose the best answer for this same-pattern mock item:"
      : "Answer this same-pattern mock item:";

    return {
      id: `simulated-${index + 1}`,
      number: index + 1,
      type: question.type || (options.length ? "choice" : "written"),
      difficulty: question.difficulty || difficulty,
      concentration: `Simulated from ${bankName}${topic ? ` - ${topic}` : ""}`,
      question: `${lead} ${question.question}`,
      options,
      correctAnswer: question.correctAnswer || "Use the same rule as the source item.",
      explanation: question.explanation
        ? `Same rule as the source bank item: ${question.explanation}`
        : "This simulated item keeps the source bank's skill pattern so the answer can be checked against the same rule."
    };
  }

  function simulatePracticeQuestionsFromBank(bank, count, difficulty, prompt) {
    const pool = shufflePracticeQuestions(filterPracticeBankQuestions(bank, prompt));

    if (!pool.length) {
      return [];
    }

    return Array.from({ length: count }).map((_, index) => {
      const source = pool[index % pool.length];
      return buildSimulatedQuestionFromBankQuestion(source, index, difficulty, bank.name, prompt);
    });
  }

  function buildLocalPracticePayload(mode, bank, questions, difficulty) {
    const isSimulated = mode === "simulate";

    return {
      mode: "local-bank",
      backendLabel: "Mate local bank",
      routeLabel: "Local file",
      outputTitle: isSimulated ? "Simulated from local bank" : "Drawn from local bank",
      blocks: [
        {
          heading: isSimulated ? "Simulation source" : "Draw source",
          text: `${questions.length} question${questions.length === 1 ? "" : "s"} ${isSimulated ? "simulated from" : "drawn from"} ${bank.name}.`
        },
        {
          heading: "Practice flow",
          text: "The set opens in a separate practice window with navigation, answer card, timer, and model answers."
        }
      ],
      questions,
      scores: [
        { value: String(questions.length), label: "questions" },
        { value: difficulty, label: "difficulty" },
        { value: bank.name, label: "source" }
      ]
    };
  }

  function initGlobalVoiceInputs() {
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    const canListen = Boolean(SpeechRecognitionCtor);
    const voiceIdleTimeoutMs = 60000;
    const voiceSelector = [
      "textarea",
      "input:not([type])",
      "input[type='text']",
      "input[type='search']",
      "input[type='email']",
      "input[type='url']",
      "input[type='tel']"
    ].join(",");
    const unsupportedInputTypes = new Set([
      "button",
      "checkbox",
      "color",
      "date",
      "datetime-local",
      "file",
      "hidden",
      "image",
      "month",
      "number",
      "password",
      "radio",
      "range",
      "reset",
      "submit",
      "time",
      "week"
    ]);
    let activeField = null;
    let activeButton = null;
    let recognition = null;
    let isListening = false;
    let isRecognitionRunning = false;
    let stopRequested = false;
    let voiceBaseText = "";
    let voiceFinalText = "";
    let voiceInsertStart = 0;
    let voiceInsertEnd = 0;
    let voiceIdleTimer = null;
    let voiceLastActivityAt = 0;
    let scanQueued = false;

    function isVoiceEligibleField(field) {
      if (!field || field.dataset.voiceInputReady || field.dataset.voiceInputSkip === "true" || field.id === "chat-input") {
        return false;
      }

      if (field.matches("textarea")) {
        return true;
      }

      if (!field.matches("input")) {
        return false;
      }

      const type = String(field.getAttribute("type") || "text").toLowerCase();
      return !unsupportedInputTypes.has(type);
    }

    function setButtonState(button, state) {
      if (!button) {
        return;
      }

      button.classList.remove("is-listening", "is-unavailable");
      button.setAttribute("aria-pressed", state === "listening" ? "true" : "false");

      if (state === "listening") {
        button.classList.add("is-listening");
        button.title = "Stop voice input";
        button.setAttribute("aria-label", "Stop voice input");
        return;
      }

      if (!canListen) {
        button.classList.add("is-unavailable");
        button.disabled = true;
        button.title = "Voice input is unavailable in this browser";
        button.setAttribute("aria-label", "Voice input unavailable");
        return;
      }

      button.disabled = false;
      button.title = "Voice input";
      button.setAttribute("aria-label", "Voice input");
    }

    function normalizeTranscriptForField(field, transcript) {
      const raw = String(transcript || "").replace(/\s+/g, " ").trim();

      if (!raw) {
        return "";
      }

      if (field && String(field.type || "").toLowerCase() === "email") {
        return raw
          .toLowerCase()
          .replace(/\s+at\s+/g, "@")
          .replace(/\s+dot\s+/g, ".")
          .replace(/\s+/g, "");
      }

      return raw;
    }

    function buildInsertedText(baseValue, start, end, transcript) {
      const before = baseValue.slice(0, start);
      const after = baseValue.slice(end);
      const spacerBefore = before && transcript && !/\s$/.test(before) ? " " : "";
      const spacerAfter = after && transcript && !/^\s/.test(after) ? " " : "";

      return `${before}${spacerBefore}${transcript}${spacerAfter}${after}`;
    }

    function setFieldVoiceDraft(transcript) {
      if (!activeField) {
        return;
      }

      const spokenText = normalizeTranscriptForField(activeField, transcript);
      activeField.value = buildInsertedText(voiceBaseText, voiceInsertStart, voiceInsertEnd, spokenText);
      activeField.dispatchEvent(new Event("input", { bubbles: true }));
      activeField.focus();

      if (typeof activeField.setSelectionRange === "function") {
        const cursorAt = buildInsertedText(voiceBaseText, voiceInsertStart, voiceInsertEnd, spokenText).length - voiceBaseText.slice(voiceInsertEnd).length;
        activeField.setSelectionRange(cursorAt, cursorAt);
      }
    }

    function clearVoiceIdleTimer() {
      if (voiceIdleTimer) {
        window.clearTimeout(voiceIdleTimer);
        voiceIdleTimer = null;
      }
    }

    function scheduleVoiceIdleTimer() {
      clearVoiceIdleTimer();

      if (!isListening || !voiceLastActivityAt) {
        return;
      }

      const remainingMs = Math.max(1, voiceIdleTimeoutMs - (Date.now() - voiceLastActivityAt));
      voiceIdleTimer = window.setTimeout(function () {
        if (!isListening || !voiceLastActivityAt) {
          return;
        }

        if (Date.now() - voiceLastActivityAt >= voiceIdleTimeoutMs) {
          stopGlobalVoiceInput();
          return;
        }

        scheduleVoiceIdleTimer();
      }, remainingMs);
    }

    function markVoiceActivity() {
      voiceLastActivityAt = Date.now();
      scheduleVoiceIdleTimer();
    }

    function stopGlobalVoiceInput() {
      stopRequested = true;
      isListening = false;
      voiceLastActivityAt = 0;
      clearVoiceIdleTimer();

      if (recognition && isRecognitionRunning) {
        recognition.stop();
      }

      if (activeButton) {
        setButtonState(activeButton, "ready");
      }

      activeField = null;
      activeButton = null;
    }

    function startRecognitionEngine() {
      const nextRecognition = ensureRecognition();

      if (!nextRecognition || isRecognitionRunning || !isListening) {
        return;
      }

      try {
        nextRecognition.start();
      } catch (error) {
        if (error && error.name === "InvalidStateError") {
          return;
        }

        stopGlobalVoiceInput();
      }
    }

    function ensureRecognition() {
      if (recognition || !canListen) {
        return recognition;
      }

      recognition = new SpeechRecognitionCtor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language || "en-US";

      recognition.addEventListener("start", function () {
        isRecognitionRunning = true;
        stopRequested = false;
        setButtonState(activeButton, "listening");
      });

      recognition.addEventListener("result", function (event) {
        let interimText = "";
        let hasSpeechResult = false;

        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const transcript = event.results[index][0] ? event.results[index][0].transcript : "";
          hasSpeechResult = hasSpeechResult || Boolean(transcript.trim());

          if (event.results[index].isFinal) {
            voiceFinalText = `${voiceFinalText} ${transcript}`.trim();
          } else {
            interimText = `${interimText} ${transcript}`.trim();
          }
        }

        if (hasSpeechResult) {
          markVoiceActivity();
        }

        setFieldVoiceDraft(`${voiceFinalText} ${interimText}`);
      });

      recognition.addEventListener("error", function () {
        stopGlobalVoiceInput();
      });

      recognition.addEventListener("end", function () {
        isRecognitionRunning = false;

        if (isListening && !stopRequested) {
          window.setTimeout(startRecognitionEngine, 250);
          return;
        }

        clearVoiceIdleTimer();
        setButtonState(activeButton, "ready");
        activeField = null;
        activeButton = null;
      });

      return recognition;
    }

    function startGlobalVoiceInput(field, button) {
      const nextRecognition = ensureRecognition();

      if (!nextRecognition) {
        setButtonState(button, "unavailable");
        return;
      }

      if (isListening) {
        stopGlobalVoiceInput();
      }

      activeField = field;
      activeButton = button;
      voiceBaseText = field.value || "";
      voiceFinalText = "";
      voiceInsertStart = typeof field.selectionStart === "number" ? field.selectionStart : voiceBaseText.length;
      voiceInsertEnd = typeof field.selectionEnd === "number" ? field.selectionEnd : voiceInsertStart;
      isListening = true;
      stopRequested = false;
      voiceLastActivityAt = Date.now();
      setButtonState(button, "listening");
      scheduleVoiceIdleTimer();
      startRecognitionEngine();
    }

    function attachVoiceButton(field) {
      if (!isVoiceEligibleField(field)) {
        return;
      }

      const wrapper = document.createElement("span");
      const button = document.createElement("button");
      wrapper.className = "voice-input-shell";
      button.type = "button";
      button.className = "field-voice-button";
      button.innerHTML = `${buildIconMarkup("mic")}<span class="sr-only">Voice input</span>`;
      setButtonState(button, "ready");

      field.parentNode.insertBefore(wrapper, field);
      wrapper.appendChild(field);
      wrapper.appendChild(button);
      field.dataset.voiceInputReady = "true";

      button.addEventListener("click", function () {
        if (activeField === field && isListening) {
          stopGlobalVoiceInput();
          return;
        }

        startGlobalVoiceInput(field, button);
      });
    }

    function scanVoiceFields(root) {
      const scope = root && root.querySelectorAll ? root : document;
      const fields = [];

      if (root && root.matches && root.matches(voiceSelector)) {
        fields.push(root);
      }

      scope.querySelectorAll(voiceSelector).forEach((field) => fields.push(field));
      fields.forEach(attachVoiceButton);
    }

    function queueVoiceFieldScan(root) {
      if (scanQueued) {
        return;
      }

      scanQueued = true;
      window.requestAnimationFrame(function () {
        scanQueued = false;
        scanVoiceFields(root || document);
      });
    }

    scanVoiceFields(document);

    if (window.MutationObserver) {
      const observer = new MutationObserver(function (mutations) {
        const hasNewNodes = mutations.some((mutation) => Array.from(mutation.addedNodes || []).some((node) => node.nodeType === 1));

        if (hasNewNodes) {
          queueVoiceFieldScan(document);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    }
  }

  function createMessageMarkup(role, content) {
    const body = Array.isArray(content)
      ? content.map((line) => formatMessageText(line)).join("")
      : formatMessageText(content);
    const voiceAction = role === "assistant"
      ? `
        <div class="message-actions">
          <button class="message-speak-button" type="button" data-chat-speak-message>
            ${buildIconMarkup("volume")}
            <span>Read aloud</span>
          </button>
        </div>
      `
      : "";

    return `
      <article class="message ${role}">
        <span class="message-role">${role === "user" ? "Learner" : "Mate"}</span>
        ${body}
        ${voiceAction}
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

    if (!cards.length) {
      const queryInput = document.getElementById("kb-search");
      const query = queryInput ? queryInput.value.trim() : "";
      const filterLabel = buildFilterLabel(currentKbFilter);
      const helper = query
        ? `No items in ${filterLabel} match "${query}" yet. Try a broader search or switch views.`
        : `No items are visible in ${filterLabel} yet. Upload a file or add a note to fill this view.`;

      grid.innerHTML = `
        <article class="source-card source-card--empty">
          <h3>No library matches yet</h3>
          <p class="source-meta">${escapeHtml(helper)}</p>
        </article>
      `;
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

  function renderQuizResult(payload, options) {
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
      const blockMarkup = blockItems.map((block) => `
        <article class="output-block">
          <h3>${escapeHtml(block.heading)}</h3>
          <div class="rich-output">${formatMessageText(block.text)}</div>
        </article>
      `).join("");

      if (questionItems.length) {
        latestPracticePayload = payload;
        const opened = renderPracticeInWindow(payload, options && options.practiceWindow);
        blocks.innerHTML = buildPracticeLaunchMarkup(payload, opened);
      } else {
        latestPracticePayload = null;
        clearPracticeTimer();
        blocks.innerHTML = blockMarkup;

        if (options && options.practiceWindow) {
          writePracticeWindowDocument(
            options.practiceWindow,
            "No Practice Questions Returned",
            blockMarkup || `<article class="output-block">
              <h3>No practice questions returned</h3>
              <p>Try a clearer topic or reduce the question count, then generate again.</p>
            </article>`
          );
        }
      }
    }

    if (scores) {
      scores.innerHTML = questionItems.length ? "" : buildScoreCardsMarkup(scoreItems);
    }
  }

  function openPracticeWindow() {
    try {
      return window.open("", "mate-practice-session", "width=1280,height=860,menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes");
    } catch (error) {
      return null;
    }
  }

  function writePracticeWindowDocument(practiceWindow, title, bodyMarkup) {
    if (!practiceWindow || practiceWindow.closed) {
      return null;
    }

    const cssHref = new URL("styles.css", window.location.href).toString();
    const faviconHref = new URL("favicon.svg", window.location.href).toString();
    const safeTitle = escapeHtml(title || "Mate Practice Set");
    let doc;

    try {
      doc = practiceWindow.document;
      doc.open();
      doc.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
  <link rel="icon" type="image/svg+xml" href="${escapeAttribute(faviconHref)}">
  <link rel="stylesheet" href="${escapeAttribute(cssHref)}">
</head>
<body data-page="quiz" class="practice-window-page">
  <main class="practice-window-shell workspace-shell">
    <section class="practice-window-card output-card">
      <div class="practice-window-heading">
        <span class="small-label">Mate Practice</span>
        <h1>${safeTitle}</h1>
      </div>
      <div id="practice-window-root">${bodyMarkup}</div>
    </section>
  </main>
</body>
</html>`);
      doc.close();
    } catch (error) {
      return null;
    }

    return doc;
  }

  function writePracticeLoadingWindow(practiceWindow, count) {
    const loadingMarkup = `
      <article class="output-block">
        <h3>Generating practice set</h3>
        <p>Mate is preparing ${escapeHtml(count)} question${Number(count) === 1 ? "" : "s"}. This window will update automatically.</p>
      </article>
    `;
    writePracticeWindowDocument(practiceWindow, "Generating Practice Set", loadingMarkup);
  }

  function renderPracticeInWindow(payload, practiceWindow) {
    const questionItems = Array.isArray(payload.questions) ? payload.questions : [];
    if (!questionItems.length) {
      return false;
    }

    const targetWindow = practiceWindow && !practiceWindow.closed ? practiceWindow : openPracticeWindow();
    if (!targetWindow || targetWindow.closed) {
      return false;
    }

    const title = `${payload.outputTitle || "Generated practice set"} - ${questionItems.length} questions`;
    const doc = writePracticeWindowDocument(targetWindow, title, buildPracticeWindowMarkup(questionItems));
    if (!doc) {
      return false;
    }

    initPracticeWindowExam(doc);
    targetWindow.focus();
    return true;
  }

  function buildPracticeLaunchMarkup(payload, opened) {
    const questions = Array.isArray(payload.questions) ? payload.questions : [];
    const scores = Array.isArray(payload.scores) ? payload.scores : [];
    const scoreSummary = scores.length
      ? `<p>${scores.map((score) => `${escapeHtml(score.label)}: ${escapeHtml(score.value)}`).join(" / ")}</p>`
      : "";

    return `
      <article class="output-block practice-launch-card">
        <h3>${opened ? "Practice opened in a new window" : "Practice window was blocked"}</h3>
        <p>${opened
          ? `${questions.length} generated question${questions.length === 1 ? "" : "s"} are ready in the separate practice window.`
          : "Your browser blocked the practice window. Use the button below to open the generated set."}</p>
        ${scoreSummary}
        <button class="secondary-button" type="button" id="quiz-open-practice-window">Open practice window</button>
      </article>
    `;
  }

  function buildPracticeQuestionsMarkup(questions) {
    const totalScore = questions.reduce((sum, question) => sum + getPracticeQuestionScore(question), 0);
    const limitMinutes = Math.max(1, questions.length);

    return `
      <section class="practice-exam" aria-label="Generated practice questions" data-practice-exam data-practice-seconds="${limitMinutes * 60}">
        <div class="practice-exam-header">
          <div>
            <span class="small-label">Practice Set</span>
            <strong>${questions.length} question${questions.length === 1 ? "" : "s"} ready</strong>
          </div>
          <div class="practice-exam-meta">
            <span>限时：${limitMinutes}分钟</span>
            <span>题量：${questions.length}题</span>
            <span>总分：${totalScore}分</span>
          </div>
        </div>
        <div class="practice-exam-layout">
          <div class="practice-question-area">
            <div class="practice-question-toolbar">
              <span data-practice-progress>1/${questions.length}</span>
              <div>
                <button class="practice-nav-button" type="button" data-practice-prev>上一题</button>
                <button class="practice-nav-button" type="button" data-practice-next>下一题</button>
              </div>
            </div>
            <div class="practice-question-stage">
              ${questions.map((question, index) => buildPracticeQuestionMarkup(question, index)).join("")}
            </div>
          </div>
          <aside class="practice-answer-card" aria-label="Answer card">
            <div class="practice-answer-card-top">
              <strong>答题卡</strong>
              <span data-practice-completion>完成0道 / 共${questions.length}道</span>
            </div>
            ${buildPracticeAnswerGroups(questions)}
          </aside>
        </div>
        <div class="practice-submit-bar">
          <span class="practice-timer" data-practice-timer>${formatPracticeTimer(limitMinutes * 60)}</span>
          <span class="practice-submit-status" data-practice-submit-status>完成后点击交卷查看答题情况。</span>
          <button class="practice-submit-button" type="button" data-practice-submit>交卷</button>
        </div>
      </section>
    `;
  }

  function buildPracticeQuestionMarkup(question, index) {
    const number = Number(question.number || index + 1);
    const options = Array.isArray(question.options) ? question.options : [];
    const typeLabel = getPracticeQuestionTypeLabel(question);
    const score = getPracticeQuestionScore(question);
    const optionMarkup = options.length
      ? `
        <fieldset class="practice-options" aria-label="Question ${number} options">
          ${options.map((option) => `
            <label class="practice-choice-option">
              <input type="radio" name="practice-question-${index}" value="${escapeAttribute(option.key || option.text || "")}" data-practice-answer>
              <span class="practice-choice-dot" aria-hidden="true"></span>
              <span class="practice-choice-key">${escapeHtml(option.key || "")}.</span>
              <span class="practice-choice-text">${escapeHtml(option.text || "")}</span>
            </label>
          `).join("")}
        </fieldset>
      `
      : "";
    const answer = question.correctAnswer || "No model answer was returned.";
    const explanation = question.explanation || "No explanation was returned.";

    return `
      <article class="practice-question-card${index === 0 ? " is-active" : ""}" data-practice-question-index="${index}" data-practice-type="${escapeAttribute(typeLabel)}" data-practice-score="${score}">
        <div class="practice-question-top">
          <span class="status-chip is-file">Q${number}</span>
          <span>[${escapeHtml(typeLabel)}]（${score}分）</span>
        </div>
        ${question.concentration ? `<p class="practice-focus">${escapeHtml(question.concentration)}</p>` : ""}
        <h4>（ ）${escapeHtml(question.question || "")}</h4>
        ${optionMarkup}
        ${options.length ? "" : `
          <label class="practice-answer-box">
            <span>Your answer</span>
            <textarea placeholder="Type your answer here..." data-practice-answer></textarea>
          </label>
        `}
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

  function getPracticeQuestionTypeLabel(question) {
    const type = String(question && question.type || "").toLowerCase();
    const options = Array.isArray(question && question.options) ? question.options : [];

    if (type.includes("multi")) {
      return "多选题";
    }

    if (type.includes("judge") || type.includes("true") || type.includes("false")) {
      return "判断题";
    }

    if (options.length) {
      return "单选题";
    }

    return "简答题";
  }

  function getPracticeQuestionScore(question) {
    const typeLabel = getPracticeQuestionTypeLabel(question);

    if (typeLabel === "多选题") {
      return 3;
    }

    if (typeLabel === "简答题") {
      return 5;
    }

    return 2;
  }

  function buildPracticeAnswerGroups(questions) {
    const groups = [];

    questions.forEach((question, index) => {
      const label = getPracticeQuestionTypeLabel(question);
      let group = groups.find((item) => item.label === label);

      if (!group) {
        group = {
          label,
          score: getPracticeQuestionScore(question),
          questions: []
        };
        groups.push(group);
      }

      group.questions.push({
        index,
        number: Number(question.number || index + 1)
      });
    });

    return groups.map((group) => `
      <div class="practice-answer-group">
        <div class="practice-answer-group-title">
          <span>☆ [${escapeHtml(group.label)}]</span>
          <small>每题${group.score}分</small>
        </div>
        <div class="practice-answer-grid">
          ${group.questions.map((item) => `
            <button class="practice-answer-dot${item.index === 0 ? " is-active" : ""}" type="button" data-practice-jump="${item.index}">${item.number}</button>
          `).join("")}
        </div>
      </div>
    `).join("");
  }

  function formatPracticeTimer(totalSeconds) {
    const safeSeconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
    const minutes = Math.floor(safeSeconds / 60);
    const seconds = safeSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function clearPracticeTimer() {
    if (practiceTimerId) {
      const timerWindow = practiceTimerWindow && !practiceTimerWindow.closed ? practiceTimerWindow : window;
      timerWindow.clearInterval(practiceTimerId);
      practiceTimerId = null;
      practiceTimerWindow = window;
    }
  }

  function initPracticeExam(container) {
    clearPracticeTimer();

    const exam = container ? container.querySelector("[data-practice-exam]") : null;
    if (!exam) {
      return;
    }

    const questions = Array.from(exam.querySelectorAll("[data-practice-question-index]"));
    const answerDots = Array.from(exam.querySelectorAll("[data-practice-jump]"));
    const progress = exam.querySelector("[data-practice-progress]");
    const completion = exam.querySelector("[data-practice-completion]");
    const timer = exam.querySelector("[data-practice-timer]");
    const status = exam.querySelector("[data-practice-submit-status]");
    const prevButton = exam.querySelector("[data-practice-prev]");
    const nextButton = exam.querySelector("[data-practice-next]");
    let activeIndex = 0;
    let remainingSeconds = Number(exam.getAttribute("data-practice-seconds") || questions.length * 60);

    function isAnswered(question) {
      const checkedOption = question.querySelector("input[type='radio'][data-practice-answer]:checked");
      const writtenAnswer = question.querySelector("textarea[data-practice-answer]");
      return Boolean(checkedOption || (writtenAnswer && writtenAnswer.value.trim()));
    }

    function updateAnsweredState() {
      const answeredCount = questions.filter(isAnswered).length;

      answerDots.forEach((button) => {
        const targetIndex = Number(button.getAttribute("data-practice-jump") || 0);
        button.classList.toggle("is-answered", Boolean(questions[targetIndex] && isAnswered(questions[targetIndex])));
      });

      if (completion) {
        completion.textContent = `完成${answeredCount}道 / 共${questions.length}道`;
      }
    }

    function setActiveQuestion(index) {
      activeIndex = Math.max(0, Math.min(questions.length - 1, index));

      questions.forEach((question, questionIndex) => {
        question.classList.toggle("is-active", questionIndex === activeIndex);
      });

      answerDots.forEach((button) => {
        button.classList.toggle("is-active", Number(button.getAttribute("data-practice-jump") || 0) === activeIndex);
      });

      const activeQuestion = questions[activeIndex];
      if (progress && activeQuestion) {
        const typeLabel = activeQuestion.getAttribute("data-practice-type") || "单选题";
        const score = activeQuestion.getAttribute("data-practice-score") || "2";
        progress.textContent = `${activeIndex + 1}/${questions.length} [${typeLabel}]（${score}分）`;
      }

      if (prevButton) {
        prevButton.disabled = activeIndex === 0;
      }

      if (nextButton) {
        nextButton.disabled = activeIndex === questions.length - 1;
      }
    }

    exam.addEventListener("click", function (event) {
      const jumpButton = event.target.closest("[data-practice-jump]");
      const prev = event.target.closest("[data-practice-prev]");
      const next = event.target.closest("[data-practice-next]");
      const submit = event.target.closest("[data-practice-submit]");

      if (jumpButton) {
        setActiveQuestion(Number(jumpButton.getAttribute("data-practice-jump") || 0));
        return;
      }

      if (prev) {
        setActiveQuestion(activeIndex - 1);
        return;
      }

      if (next) {
        setActiveQuestion(activeIndex + 1);
        return;
      }

      if (submit) {
        clearPracticeTimer();
        updateAnsweredState();
        const answeredCount = questions.filter(isAnswered).length;
        const unansweredCount = questions.length - answeredCount;
        if (status) {
          status.textContent = unansweredCount
            ? `已交卷：完成${answeredCount}道，剩余${unansweredCount}道未答。`
            : `已交卷：${questions.length}道全部完成。`;
        }
      }
    });

    exam.addEventListener("change", updateAnsweredState);
    exam.addEventListener("input", updateAnsweredState);

    if (timer) {
      timer.textContent = formatPracticeTimer(remainingSeconds);
      practiceTimerId = window.setInterval(function () {
        remainingSeconds -= 1;
        timer.textContent = formatPracticeTimer(remainingSeconds);

        if (remainingSeconds <= 0) {
          clearPracticeTimer();
          if (status) {
            status.textContent = "时间到，请检查答题卡后交卷。";
          }
        }
      }, 1000);
    }

    setActiveQuestion(0);
    updateAnsweredState();
  }

  function buildPracticeWindowMarkup(questions) {
    const totalScore = questions.reduce((sum, question) => sum + getPracticeWindowQuestionScore(question), 0);
    const limitMinutes = Math.max(1, questions.length);

    return `
      <section class="practice-exam" aria-label="Generated practice questions" data-practice-exam data-practice-seconds="${limitMinutes * 60}">
        <div class="practice-exam-header">
          <div>
            <span class="small-label">Practice Set</span>
            <strong>${questions.length} question${questions.length === 1 ? "" : "s"} ready</strong>
          </div>
          <div class="practice-exam-meta">
            <span>${"\u9650\u65f6"}: ${limitMinutes}${"\u5206\u949f"}</span>
            <span>${"\u9898\u91cf"}: ${questions.length}${"\u9898"}</span>
            <span>${"\u603b\u5206"}: ${totalScore}${"\u5206"}</span>
          </div>
        </div>
        <div class="practice-exam-layout">
          <div class="practice-question-area">
            <div class="practice-question-toolbar">
              <span data-practice-progress>1/${questions.length}</span>
              <div>
                <button class="practice-nav-button" type="button" data-practice-prev>${"\u4e0a\u4e00\u9898"}</button>
                <button class="practice-nav-button" type="button" data-practice-next>${"\u4e0b\u4e00\u9898"}</button>
              </div>
            </div>
            <div class="practice-question-stage">
              ${questions.map((question, index) => buildPracticeWindowQuestionMarkup(question, index)).join("")}
            </div>
          </div>
          <aside class="practice-answer-card" aria-label="Answer card">
            <div class="practice-answer-card-top">
              <strong>${"\u7b54\u9898\u5361"}</strong>
              <span data-practice-completion>${"\u5b8c\u6210"}0${"\u9053"} / ${"\u5171"}${questions.length}${"\u9053"}</span>
            </div>
            ${buildPracticeWindowAnswerGroups(questions)}
          </aside>
        </div>
        <div class="practice-submit-bar">
          <span class="practice-timer" data-practice-timer>${formatPracticeTimer(limitMinutes * 60)}</span>
          <span class="practice-submit-status" data-practice-submit-status>${"\u5b8c\u6210\u540e\u70b9\u51fb\u4ea4\u5377\u67e5\u770b\u7b54\u9898\u60c5\u51b5\u3002"}</span>
          <button class="practice-submit-button" type="button" data-practice-submit>${"\u4ea4\u5377"}</button>
        </div>
      </section>
    `;
  }

  function buildPracticeWindowQuestionMarkup(question, index) {
    const number = Number(question.number || index + 1);
    const options = Array.isArray(question.options) ? question.options : [];
    const typeLabel = getPracticeWindowQuestionTypeLabel(question);
    const score = getPracticeWindowQuestionScore(question);
    const optionMarkup = options.length
      ? `
        <fieldset class="practice-options" aria-label="Question ${number} options">
          ${options.map((option) => `
            <label class="practice-choice-option">
              <input type="radio" name="practice-question-${index}" value="${escapeAttribute(option.key || option.text || "")}" data-practice-answer>
              <span class="practice-choice-dot" aria-hidden="true"></span>
              <span class="practice-choice-key">${escapeHtml(option.key || "")}.</span>
              <span class="practice-choice-text">${escapeHtml(option.text || "")}</span>
            </label>
          `).join("")}
        </fieldset>
      `
      : "";
    const answer = question.correctAnswer || "No model answer was returned.";
    const explanation = question.explanation || "No explanation was returned.";
    const questionPrefix = options.length ? '<span class="practice-question-blank">( )</span> ' : "";

    return `
      <article class="practice-question-card${index === 0 ? " is-active" : ""}" data-practice-question-index="${index}" data-practice-type="${escapeAttribute(typeLabel)}" data-practice-score="${score}">
        <div class="practice-question-top">
          <span class="status-chip is-file">Q${number}</span>
          <span>[${escapeHtml(typeLabel)}] (${score}${"\u5206"})</span>
        </div>
        ${question.concentration ? `<p class="practice-focus">${escapeHtml(question.concentration)}</p>` : ""}
        <h4>${questionPrefix}${escapeHtml(question.question || "")}</h4>
        ${optionMarkup}
        ${options.length ? "" : `
          <label class="practice-answer-box">
            <span>Your answer</span>
            <textarea placeholder="Type your answer here..." data-practice-answer></textarea>
          </label>
        `}
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

  function getPracticeWindowQuestionTypeLabel(question) {
    const type = String(question && question.type || "").toLowerCase();
    const options = Array.isArray(question && question.options) ? question.options : [];

    if (type.includes("multi")) {
      return "\u591a\u9009\u9898";
    }

    if (type.includes("judge") || type.includes("true") || type.includes("false")) {
      return "\u5224\u65ad\u9898";
    }

    if (options.length) {
      return "\u5355\u9009\u9898";
    }

    return "\u7b80\u7b54\u9898";
  }

  function getPracticeWindowQuestionScore(question) {
    const typeLabel = getPracticeWindowQuestionTypeLabel(question);

    if (typeLabel === "\u591a\u9009\u9898") {
      return 3;
    }

    if (typeLabel === "\u7b80\u7b54\u9898") {
      return 5;
    }

    return 2;
  }

  function buildPracticeWindowAnswerGroups(questions) {
    const groups = [];

    questions.forEach((question, index) => {
      const label = getPracticeWindowQuestionTypeLabel(question);
      let group = groups.find((item) => item.label === label);

      if (!group) {
        group = {
          label,
          score: getPracticeWindowQuestionScore(question),
          questions: []
        };
        groups.push(group);
      }

      group.questions.push({
        index,
        number: Number(question.number || index + 1)
      });
    });

    return groups.map((group) => `
      <div class="practice-answer-group">
        <div class="practice-answer-group-title">
          <span>* [${escapeHtml(group.label)}]</span>
          <small>${"\u6bcf\u9898"}${group.score}${"\u5206"}</small>
        </div>
        <div class="practice-answer-grid">
          ${group.questions.map((item) => `
            <button class="practice-answer-dot${item.index === 0 ? " is-active" : ""}" type="button" data-practice-jump="${item.index}">${item.number}</button>
          `).join("")}
        </div>
      </div>
    `).join("");
  }

  function initPracticeWindowExam(container) {
    clearPracticeTimer();

    const exam = container ? container.querySelector("[data-practice-exam]") : null;
    if (!exam) {
      return;
    }

    const timerWindow = exam.ownerDocument && exam.ownerDocument.defaultView ? exam.ownerDocument.defaultView : window;
    const questions = Array.from(exam.querySelectorAll("[data-practice-question-index]"));
    const answerDots = Array.from(exam.querySelectorAll("[data-practice-jump]"));
    const progress = exam.querySelector("[data-practice-progress]");
    const completion = exam.querySelector("[data-practice-completion]");
    const timer = exam.querySelector("[data-practice-timer]");
    const status = exam.querySelector("[data-practice-submit-status]");
    const prevButton = exam.querySelector("[data-practice-prev]");
    const nextButton = exam.querySelector("[data-practice-next]");
    let activeIndex = 0;
    let remainingSeconds = Number(exam.getAttribute("data-practice-seconds") || questions.length * 60);

    function isAnswered(question) {
      const checkedOption = question.querySelector("input[type='radio'][data-practice-answer]:checked");
      const writtenAnswer = question.querySelector("textarea[data-practice-answer]");
      return Boolean(checkedOption || (writtenAnswer && writtenAnswer.value.trim()));
    }

    function updateAnsweredState() {
      const answeredCount = questions.filter(isAnswered).length;

      answerDots.forEach((button) => {
        const targetIndex = Number(button.getAttribute("data-practice-jump") || 0);
        button.classList.toggle("is-answered", Boolean(questions[targetIndex] && isAnswered(questions[targetIndex])));
      });

      if (completion) {
        completion.textContent = `\u5b8c\u6210${answeredCount}\u9053 / \u5171${questions.length}\u9053`;
      }
    }

    function setActiveQuestion(index) {
      activeIndex = Math.max(0, Math.min(questions.length - 1, index));

      questions.forEach((question, questionIndex) => {
        question.classList.toggle("is-active", questionIndex === activeIndex);
      });

      answerDots.forEach((button) => {
        button.classList.toggle("is-active", Number(button.getAttribute("data-practice-jump") || 0) === activeIndex);
      });

      const activeQuestion = questions[activeIndex];
      if (progress && activeQuestion) {
        const typeLabel = activeQuestion.getAttribute("data-practice-type") || "\u5355\u9009\u9898";
        const score = activeQuestion.getAttribute("data-practice-score") || "2";
        progress.textContent = `${activeIndex + 1}/${questions.length} [${typeLabel}] (${score}\u5206)`;
      }

      if (prevButton) {
        prevButton.disabled = activeIndex === 0;
      }

      if (nextButton) {
        nextButton.disabled = activeIndex === questions.length - 1;
      }
    }

    exam.addEventListener("click", function (event) {
      const jumpButton = event.target.closest("[data-practice-jump]");
      const prev = event.target.closest("[data-practice-prev]");
      const next = event.target.closest("[data-practice-next]");
      const submit = event.target.closest("[data-practice-submit]");

      if (jumpButton) {
        setActiveQuestion(Number(jumpButton.getAttribute("data-practice-jump") || 0));
        return;
      }

      if (prev) {
        setActiveQuestion(activeIndex - 1);
        return;
      }

      if (next) {
        setActiveQuestion(activeIndex + 1);
        return;
      }

      if (submit) {
        clearPracticeTimer();
        updateAnsweredState();
        const answeredCount = questions.filter(isAnswered).length;
        const unansweredCount = questions.length - answeredCount;
        if (status) {
          status.textContent = unansweredCount
            ? `\u5df2\u4ea4\u5377\uff1a\u5b8c\u6210${answeredCount}\u9053\uff0c\u5269\u4f59${unansweredCount}\u9053\u672a\u7b54\u3002`
            : `\u5df2\u4ea4\u5377\uff1a${questions.length}\u9053\u5168\u90e8\u5b8c\u6210\u3002`;
        }
      }
    });

    exam.addEventListener("change", updateAnsweredState);
    exam.addEventListener("input", updateAnsweredState);

    if (timer) {
      timer.textContent = formatPracticeTimer(remainingSeconds);
      practiceTimerWindow = timerWindow;
      practiceTimerId = timerWindow.setInterval(function () {
        remainingSeconds -= 1;
        timer.textContent = formatPracticeTimer(remainingSeconds);

        if (remainingSeconds <= 0) {
          clearPracticeTimer();
          if (status) {
            status.textContent = "\u65f6\u95f4\u5230\uff0c\u8bf7\u68c0\u67e5\u7b54\u9898\u5361\u540e\u4ea4\u5377\u3002";
          }
        }
      }, 1000);
    }

    setActiveQuestion(0);
    updateAnsweredState();
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
        ? "Questions will open in a separate practice window."
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
    setValue("quiz-count", preset.count);
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
    const voiceInputButton = document.getElementById("chat-voice-input");
    const readSelectionButton = document.getElementById("chat-read-selection");
    const readLatestButton = document.getElementById("chat-read-latest");
    const stopSpeechButton = document.getElementById("chat-stop-speech");
    const speechStatus = document.getElementById("chat-speech-status");
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    const canListen = Boolean(SpeechRecognitionCtor);
    const canSpeak = Boolean(window.speechSynthesis && window.SpeechSynthesisUtterance);
    const voiceIdleTimeoutMs = 60000;
    let recognition = null;
    let isListening = false;
    let isRecognitionRunning = false;
    let voiceStopRequested = false;
    let voiceStopStatusText = "";
    let voiceStopStatusTone = "is-file";
    let voiceIdleTimer = null;
    let voiceLastActivityAt = 0;
    let voiceBaseText = "";
    let voiceFinalText = "";

    if (!thread || !form || !textarea) {
      return;
    }

    function updateSpeechStatus(text, tone) {
      if (speechStatus) {
        setBadge(speechStatus, text, tone || "is-file");
      }
    }

    function getSelectedSpeechText() {
      if (document.activeElement === textarea && textarea.selectionStart !== textarea.selectionEnd) {
        return textarea.value.slice(textarea.selectionStart, textarea.selectionEnd).trim();
      }

      const selection = window.getSelection ? window.getSelection() : null;
      return selection ? selection.toString().trim() : "";
    }

    function getMessageSpeechText(message) {
      if (!message) {
        return "";
      }

      const clone = message.cloneNode(true);
      clone.querySelectorAll(".message-actions, .message-role").forEach((node) => node.remove());
      return clone.textContent.replace(/\s+/g, " ").trim();
    }

    function getLatestAssistantMessage() {
      const messages = Array.from(thread.querySelectorAll(".message.assistant"));
      return messages.length ? messages[messages.length - 1] : null;
    }

    function syncSpeechButtons() {
      const selectedText = getSelectedSpeechText();
      const hasLatestAssistant = Boolean(getLatestAssistantMessage());

      function setButtonLabel(button, label) {
        const labelNode = button ? button.querySelector("span") : null;
        if (labelNode) {
          labelNode.textContent = label;
        } else if (button) {
          button.textContent = label;
        }
      }

      if (voiceInputButton) {
        voiceInputButton.disabled = !canListen;
        setButtonLabel(voiceInputButton, isListening ? "Stop listening" : "Voice input");
        voiceInputButton.setAttribute("aria-pressed", isListening ? "true" : "false");
      }

      if (readSelectionButton) {
        readSelectionButton.disabled = !canSpeak || !selectedText;
      }

      if (readLatestButton) {
        readLatestButton.disabled = !canSpeak || !hasLatestAssistant;
      }

      if (stopSpeechButton) {
        stopSpeechButton.disabled = !canSpeak || !window.speechSynthesis.speaking;
      }
    }

    function setTextareaVoiceDraft(transcript) {
      const spokenText = transcript.trim();
      textarea.value = [voiceBaseText, spokenText].filter(Boolean).join(voiceBaseText && spokenText ? " " : "");
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }

    function clearVoiceIdleTimer() {
      if (voiceIdleTimer) {
        window.clearTimeout(voiceIdleTimer);
        voiceIdleTimer = null;
      }
    }

    function scheduleVoiceIdleTimer() {
      clearVoiceIdleTimer();

      if (!isListening || !voiceLastActivityAt) {
        return;
      }

      const idleMs = Date.now() - voiceLastActivityAt;
      const remainingMs = Math.max(1, voiceIdleTimeoutMs - idleMs);

      voiceIdleTimer = window.setTimeout(function () {
        if (!isListening || !voiceLastActivityAt) {
          return;
        }

        if (Date.now() - voiceLastActivityAt >= voiceIdleTimeoutMs) {
          stopVoiceInput("Stopped after 1 min silence", "is-demo");
          return;
        }

        scheduleVoiceIdleTimer();
      }, remainingMs);
    }

    function markVoiceActivity() {
      voiceLastActivityAt = Date.now();
      scheduleVoiceIdleTimer();
    }

    function stopVoiceInput(statusText, tone) {
      voiceStopRequested = true;
      voiceStopStatusText = statusText || (canSpeak ? "Read aloud ready" : "Voice input ready");
      voiceStopStatusTone = tone || "is-file";
      isListening = false;
      voiceLastActivityAt = 0;
      clearVoiceIdleTimer();

      if (recognition && isRecognitionRunning) {
        recognition.stop();
      }

      updateSpeechStatus(voiceStopStatusText, voiceStopStatusTone);
      syncSpeechButtons();
    }

    function startRecognitionEngine() {
      const nextRecognition = ensureRecognition();

      if (!nextRecognition || isRecognitionRunning || !isListening) {
        return;
      }

      try {
        nextRecognition.start();
      } catch (error) {
        if (error && error.name === "InvalidStateError") {
          return;
        }

        stopVoiceInput("Voice input unavailable", "is-demo");
      }
    }

    function ensureRecognition() {
      if (recognition || !canListen) {
        return recognition;
      }

      recognition = new SpeechRecognitionCtor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language || "en-US";

      recognition.addEventListener("start", function () {
        isRecognitionRunning = true;
        isListening = true;
        voiceStopRequested = false;
        voiceStopStatusText = "";
        voiceStopStatusTone = "is-file";
        updateSpeechStatus("Listening - auto stops after 1 min silence", "is-live");
        scheduleVoiceIdleTimer();
        syncSpeechButtons();
      });

      recognition.addEventListener("result", function (event) {
        let interimText = "";
        let hasSpeechResult = false;

        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const transcript = event.results[index][0] ? event.results[index][0].transcript : "";
          hasSpeechResult = hasSpeechResult || Boolean(transcript.trim());

          if (event.results[index].isFinal) {
            voiceFinalText = `${voiceFinalText} ${transcript}`.trim();
          } else {
            interimText = `${interimText} ${transcript}`.trim();
          }
        }

        if (hasSpeechResult) {
          markVoiceActivity();
        }

        setTextareaVoiceDraft(`${voiceFinalText} ${interimText}`);
      });

      recognition.addEventListener("error", function (event) {
        if (event && ["audio-capture", "not-allowed", "service-not-allowed"].includes(event.error)) {
          stopVoiceInput("Voice input unavailable", "is-demo");
          return;
        }

        if (isListening) {
          updateSpeechStatus("Voice input paused - retrying", "is-demo");
        } else {
          updateSpeechStatus("Voice input unavailable", "is-demo");
        }
      });

      recognition.addEventListener("end", function () {
        isRecognitionRunning = false;

        if (isListening && !voiceStopRequested) {
          updateSpeechStatus("Listening - waiting for speech", "is-live");
          window.setTimeout(startRecognitionEngine, 250);
          syncSpeechButtons();
          return;
        }

        clearVoiceIdleTimer();
        isListening = false;
        updateSpeechStatus(voiceStopStatusText || (canSpeak ? "Read aloud ready" : "Voice input ready"), voiceStopStatusTone || "is-file");
        voiceStopStatusText = "";
        voiceStopStatusTone = "is-file";
        syncSpeechButtons();
      });

      return recognition;
    }

    function getSpeechLanguage(text) {
      return /[\u3400-\u9fff]/.test(text) ? "zh-CN" : "en-US";
    }

    function speakText(text, label) {
      const speechText = String(text || "").replace(/\s+/g, " ").trim();

      if (!speechText) {
        updateSpeechStatus("Select text first", "is-demo");
        return;
      }

      if (!canSpeak) {
        updateSpeechStatus("Read aloud unavailable", "is-demo");
        return;
      }

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(speechText);
      utterance.lang = getSpeechLanguage(speechText);
      utterance.rate = 0.95;
      utterance.pitch = 1;

      utterance.addEventListener("start", function () {
        updateSpeechStatus(label || "Reading aloud", "is-live");
        syncSpeechButtons();
      });

      utterance.addEventListener("end", function () {
        updateSpeechStatus("Read aloud ready", "is-file");
        syncSpeechButtons();
      });

      utterance.addEventListener("error", function () {
        updateSpeechStatus("Read aloud stopped", "is-demo");
        syncSpeechButtons();
      });

      window.speechSynthesis.speak(utterance);
      syncSpeechButtons();
    }

    function stopVoiceTools() {
      if (isListening) {
        stopVoiceInput(canSpeak ? "Read aloud ready" : "Voice ready", "is-file");
      }

      if (canSpeak) {
        window.speechSynthesis.cancel();
      }

      updateSpeechStatus(canSpeak ? "Read aloud ready" : "Voice ready", "is-file");
      syncSpeechButtons();
    }

    renderChatScenario("essay");
    setBadge(runtimeBadge, "Checking", "is-file");
    updateSpeechStatus(canSpeak ? "Read aloud ready" : canListen ? "Voice input ready" : "Voice unavailable", canSpeak || canListen ? "is-file" : "is-demo");
    syncSpeechButtons();

    chips.forEach((chip) => {
      chip.addEventListener("click", function () {
        const key = chip.getAttribute("data-chat-scenario");
        chips.forEach((item) => item.classList.remove("is-active"));
        chip.classList.add("is-active");
        renderChatScenario(key);
        syncSpeechButtons();
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
        syncSpeechButtons();
      });
    }

    if (voiceInputButton) {
      voiceInputButton.addEventListener("click", function () {
        if (isListening) {
          stopVoiceInput("Voice input stopped", "is-file");
          return;
        }

        const nextRecognition = ensureRecognition();
        if (!nextRecognition) {
          updateSpeechStatus("Voice input unavailable", "is-demo");
          syncSpeechButtons();
          return;
        }

        voiceBaseText = textarea.value.trim();
        voiceFinalText = "";
        isListening = true;
        voiceStopRequested = false;
        voiceLastActivityAt = Date.now();
        updateSpeechStatus("Listening - auto stops after 1 min silence", "is-live");
        scheduleVoiceIdleTimer();
        startRecognitionEngine();
        syncSpeechButtons();
      });
    }

    if (readSelectionButton) {
      readSelectionButton.addEventListener("click", function () {
        speakText(getSelectedSpeechText(), "Reading selected text");
      });
    }

    if (readLatestButton) {
      readLatestButton.addEventListener("click", function () {
        speakText(getMessageSpeechText(getLatestAssistantMessage()), "Reading latest reply");
      });
    }

    if (stopSpeechButton) {
      stopSpeechButton.addEventListener("click", stopVoiceTools);
    }

    thread.addEventListener("click", function (event) {
      const button = event.target.closest("[data-chat-speak-message]");
      if (!button) {
        return;
      }

      speakText(getMessageSpeechText(button.closest(".message")), "Reading reply");
    });

    document.addEventListener("selectionchange", syncSpeechButtons);
    textarea.addEventListener("keyup", syncSpeechButtons);
    textarea.addEventListener("mouseup", syncSpeechButtons);

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      const text = textarea.value.trim();
      const submitButton = form.querySelector("button[type='submit']");

      if (!text || !submitButton) {
        return;
      }

      thread.insertAdjacentHTML("beforeend", createMessageMarkup("user", text));
      thread.insertAdjacentHTML("beforeend", createMessageMarkup("assistant", ["Mate is preparing a coaching response..."]));
      syncSpeechButtons();

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
          syncSpeechButtons();
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
          syncSpeechButtons();
        }

        if (runtimeBadge) {
          setBadge(runtimeBadge, "Chat unavailable", "is-file");
        }

        setText("chat-route", "POST /api/chat");
        setText("chat-engine", "Mate writing coach");
      }

      submitButton.disabled = false;
      thread.scrollTop = thread.scrollHeight;
      syncSpeechButtons();
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
    const libraryCount = document.getElementById("kb-library-count");
    const libraryContext = document.getElementById("kb-library-context");
    const sideTitle = document.getElementById("kb-side-title");
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

    function updateFilterState(libraryCardCount, visibleDocCount) {
      const meta = getKbFilterMeta(currentKbFilter);
      filterButtons.forEach((button) => {
        button.classList.toggle("is-active", button.getAttribute("data-kb-filter") === currentKbFilter);
      });

      if (filterStatus) {
        setBadge(
          filterStatus,
          visibleDocCount > 0 ? `${meta.label} (${visibleDocCount})` : meta.label,
          visibleDocCount > 0 ? "is-file" : "is-demo"
        );
      }

      if (libraryContext) {
        libraryContext.textContent = meta.context;
      }

      if (libraryCount) {
        setBadge(
          libraryCount,
          `${libraryCardCount} match${libraryCardCount === 1 ? "" : "es"}`,
          libraryCardCount > 0 ? "is-file" : "is-demo"
        );
      }

      if (sideTitle) {
        sideTitle.textContent = meta.sideTitle;
      }
    }

    function syncKnowledgeSurface() {
      const visibleCount = activeDocs.filter((document) => matchesKbFilter(document, currentKbFilter)).length;
      const libraryCards = buildKnowledgeCards(search.value, activeDocs, currentKbFilter);
      renderDocuments(activeDocs);
      renderKnowledgeCards(libraryCards);
      updateDocStatus(`${visibleCount} visible / ${activeDocs.length} total`, "is-file");
      updateFilterState(libraryCards.length, visibleCount);
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
      setBadge(runtimeBadge, payload.mode === "proxy" ? "KB synced" : payload.mode === "mock" ? "Local store" : "Ready", payload.mode === "proxy" ? "is-live" : "is-demo");
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
        setBadge(runtimeBadge, payload.mode === "proxy" ? "KB synced" : payload.mode === "mock" ? "Local store" : "Ready", payload.mode === "proxy" ? "is-live" : "is-demo");
        setUploadProgress(100, payload.mode === "proxy" ? "Upload completed and synced" : payload.mode === "mock" ? "Upload saved locally" : "Upload saved");
        updateUploadStatus(
          payload.mode === "proxy"
            ? `${payload.uploadedCount || queuedFiles.length} file${(payload.uploadedCount || queuedFiles.length) > 1 ? "s" : ""} synced`
            : payload.mode === "mock"
              ? `${payload.uploadedCount || queuedFiles.length} file${(payload.uploadedCount || queuedFiles.length) > 1 ? "s" : ""} saved locally`
              : `${payload.uploadedCount || queuedFiles.length} file${(payload.uploadedCount || queuedFiles.length) > 1 ? "s" : ""} saved`,
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
        setBadge(runtimeBadge, payload.mode === "proxy" ? "KB synced" : "Ready", payload.mode === "proxy" ? "is-live" : "is-demo");
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
                  status: "Saved",
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
        setBadge(entryStatus, payload.mode === "proxy" ? "Saved to DeepTutor" : "Saved", payload.mode === "proxy" ? "is-live" : "is-demo");
        setBadge(runtimeBadge, payload.mode === "proxy" ? "KB synced" : "Local store", payload.mode === "proxy" ? "is-live" : "is-demo");
        entryForm.reset();
        submitButton.disabled = false;
      });
    }

    search.addEventListener("input", async function () {
      const query = search.value;
      const fallbackCards = buildKnowledgeCards(query, activeDocs, currentKbFilter);
      const visibleCount = activeDocs.filter((document) => matchesKbFilter(document, currentKbFilter)).length;
      const payload = await requestJson(
        "/api/kb/search",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            query: query,
            filter: currentKbFilter
          })
        },
        function () {
          return {
            mode: "demo",
            cards: fallbackCards
          };
        }
      );

      const nextCards = currentKbFilter === "all" && Array.isArray(payload.cards) ? payload.cards : fallbackCards;
      renderKnowledgeCards(nextCards);
      updateFilterState(nextCards.length, visibleCount);
      setBadge(runtimeBadge, payload.mode === "proxy" ? "KB search live" : "Ready", payload.mode === "proxy" ? "is-live" : "is-demo");
    });
  }

  function initQuiz() {
    const tabs = Array.from(document.querySelectorAll("[data-quiz-mode]"));
    const presetButtons = Array.from(document.querySelectorAll("[data-quiz-preset]"));
    const runButton = document.getElementById("quiz-run-button");
    const runtimeBadge = document.getElementById("quiz-runtime");
    const promptInput = document.getElementById("quiz-prompt-input");
    const difficultySelect = document.getElementById("quiz-difficulty");
    const countInput = document.getElementById("quiz-count");
    const bankFileInput = document.getElementById("quiz-bank-file");
    const bankStatus = document.getElementById("quiz-bank-status");
    const bankPreview = document.getElementById("quiz-bank-preview");
    const bankSampleButton = document.getElementById("quiz-bank-sample");
    const bankClearButton = document.getElementById("quiz-bank-clear");
    const bankDrawButton = document.getElementById("quiz-bank-draw");
    const bankSimulateButton = document.getElementById("quiz-bank-simulate");
    const bankHint = document.getElementById("quiz-bank-hint");

    if (!tabs.length || !runButton || !promptInput || !difficultySelect || !countInput) {
      return;
    }

    applyQuizPreset(currentQuizPreset);
    setBadge(runtimeBadge, "Checking", "is-file");
    localPracticeQuestionBank = loadStoredPracticeQuestionBank();

    function updateLocalQuestionBankUi(message, tone) {
      const bank = localPracticeQuestionBank;
      const hasBank = Boolean(bank && Array.isArray(bank.questions) && bank.questions.length);

      if (bankStatus) {
        setBadge(
          bankStatus,
          message || (hasBank ? `${bank.questions.length} questions loaded` : "No bank loaded"),
          tone || (hasBank ? "is-file" : "is-demo")
        );
      }

      if (bankPreview) {
        if (!hasBank) {
          bankPreview.innerHTML = "<li>No local bank loaded yet.</li>";
        } else {
          bankPreview.innerHTML = bank.questions.slice(0, 4).map((question) => `
            <li>
              <strong>${escapeHtml(question.question)}</strong>
              <span class="file-meta">${escapeHtml(question.concentration || question.type || "Practice item")}${question.correctAnswer ? ` - Answer: ${escapeHtml(question.correctAnswer)}` : ""}</span>
            </li>
          `).join("");
        }
      }

      if (bankDrawButton) {
        bankDrawButton.disabled = !hasBank;
      }

      if (bankSimulateButton) {
        bankSimulateButton.disabled = !hasBank;
      }

      if (bankClearButton) {
        bankClearButton.disabled = !hasBank;
      }

      if (bankHint) {
        bankHint.textContent = hasBank
          ? `Using ${bank.name}. Draw picks existing items; simulate creates same-pattern mock items.`
          : "Upload a local bank or load the sample bank first.";
      }
    }

    async function importQuestionBankFile(file) {
      if (!file) {
        return;
      }

      if (bankStatus) {
        setBadge(bankStatus, "Reading file", "is-file");
      }

      try {
        const text = await readLocalTextFile(file);
        const bank = parsePracticeQuestionBankFile(text, file.name, file);

        if (!bank.questions.length) {
          localPracticeQuestionBank = null;
          updateLocalQuestionBankUi("No valid questions found", "is-demo");
          return;
        }

        localPracticeQuestionBank = bank;
        persistPracticeQuestionBank(bank);
        updateLocalQuestionBankUi(`${bank.questions.length} questions loaded`, "is-live");
      } catch (error) {
        localPracticeQuestionBank = null;
        updateLocalQuestionBankUi(error.message || "Could not parse bank", "is-demo");
      }
    }

    function runLocalQuestionBank(mode) {
      const bank = localPracticeQuestionBank;

      if (!bank || !Array.isArray(bank.questions) || !bank.questions.length) {
        updateLocalQuestionBankUi("Upload a bank first", "is-demo");
        return;
      }

      const count = clampPracticeQuestionCount(countInput.value, 5);
      const difficulty = difficultySelect.value;
      const prompt = promptInput.value.trim();
      const questions = mode === "simulate"
        ? simulatePracticeQuestionsFromBank(bank, count, difficulty, prompt)
        : drawPracticeQuestionsFromBank(bank, Math.min(count, bank.questions.length), difficulty, prompt);

      countInput.value = mode === "simulate" ? count : questions.length;

      if (!questions.length) {
        updateLocalQuestionBankUi("No matching questions found", "is-demo");
        return;
      }

      const practiceWindow = openPracticeWindow();
      if (practiceWindow) {
        writePracticeLoadingWindow(practiceWindow, questions.length);
      }

      renderQuizResult(buildLocalPracticePayload(mode, bank, questions, difficulty), { practiceWindow });
      renderQuizFocus(mode === "simulate"
        ? ["Simulated from local bank patterns", "Keeps source answer keys visible for checking", "Use the prompt box to filter or steer topic"]
        : ["Random draw from local uploaded bank", "Uses the selected question count", "Keeps answers and explanations from the bank"]);
      setBadge(runtimeBadge, mode === "simulate" ? "Local simulation" : "Local draw", "is-file");
      updateLocalQuestionBankUi();
    }

    updateLocalQuestionBankUi();

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

    countInput.addEventListener("change", function () {
      countInput.value = clampPracticeQuestionCount(countInput.value, 5);
    });

    const outputBlocks = document.getElementById("quiz-output-blocks");
    if (outputBlocks) {
      outputBlocks.addEventListener("click", function (event) {
        const openButton = event.target.closest("#quiz-open-practice-window");
        if (!openButton || !latestPracticePayload) {
          return;
        }

        renderPracticeInWindow(latestPracticePayload, openPracticeWindow());
      });
    }

    if (bankFileInput) {
      bankFileInput.addEventListener("change", function () {
        importQuestionBankFile(bankFileInput.files && bankFileInput.files[0]);
        bankFileInput.value = "";
      });
    }

    if (bankSampleButton) {
      bankSampleButton.addEventListener("click", function () {
        localPracticeQuestionBank = buildSamplePracticeQuestionBank();
        persistPracticeQuestionBank(localPracticeQuestionBank);
        updateLocalQuestionBankUi("Sample bank loaded", "is-live");
      });
    }

    if (bankClearButton) {
      bankClearButton.addEventListener("click", function () {
        localPracticeQuestionBank = null;
        persistPracticeQuestionBank(null);
        updateLocalQuestionBankUi("Bank cleared", "is-demo");
      });
    }

    if (bankDrawButton) {
      bankDrawButton.addEventListener("click", function () {
        runLocalQuestionBank("draw");
      });
    }

    if (bankSimulateButton) {
      bankSimulateButton.addEventListener("click", function () {
        runLocalQuestionBank("simulate");
      });
    }

    runButton.addEventListener("click", async function () {
      const mode = quizModes[currentQuizMode];
      const prompt = promptInput.value.trim();
      const difficulty = difficultySelect.value;
      const count = clampPracticeQuestionCount(countInput.value, 5);
      const activePreset = quizPresets[currentQuizPreset];
      countInput.value = count;

      if (!prompt) {
        setBadge(runtimeBadge, "Add a prompt first", "is-demo");
        promptInput.focus();
        return;
      }

      let practiceWindow = null;
      if (currentQuizMode === "quiz") {
        practiceWindow = openPracticeWindow();
        if (practiceWindow) {
          writePracticeLoadingWindow(practiceWindow, count);
        }
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

        renderQuizResult(payload, { practiceWindow });
        setBadge(
          runtimeBadge,
          payload.mode === "proxy" ? "DeepTutor live" : "Ready",
          payload.mode === "proxy" ? "is-live" : payload.mode === "mock" ? "is-file" : "is-demo"
        );
      } catch (error) {
        if (practiceWindow && !practiceWindow.closed) {
          writePracticeWindowDocument(
            practiceWindow,
            "Practice generation failed",
            `<article class="output-block">
              <h3>Practice request failed</h3>
              <p>${escapeHtml(error.message || "Please try again.")}</p>
            </article>`
          );
        }
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
    initGlobalVoiceInputs();
    initDocumentExport();
    applyRuntimeSurfaceState();
  });
})();
