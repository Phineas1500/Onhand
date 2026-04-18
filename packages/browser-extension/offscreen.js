const HEARTBEAT_MS = 20_000;

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
