(async () => {
	const allowButton = document.getElementById("allowButton");
	const statusEl = document.getElementById("status");

	function setStatus(message, className = "") {
		statusEl.textContent = message;
		statusEl.className = className;
	}

	async function notify(payload) {
		try {
			await chrome.runtime.sendMessage({
				type: "mic-permission:result",
				...payload,
			});
		} catch {}
	}

	async function requestMicrophone() {
		allowButton.disabled = true;
		setStatus("Waiting for Chrome microphone permission...");
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: {
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true,
				},
			});
			for (const track of stream.getTracks()) track.stop();
			setStatus("Microphone permission granted. Returning to Onhand...", "ok");
			await notify({ ok: true });
			setTimeout(() => {
				window.close();
			}, 700);
		} catch (error) {
			const message = error?.message || String(error);
			setStatus(message || "Could not get microphone permission.", "error");
			await notify({ ok: false, error: message });
			allowButton.disabled = false;
		}
	}

	allowButton.addEventListener("click", () => {
		void requestMicrophone();
	});

	try {
		const permission = await navigator.permissions?.query?.({ name: "microphone" });
		if (permission?.state === "granted") {
			setStatus("Microphone permission is already granted. Returning to Onhand...", "ok");
			await notify({ ok: true });
			setTimeout(() => {
				window.close();
			}, 700);
		}
	} catch {}
})();
