const dom = {
  loginForm: document.getElementById("loginForm"),
  loginUsername: document.getElementById("loginUsername"),
  loginPassword: document.getElementById("loginPassword"),
  loginMessage: document.getElementById("loginMessage"),
};

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function setAuthMessage(text, kind = "") {
  if (!dom.loginMessage) {
    return;
  }
  dom.loginMessage.textContent = text;
  dom.loginMessage.classList.toggle("error", kind === "error");
}

async function fetchSession() {
  const response = await fetch("/api/me", {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    return null;
  }
  return readJsonResponse(response);
}

async function submitLogin(username, password) {
  const response = await fetch("/api/login", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      username: String(username || "").trim(),
      password: String(password || ""),
    }),
  });

  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || "Invalid username or password.");
  }
  return payload;
}

async function initializeLogin() {
  const session = await fetchSession().catch(() => null);
  if (session?.authenticated) {
    window.location.replace("/home");
    return;
  }

  setAuthMessage("Use the shared AutoAce credentials to sign in.");

  dom.loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = dom.loginUsername?.value || "";
    const password = dom.loginPassword?.value || "";
    setAuthMessage("Signing in...");
    dom.loginForm.querySelector("button[type='submit']")?.setAttribute("disabled", "disabled");
    try {
      await submitLogin(username, password);
      window.location.replace("/home");
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : "Invalid username or password.", "error");
      dom.loginPassword?.focus();
    } finally {
      dom.loginForm.querySelector("button[type='submit']")?.removeAttribute("disabled");
    }
  });
}

void initializeLogin();
