const HEARTBEAT_MS = 20_000;

async function readClipboardText() {
	if (!navigator.clipboard?.readText) {
		throw new Error("Clipboard read is not available in this browser context.");
	}
	return await navigator.clipboard.readText();
}

async function writeClipboardText(text) {
	const value = String(text ?? "");
	if (navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(value);
		return;
	}
	const textarea = document.createElement("textarea");
	textarea.value = value;
	textarea.setAttribute("readonly", "");
	textarea.style.position = "fixed";
	textarea.style.left = "-10000px";
	textarea.style.top = "-10000px";
	document.body.appendChild(textarea);
	textarea.select();
	try {
		if (!document.execCommand("copy")) throw new Error("document.execCommand('copy') returned false.");
	} finally {
		textarea.remove();
	}
}

function sendHeartbeat() {
	chrome.runtime
		.sendMessage({
			type: "offscreen-heartbeat",
			sentAt: Date.now(),
		})
		.catch(() => {});
}

sendHeartbeat();
setInterval(sendHeartbeat, HEARTBEAT_MS);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (message?.target !== "offscreen") return false;
	(async () => {
		if (message?.type === "offscreen:clipboard-read") {
			sendResponse({ ok: true, text: await readClipboardText() });
			return;
		}
		if (message?.type === "offscreen:clipboard-write") {
			await writeClipboardText(message.text);
			sendResponse({ ok: true });
			return;
		}
		sendResponse({ ok: false, error: "Unknown offscreen message" });
	})().catch((error) => {
		sendResponse({ ok: false, error: error?.message || String(error) });
	});
	return true;
});
