const STORAGE_KEY = "emoney-conversations-v1";
const chatForm = document.querySelector("#chat-form");
const input = document.querySelector("#message-input");
const messagesNode = document.querySelector("#messages");
const welcome = document.querySelector("#welcome");
const sendButton = document.querySelector("#send-button");
const historyList = document.querySelector("#history-list");
const sidebar = document.querySelector("#sidebar");
const toast = document.querySelector("#toast");

let conversations = loadConversations();
let currentId = null;
let busy = false;
let toastTimer;

function loadConversations() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(saved) ? saved.filter(item =>
      item &&
      typeof item.id === "string" &&
      Array.isArray(item.messages) &&
      item.messages.every(message =>
        message &&
        ["user", "assistant"].includes(message.role) &&
        typeof message.content === "string"
      )
    ) : [];
  } catch (error) {
    console.error("Could not load saved chats.", error);
    return [];
  }
}

function saveConversations() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  } catch (error) {
    console.error("Could not save chats.", error);
    showToast("Could not save this chat on your device.");
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3600);
}

function activeConversation() {
  return conversations.find(item => item.id === currentId);
}

function renderHistory() {
  historyList.replaceChildren();
  for (const conversation of conversations) {
    const firstUserMessage = conversation.messages.find(message => message.role === "user");
    const button = document.createElement("button");
    button.type = "button";
    button.className = `history-item${conversation.id === currentId ? " active" : ""}`;
    button.textContent = firstUserMessage?.content.slice(0, 48) || "New chat";
    button.title = firstUserMessage?.content || "New chat";
    button.addEventListener("click", () => openConversation(conversation.id));
    historyList.append(button);
  }
}

function appendMessage(role, content, className = "") {
  const row = document.createElement("div");
  row.className = `message ${role}${className ? ` ${className}` : ""}`;
  if (role === "assistant") {
    const mark = document.createElement("span");
    mark.className = "message-mark";
    mark.textContent = "e";
    row.append(mark);
  }
  const body = document.createElement("div");
  body.className = "message-content";
  body.textContent = content;
  row.append(body);
  messagesNode.append(row);
  return row;
}

function renderConversation() {
  messagesNode.replaceChildren();
  const conversation = activeConversation();
  welcome.hidden = Boolean(conversation?.messages.length);
  if (conversation) {
    for (const message of conversation.messages) appendMessage(message.role, message.content);
  }
  messagesNode.scrollTop = messagesNode.scrollHeight;
}

function openConversation(id) {
  currentId = id;
  renderHistory();
  renderConversation();
  sidebar.classList.remove("open");
}

function newConversation() {
  currentId = null;
  renderHistory();
  renderConversation();
  input.focus();
  sidebar.classList.remove("open");
}

async function sendMessage(text) {
  if (busy || !text.trim()) return;
  const content = text.trim();
  let conversation = activeConversation();
  if (!conversation) {
    conversation = { id: crypto.randomUUID(), messages: [] };
    conversations.unshift(conversation);
    currentId = conversation.id;
  }
  conversation.messages.push({ role: "user", content });
  saveConversations();
  renderHistory();
  renderConversation();
  welcome.hidden = true;

  busy = true;
  sendButton.disabled = true;
  input.disabled = true;
  const typing = appendMessage("assistant", "Emoney is thinking", "typing");

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: conversation.messages.slice(-30) })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || `Request failed (${response.status}).`);
    }
    if (typeof result.reply !== "string" || !result.reply.trim()) {
      throw new Error("Emoney returned an empty reply. Please try again.");
    }
    typing.remove();
    conversation.messages.push({ role: "assistant", content: result.reply });
    saveConversations();
    if (currentId === conversation.id) {
      appendMessage("assistant", result.reply);
      messagesNode.scrollTop = messagesNode.scrollHeight;
    }
  } catch (error) {
    typing.remove();
    showToast(error.message || "Could not reach Emoney. Check your connection and try again.");
  } finally {
    busy = false;
    input.disabled = false;
    sendButton.disabled = !input.value.trim();
    input.focus();
  }
}

chatForm.addEventListener("submit", event => {
  event.preventDefault();
  const text = input.value;
  input.value = "";
  input.style.height = "auto";
  sendMessage(text);
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  sendButton.disabled = busy || !input.value.trim();
});

input.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

document.querySelectorAll(".suggestion").forEach(button => {
  button.addEventListener("click", () => {
    input.value = button.dataset.prompt || "";
    input.dispatchEvent(new Event("input"));
    input.focus();
  });
});

document.querySelector("#new-chat").addEventListener("click", newConversation);
document.querySelector("#clear-button").addEventListener("click", newConversation);
document.querySelector("#menu-button").addEventListener("click", () => sidebar.classList.toggle("open"));
document.querySelector("#settings-button").addEventListener("click", () => {
  showToast("Add your xAI API key as XAI_API_KEY on the server to enable AI replies.");
});

renderHistory();
renderConversation();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(error => {
      console.error("Could not register the service worker.", error);
    });
  });
}
