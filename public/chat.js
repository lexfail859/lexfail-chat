// Frontend for Nemotron chat: sends messages + selected model + optional system prompt.
// Minor improvements: escape HTML when inserting messages, allow selecting model & editing system prompt.

const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");
const typingIndicator = document.getElementById("typing-indicator");
const modelSelect = document.getElementById("model-select");
const togglePromptBtn = document.getElementById("toggle-prompt");
const promptArea = document.getElementById("prompt-area");
const systemPromptEl = document.getElementById("system-prompt");
const currentModelEl = document.getElementById("current-model");

let chatHistory = [
  { role: "assistant", content: "Hello! I’m Nemotron — how can I help?" }
];
let isProcessing = false;

// helpers
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function addMessageToChat(role, content) {
  const messageEl = document.createElement("div");
  messageEl.className = `message ${role}-message`;
  messageEl.innerHTML = `<p>${escapeHtml(content)}</p>`;
  chatMessages.appendChild(messageEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// UI bindings
userInput.addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = this.scrollHeight + "px";
});

userInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendButton.addEventListener("click", sendMessage);

togglePromptBtn.addEventListener("click", () => {
  promptArea.style.display = promptArea.style.display === "none" ? "block" : "none";
});

modelSelect.addEventListener("change", () => {
  currentModelEl.textContent = modelSelect.value;
});

async function sendMessage() {
  const message = userInput.value.trim();
  if (message === "" || isProcessing) return;

  isProcessing = true;
  userInput.disabled = true;
  sendButton.disabled = true;

  addMessageToChat("user", message);
  userInput.value = "";
  userInput.style.height = "auto";
  typingIndicator.style.display = "block";

  chatHistory.push({ role: "user", content: message });

  try {
    // create assistant placeholder
    const assistantMessageEl = document.createElement("div");
    assistantMessageEl.className = "message assistant-message";
    assistantMessageEl.innerHTML = "<p></p>";
    chatMessages.appendChild(assistantMessageEl);
    const assistantTextEl = assistantMessageEl.querySelector("p");
    chatMessages.scrollTop = chatMessages.scrollHeight;

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: chatHistory,
        modelId: modelSelect.value,
        systemPrompt: systemPromptEl ? systemPromptEl.value : undefined,
      }),
    });

    if (!response.ok) throw new Error("Failed to get response");
    if (!response.body) throw new Error("Response body is null");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let responseText = "";
    let buffer = "";

    const flushAssistantText = () => {
      assistantTextEl.innerHTML = escapeHtml(responseText);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    };

    // SSE-style processing
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        // process remaining
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      // Consume lines separated by \n\n (SSE)
      let eventEnd;
      while ((eventEnd = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, eventEnd);
        buffer = buffer.slice(eventEnd + 2);
        const lines = raw.split("\n");
        for (const line of lines) {
          if (line.startsWith("data:")) {
            const payload = line.slice("data:".length).trim();
            if (payload === "[DONE]") {
              // finished
              break;
            }
            try {
              const json = JSON.parse(payload);
              // support both "response" and OpenAI delta style
              let delta = "";
              if (typeof json.response === "string") delta = json.response;
              else if (json.choices?.[0]?.delta?.content) delta = json.choices[0].delta.content;
              responseText += delta;
              flushAssistantText();
            } catch (err) {
              // ignore parse errors for non-json data
            }
          }
        }
      }
    }

    if (responseText.length > 0) {
      chatHistory.push({ role: "assistant", content: responseText });
    }
  } catch (err) {
    console.error(err);
    addMessageToChat("assistant", "Sorry, there was an error processing your request.");
  } finally {
    typingIndicator.style.display = "none";
    isProcessing = false;
    userInput.disabled = false;
    sendButton.disabled = false;
    userInput.focus();
  }
}
